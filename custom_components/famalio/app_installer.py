"""Install and start the Famalio server app through the Home Assistant Supervisor.

HACS can only install this integration. The server (and its sidebar entry) is a
Supervisor app, so the config flow asks the Supervisor to add the public
repository, install the app, show it in the sidebar and start it. Nothing here
imports Home Assistant or aiohttp: a caller supplies `request`, so the steps can
be tested without a Home Assistant installation.
"""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from typing import Any

REPOSITORY_URL = "https://github.com/fisch192/famalio-home"
APP_NAME = "famalio_home"

# Building the image on a small machine took about 18 minutes.
INSTALL_TIMEOUT = 45 * 60
STORE_TIMEOUT = 3 * 60
START_TIMEOUT = 5 * 60
SHORT_TIMEOUT = 60.0

Request = Callable[[str, str, dict[str, Any] | None, float], Awaitable[Any]]
Progress = Callable[[str], None]


class AppInstallError(Exception):
    """The Supervisor refused or could not complete a step."""

    def __init__(self, step: str, detail: str = "") -> None:
        super().__init__(f"{step}: {detail}" if detail else step)
        self.step = step
        self.detail = detail


def repository_slug(url: str = REPOSITORY_URL) -> str:
    """The Supervisor names a repository by the first 8 hex digits of sha1(url)."""
    return hashlib.sha1(url.lower().encode()).hexdigest()[:8]  # noqa: S324 - identifier, not security


def app_slug(url: str = REPOSITORY_URL) -> str:
    return f"{repository_slug(url)}_{APP_NAME}"


async def _call(request: Request, method: str, path: str, body: dict[str, Any] | None = None,
                timeout: float = SHORT_TIMEOUT, *, step: str) -> Any:
    try:
        return await request(method, path, body, timeout)
    except AppInstallError:
        raise
    except Exception as err:  # transport/HTTP errors are reported with the failing step
        raise AppInstallError(step, str(err)) from err


async def _installed_info(request: Request, slug: str) -> dict[str, Any] | None:
    data = await _call(request, "GET", "/addons", step="list_apps")
    for app in (data or {}).get("addons", []):
        if app.get("slug") == slug:
            return app
    return None


async def _wait(predicate: Callable[[], Awaitable[bool]], *, timeout: float, interval: float,
                sleep: Callable[[float], Awaitable[Any]], step: str) -> None:
    waited = 0.0
    while True:
        if await predicate():
            return
        if waited >= timeout:
            raise AppInstallError(step, "timed out")
        await sleep(interval)
        waited += interval


async def ensure_app_running(request: Request, *, progress: Progress | None = None,
                             sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
                             repository: str = REPOSITORY_URL) -> str:
    """Add the repository, install the app, show it in the sidebar and start it.

    Every step is safe to repeat: an installed app is not reinstalled and a
    running app is not restarted. Returns the app slug.
    """
    say = progress or (lambda _step: None)
    slug = app_slug(repository)
    repo_id = repository_slug(repository)

    app = await _installed_info(request, slug)
    if app is None:
        say("repository")
        repos = await _call(request, "GET", "/store/repositories", step="list_repositories")
        if not any(item.get("slug") == repo_id for item in repos or []):
            await _call(request, "POST", "/store/repositories", {"repository": repository},
                        STORE_TIMEOUT, step="add_repository")

        async def in_store() -> bool:
            try:
                await request("GET", f"/store/addons/{slug}", None, SHORT_TIMEOUT)
            except Exception:  # not listed yet; the Supervisor is still reading the repository
                return False
            return True

        await _wait(in_store, timeout=STORE_TIMEOUT, interval=3, sleep=sleep, step="find_app")
        say("install")
        await _call(request, "POST", f"/store/addons/{slug}/install", None, INSTALL_TIMEOUT, step="install_app")
        app = await _installed_info(request, slug)
        if app is None:
            raise AppInstallError("install_app", "the app is not listed after installing")

    # Fresh installs hide the sidebar entry; this is what makes it appear.
    say("configure")
    await _call(request, "POST", f"/addons/{slug}/options", {"boot": "auto", "ingress_panel": True},
                step="configure_app")

    if (app or {}).get("state") != "started":
        say("start")
        await _call(request, "POST", f"/addons/{slug}/start", None, START_TIMEOUT, step="start_app")

        async def started() -> bool:
            info = await request("GET", f"/addons/{slug}/info", None, SHORT_TIMEOUT)
            return (info or {}).get("state") == "started"

        await _wait(started, timeout=START_TIMEOUT, interval=3, sleep=sleep, step="wait_for_start")
    return slug
