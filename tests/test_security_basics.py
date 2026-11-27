import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import server


class RateLimiterTests(unittest.TestCase):
    def test_blocks_over_limit_and_reports_retry(self):
        limiter = server.SlidingWindowRateLimiter()
        self.assertEqual(limiter.check("client", 1, 30), (True, 0))
        allowed, retry = limiter.check("client", 1, 30)
        self.assertFalse(allowed)
        self.assertGreater(retry, 0)

    def test_separates_keys(self):
        limiter = server.SlidingWindowRateLimiter()
        self.assertTrue(limiter.check("client-a", 1)[0])
        self.assertTrue(limiter.check("client-b", 1)[0])


class ApiInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.base_url = f"http://127.0.0.1:{cls.httpd.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def post_json(self, path, body):
        request = Request(self.base_url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        try:
            return urlopen(request)
        except HTTPError as error:
            return error

    def post_status(self, path, body):
        response = self.post_json(path, body)
        try:
            return response.status, response.headers
        finally:
            response.close()

    def test_array_body_is_rejected_as_client_error(self):
        status, headers = self.post_status("/api/provider-token", [])
        self.assertEqual(status, 400)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")

    def test_non_string_provider_is_rejected(self):
        self.assertEqual(self.post_status("/api/provider-token", {"lessonId": "hello-1", "provider": []})[0], 400)

    def test_static_brand_assets_are_served_but_dotenv_is_not(self):
        with urlopen(self.base_url + "/site.webmanifest") as manifest:
            self.assertEqual(manifest.status, 200)
            self.assertIn("application/manifest+json", manifest.headers.get("Content-Type", ""))
        with self.assertRaises(HTTPError) as error:
            urlopen(self.base_url + "/.env")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()
        with urlopen(self.base_url + "/assets/branding/icons/lolo-icon.webp") as icon:
            self.assertEqual(icon.headers.get("Content-Type"), "image/webp")

    def test_provider_route_throttles_repeated_requests(self):
        old_limits = server.Handler.API_LIMITS
        old_limiter = server.API_RATE_LIMITER
        server.Handler.API_LIMITS = {**old_limits, "/api/provider-token": (1, 60)}
        server.API_RATE_LIMITER = server.SlidingWindowRateLimiter()
        try:
            self.assertEqual(self.post_status("/api/provider-token", [])[0], 400)
            status, headers = self.post_status("/api/provider-token", [])
            self.assertEqual(status, 429)
            self.assertGreater(int(headers["Retry-After"]), 0)
        finally:
            server.Handler.API_LIMITS = old_limits
            server.API_RATE_LIMITER = old_limiter


if __name__ == "__main__":
    unittest.main()
