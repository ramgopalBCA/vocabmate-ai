# VocabMate AI

A personal English vocabulary and practice assistant built with Flask, SQLite, and vanilla JavaScript. The tutor works in a useful demo mode without credentials and uses Gemini when configured.

## Run locally

1. Create and activate a virtual environment with Python 3.10 or newer.
2. Install dependencies: `python -m pip install -r requirements.txt`
3. Copy `.env.example` to `.env` and set `GEMINI_API_KEY` to a key from Google AI Studio to enable live AI responses. Keep the key only in `.env`; it is used by Flask and is never sent to the browser.
4. Start the server: `python app.py`
5. Open `http://127.0.0.1:5000`.

The tutor uses the official `google-genai` SDK with Gemini 3.8 Flash. Without a key, chat remains available in Demo Mode; configured keys stay on the Flask backend.

The SQLite database is created at `data/vocabmate.db` on first launch. Set `VOCABMATE_DATABASE` to use another path. The app does not require an API key to use vocabulary, daily words, quizzes, progress, or demo chat.
