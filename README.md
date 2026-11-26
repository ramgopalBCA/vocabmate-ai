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

## Deploy the separate Netlify version

The separate Netlify static site lives in `netlify-site/`; it does not replace the Flask/SQLite application. The static version keeps the existing dashboard design and stores learning progress, favorites, quiz results, and chat history in the visitor's browser using `localStorage`.

### Deploy from GitHub

1. Push this repository to GitHub and choose **Add new site → Import an existing project** in Netlify.
2. Select this repository. Leave the base directory and build command blank; `netlify.toml` sets the publish directory to `netlify-site` and the serverless functions directory to `netlify/functions`.
3. In **Site configuration → Environment variables**, optionally add `GEMINI_API_KEY` with your Google AI Studio key. Never put this value in frontend files or commit it to Git.
4. Deploy the site. Netlify will provide a public `*.netlify.app` URL. Redeploy after changing environment variables.

Alternatively, install the Netlify CLI, run `netlify login` and `netlify init` from the repository root, then use `netlify deploy --prod`. To test the static site and its function rewrites locally, run `netlify dev` from the repository root.

Without `GEMINI_API_KEY`, the serverless tutor returns its built-in demo responses. Vocabulary search, the daily word set, favorites, learned-word tracking, quizzes, score history, progress charts, and saved chat transcripts work without Gemini; browser data is local to that browser and is not synchronized between devices. With the key configured, tutor replies use Gemini through the serverless function. The key stays server-side. The Netlify deployment does not use or migrate the Flask SQLite database.

## Deploy on Vercel

The Vercel deployment runs the existing Flask application, not the separate Netlify static demo. Import the Git repository into Vercel and keep the **Root Directory** at the repository root (`.`). Vercel detects the Python function at `api/index.py`, which imports the existing `app` instance from `app.py`. `vercel.json` sends incoming page, static-asset, and API requests to Flask; the function bundle explicitly includes `templates/` and `static/`.

Vercel's function filesystem is not persistent. On Vercel, the app uses `/tmp/vocabmate.db` (or `VOCABMATE_DATABASE` if set), which is writable but temporary and may not be shared between function instances. Vocabulary is initialized from the app's built-in word list; user progress and chat history stored in SQLite can reset or differ between instances. For durable multi-user data, configure an external database before relying on production progress. Locally, SQLite continues to use `data/vocabmate.db`.

Add `GEMINI_API_KEY` in Vercel **Settings → Environment Variables** if you want live Gemini tutor responses, then redeploy. The key remains server-side and is not exposed to templates or static assets. Keep `requirements.txt` at the repository root so Vercel installs Flask and the existing Python dependencies. After importing the project, verify the Vercel **Root Directory** is `.` and the deployment uses the Python function in `api/index.py`; do not set `netlify-site/` as the root directory.
