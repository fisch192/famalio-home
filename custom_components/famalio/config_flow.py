"""UI setup and credential reauthentication for Famalio Home."""

from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.const import CONF_API_KEY, CONF_URL
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.hassio import HassioServiceInfo

from .api import FamalioApi, FamalioApiError, FamalioAuthError, normalize_origin, normalize_internal_origin
from .const import CONF_ADDON_SLUG, CONF_INTERNAL_URL, CONF_FAMILY_ID, CONF_INSTANCE_ID, CONF_INTEGRATION_ID, CONF_MAX_DAYS, CONF_PROJECTION, CONF_RECOVERY_EPOCH, CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


async def _validate(hass: HomeAssistant, origin: str, token: str,
                    *, internal_origin: str | None = None,
                    addon_slug: str | None = None) -> tuple[str, dict[str, Any]]:
    normalized = normalize_origin(origin)
    payload = await FamalioApi(async_get_clientsession(hass), normalized, token,
                              internal_origin=internal_origin, addon_slug=addon_slug).calendars()
    identities = ("instance_id", "recovery_epoch", "family_id", "integration_id")
    if not all(isinstance(payload.get(key), str) and payload[key] for key in identities):
        raise FamalioApiError("Famalio Home returned incomplete identity information")
    try:
        for key in ("instance_id", "family_id", "integration_id"):
            UUID(payload[key])
    except ValueError as err:
        raise FamalioApiError("Famalio Home returned invalid identity information") from err
    if not isinstance(payload.get("recovery_epoch"), str) or len(payload["recovery_epoch"]) > 128:
        raise FamalioApiError("Famalio Home returned invalid recovery information")
    max_days = payload.get("max_days")
    if type(max_days) is not int or not 1 <= max_days <= 90:
        raise FamalioApiError("Famalio Home returned an invalid time horizon")
    if payload.get("projection") not in ("full", "busy"):
        raise FamalioApiError("Famalio Home returned an invalid privacy projection")
    calendars = payload.get("calendars")
    if not isinstance(calendars, list) or not calendars or len(calendars) > 30:
        raise FamalioApiError("The integration token has no available calendars")
    seen: set[str] = set()
    for calendar in calendars:
        if not isinstance(calendar, dict):
            raise FamalioApiError("Famalio Home returned an invalid calendar")
        calendar_id = calendar.get("calendar_id")
        name = calendar.get("name")
        color = calendar.get("color")
        if (not isinstance(calendar_id, str) or not calendar_id or len(calendar_id) > 80
                or calendar_id in seen or not isinstance(name, str) or not name.strip()
                or len(name) > 120 or (color is not None and (not isinstance(color, str)
                    or len(color) != 7 or color[0] != "#"
                    or any(character not in "0123456789abcdefABCDEF" for character in color[1:])))):
            raise FamalioApiError("Famalio Home returned invalid calendar information")
        seen.add(calendar_id)
    return normalized, payload


