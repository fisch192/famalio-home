"""Standard-library tests for the Home Assistant calendar wire contract."""

from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from events import clamp_interval, format_api_datetime, parse_event, write_payload


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
