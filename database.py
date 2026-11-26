from __future__ import annotations

import random
import sqlite3
from contextlib import contextmanager
from datetime import date, timedelta
from pathlib import Path

WORDS = [
    ("curious", "adjective", "जिज्ञासु", "interested, inquisitive", "uninterested", "She is curious about how the machine works.", "KYOOR-ee-us", "Beginner"),
    ("gentle", "adjective", "कोमल, नम्र", "kind, soft", "harsh, rough", "He gave me a gentle reminder.", "JEN-tul", "Beginner"),
    ("improve", "verb", "सुधारना", "develop, enhance", "worsen, decline", "Reading every day can improve your vocabulary.", "im-PROOV", "Beginner"),
    ("confident", "adjective", "आत्मविश्वासी", "assured, certain", "doubtful, unsure", "Practice helped her feel confident at work.", "KON-fi-dunt", "Beginner"),
    ("discover", "verb", "खोजना, पता लगाना", "find, uncover", "miss, overlook", "We discovered a quiet café near the station.", "dis-KUV-er", "Beginner"),
    ("patient", "adjective", "धैर्यवान", "calm, tolerant", "impatient", "Be patient with yourself while learning.", "PAY-shunt", "Beginner"),
    ("achieve", "verb", "हासिल करना", "accomplish, attain", "fail, lose", "Small habits help you achieve your goals.", "uh-CHEEV", "Beginner"),
    ("generous", "adjective", "उदार", "giving, unselfish", "selfish, mean", "Our generous neighbor shared fresh fruit.", "JEN-er-us", "Intermediate"),
    ("journey", "noun", "यात्रा, सफ़र", "trip, adventure", "stay", "Learning a language is a long but rewarding journey.", "JUR-nee", "Beginner"),
    ("notice", "verb", "ध्यान देना, देखना", "observe, spot", "ignore, miss", "Did you notice the new sign outside?", "NOH-tis", "Beginner"),
    ("opportunity", "noun", "अवसर", "chance, possibility", "obstacle", "The course gave him an opportunity to practice.", "op-er-TOO-ni-tee", "Intermediate"),
    ("delight", "noun", "खुशी, आनंद", "joy, pleasure", "sadness, misery", "It was a delight to meet your family.", "di-LITE", "Intermediate"),
    ("reliable", "adjective", "भरोसेमंद", "dependable, trustworthy", "unreliable", "A reliable friend keeps their promises.", "ri-LY-uh-bul", "Intermediate"),
    ("whisper", "verb", "फुसफुसाना", "murmur, speak softly", "shout, yell", "Please whisper while the baby is sleeping.", "WIS-per", "Beginner"),
    ("brave", "adjective", "बहादुर", "courageous, bold", "afraid, fearful", "It was brave of her to ask for help.", "BRAYV", "Beginner"),
    ("reduce", "verb", "कम करना", "decrease, lessen", "increase, expand", "Try to reduce screen time before bed.", "ri-DOOS", "Beginner"),
    ("ancient", "adjective", "प्राचीन", "old, historic", "modern, recent", "They explored an ancient temple together.", "AYN-shunt", "Intermediate"),
    ("gather", "verb", "इकट्ठा करना", "collect, assemble", "scatter, disperse", "Let's gather a few ideas before we begin.", "GATH-er", "Beginner"),
    ("suggest", "verb", "सुझाव देना", "recommend, propose", "demand", "Could you suggest a good book for beginners?", "sug-JEST", "Beginner"),
    ("peaceful", "adjective", "शांतिपूर्ण", "calm, quiet", "noisy, troubled", "We found a peaceful place to study.", "PEES-ful", "Beginner"),
]

