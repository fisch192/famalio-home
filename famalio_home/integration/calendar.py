"""Famalio Home calendar entities (editable when the owner allowed it)."""

from __future__ import annotations

from datetime import date, datetime
import logging
from typing import Any

from homeassistant.components.calendar import CalendarEntity, CalendarEntityFeature, CalendarEvent
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import dt as dt_util

from . import FamalioCalendarCoordinator
from .api import FamalioApiError, FamalioAuthError, FamalioConflictError
from .const import DOMAIN
from .events import clamp_interval, parse_event, write_payload

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: FamalioCalendarCoordinator = entry.runtime_data
    async_add_entities(
        FamalioCalendarEntity(coordinator, calendar)
        for calendar in coordinator.data["calendars"]
    )


class FamalioCalendarEntity(CoordinatorEntity[FamalioCalendarCoordinator], CalendarEntity):
    """A single owner-authorized calendar; writable only with an owner-approved write grant."""

    _attr_has_entity_name = True

    def __init__(self, coordinator: FamalioCalendarCoordinator, calendar: dict[str, Any]) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self.calendar = calendar
        self._attr_name = calendar["name"]
        self._attr_unique_id = (
            f"{coordinator.entry.data['instance_id']}:"
            f"{coordinator.entry.data['family_id']}:"
            f"{calendar['calendar_id']}"
        )
        self._attr_device_info = {
            "identifiers": {(DOMAIN, f"{coordinator.entry.data['instance_id']}:{coordinator.entry.data['family_id']}")},
            "name": "Famalio Home",
            "manufacturer": "Famalio",
        }
        color = calendar.get("color")
        if isinstance(color, str) and len(color) == 7 and color.startswith("#"):
            self._attr_initial_color = color
        self._attr_available = coordinator.last_update_success

    @property
    def available(self) -> bool:
        return self.coordinator.last_update_success and any(
            item.get("calendar_id") == self.calendar["calendar_id"]
            for item in self.coordinator.data.get("calendars", [])
        )

    @property
    def supported_features(self) -> CalendarEntityFeature:
        metadata = (self.coordinator.data or {}).get("metadata") or {}
        if metadata.get("access") == "write" and metadata.get("projection") == "full":
            return (CalendarEntityFeature.CREATE_EVENT | CalendarEntityFeature.UPDATE_EVENT
                    | CalendarEntityFeature.DELETE_EVENT)
        return CalendarEntityFeature(0)

    async def async_create_event(self, **kwargs: Any) -> None:
        payload = self._payload(kwargs)
        await self._write(lambda: self.coordinator.api.create_event(self.calendar["calendar_id"], payload))

    async def async_update_event(self, uid: str, event: dict[str, Any],
                                 recurrence_id: str | None = None,
                                 recurrence_range: str | None = None) -> None:
        if recurrence_id or recurrence_range:
            raise HomeAssistantError("Edit repeating events in the Famalio app")
        payload = self._payload(event)
        await self._write(lambda: self.coordinator.api.update_event(self.calendar["calendar_id"], uid, payload))

    async def async_delete_event(self, uid: str, recurrence_id: str | None = None,
                                 recurrence_range: str | None = None) -> None:
        if recurrence_id or recurrence_range:
            raise HomeAssistantError("Delete repeating events in the Famalio app")
        await self._write(lambda: self.coordinator.api.delete_event(self.calendar["calendar_id"], uid))

    def _payload(self, event: dict[str, Any]) -> dict[str, Any]:
        try:
            return write_payload(event, self.hass.config.time_zone)
        except ValueError as err:
            raise HomeAssistantError(str(err)) from err

    async def _write(self, call: Any) -> None:
        if not self.supported_features:
            raise HomeAssistantError("This Famalio connection can only read events")
        try:
            await call()
        except FamalioAuthError as err:
            self.coordinator.entry.async_start_reauth(self.hass)
            raise HomeAssistantError("Famalio Home integration needs reauthentication") from err
        except FamalioConflictError as err:
            raise HomeAssistantError(str(err)) from err
        except FamalioApiError as err:
            raise HomeAssistantError("Could not save the event in Famalio Home") from err
        await self.coordinator.async_request_refresh()

    @property
    def event(self) -> CalendarEvent | None:
        if not self.available:
            return None
        now = dt_util.now()
        upcoming = self.coordinator.data["events"].get(self.calendar["calendar_id"], [])
        candidates = [_to_calendar_event(item) for item in upcoming]
        return next((event for event in candidates if _event_end_after(event.end, now)), None)

    async def async_get_events(self, hass: HomeAssistant, start_date: datetime, end_date: datetime) -> list[CalendarEvent]:
        if not self.available or not self.coordinator.data.get("metadata"):
            return []
        window = clamp_interval(
            start_date, end_date, dt_util.now(), int(self.coordinator.data["metadata"]["max_days"])
        )
        if window is None:
            return []
        clipped_start, clipped_end = window
        try:
            payload = await self.coordinator.api.events(
                self.calendar["calendar_id"], clipped_start, clipped_end, hass.config.time_zone
            )
        except FamalioAuthError as err:
            self.coordinator.async_set_updated_data(
                {"metadata": {}, "calendars": [], "events": {}, "updated_at": None}
            )
            self.coordinator.entry.async_start_reauth(hass)
            raise HomeAssistantError("Famalio Home integration needs reauthentication") from err
        except Exception as err:
            raise HomeAssistantError("Could not read events from Famalio Home") from err
        return [_to_calendar_event(item) for item in payload]


def _to_calendar_event(item: dict[str, Any]) -> CalendarEvent:
    try:
        return CalendarEvent(**parse_event(item))
    except (KeyError, TypeError, ValueError) as err:
        raise HomeAssistantError("Famalio Home returned an invalid event") from err


def _event_end_after(value: date | datetime, now: datetime) -> bool:
    if isinstance(value, datetime):
        return value > now
    return value > now.date()
