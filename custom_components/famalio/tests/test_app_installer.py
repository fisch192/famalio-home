"""Tests for the Supervisor app installer; needs no Home Assistant and no network.

Run with: python -m unittest discover -s custom_components/famalio/tests
"""

import asyncio
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("app_installer", Path(__file__).resolve().parents[1] / "app_installer.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

SLUG = "b8806cf6_famalio_home"


class FakeSupervisor:
    """Just enough of the Supervisor API; records every call in order."""

    def __init__(self, *, installed=False, state="stopped", repo_added=False, store_ready_after=0,
                 fail=None, ingress_panel=False):
        self.installed, self.state, self.repo_added = installed, state, repo_added
        self.store_polls, self.store_ready_after = 0, store_ready_after
        self.fail, self.calls, self.options = fail, [], {"ingress_panel": ingress_panel}

    async def __call__(self, method, path, body, timeout):
        self.calls.append((method, path, body))
        if self.fail and (method, path) == self.fail:
            raise RuntimeError("HTTP 500 boom")
        if (method, path) == ("GET", "/addons"):
            return {"addons": [{"slug": SLUG, "state": self.state}] if self.installed else []}
        if (method, path) == ("GET", "/store/repositories"):
            return [{"slug": "b8806cf6"}] if self.repo_added else [{"slug": "core"}]
        if (method, path) == ("POST", "/store/repositories"):
            self.repo_added = True
            return {}
        if (method, path) == ("GET", f"/store/addons/{SLUG}"):
            self.store_polls += 1
            if not self.repo_added or self.store_polls <= self.store_ready_after:
                raise RuntimeError("HTTP 404 not found")
            return {"slug": SLUG}
        if (method, path) == ("POST", f"/store/addons/{SLUG}/install"):
            self.installed = True
            return {}
        if (method, path) == ("POST", f"/addons/{SLUG}/options"):
            self.options.update(body)
            return {}
        if (method, path) == ("POST", f"/addons/{SLUG}/start"):
            self.state = "started"
            return {}
        if (method, path) == ("GET", f"/addons/{SLUG}/info"):
            return {"state": self.state}
        raise AssertionError(f"unexpected call {method} {path}")

    def paths(self):
        return [f"{m} {p}" for m, p, _ in self.calls]


async def no_sleep(_seconds):
    return None


def run(coro):
    return asyncio.run(coro)


class AppInstallerTests(unittest.TestCase):
    def test_slug_matches_the_supervisor_naming(self):
        self.assertEqual(installer.repository_slug(), "b8806cf6")
        self.assertEqual(installer.app_slug(), SLUG)

    def test_fresh_install_adds_repository_installs_shows_sidebar_and_starts(self):
        fake = FakeSupervisor(store_ready_after=2)
        steps = []
        slug = run(installer.ensure_app_running(fake, progress=steps.append, sleep=no_sleep))
        self.assertEqual(slug, SLUG)
        self.assertEqual(steps, ["repository", "install", "configure", "start"])
        paths = fake.paths()
        self.assertLess(paths.index("POST /store/repositories"), paths.index(f"POST /store/addons/{SLUG}/install"))
        self.assertLess(paths.index(f"POST /store/addons/{SLUG}/install"), paths.index(f"POST /addons/{SLUG}/options"))
        self.assertLess(paths.index(f"POST /addons/{SLUG}/options"), paths.index(f"POST /addons/{SLUG}/start"))
        self.assertEqual(fake.options, {"ingress_panel": True, "boot": "auto"})
        self.assertEqual(fake.state, "started")
        self.assertGreater(fake.store_polls, 2, "must wait until the store lists the app")

    def test_existing_repository_is_not_added_twice(self):
        fake = FakeSupervisor(repo_added=True)
        run(installer.ensure_app_running(fake, sleep=no_sleep))
        self.assertNotIn("POST /store/repositories", fake.paths())

    def test_installed_and_running_app_is_not_reinstalled_or_restarted(self):
        fake = FakeSupervisor(installed=True, state="started", repo_added=True)
        run(installer.ensure_app_running(fake, sleep=no_sleep))
        paths = fake.paths()
        self.assertNotIn(f"POST /store/addons/{SLUG}/install", paths)
        self.assertNotIn(f"POST /addons/{SLUG}/start", paths)
        self.assertEqual(fake.options["ingress_panel"], True, "the sidebar entry is switched on")

    def test_installed_but_stopped_app_is_only_started(self):
        fake = FakeSupervisor(installed=True, state="stopped", repo_added=True)
        run(installer.ensure_app_running(fake, sleep=no_sleep))
        self.assertNotIn(f"POST /store/addons/{SLUG}/install", fake.paths())
        self.assertEqual(fake.state, "started")

    def test_a_failing_step_is_named(self):
        fake = FakeSupervisor(fail=("POST", f"/store/addons/{SLUG}/install"))
        with self.assertRaises(installer.AppInstallError) as raised:
            run(installer.ensure_app_running(fake, sleep=no_sleep))
        self.assertEqual(raised.exception.step, "install_app")
        self.assertIn("boom", raised.exception.detail)
        self.assertNotIn(f"POST /addons/{SLUG}/start", fake.paths())

    def test_app_missing_from_the_store_times_out(self):
        fake = FakeSupervisor(store_ready_after=10**6)
        with self.assertRaises(installer.AppInstallError) as raised:
            run(installer.ensure_app_running(fake, sleep=no_sleep))
        self.assertEqual(raised.exception.step, "find_app")
        self.assertNotIn(f"POST /store/addons/{SLUG}/install", fake.paths())


if __name__ == "__main__":
    unittest.main()
