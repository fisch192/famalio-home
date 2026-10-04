"""Standard-library tests for the Home Assistant calendar wire contract."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from events import clamp_interval, format_api_datetime, parse_event, poll_window, write_payload


class CalendarWireTests(unittest.TestCase):
    def test_timed_event_requires_timezone_and_preserves_only_contract_fields(self) -> None:
        event = parse_event({
            "uid": "event-1",
            "start": "2026-10-25T08:00:00.000Z",
            "end": "2026-10-25T09:00:00.000Z",
            "title": "Busy",
            "secret_member_id": "must-not-be-forwarded",
        })
        self.assertEqual(event, {
            "uid": "event-1",
            "start": datetime(2026, 10, 25, 8, tzinfo=timezone.utc),
            "end": datetime(2026, 10, 25, 9, tzinfo=timezone.utc),
            "summary": "Busy",
        })
        with self.assertRaises(ValueError):
            parse_event({"start": "2026-10-25T08:00:00", "end": "2026-10-25T09:00:00", "title": "unsafe"})

    def test_all_day_events_use_exclusive_end_dates(self) -> None:
        event = parse_event({"start": "2026-10-25", "end": "2026-10-27", "title": "Trip"})
        self.assertEqual(event["start"], date(2026, 10, 25))
        self.assertEqual(event["end"], date(2026, 10, 27))
        with self.assertRaises(ValueError):
            parse_event({"start": "2026-10-25", "end": "2026-10-25", "title": "Empty"})

    def test_requested_calendar_range_is_clipped_to_grant(self) -> None:
        now = datetime(2026, 10, 25, 12, tzinfo=timezone.utc)
        result = clamp_interval(now - timedelta(days=50), now + timedelta(days=50), now, 30)
        self.assertIsNotNone(result)
        start, end = result  # type: ignore[misc]
        self.assertEqual(end - start, timedelta(days=30))
        self.assertLessEqual(start, now)
        self.assertGreaterEqual(end, now)
        self.assertGreaterEqual(start, now - timedelta(days=30) + timedelta(seconds=60))
        self.assertLessEqual(end, now + timedelta(days=30) - timedelta(seconds=60))
        self.assertIsNone(clamp_interval(now + timedelta(days=31), now + timedelta(days=32), now, 30))

    def test_api_timestamps_use_server_supported_millisecond_precision(self) -> None:
        value = datetime(2026, 9, 26, 10, 11, 12, 123456, tzinfo=timezone.utc)
        self.assertEqual(format_api_datetime(value), "2026-09-26T10:11:12.123+00:00")
        with self.assertRaises(ValueError):
            format_api_datetime(datetime(2026, 9, 26, 10, 11, 12))



ROME = ZoneInfo("Europe/Rome")
SERVER_MARGIN = timedelta(seconds=1)


def _server_accepts(start: datetime, end: datetime, now: datetime, max_days: int) -> bool:
    """Mirror server/famalio-home/src/ha-calendar.ts events(): real instants, not wall clock."""
    start_u, end_u, now_u = (value.astimezone(timezone.utc) for value in (start, end, now))
    span = timedelta(days=max_days)
    return (end_u > start_u and end_u - start_u <= span
            and start_u >= now_u - span and end_u <= now_u + span)


class DaylightSavingWindowTests(unittest.TestCase):
    """Windows that cross a clock change must still fit the grant (the HTTP 400 regression)."""

    def test_poll_window_fits_the_grant_across_the_autumn_clock_change(self) -> None:
        for max_days in (1, 3, 7, 30, 45, 90):
            for now in (datetime(2026, 10, 4, 17, 6, 48, 444000, tzinfo=ROME),
                        datetime(2026, 10, 25, 1, 59, tzinfo=ROME),
                        datetime(2026, 7, 29, 8, tzinfo=ROME),
                        datetime(2027, 3, 20, 9, tzinfo=ROME)):
                with self.subTest(max_days=max_days, now=now.isoformat()):
                    start, end = poll_window(now, max_days)
                    self.assertTrue(_server_accepts(start, end, now, max_days), (start, end))
                    self.assertGreater(end - start, timedelta(0))

    def test_poll_window_keeps_the_intended_look_back_and_look_ahead(self) -> None:
        now = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
        start, end = poll_window(now, 30)
        self.assertEqual(now - start, timedelta(days=2))
        self.assertEqual(end - now, timedelta(days=28))
        start, end = poll_window(now, 2)
        self.assertEqual(now - start, timedelta(0))
        self.assertEqual(end - now, timedelta(days=2))

    def test_poll_window_is_sent_in_utc_so_no_offset_shift_can_widen_it(self) -> None:
        start, end = poll_window(datetime(2026, 10, 4, 17, tzinfo=ROME), 90)
        self.assertEqual(start.utcoffset(), timedelta(0))
        self.assertEqual(end.utcoffset(), timedelta(0))

    def test_calendar_view_requests_are_clipped_inside_the_grant_across_the_clock_change(self) -> None:
        now = datetime(2026, 10, 4, 17, tzinfo=ROME)
        for max_days in (7, 30, 90):
            # HA's calendar card asks for whole local months/years, far beyond the grant.
            for requested in ((datetime(2026, 9, 1, tzinfo=ROME), datetime(2027, 1, 1, tzinfo=ROME)),
                              (datetime(2026, 10, 1, tzinfo=ROME), datetime(2026, 11, 1, tzinfo=ROME)),
                              (datetime(2026, 1, 1, tzinfo=ROME), datetime(2028, 1, 1, tzinfo=ROME))):
                with self.subTest(max_days=max_days, requested=requested[0].isoformat()):
                    window = clamp_interval(*requested, now, max_days)
                    if window is not None:
                        self.assertTrue(_server_accepts(*window, now, max_days), window)

    def test_calendar_view_clipping_survives_the_spring_clock_change(self) -> None:
        now = datetime(2027, 3, 20, 9, tzinfo=ROME)
        window = clamp_interval(datetime(2027, 3, 1, tzinfo=ROME), datetime(2027, 6, 1, tzinfo=ROME), now, 45)
        self.assertIsNotNone(window)
        self.assertTrue(_server_accepts(*window, now, 45), window)  # type: ignore[misc]


class WritePayloadTests(unittest.TestCase):
    def test_timed_and_all_day_events_map_to_the_server_contract(self) -> None:
        timed = write_payload({"summary": " Swim ", "dtstart": datetime(2026, 10, 1, 8, tzinfo=timezone.utc),
                               "dtend": datetime(2026, 10, 1, 9, tzinfo=timezone.utc), "description": "Towel"}, "Europe/Rome")
        self.assertEqual(timed, {"start": "2026-10-01T08:00:00.000+00:00", "end": "2026-10-01T09:00:00.000+00:00",
                                 "all_day": False, "summary": "Swim", "tz": "Europe/Rome", "description": "Towel"})
        all_day = write_payload({"summary": "Trip", "dtstart": date(2026, 10, 1), "dtend": date(2026, 10, 3)}, "UTC")
        self.assertEqual(all_day, {"start": "2026-10-01", "end": "2026-10-03", "all_day": True, "summary": "Trip", "tz": "UTC"})

    def test_invalid_writes_are_rejected_before_any_request(self) -> None:
        for event in ({"summary": "", "dtstart": date(2026, 1, 1), "dtend": date(2026, 1, 2)},
                      {"summary": "x", "dtstart": date(2026, 1, 2), "dtend": date(2026, 1, 2)},
                      {"summary": "x", "dtstart": datetime(2026, 1, 1, 8), "dtend": datetime(2026, 1, 1, 9)},
                      {"summary": "x", "dtstart": date(2026, 1, 1), "dtend": datetime(2026, 1, 1, 9, tzinfo=timezone.utc)}):
            with self.assertRaises(ValueError):
                write_payload(event, "UTC")

if __name__ == "__main__":
    unittest.main()
