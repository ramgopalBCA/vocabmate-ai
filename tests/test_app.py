import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from app import create_app
from google.genai import errors as genai_errors


class VocabMateAppTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.app = create_app({
            "TESTING": True,
            "DATABASE_PATH": str(Path(self.temp_dir.name) / "test.db"),
            "GEMINI_API_KEY": "",
        })
        self.client = self.app.test_client()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_home_and_static_assets(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"VocabMate AI", response.data)
        self.assertIn(b'id="clear-chat"', response.data)
        self.assertIn(b'id="chat-mode"', response.data)
        self.assertIn("default-src 'self'", response.headers["Content-Security-Policy"])
        with self.client.get("/static/css/style.css") as css_response:
            self.assertIn(b"@media(max-width:560px)", css_response.data)
        with self.client.get("/static/js/app.js") as js_response:
            self.assertEqual(js_response.status_code, 200)
            app_js_data = js_response.data
        with self.client.get("/static/js/chat.js") as chat_js:
            self.assertEqual(chat_js.status_code, 200)
            chat_js_data = chat_js.data
        self.assertIn(b"typing-indicator", chat_js_data)
        self.assertIn(b"/api/history/", chat_js_data)
        self.assertIn(b"message-time", chat_js_data)
        self.app.config["GEMINI_API_KEY"] = "test-api-key"
        frontend = self.client.get("/").data + app_js_data + chat_js_data
        self.assertNotIn(b"test-api-key", frontend)
        self.assertNotIn(b"GEMINI_API_KEY", frontend)

    def test_vercel_uses_writable_temporary_sqlite_path(self):
        with patch.dict(os.environ, {"VERCEL": "1", "VOCABMATE_DATABASE": ""}):
            with patch("app.Database.initialize"):
                app = create_app()

        self.assertEqual(app.config["DATABASE_PATH"], "/tmp/vocabmate.db")

    def test_learning_routes_and_statistics(self):
        for route in ("/api/dashboard", "/api/vocabulary", "/api/daily-words", "/api/progress", "/api/history"):
            with self.subTest(route=route):
                self.assertEqual(self.client.get(route).status_code, 200)
        words = self.client.get("/api/vocabulary").get_json()["words"]
        self.assertGreaterEqual(len(words), 20)
        self.assertTrue(words[0]["synonyms"])
        self.assertEqual(len(self.client.get("/api/daily-words").get_json()["words"]), 5)
        word_id = words[0]["id"]
        self.assertTrue(self.client.post(f"/api/words/{word_id}/favorite").get_json()["favorite"])
        self.assertTrue(self.client.post(f"/api/words/{word_id}/learn").get_json()["learned"])
        dashboard = self.client.get("/api/dashboard").get_json()
        self.assertEqual(dashboard["learned_words"], 1)
        self.assertGreaterEqual(dashboard["streak"], 1)
        self.assertEqual(self.client.get("/api/vocabulary?search=curious").get_json()["words"][0]["word"], "curious")

    def test_quiz_is_scored_against_issued_questions(self):
        words = self.client.get("/api/vocabulary").get_json()["words"]
        quiz = self.client.get("/api/quiz").get_json()
        by_word = {word["word"]: word["id"] for word in words}
        answers = {question["id"]: by_word[question["word"]] for question in quiz["questions"]}
        response = self.client.post("/api/quiz/submit", json={"quiz_id": quiz["quiz_id"], "answers": answers})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["score"], response.get_json()["total"])
        self.assertEqual(self.client.post("/api/quiz/submit", json={"quiz_id": quiz["quiz_id"], "answers": answers}).status_code, 400)
        self.assertEqual(self.client.get("/api/dashboard").get_json()["quiz_attempts"], 1)

    def test_demo_chat_validation_and_history(self):
        self.assertEqual(self.client.get("/api/chat/status").get_json(), {"mode": "demo"})
        response = self.client.post("/api/chat", json={"message": "What does curious mean in Hindi?"})
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["mode"], "demo")
        history = self.client.get(f"/api/history/{data['conversation_id']}")
        self.assertEqual(len(history.get_json()["messages"]), 2)
        self.assertEqual(self.client.post("/api/chat", json={"message": " "}).status_code, 400)
        self.assertEqual(self.client.get("/api/history/missing").status_code, 404)

    def test_gemini_chat_uses_configured_key_and_recent_history(self):
        self.app.config["GEMINI_API_KEY"] = "test-api-key"
        with patch("tutor.genai.Client") as gemini_client:
            gemini_client.return_value.__enter__.return_value.models.generate_content.return_value = (
                SimpleNamespace(text="Great question! Let's practice together.")
            )
            first = self.client.post("/api/chat", json={"message": "I want learn English."})
            conversation_id = first.get_json()["conversation_id"]
            second = self.client.post(
                "/api/chat",
                json={"message": "Can you correct me?", "conversation_id": conversation_id},
            )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.get_json()["mode"], "gemini")
        self.assertEqual(second.get_json()["mode"], "gemini")
        self.assertEqual(gemini_client.call_args.kwargs["api_key"], "test-api-key")
        second_contents = gemini_client.return_value.__enter__.return_value.models.generate_content.call_args.kwargs["contents"]
        self.assertEqual(second_contents[-1].parts[0].text, "Can you correct me?")
        self.assertEqual(second_contents[-2].role, "model")
        saved = self.client.get(f"/api/history/{conversation_id}").get_json()["messages"]
        self.assertEqual(len(saved), 4)
        self.assertEqual(saved[-1]["content"], "Great question! Let's practice together.")

    def test_invalid_gemini_key_returns_a_friendly_error(self):
        self.app.config["GEMINI_API_KEY"] = "invalid-key"
        invalid_key = genai_errors.APIError(
            400,
            {"error": {"message": "API key not valid. Please pass a valid API key."}},
        )
        with patch("tutor.genai.Client", side_effect=invalid_key):
            response = self.client.post("/api/chat", json={"message": "Hello"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["mode"], "error")
        self.assertIn("authenticate", response.get_json()["reply"].lower())

    def test_gemini_rate_limit_is_reported_without_crashing(self):
        self.app.config["GEMINI_API_KEY"] = "test-api-key"
        rate_limit = genai_errors.APIError(429, {"error": {"message": "Rate limit exceeded."}})
        with patch("tutor.genai.Client", side_effect=rate_limit):
            response = self.client.post("/api/chat", json={"message": "Teach me a new word."})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["mode"], "error")
        self.assertIn("rate limit", response.get_json()["reply"].lower())


if __name__ == "__main__":
    unittest.main()
