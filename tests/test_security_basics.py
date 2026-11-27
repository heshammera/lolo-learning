import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch

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


class AssessmentToolingTests(unittest.TestCase):
    def test_spoken_test_grade_is_not_a_model_supplied_tool(self):
        tool_names = {item["name"] for item in server.TOOL_DECLARATIONS}
        self.assertIn("submit_spoken_assessment_answer", tool_names)
        self.assertNotIn("record_lesson_test_result", tool_names)
        instructions = server.teacher_instructions("hello-1", "test")
        self.assertIn("لا ترسلي الإجابة أو is_correct", instructions)
        self.assertIn("submit_spoken_assessment_answer", instructions)

    def test_openai_test_waits_for_app_before_responding(self):
        lesson = server.openai_audio_input("lesson")
        test = server.openai_audio_input("test")
        self.assertNotIn("transcription", lesson)
        self.assertNotIn("create_response", lesson["turn_detection"])
        self.assertIs(test["turn_detection"]["create_response"], False)
        self.assertEqual(test["turn_detection"]["type"], "server_vad")
        self.assertEqual(test["transcription"]["model"], "gpt-transcribe")


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

    def test_unsupported_content_type_is_rejected(self):
        request = Request(self.base_url + "/api/provider-token", data=b"not-json", headers={"Content-Type": "text/plain"})
        try:
            response = urlopen(request)
        except HTTPError as error:
            response = error
        try:
            self.assertEqual(response.status, 415)
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
        for filename in ("storage.js", "assessment-engine.js", "subject-catalog.js", "visual-question-bank.js", "visual-assessment-engine.js", "curriculum-engine.js", "learning-engine.js", "learning-path-engine.js", "network.js", "offline-assets.js", "sw.js", "parent-gate.js", "session-timers.js"):
            with urlopen(self.base_url + "/" + filename) as script:
                self.assertEqual(script.status, 200)
                self.assertIn("javascript", script.headers.get("Content-Type", ""))

    def test_invalid_mode_and_teacher_settings_do_not_raise(self):
        self.assertEqual(self.post_status("/api/provider-token", {"lessonId": "hello-1", "mode": []})[0], 400)
        self.assertEqual(self.post_status("/api/provider-token", {"lessonId": "missing-lesson", "teacherSettings": {"speechPace": [], "hintLevel": {}, "learningScope": []}})[0], 400)

    def test_global_budget_and_disabled_services_do_not_reach_upstream(self):
        with patch.object(server, "GLOBAL_RATE_LIMITER", server.SlidingWindowRateLimiter()), patch.object(server, "API_RATE_LIMITER", server.SlidingWindowRateLimiter()), patch.object(server, "GLOBAL_PAID_LIMIT", 1), patch.object(server, "VOICE_ENABLED", True), patch.object(server, "urlopen") as upstream:
            self.assertEqual(self.post_status("/api/provider-token", [])[0], 400)
            self.assertEqual(self.post_status("/api/provider-token", [])[0], 429)
            upstream.assert_not_called()
        with patch.object(server, "VOICE_ENABLED", False), patch.object(server, "TTS_ENABLED", False), patch.object(server, "urlopen") as upstream:
            self.assertEqual(self.post_status("/api/provider-token", {})[0], 503)
            self.assertEqual(self.post_status("/api/challenge-audio", {})[0], 503)
            with urlopen(self.base_url + "/api/status") as response:
                data = json.load(response)
                self.assertEqual(data["providers"], [])
                self.assertFalse(data["ttsEnabled"])
            upstream.assert_not_called()

    def test_combined_tts_and_malformed_payloads(self):
        with patch.object(server, "API_RATE_LIMITER", server.SlidingWindowRateLimiter()), patch.object(server, "GLOBAL_RATE_LIMITER", server.SlidingWindowRateLimiter()), patch.object(server, "CLIENT_TTS_LIMIT", 1), patch.object(server, "TTS_ENABLED", True), patch.object(server, "GEMINI_API_KEY", "test-only"), patch.object(server, "urlopen") as upstream:
            self.assertEqual(self.post_status("/api/onboarding-audio", {"step": []})[0], 400)
            self.assertEqual(self.post_status("/api/challenge-audio", {"text": ""})[0], 429)
            upstream.assert_not_called()
        with patch.object(server, "API_RATE_LIMITER", server.SlidingWindowRateLimiter()), patch.object(server, "GLOBAL_RATE_LIMITER", server.SlidingWindowRateLimiter()):
            self.assertEqual(self.post_status("/api/provider-token", {"excellenceCount": float("inf")})[0], 400)
            self.assertEqual(self.post_status("/api/provider-token", {"lessonId": "course-complete"})[0], 400)

    def test_cross_site_request_is_rejected(self):
        request = Request(self.base_url + "/api/provider-token", data=b"{}", headers={"Content-Type":"application/json", "Sec-Fetch-Site":"cross-site"})
        with self.assertRaises(HTTPError) as error:
            urlopen(request)
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

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
