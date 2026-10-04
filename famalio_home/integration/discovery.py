"""Pure helper for Supervisor discovery (no Home Assistant imports, unit-testable offline)."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

# Same values as homeassistant.const.CONF_URL / CONF_API_KEY and const.CONF_INSTANCE_ID.
_URL, _TOKEN, _INSTANCE = "url", "api_key", "instance_id"


def is_known_connection(entries: Iterable[Mapping[str, Any]], discovered: Mapping[str, Any]) -> bool:
    """True when an existing entry already holds exactly this server, address and grant.

    The add-on re-announces itself on every start. Such an announcement must not leave a
    second "Discovered" card behind. A different token for the same server is different:
    the owner approved a new grant, so Home Assistant still asks before replacing the old one.
    """
    return any(
        data.get(_INSTANCE) == discovered.get(_INSTANCE)
        and data.get(_URL) == discovered.get(_URL)
        and data.get(_TOKEN) == discovered.get(_TOKEN)
        and discovered.get(_INSTANCE) is not None
        for data in entries
    )
