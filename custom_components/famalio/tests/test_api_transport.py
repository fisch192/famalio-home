"""Real TLS tests for the scoped calendar client; requires aiohttp.

Run with: python -m unittest discover -s custom_components/famalio/tests
The temporary test CA is explicitly trusted; hostname/chain checks stay enabled.
"""

import asyncio
import importlib
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import types
import unittest

import aiohttp
from aiohttp.abc import AbstractResolver

PACKAGE = "famalio_transport_under_test"
package = types.ModuleType(PACKAGE)
package.__path__ = [str(Path(__file__).resolve().parents[1])]
sys.modules[PACKAGE] = package
api_module = importlib.import_module(f"{PACKAGE}.api")
FamalioApi = api_module.FamalioApi
FamalioApiError = api_module.FamalioApiError
PUBLIC_HOST = "famalio-test.taila0600.ts.net"


class TestResolver(AbstractResolver):
    def __init__(self, port):
        self.port = port

    async def resolve(self, host, port=0, family=socket.AF_INET):
        return [{"hostname": host, "host": "127.0.0.1", "port": self.port,
                 "family": socket.AF_INET, "proto": socket.IPPROTO_TCP, "flags": 0}]

    async def close(self):
        pass


class CalendarTransportTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory(prefix="famalio-tls-test-")
        cls.cert = Path(cls.directory.name) / "cert.pem"
        cls.key = Path(cls.directory.name) / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
            "-subj", f"/CN={PUBLIC_HOST}", "-addext", f"subjectAltName=DNS:{PUBLIC_HOST}",
            "-keyout", str(cls.key), "-out", str(cls.cert),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.key.chmod(0o600)

    @classmethod
    def tearDownClass(cls):
        cls.directory.cleanup()

    async def asyncSetUp(self):
        self.requests = []
        self.redirect = False
        self.rejection = None
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cert, self.key)
        self.server = await asyncio.start_server(self.handle, "127.0.0.1", 0, ssl=context)
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        self.server.close()
        await self.server.wait_closed()

    async def handle(self, reader, writer):
        try:
            request = await reader.readuntil(b"\r\n\r\n")
            self.requests.append(request)
            if self.redirect:
                reply = b"HTTP/1.1 302 Found\r\nLocation: /redirect-target\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            elif self.rejection is not None:
                body = self.rejection
                reply = (b"HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nContent-Length: "
                         + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
            else:
                body = b'{"calendars":[]}'
                reply = (b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: "
                         + str(len(body)).encode() + b"\r\nConnection: close\r\n\r\n" + body)
            writer.write(reply)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()

    def session(self, trusted=True):
        context = ssl.create_default_context(cafile=str(self.cert) if trusted else None)
        connector = aiohttp.TCPConnector(ssl=context, resolver=TestResolver(self.port))
        return aiohttp.ClientSession(connector=connector)

    def relay(self, session, host=PUBLIC_HOST):
        return FamalioApi(session, f"https://{host}", "fhi_synthetic_test_only",
                          internal_origin="https://local-famalio-home:9443",
                          addon_slug="local_famalio_home")

    async def test_internal_network_destination_retains_public_tls_identity(self):
        async with self.session() as session:
            self.assertEqual(await self.relay(session).calendars(), {"calendars": []})
        self.assertEqual(len(self.requests), 1)
        self.assertIn(b"GET /v1/ha/calendars HTTP/1.1", self.requests[0])
        self.assertIn(b"Authorization: Bearer fhi_synthetic_test_only", self.requests[0])

    async def test_wrong_public_hostname_never_receives_credential(self):
        async with self.session() as session:
            with self.assertRaises(FamalioApiError):
                await self.relay(session, "other.taila0600.ts.net").calendars()
        self.assertEqual(self.requests, [])

    async def test_untrusted_certificate_never_receives_credential(self):
        async with self.session(trusted=False) as session:
            with self.assertRaises(FamalioApiError):
                await self.relay(session).calendars()
        self.assertEqual(self.requests, [])

    async def test_redirect_is_not_followed(self):
        self.redirect = True
        async with self.session() as session:
            with self.assertRaisesRegex(FamalioApiError, "HTTP 302"):
                await self.relay(session).calendars()
        self.assertEqual(len(self.requests), 1)

    async def test_rejected_request_reports_the_servers_reason(self):
        self.rejection = b'{"code":"INVALID_INPUT","message":"Requested interval exceeds this integration grant","request_id":"x"}'
        async with self.session() as session:
            api = FamalioApi(session, f"https://{PUBLIC_HOST}", "fhi_synthetic_test_only")
            with self.assertRaisesRegex(FamalioApiError,
                                        "HTTP 400: Requested interval exceeds this integration grant"):
                await api.calendars()

    async def test_rejection_without_a_readable_reason_still_reports_the_status(self):
        self.rejection = b"not json"
        async with self.session() as session:
            api = FamalioApi(session, f"https://{PUBLIC_HOST}", "fhi_synthetic_test_only")
            with self.assertRaisesRegex(FamalioApiError, r"^Famalio Home returned HTTP 400$"):
                await api.calendars()

    async def test_normal_public_https_connection_still_works(self):
        async with self.session() as session:
            api = FamalioApi(session, f"https://{PUBLIC_HOST}", "fhi_synthetic_test_only")
            self.assertEqual(await api.calendars(), {"calendars": []})

    def test_discovery_relay_cannot_select_another_network_target(self):
        normalize = api_module.normalize_internal_origin
        self.assertEqual(normalize("https://local-famalio-home:9443", "local_famalio_home"),
                         "https://local-famalio-home:9443")
        for url in ["http://local-famalio-home:9443", "https://other-famalio-home:9443",
                    "https://local-famalio-home:443", "https://local-famalio-home:9443/path",
                    "https://user@local-famalio-home:9443", "https://local-famalio-home:9443?q=x"]:
            with self.assertRaises(ValueError):
                normalize(url, "local_famalio_home")


if __name__ == "__main__":
    unittest.main()
