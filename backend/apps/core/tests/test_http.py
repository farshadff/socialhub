from unittest import mock

import httpx2 as httpx
from django.test import SimpleTestCase, override_settings

from apps.core import http
from apps.core.http import FetchError, safe_fetch

PUBLIC = {"feed.example.com": ["93.184.216.34"], "other.example.com": ["93.184.216.35"]}


def resolver(mapping):
    def resolve(host):
        if host not in mapping:
            raise OSError("no such host")
        return mapping[host]

    return resolve


class SafeFetchTests(SimpleTestCase):
    def setUp(self):
        patcher = mock.patch.object(http, "resolve_host", resolver(PUBLIC))
        patcher.start()
        self.addCleanup(patcher.stop)
        sleeper = mock.patch.object(http, "_sleep")
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def test_ok_sends_user_agent_and_headers(self):
        seen = {}

        def handler(request):
            seen.update(request.headers)
            return httpx.Response(200, content=b"<rss/>")

        result = safe_fetch(
            "https://feed.example.com/feed",
            headers={"Accept": "application/rss+xml"},
            transport=httpx.MockTransport(handler),
        )
        self.assertEqual(result.content, b"<rss/>")
        self.assertEqual(seen["user-agent"], "SocialHubBot/1.0")
        self.assertEqual(seen["accept"], "application/rss+xml")

    def test_private_addresses_blocked_without_request(self):
        calls = []
        transport = httpx.MockTransport(lambda r: calls.append(r) or httpx.Response(200))
        cases = {
            "internal.example.com": ["10.0.0.5"],
            "loop.example.com": ["127.0.0.1"],
            "link.example.com": ["169.254.169.254"],
            "v6.example.com": ["::1"],
        }
        with mock.patch.object(http, "resolve_host", resolver(cases)):
            for host in cases:
                with self.subTest(host=host), self.assertRaises(FetchError) as ctx:
                    safe_fetch(f"http://{host}/feed", transport=transport)
                self.assertEqual(ctx.exception.code, "blocked_url")
        for url in ("http://127.0.0.1/x", "http://localhost/x", "ftp://feed.example.com/x"):
            with self.assertRaises(FetchError):
                safe_fetch(url, transport=transport)
        self.assertEqual(calls, [])

    def test_redirect_to_private_is_blocked(self):
        def handler(request):
            return httpx.Response(302, headers={"location": "http://evil.example.com/"})

        with mock.patch.object(http, "resolve_host", resolver({**PUBLIC, "evil.example.com": ["192.168.1.1"]})):
            with self.assertRaises(FetchError) as ctx:
                safe_fetch("https://feed.example.com/", transport=httpx.MockTransport(handler))
        self.assertEqual(ctx.exception.code, "blocked_url")

    def test_redirect_limit(self):
        transport = httpx.MockTransport(
            lambda r: httpx.Response(301, headers={"location": "/again"})
        )
        with self.assertRaises(FetchError) as ctx:
            safe_fetch("https://feed.example.com/", transport=transport)
        self.assertEqual(ctx.exception.code, "blocked_url")

    def test_http_error_no_retry(self):
        calls = []
        transport = httpx.MockTransport(lambda r: calls.append(1) or httpx.Response(404))
        with self.assertRaises(FetchError) as ctx:
            safe_fetch("https://feed.example.com/", transport=transport)
        self.assertEqual(ctx.exception.code, "http_404")
        self.assertEqual(len(calls), 1)

    def test_timeout_retried_once(self):
        calls = []

        def handler(request):
            calls.append(1)
            raise httpx.ReadTimeout("slow", request=request)

        with self.assertRaises(FetchError) as ctx:
            safe_fetch("https://feed.example.com/", transport=httpx.MockTransport(handler))
        self.assertEqual((ctx.exception.code, ctx.exception.cause), ("timeout", "timeout"))
        self.assertEqual(len(calls), 2)
        self.sleep.assert_called_once_with(2.0)

    def test_connect_error_cause(self):
        def handler(request):
            raise httpx.ConnectError("refused", request=request)

        with self.assertRaises(FetchError) as ctx:
            safe_fetch("https://feed.example.com/", transport=httpx.MockTransport(handler))
        self.assertEqual((ctx.exception.code, ctx.exception.cause), ("timeout", "connect"))

    def test_size_cap(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 50))
        result = safe_fetch("https://feed.example.com/", max_bytes=10, transport=transport)
        self.assertTrue(result.truncated)
        self.assertEqual(len(result.content), 10)
        with self.assertRaises(FetchError) as ctx:
            safe_fetch(
                "https://feed.example.com/", max_bytes=10, on_too_large="error", transport=transport
            )
        self.assertEqual(ctx.exception.code, "too_large")

    @override_settings(SOCIALHUB_FETCH_ALLOW_HOSTS="fixtures.local", DEBUG=True)
    def test_allow_hosts_in_debug(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, content=b"ok"))
        self.assertEqual(safe_fetch("http://fixtures.local/feed", transport=transport).content, b"ok")

    @override_settings(SOCIALHUB_FETCH_ALLOW_HOSTS="fixtures.local", DEBUG=False)
    def test_allow_hosts_ignored_in_production(self):
        with mock.patch.object(http, "resolve_host", resolver({"fixtures.local": ["10.1.1.1"]})):
            with self.assertRaises(FetchError):
                safe_fetch("http://fixtures.local/feed", transport=httpx.MockTransport(lambda r: httpx.Response(200)))
