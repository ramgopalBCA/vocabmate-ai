from __future__ import annotations

import logging
import re

import httpx
from google import genai
from google.genai import types

LOGGER = logging.getLogger(__name__)
MODEL = "gemini-3.8-flash"
SYSTEM_INSTRUCTION = (
    "You are VocabMate, a warm, patient English teacher for beginner-level "
    "Indian learners. Talk naturally in clear, simple English and encourage "
    "the learner. Gently correct grammar mistakes and explain corrections in "
    "simple Hindi. Suggest a more natural or professional sentence when useful. "
    "For every vocabulary question, explain the meaning in simple Hindi, give "
    "useful synonyms and antonyms, and include at least two short, "
    "beginner-friendly example sentences. Help the learner practice useful "
    "daily conversations. Avoid repeating generic responses; use recent "
    "conversation context to personalize each reply. Keep answers friendly, "
    "relevant, and easy to understand."
)
SERVICE_ERROR = (
    "I can’t connect to the AI tutor right now. Please try again shortly; "
    "your conversation is still saved."
)

DEMO_TIPS = {
    "hello": "Hello! I’m glad you’re here. Tell me what you’d like to practice, and we’ll take it one step at a time.",
    "thank": "You’re welcome! A natural alternative is “I really appreciate your help.” Try saying it in your own sentence.",
    "how are you": "I’m doing well, thank you for asking! You can answer with “I’m doing well” or the more casual “I’m good, thanks.” How about you?",
}
DEMO_WORDS = {
    "curious": ("जिज्ञासु", "She is curious about how the machine works."),
    "gentle": ("कोमल, नम्र", "He gave me a gentle reminder."),
    "improve": ("सुधारना", "Reading every day can improve your vocabulary."),
    "confident": ("आत्मविश्वासी", "Practice helped her feel confident at work."),
    "discover": ("खोजना, पता लगाना", "We discovered a quiet café near the station."),
    "patient": ("धैर्यवान", "Be patient with yourself while learning."),
    "achieve": ("हासिल करना", "Small habits help you achieve your goals."),
    "journey": ("यात्रा, सफ़र", "Learning a language is a rewarding journey."),
    "opportunity": ("अवसर", "The course gave him an opportunity to practice."),
    "reliable": ("भरोसेमंद", "A reliable friend keeps their promises."),
    "brave": ("बहादुर", "It was brave of her to ask for help."),
    "peaceful": ("शांतिपूर्ण", "We found a peaceful place to study."),
}

def demo_reply(message):
    text = message.strip()
    lowered = text.lower()
    for key, reply in DEMO_TIPS.items():
        if key in lowered:
            return reply
    if any(token in lowered for token in ("meaning", "means", "hindi", "translate")):
        for word, (meaning, example) in DEMO_WORDS.items():
            if re.search(r"\b" + re.escape(word) + r"\b", lowered):
                return f"{word.capitalize()} means {meaning} in Hindi. Example: “{example}”"
        return "Share the English word you’re curious about, and I’ll explain its meaning in simple Hindi with an example."
    if any(token in lowered for token in ("correct", "grammar", "sentence", "is this")):
        sentence = text.split(":", 1)[-1].strip()
        corrected = sentence
        substitutions = ((r"\b(she|he|it) go\b", r"\1 goes"), (r"\b(she|he|it) have\b", r"\1 has"),
            (r"\b(she|he|it) do\b", r"\1 does"), (r"\bI is\b", "I am"),
            (r"\b(she|he|it) are\b", r"\1 is"), (r"\b(I|we|they|you) goes\b", r"\1 go"))
        for pattern, replacement in substitutions:
            corrected = re.sub(pattern, replacement, corrected, flags=re.IGNORECASE)
        if corrected != sentence:
            corrected = corrected[:1].upper() + corrected[1:]
            if corrected[-1:] not in ".!?":
                corrected += "."
            return f"A more natural sentence is: “{corrected}” Use “goes” with “he,” “she,” or “it.” You’re making progress!"
        return "A clear sentence usually follows subject + verb + extra detail. Send me the exact sentence and I’ll help improve it."
    if "example" in lowered:
        for word, (_, example) in DEMO_WORDS.items():
            if re.search(r"\b" + re.escape(word) + r"\b", lowered):
                return f"Here’s an example with {word}: “{example}”"
        return "Here’s a simple example: “I practice English every morning.” Try making a sentence with a word you learned today."
    return "That’s a great question. Share a word or sentence you’re practicing, and I’ll explain it in beginner-friendly English and Hindi."


def answer_tutor(history, message, api_key):
    if not api_key or not api_key.strip():
        return demo_reply(message), "demo"

    contents = [
        types.Content(
            role="model" if item["role"] == "assistant" else "user",
            parts=[types.Part.from_text(text=item["content"])],
        )
        for item in history
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]
    try:
        with genai.Client(
            api_key=api_key,
            http_options=types.HttpOptions(timeout=18_000),
        ) as client:
            response = client.models.generate_content(
                model=MODEL,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    temperature=0.6,
                    max_output_tokens=600,
                ),
            )
        text = response.text
        if not isinstance(text, str) or not text.strip():
            LOGGER.warning("Gemini returned an empty tutor response.")
            return SERVICE_ERROR, "error"
        return text.strip()[:5000], "gemini"
    except genai.errors.APIError as error:
        message = (error.message or "").lower()
        if error.code == 429:
            reply = "The AI tutor is busy right now because of a rate limit. Please wait a moment and try again."
        elif error.code in {401, 403} or (
            error.code == 400 and "api key" in message and ("invalid" in message or "not valid" in message)
        ):
            reply = "Gemini could not authenticate this API key. Check GEMINI_API_KEY in your .env file."
        else:
            reply = SERVICE_ERROR
        LOGGER.warning("Gemini API request failed with status %s.", error.code)
        return reply, "error"
    except (httpx.TransportError, TimeoutError, ConnectionError, OSError) as error:
        LOGGER.warning("Gemini connection failed: %s", type(error).__name__)
        return SERVICE_ERROR, "error"
