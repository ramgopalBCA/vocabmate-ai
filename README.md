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

The static site lives in `netlify-site/`; the Flask/SQLite application above is retained and is not used by the Netlify or Vercel deployment. The static version keeps the existing dashboard design and stores learning progress, favorites, quiz results, and chat history in the visitor's browser using `localStorage`.

### Deploy from GitHub

1. Push this repository to GitHub and choose **Add new site → Import an existing project** in Netlify.
2. Select this repository. Leave the base directory and build command blank; `netlify.toml` sets the publish directory to `netlify-site` and the serverless functions directory to `netlify/functions`.
3. In **Site configuration → Environment variables**, optionally add `GEMINI_API_KEY` with your Google AI Studio key. Never put this value in frontend files or commit it to Git.
4. Deploy the site. Netlify will provide a public `*.netlify.app` URL. Redeploy after changing environment variables.

Alternatively, install the Netlify CLI, run `netlify login` and `netlify init` from the repository root, then use `netlify deploy --prod`. To test the static site and its function rewrites locally, run `netlify dev` from the repository root.

Without `GEMINI_API_KEY`, the serverless tutor returns its built-in demo responses. Vocabulary search, the daily word set, favorites, learned-word tracking, quizzes, score history, progress charts, and saved chat transcripts work without Gemini; browser data is local to that browser and is not synchronized between devices. With the key configured, tutor replies use Gemini through the serverless function. The key stays server-side. The Netlify deployment does not use or migrate the Flask SQLite database.

## Deploy on Vercel

The repository root is the Vercel project root. Import the Git repository into Vercel and leave the **Root Directory** as `.`. `vercel.json` publishes the existing `netlify-site/` static frontend, and `api/chat.js` adapts the existing tutor handler to Vercel's Node.js function API; `/api/chat/status` is rewritten to that same function. Do not set `netlify-site` as Vercel's Root Directory, or Vercel will not include the API function.

In the Vercel project settings, add `GEMINI_API_KEY` under **Settings → Environment Variables** to enable live Gemini responses, then redeploy. The key is read only by the serverless function and is not included in the frontend. Without the variable, tutor demo responses work. Vocabulary, favorites, learned words, quizzes, progress, and chat history work without the key and are stored locally in each visitor's browser. The original Flask/SQLite project remains in the repository but is not used by this static Vercel deployment.