class FamalioConfigFlow(ConfigFlow, domain=DOMAIN):
    """Configure an owner-created, read-only Famalio integration token."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        """Return the user-facing polling interval options flow."""
        return FamalioOptionsFlow()

    async def async_step_hassio(self, discovery_info: HassioServiceInfo) -> ConfigFlowResult:
        """Receive only a grant explicitly provided by the family owner."""
        supplied = discovery_info.config
        try:
            origin = normalize_origin(supplied[CONF_URL])
            token = supplied[CONF_API_KEY]
            if not isinstance(token, str) or not token.startswith("fhi_"):
                raise ValueError("Only a scoped integration credential is accepted")
            expected_instance = supplied[CONF_INSTANCE_ID]
            if not isinstance(expected_instance, str):
                raise ValueError("Missing server identity")
            UUID(expected_instance)
            data = {CONF_URL: origin, CONF_API_KEY: token,
                    CONF_INSTANCE_ID: expected_instance}
            if supplied.get(CONF_INTERNAL_URL) is not None:
                data[CONF_INTERNAL_URL] = normalize_internal_origin(
                    supplied[CONF_INTERNAL_URL], discovery_info.slug)
                data[CONF_ADDON_SLUG] = discovery_info.slug
        except (KeyError, TypeError, ValueError):
            return self.async_abort(reason="invalid_discovery")
        self._discovered = data
        self.context["title_placeholders"] = {"name": "Famalio Home"}
        return await self.async_step_hassio_confirm()

    async def async_step_hassio_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Validate TLS and scope, then let the HA user confirm the connection."""
        errors: dict[str, str] = {}
        data = self._discovered
        if user_input is not None:
            try:
                origin, metadata = await _validate(
                    self.hass, data[CONF_URL], data[CONF_API_KEY],
                    internal_origin=data.get(CONF_INTERNAL_URL),
                    addon_slug=data.get(CONF_ADDON_SLUG))
                if metadata[CONF_INSTANCE_ID] != data[CONF_INSTANCE_ID]:
                    raise FamalioApiError("The discovered server identity changed")
            except ValueError:
                errors["base"] = "invalid_url"
            except FamalioAuthError:
                errors["base"] = "invalid_auth"
            except FamalioApiError:
                errors["base"] = "cannot_connect"
            else:
                values = {**data, CONF_URL: origin, **{
                    key: metadata[key] for key in (CONF_INSTANCE_ID, CONF_RECOVERY_EPOCH,
                        CONF_FAMILY_ID, CONF_INTEGRATION_ID, CONF_MAX_DAYS, CONF_PROJECTION)
                }}
                await self.async_set_unique_id(f"{metadata[CONF_INSTANCE_ID]}:{metadata[CONF_FAMILY_ID]}")
                self._abort_if_unique_id_configured(updates=values, reload_on_update=True)
                return self.async_create_entry(title="Famalio Home", data=values)
        return self.async_show_form(step_id="hassio_confirm", data_schema=vol.Schema({}),
                                    errors=errors, description_placeholders={"url": data[CONF_URL]})

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                origin, metadata = await _validate(self.hass, user_input[CONF_URL], user_input[CONF_API_KEY])
            except ValueError:
                errors["base"] = "invalid_url"
            except FamalioAuthError:
                errors["base"] = "invalid_auth"
            except FamalioApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(f"{metadata[CONF_INSTANCE_ID]}:{metadata[CONF_FAMILY_ID]}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title="Famalio Home",
                    data={
                        CONF_URL: origin,
                        CONF_API_KEY: user_input[CONF_API_KEY],
                        CONF_INSTANCE_ID: metadata[CONF_INSTANCE_ID],
                        CONF_RECOVERY_EPOCH: metadata[CONF_RECOVERY_EPOCH],
                        CONF_FAMILY_ID: metadata[CONF_FAMILY_ID],
                        CONF_INTEGRATION_ID: metadata[CONF_INTEGRATION_ID],
                        CONF_MAX_DAYS: metadata[CONF_MAX_DAYS],
                        CONF_PROJECTION: metadata[CONF_PROJECTION],
                    },
                )
        schema = vol.Schema({
            vol.Required(CONF_URL): str,
            vol.Required(CONF_API_KEY): str,
        })
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        self._reauth_entry = self._get_reauth_entry()
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        entry = self._reauth_entry
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                origin, metadata = await _validate(
                    self.hass, user_input[CONF_URL], user_input[CONF_API_KEY],
                    internal_origin=entry.data.get(CONF_INTERNAL_URL)
                        if normalize_origin(user_input[CONF_URL]) == entry.data[CONF_URL] else None,
                    addon_slug=entry.data.get(CONF_ADDON_SLUG))
            except ValueError:
                errors["base"] = "invalid_url"
            except FamalioAuthError:
                errors["base"] = "invalid_auth"
            except FamalioApiError:
                errors["base"] = "cannot_connect"
            else:
                if (metadata[CONF_INSTANCE_ID] != entry.data[CONF_INSTANCE_ID]
                        or metadata[CONF_FAMILY_ID] != entry.data[CONF_FAMILY_ID]):
                    errors["base"] = "server_changed"
                    return self.async_show_form(
                        step_id="reauth_confirm",
                        data_schema=vol.Schema({
                            vol.Required(CONF_URL, default=entry.data[CONF_URL]): str,
                            vol.Required(CONF_API_KEY): str,
                        }),
                        errors=errors,
                    )
                new_data = {
                    **entry.data,
                    CONF_URL: origin,
                    CONF_API_KEY: user_input[CONF_API_KEY],
                    CONF_INSTANCE_ID: metadata[CONF_INSTANCE_ID],
                    CONF_RECOVERY_EPOCH: metadata[CONF_RECOVERY_EPOCH],
                    CONF_FAMILY_ID: metadata[CONF_FAMILY_ID],
                    CONF_INTEGRATION_ID: metadata[CONF_INTEGRATION_ID],
                    CONF_MAX_DAYS: metadata[CONF_MAX_DAYS],
                    CONF_PROJECTION: metadata[CONF_PROJECTION],
                }
                if origin != entry.data[CONF_URL]:
                    new_data.pop(CONF_INTERNAL_URL, None)
                    new_data.pop(CONF_ADDON_SLUG, None)
                return self.async_update_reload_and_abort(entry, data=new_data)
        schema = vol.Schema({
            vol.Required(CONF_URL, default=entry.data[CONF_URL]): str,
            vol.Required(CONF_API_KEY): str,
        })
        return self.async_show_form(step_id="reauth_confirm", data_schema=schema, errors=errors)


class FamalioOptionsFlow(OptionsFlow):
    """Manage the polling interval without exposing connection credentials."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = self.config_entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        if type(current) is not int or not 30 <= current <= 3600:
            current = DEFAULT_SCAN_INTERVAL
        schema = vol.Schema({
            vol.Required(CONF_SCAN_INTERVAL, default=current): vol.All(int, vol.Range(min=30, max=3600)),
        })
        return self.async_show_form(step_id="init", data_schema=schema)