class Database:
    def __init__(self, path):
        self.path = str(path)

    @contextmanager
    def connect(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self):
        with self.connect() as connection:
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS words (
                    id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE, part_of_speech TEXT NOT NULL,
                    hindi TEXT NOT NULL, synonyms TEXT NOT NULL, antonyms TEXT NOT NULL,
                    example TEXT NOT NULL, pronunciation TEXT NOT NULL, level TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS favorites (
                    word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS learned_words (
                    word_id TEXT PRIMARY KEY REFERENCES words(id) ON DELETE CASCADE,
                    learned_on TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')), content TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS quiz_attempts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, score INTEGER NOT NULL, total INTEGER NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS quiz_sessions (
                    id TEXT PRIMARY KEY, questions TEXT NOT NULL, created_at TEXT NOT NULL
                );
            """)
            for index, item in enumerate(WORDS, start=1):
                connection.execute("INSERT OR IGNORE INTO words VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (f"w{index:02}", *item))

    @staticmethod
    def _word(row):
        item = dict(row)
        item["synonyms"] = [value.strip() for value in item["synonyms"].split(",")]
        item["antonyms"] = [value.strip() for value in item["antonyms"].split(",")]
        item["favorite"] = bool(item.pop("is_favorite", 0))
        item["learned"] = bool(item.pop("is_learned", 0))
        return item

    def list_words(self, query=""):
        with self.connect() as connection:
            rows = connection.execute("""
                SELECT w.*, EXISTS(SELECT 1 FROM favorites f WHERE f.word_id=w.id) is_favorite,
                    EXISTS(SELECT 1 FROM learned_words l WHERE l.word_id=w.id) is_learned
                FROM words w WHERE ? = '' OR w.word LIKE ? OR w.hindi LIKE ? OR w.part_of_speech LIKE ?
                ORDER BY w.word
            """, (query, f"%{query}%", f"%{query}%", f"%{query}%")).fetchall()
        return [self._word(row) for row in rows]

    def word_exists(self, word_id):
        with self.connect() as connection:
            return connection.execute("SELECT 1 FROM words WHERE id=?", (word_id,)).fetchone() is not None

    def toggle_favorite(self, word_id):
        with self.connect() as connection:
            exists = connection.execute("SELECT 1 FROM favorites WHERE word_id=?", (word_id,)).fetchone()
            if exists:
                connection.execute("DELETE FROM favorites WHERE word_id=?", (word_id,))
                return False
            connection.execute("INSERT INTO favorites(word_id) VALUES (?)", (word_id,))
            return True

    def mark_learned(self, word_id, today):
        with self.connect() as connection:
            connection.execute("INSERT OR IGNORE INTO learned_words VALUES (?, ?)", (word_id, today.isoformat()))
        return True

    def daily_words(self, today):
        words = self.list_words()
        offset = today.toordinal() % len(words)
        selection = [words[(offset + index) % len(words)] for index in range(5)]
        return {"date": today.isoformat(), "words": selection}

    def dashboard(self, today):
        daily = self.daily_words(today)
        with self.connect() as connection:
            total_words = connection.execute("SELECT COUNT(*) FROM words").fetchone()[0]
            learned = connection.execute("SELECT COUNT(*) FROM learned_words").fetchone()[0]
            learned_today = connection.execute("SELECT COUNT(*) FROM learned_words WHERE learned_on=?", (today.isoformat(),)).fetchone()[0]
            attempts = connection.execute("SELECT COUNT(*) FROM quiz_attempts").fetchone()[0]
            average = connection.execute("SELECT COALESCE(ROUND(AVG(100.0 * score / total)), 0) FROM quiz_attempts").fetchone()[0]
            last_quiz = connection.execute("SELECT score, total FROM quiz_attempts ORDER BY id DESC LIMIT 1").fetchone()
            scores = [dict(row) for row in connection.execute("SELECT score, total, created_at FROM quiz_attempts ORDER BY id DESC LIMIT 5")]
            learned_dates = {date.fromisoformat(row[0]) for row in connection.execute("SELECT DISTINCT learned_on FROM learned_words")}
        streak = 0
        streak_day = today if today in learned_dates else today - timedelta(days=1)
        while streak_day in learned_dates:
            streak += 1
            streak_day -= timedelta(days=1)
        return {"total_words": total_words, "learned_words": learned, "daily_learned": learned_today,
                "daily_goal": 5, "streak": streak, "quiz_attempts": attempts, "average_score": average,
                "last_quiz": dict(last_quiz) if last_quiz else None, "recent_scores": scores,
                "word_of_day": daily["words"][0]}

    def create_quiz(self):
        import json
        import uuid
        words = self.list_words()
        selection = random.SystemRandom().sample(words, min(5, len(words)))
        questions = []
        for index, word in enumerate(selection, start=1):
            choices = random.SystemRandom().sample(words, 4)
            if all(choice["id"] != word["id"] for choice in choices):
                choices[-1] = word
            random.SystemRandom().shuffle(choices)
            questions.append({"id": str(index), "word": word["word"], "part_of_speech": word["part_of_speech"],
                "options": [{"id": option["id"], "text": option["hindi"]} for option in choices]})
        quiz_id = str(uuid.uuid4())
        with self.connect() as connection:
            connection.execute("INSERT INTO quiz_sessions VALUES (?, ?, datetime('now'))", (quiz_id, json.dumps(questions)))
            connection.execute("DELETE FROM quiz_sessions WHERE created_at < datetime('now', '-1 day')")
        return {"quiz_id": quiz_id, "questions": questions}

    def score_quiz(self, quiz_id, answers):
        import json
        with self.connect() as connection:
            quiz = connection.execute("SELECT questions FROM quiz_sessions WHERE id=?", (quiz_id,)).fetchone()
            if not quiz:
                return None
            questions = json.loads(quiz["questions"])
            valid = {option["id"] for question in questions for option in question["options"]}
            if set(answers) != {question["id"] for question in questions} or any(value not in valid for value in answers.values()):
                return None
            words = {row["id"]: row["word"] for row in connection.execute("SELECT id, word FROM words")}
            meanings = {row["id"]: row["hindi"] for row in connection.execute("SELECT id, hindi FROM words")}
            results = []
            score = 0
            for question in questions:
                expected = next(option["id"] for option in question["options"] if words[option["id"]] == question["word"])
                picked = answers[question["id"]]
                is_correct = picked == expected
                score += int(is_correct)
                results.append({"word": question["word"], "correct": is_correct,
                    "correct_answer": meanings[expected], "selected_answer": meanings[picked]})
            connection.execute("INSERT INTO quiz_attempts(score, total, created_at) VALUES (?, ?, datetime('now'))", (score, len(questions)))
            connection.execute("DELETE FROM quiz_sessions WHERE id=?", (quiz_id,))
        return {"score": score, "total": len(questions), "percentage": round(100 * score / len(questions)), "results": results}

    def progress(self):
        today = date.today()
        start = today - timedelta(days=6)
        with self.connect() as connection:
            learning = {row["day"]: row["count"] for row in connection.execute(
                "SELECT learned_on day, COUNT(*) count FROM learned_words WHERE learned_on>=? GROUP BY learned_on", (start.isoformat(),))}
            quizzes = [dict(row) for row in connection.execute("SELECT score, total, created_at FROM quiz_attempts ORDER BY id DESC LIMIT 20")]
            learned_total = connection.execute("SELECT COUNT(*) FROM learned_words").fetchone()[0]
        days = [{"date": (start + timedelta(days=index)).isoformat(), "count": learning.get((start + timedelta(days=index)).isoformat(), 0)} for index in range(7)]
        return {"learned_total": learned_total, "days": days, "quizzes": quizzes}

    def create_conversation(self, conversation_id, title):
        now = date.today().isoformat()
        with self.connect() as connection:
            connection.execute("INSERT INTO conversations VALUES (?, ?, ?, ?)", (conversation_id, title[:48], now, now))

    def conversation_exists(self, conversation_id):
        with self.connect() as connection:
            return connection.execute("SELECT 1 FROM conversations WHERE id=?", (conversation_id,)).fetchone() is not None

    def add_message(self, conversation_id, role, content):
        with self.connect() as connection:
            connection.execute("INSERT INTO messages(conversation_id, role, content, created_at) VALUES (?, ?, ?, datetime('now'))", (conversation_id, role, content))
            connection.execute("UPDATE conversations SET updated_at=datetime('now') WHERE id=?", (conversation_id,))

    def get_recent_messages(self, conversation_id, limit=12):
        with self.connect() as connection:
            rows = connection.execute("SELECT role, content FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT ?", (conversation_id, limit)).fetchall()
        return [dict(row) for row in reversed(rows)]

    def list_conversations(self):
        with self.connect() as connection:
            return [dict(row) for row in connection.execute("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 30")]

    def get_conversation(self, conversation_id):
        with self.connect() as connection:
            exists = connection.execute("SELECT 1 FROM conversations WHERE id=?", (conversation_id,)).fetchone()
            if not exists:
                return None
            return [dict(row) for row in connection.execute("SELECT role, content, created_at FROM messages WHERE conversation_id=? ORDER BY id", (conversation_id,))]
