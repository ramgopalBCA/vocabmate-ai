from __future__ import annotations

import os
import uuid
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request

from database import Database
from tutor import answer_tutor

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

def create_app(test_config=None):
    app = Flask(__name__, template_folder="templates", static_folder="static")
    database_path = os.getenv("VOCABMATE_DATABASE", "").strip()
    if not database_path:
        database_path = (
            "/tmp/vocabmate.db"
            if os.getenv("VERCEL")
            else str(BASE_DIR / "data" / "vocabmate.db")
        )
    app.config.update(
        DATABASE_PATH=database_path,
        GEMINI_API_KEY=os.getenv("GEMINI_API_KEY", "").strip(),
        MAX_CONTENT_LENGTH=16 * 1024,
        JSON_SORT_KEYS=False,
    )
    if test_config:
        app.config.update(test_config)
    db = Database(app.config["DATABASE_PATH"])
    db.initialize()
    app.extensions["vocabmate_db"] = db

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
        return response

    @app.get("/")
    def home():
        return render_template("index.html")

    @app.get("/api/dashboard")
    def dashboard():
        return jsonify(db.dashboard(date.today()))

    @app.get("/api/vocabulary")
    def vocabulary():
        query = request.args.get("search", "").strip()[:80]
        return jsonify({"words": db.list_words(query)})

    @app.get("/api/daily-words")
    def daily_words():
        return jsonify(db.daily_words(date.today()))

    @app.post("/api/words/<word_id>/favorite")
    def favorite_word(word_id):
        if not db.word_exists(word_id):
            return jsonify({"error": "Word not found."}), 404
        return jsonify({"favorite": db.toggle_favorite(word_id)})

    @app.post("/api/words/<word_id>/learn")
    def learn_word(word_id):
        if not db.word_exists(word_id):
            return jsonify({"error": "Word not found."}), 404
        return jsonify({"learned": db.mark_learned(word_id, date.today())})

    @app.get("/api/quiz")
    def quiz():
        return jsonify(db.create_quiz())

    @app.post("/api/quiz/submit")
    def submit_quiz():
        payload = request.get_json(silent=True)
        answers = payload.get("answers") if isinstance(payload, dict) else None
        quiz_id = payload.get("quiz_id") if isinstance(payload, dict) else None
        if not isinstance(answers, dict) or not answers or len(answers) > 10 or not isinstance(quiz_id, str):
            return jsonify({"error": "Submit answers for the current quiz."}), 400
        result = db.score_quiz(quiz_id, answers)
        if result is None:
            return jsonify({"error": "One or more answers are invalid."}), 400
        return jsonify(result)

    @app.get("/api/progress")
    def progress():
        return jsonify(db.progress())

    @app.get("/api/history")
    def history():
        return jsonify({"conversations": db.list_conversations()})

    @app.get("/api/history/<conversation_id>")
    def conversation(conversation_id):
        messages = db.get_conversation(conversation_id)
        if messages is None:
            return jsonify({"error": "Conversation not found."}), 404
        return jsonify({"messages": messages})

    @app.get("/api/chat/status")
    def chat_status():
        return jsonify({"mode": "gemini" if app.config["GEMINI_API_KEY"] else "demo"})

    @app.post("/api/chat")
    def chat():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"error": "Send a message to get started."}), 400
        message = payload.get("message")
        conversation_id = payload.get("conversation_id")
        if not isinstance(message, str) or not message.strip() or len(message.strip()) > 1200:
            return jsonify({"error": "Your message must be between 1 and 1,200 characters."}), 400
        message = message.strip()
        if conversation_id is not None and (not isinstance(conversation_id, str) or len(conversation_id) > 80):
            return jsonify({"error": "That conversation could not be opened."}), 400
        if conversation_id and not db.conversation_exists(conversation_id):
            return jsonify({"error": "That conversation could not be opened."}), 404
        if not conversation_id:
            conversation_id = str(uuid.uuid4())
            db.create_conversation(conversation_id, message[:48])
        db.add_message(conversation_id, "user", message)
        prior = db.get_recent_messages(conversation_id, limit=12)
        reply, mode = answer_tutor(prior, message, app.config["GEMINI_API_KEY"])
        db.add_message(conversation_id, "assistant", reply)
        return jsonify({"conversation_id": conversation_id, "reply": reply, "mode": mode})

    @app.errorhandler(413)
    def request_too_large(_error):
        return jsonify({"error": "That request is too large."}), 413

    @app.errorhandler(500)
    def server_error(_error):
        app.logger.exception("Unhandled application error")
        return jsonify({"error": "Something went wrong. Please try again."}), 500

    return app

app = create_app()

if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "false").lower() == "true")
