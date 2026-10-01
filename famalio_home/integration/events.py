"""Pure helpers for calendar payload validation and token-range clipping."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any


def parse_event(item: dict[str, Any]) -> dict[str, Any]:
    """Validate the deliberately small event projection returned by the server."""
    try:
        start = _parse_boundary(item["start"])
        end = _parse_boundary(item["end"])
        if type(start) is not type(end) or start >= end:
            raise ValueError("Invalid event range")
        if isinstance(start, datetime) and start.utcoffset() != end.utcoffset():
            # Wire responses use UTC; requiring matching offsets protects HA's
            # CalendarEvent contract if a future server changes serialization.
            raise ValueError("Event boundaries use different timezones")
        title = item["title"]
        if not isinstance(title, str):
            raise ValueError("Event title must be a string")
        result: dict[str, Any] = {"start": start, "end": end, "summary": title}
        for source, target in (("description", "description"), ("location", "location"), ("uid", "uid")):
            value = item.get(source)
            if value is not None:
                if not isinstance(value, str):
                    raise ValueError(f"Event {source} must be a string")
                result[target] = value
        return result
    except (KeyError, TypeError) as err:
        raise ValueError("Incomplete Famalio event") from err


def format_api_datetime(value: datetime) -> str:
    """Serialize an aware timestamp in the server's millisecond wire format."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("API datetime must include a timezone")
    return value.isoformat(timespec="milliseconds")


def clamp_interval(start: datetime, end: datetime, now: datetime, max_days: int) -> tuple[datetime, datetime] | None:
    """Return a safe intersection with the grant's rolling time window.

    HA calendar consumers may request arbitrary historical/future windows. The
    server enforces both a rolling +/- max_days horizon and a max_days query span;
    clip here so ordinary month/year browser requests do not mark the entity down.
    """
    if not (start.tzinfo and end.tzinfo and now.tzinfo) or end <= start or max_days < 1:
        return None
    span = timedelta(days=max_days)
    # Keep a small allowance for network transit and server-side `now` checks;
    # a request exactly at the grant boundary can otherwise become out of range
    # before it reaches the API.
    margin = timedelta(seconds=60)
    lower = now - span + margin
    upper = now + span - margin
    clipped_start = max(start, lower)
    clipped_end = min(end, upper)
    if clipped_end <= clipped_start:
        return None
    if clipped_end - clipped_start > span:
        clipped_start = max(clipped_start, min(now, clipped_end - span))
        clipped_end = clipped_start + span
        if clipped_end > upper:
            clipped_end = upper
            clipped_start = clipped_end - span
    if clipped_end <= clipped_start:
        return None
    return clipped_start, clipped_end


def _parse_boundary(value: Any) -> date | datetime:
    if not isinstance(value, str):
        raise ValueError("Event boundary must be a string")
    if len(value) == 10:
        return date.fromisoformat(value)
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("Event time has no timezone")
    return parsed


def write_payload(event: dict[str, Any], timezone: str) -> dict[str, Any]:
    """Map HA's create/update event fields onto the server's HA write contract."""
    start = event.get("dtstart")
    end = event.get("dtend")
    summary = event.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("A title is required")
    if isinstance(start, datetime) and isinstance(end, datetime):
        if start.tzinfo is None or end.tzinfo is None or end <= start:
            raise ValueError("Events need a timezone-aware start before their end")
        body: dict[str, Any] = {"start": format_api_datetime(start), "end": format_api_datetime(end), "all_day": False}
    elif isinstance(start, date) and isinstance(end, date) and not isinstance(start, datetime) and not isinstance(end, datetime):
        if end <= start:
            raise ValueError("All-day events end after their start day")
        body = {"start": start.isoformat(), "end": end.isoformat(), "all_day": True}
    else:
        raise ValueError("Start and end must both be dates or both be times")
    body.update({"summary": summary.strip(), "tz": timezone})
    for key in ("description", "location"):
        value = event.get(key)
        if isinstance(value, str) and value.strip():
            body[key] = value
    return body
