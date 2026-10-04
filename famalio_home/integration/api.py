"""Small strict HTTP client for the scoped Famalio Home calendar API."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from aiohttp import ClientError, ClientSession

from .events import format_api_datetime


class FamalioApiError(Exception):
    """Raised for invalid API responses and non-auth HTTP errors."""


class FamalioAuthError(FamalioApiError):
    """The integration credential is invalid or has been revoked."""


class FamalioConflictError(FamalioApiError):
    """The event cannot be changed from Home Assistant (series or imported mirror)."""


def normalize_origin(value: str) -> str:
    """Validate and normalize a TLS origin without path/query credentials."""
    if not isinstance(value, str):
        raise ValueError("The server address must be text")
    parsed = urlsplit(value.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Famalio Home requires an HTTPS origin")
    if parsed.query or parsed.fragment:
        raise ValueError("The server address cannot include a query or fragment")
    if parsed.path not in ("", "/"):
        raise ValueError("The server address must be an origin without a path")
    if parsed.port is not None and not 1 <= parsed.port <= 65535:
        raise ValueError("The server port is invalid")
    if parsed.hostname.endswith("."):
        raise ValueError("The server hostname must not have a trailing dot")
    return urlunsplit(("https", parsed.netloc, "", "", ""))


def normalize_internal_origin(value: str, addon_slug: str) -> str:
    """Accept only this Supervisor-discovered app's unpublished TLS relay."""
    if not isinstance(addon_slug, str) or not re.fullmatch(r"[a-z0-9]+_famalio_home", addon_slug):
        raise ValueError("Unexpected Famalio app identity")
    expected = f"https://{addon_slug.replace('_', '-')}:9443"
    if normalize_origin(value) != expected:
        raise ValueError("The internal relay does not belong to this app")
    return expected


async def _status_error(response: Any) -> str:
    """Name the HTTP status and, for client errors, the server's own short reason.

    The server only sends fixed, content-free messages (never tokens or event data), so
    quoting it makes a rejected request diagnosable from the Home Assistant UI.
    """
    text = f"Famalio Home returned HTTP {response.status}"
    if 400 <= response.status < 500:
        try:
            payload = await response.json(content_type=None)
        except (ClientError, TimeoutError, ValueError):
            return text
        message = payload.get("message") if isinstance(payload, dict) else None
        if isinstance(message, str) and message.strip():
            return f"{text}: {' '.join(message.split())[:160]}"
    return text


class FamalioApi:
    """Calls only the scoped HA calendar routes; redirects are never followed."""

    def __init__(self, session: ClientSession, origin: str, token: str,
                 *, internal_origin: str | None = None, addon_slug: str | None = None) -> None:
        self._session = session
        self._origin = normalize_origin(origin)
        self._token = token
        self._internal_origin = None
        if internal_origin is not None:
            self._internal_origin = normalize_internal_origin(internal_origin, addon_slug or "")
            if not urlsplit(self._origin).hostname.endswith(".ts.net"):
                raise ValueError("The internal TLS relay requires the app's Tailscale certificate")

    async def _get(self, path: str, params: dict[str, str] | None = None) -> dict[str, Any]:
        return await self._request("GET", path, params=params)

    async def _request(self, method: str, path: str, *, params: dict[str, str] | None = None,
                       json: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            async with self._session.request(
                method,
                f"{self._internal_origin or self._origin}{path}",
                params=params,
                json=json,
                headers={"Authorization": f"Bearer {self._token}"},
                allow_redirects=False,
                timeout=15,
                # Only the network destination changes. The normal CA chain,
                # hostname and expiry checks still use the public certificate.
                **({"server_hostname": urlsplit(self._origin).hostname}
                   if self._internal_origin else {}),
            ) as response:
                if response.status == 401:
                    raise FamalioAuthError("The Famalio Home integration token is invalid or revoked")
                if response.status == 409:
                    raise FamalioConflictError("Edit repeating or imported events in the Famalio app")
                if response.status >= 300:
                    raise FamalioApiError(await _status_error(response))
                if response.status == 204:
                    return {}
                payload = await response.json(content_type=None)
                if not isinstance(payload, dict):
                    raise FamalioApiError("Famalio Home returned an invalid response")
                return payload
        except FamalioApiError:
            raise
        except (ClientError, TimeoutError, ValueError) as err:
            raise FamalioApiError("Cannot connect to Famalio Home") from err

    async def calendars(self) -> dict[str, Any]:
        return await self._get("/v1/ha/calendars")

    async def events(self, calendar_id: str, start: datetime, end: datetime, timezone: str) -> list[dict[str, Any]]:
        path_id = quote(calendar_id, safe="")
        payload = await self._get(
            f"/v1/ha/calendars/{path_id}/events",
            {
                "start": format_api_datetime(start),
                "end": format_api_datetime(end),
                "tz": timezone,
            },
        )
        events = payload.get("events")
        if not isinstance(events, list) or not all(isinstance(event, dict) for event in events):
            raise FamalioApiError("Famalio Home returned an invalid event list")
        return events

    async def create_event(self, calendar_id: str, event: dict[str, Any]) -> str:
        payload = await self._request("POST", f"/v1/ha/calendars/{quote(calendar_id, safe='')}/events", json=event)
        uid = payload.get("uid")
        if not isinstance(uid, str):
            raise FamalioApiError("Famalio Home returned an invalid event id")
        return uid

    async def update_event(self, calendar_id: str, uid: str, event: dict[str, Any]) -> None:
        await self._request("PATCH", f"/v1/ha/calendars/{quote(calendar_id, safe='')}/events/{quote(uid, safe='')}", json=event)

    async def delete_event(self, calendar_id: str, uid: str) -> None:
        await self._request("DELETE", f"/v1/ha/calendars/{quote(calendar_id, safe='')}/events/{quote(uid, safe='')}")
