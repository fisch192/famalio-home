"""Standard-library tests for ignoring re-announcements of an already configured connection."""

from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from discovery import is_known_connection

INSTANCE = "63cdc8a4-3273-4d22-a987-c4891f888b03"
ENTRY = {"url": "https://home.example.ts.net", "api_key": "fhi_a", "instance_id": INSTANCE,
         "internal_url": "https://abc-famalio-home:9443", "addon_slug": "abc_famalio_home", "family_id": "f"}


class KnownConnectionTests(unittest.TestCase):
    def test_same_server_address_and_grant_is_a_duplicate(self) -> None:
        discovered = {"url": ENTRY["url"], "api_key": "fhi_a", "instance_id": INSTANCE}
        self.assertTrue(is_known_connection([ENTRY], discovered))

    def test_a_new_grant_for_the_same_server_still_asks_the_user(self) -> None:
        # The owner re-approved Home Assistant: the new token must be confirmed, never swapped silently.
        discovered = {"url": ENTRY["url"], "api_key": "fhi_new", "instance_id": INSTANCE}
        self.assertFalse(is_known_connection([ENTRY], discovered))

    def test_a_different_server_or_address_is_not_a_duplicate(self) -> None:
        other = "11111111-1111-4111-8111-111111111111"
        self.assertFalse(is_known_connection([ENTRY], {"url": ENTRY["url"], "api_key": "fhi_a", "instance_id": other}))
        self.assertFalse(is_known_connection([ENTRY], {"url": "https://other.ts.net", "api_key": "fhi_a", "instance_id": INSTANCE}))

    def test_no_entries_means_nothing_is_known(self) -> None:
        self.assertFalse(is_known_connection([], {"url": ENTRY["url"], "api_key": "fhi_a", "instance_id": INSTANCE}))
        self.assertFalse(is_known_connection([{}], {"url": ENTRY["url"], "api_key": "fhi_a", "instance_id": INSTANCE}))


if __name__ == "__main__":
    unittest.main()
