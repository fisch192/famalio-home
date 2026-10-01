"""Famalio Home read-only calendar integration."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import FamalioApi, FamalioApiError, FamalioAuthError
from .const import CONF_ADDON_SLUG, CONF_INTERNAL_URL, CONF_FAMILY_ID, CONF_INSTANCE_ID, CONF_INTEGRATION_ID, CONF_MAX_DAYS, CONF_PROJECTION, CONF_RECOVERY_EPOCH, CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL, DOMAIN, PLATFORMS

_LOGGER = logging.getLogger(__name__)

type FamalioConfigEntry = ConfigEntry


class FamalioCalendarCoordinator(DataUpdateCoordinator[dict]):
    """Refresh calendar metadata and a bounded event window as one unit."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, api: FamalioApi) -> None:
        self.api = api
        self.entry = entry
        interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        if type(interval) is not int or not 30 <= interval <= 3600:
            interval = DEFAULT_SCAN_INTERVAL
        super().__init__(
            hass,
            _LOGGER,
            name=f"Famalio {entry.data[CONF_URL]}",
            update_interval=timedelta(seconds=interval),
        )

    async def _async_update_data(self) -> dict:
        from homeassistant.util import dt as dt_util

        try:
            metadata = await self.api.calendars()
            if (metadata.get("integration_id") != self.entry.data[CONF_INTEGRATION_ID]
                    or metadata.get("instance_id") != self.entry.data[CONF_INSTANCE_ID]
                    or metadata.get("recovery_epoch") != self.entry.data[CONF_RECOVERY_EPOCH]
                    or metadata.get("family_id") != self.entry.data[CONF_FAMILY_ID]):
                self.data = {"metadata": {}, "calendars": [], "events": {}, "updated_at": None}
                raise ConfigEntryAuthFailed("Famalio Home instance or grant identity changed")
            calendars = metadata.get("calendars")
            if not isinstance(calendars, list):
                raise UpdateFailed("Famalio Home returned invalid calendars")
            max_days = int(metadata.get("max_days", self.entry.data[CONF_MAX_DAYS]))
            now = dt_util.now()
            past_days = min(2, max_days // 4)
            start = now - timedelta(days=past_days)
            end = now + timedelta(days=max_days - past_days)
            events: dict[str, list[dict]] = {}
            for calendar in calendars:
                calendar_id = calendar.get("calendar_id")
                if not isinstance(calendar_id, str):
                    raise UpdateFailed("Famalio Home returned an invalid calendar id")
                events[calendar_id] = await self.api.events(calendar_id, start, end, self.hass.config.time_zone)
            return {"metadata": metadata, "calendars": calendars, "events": events, "updated_at": now}
        except FamalioAuthError as err:
            # Never serve potentially private cached calendar content after the
            # owner revokes the integration credential.
            self.data = {"metadata": {}, "calendars": [], "events": {}, "updated_at": None}
            raise ConfigEntryAuthFailed from err
        except FamalioApiError as err:
            raise UpdateFailed(str(err)) from err


async def async_setup_entry(hass: HomeAssistant, entry: FamalioConfigEntry) -> bool:
    api = FamalioApi(async_get_clientsession(hass), entry.data[CONF_URL], entry.data[CONF_API_KEY],
                     internal_origin=entry.data.get(CONF_INTERNAL_URL),
                     addon_slug=entry.data.get(CONF_ADDON_SLUG))
    coordinator = FamalioCalendarCoordinator(hass, entry, api)
    try:
        await coordinator.async_config_entry_first_refresh()
    except ConfigEntryAuthFailed:
        raise
    except Exception as err:
        raise ConfigEntryNotReady from err
    entry.runtime_data = coordinator
    entry.async_on_unload(entry.add_update_listener(update_listener))
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True


async def update_listener(hass: HomeAssistant, entry: FamalioConfigEntry) -> None:
    """Reload the coordinator when the polling interval changes."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: FamalioConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
