import httpx2 as httpx
from django.test import SimpleTestCase, override_settings

from apps.core.http import BlockedURL, FetchHTTPError, FetchTimeout, safe_fetch


def resolver(mapping):
    return lambda host: mapping.get(host, ["93.184.216.34"])


class SafeFetchTests(SimpleTestCase):
    def test_blocks_private_addresses_before_connecting(self):
        sent = []

        def handler(request):
            sent.append(request)
            return httpx.Response(200, content=b"ok")

        for address in ("10.0.0.5", "127.0.0.1", "169.254.1.1", "192.168.1.1", "::1",
                        "224.0.0.1", "0.0.0.0"):
            with self.subTest(address=address), self.assertRaises(BlockedURL):
                safe_fetch("https://internal.example/feed", transport=httpx.MockTransport(handler),
                           resolver=resolver({"internal.example": [address]}))
        self.assertEqual(sent, [])

    def test_blocks_redirect_to_private_host(self):
        def handler(request):
            if request.url.host == "public.example":
                return httpx.Response(302, headers={"location": "http://internal.example/x"})
            return httpx.Response(200, content=b"secret")

        with self.assertRaises(BlockedURL):
            safe_fetch("https://public.example/feed", transport=httpx.MockTransport(handler),
                       resolver=resolver({"internal.example": ["10.1.2.3"]}))

    def test_follows_up_to_three_redirects(self):
        def handler(request):
            n = int(request.url.path.strip("/") or 0)
            if n < 4:
                return httpx.Response(301, headers={"location": f"/{n + 1}"})
            return httpx.Response(200, content=b"done")

        with self.assertRaises(FetchHTTPError):
            safe_fetch("https://a.example/0", transport=httpx.MockTransport(handler),
                       resolver=resolver({}))
        result = safe_fetch("https://a.example/1", transport=httpx.MockTransport(handler),
                            resolver=resolver({}))
        self.assertEqual(result.content, b"done")
        self.assertEqual(result.url, "https://a.example/4")

    def test_caps_body(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, content=b"x" * 5000))
        result = safe_fetch("https://a.example/", transport=transport, max_bytes=1000,
                            resolver=resolver({}))
        self.assertEqual(len(result.content), 1000)
        self.assertTrue(result.truncated)

    def test_http_error_and_timeout(self):
        with self.assertRaises(FetchHTTPError) as ctx:
            safe_fetch("https://a.example/", resolver=resolver({}),
                       transport=httpx.MockTransport(lambda r: httpx.Response(404)))
        self.assertEqual(ctx.exception.code, "http_404")

        def slow(request):
            raise httpx.ReadTimeout("slow", request=request)

        with self.assertRaises(FetchTimeout):
            safe_fetch("https://a.example/", resolver=resolver({}),
                       transport=httpx.MockTransport(slow))

    def test_sends_user_agent(self):
        seen = {}

        def handler(request):
            seen["ua"] = request.headers.get("user-agent")
            return httpx.Response(200, content=b"")

        with override_settings(SOCIALHUB_HTTP_USER_AGENT="SocialHubBot/1.0"):
            safe_fetch("https://a.example/", transport=httpx.MockTransport(handler),
                       resolver=resolver({}))
        self.assertEqual(seen["ua"], "SocialHubBot/1.0")

    @override_settings(DEBUG=True, SOCIALHUB_FETCH_ALLOW_HOSTS=["feeds.local"])
    def test_allow_hosts_in_debug(self):
        transport = httpx.MockTransport(lambda r: httpx.Response(200, content=b"ok"))
        result = safe_fetch("http://feeds.local/rss", transport=transport,
                            resolver=resolver({"feeds.local": ["10.0.0.2"]}))
        self.assertEqual(result.content, b"ok")

    @override_settings(DEBUG=False, SOCIALHUB_TEST_HOOKS=False,
                       SOCIALHUB_FETCH_ALLOW_HOSTS=["feeds.local"])
    def test_allow_hosts_ignored_without_debug(self):
        with self.assertRaises(BlockedURL):
            safe_fetch("http://feeds.local/rss", resolver=resolver({"feeds.local": ["10.0.0.2"]}),
                       transport=httpx.MockTransport(lambda r: httpx.Response(200)))
