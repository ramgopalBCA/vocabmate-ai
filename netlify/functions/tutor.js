"use strict";

const MODEL = "gemini-3.8-flash";
const SYSTEM_INSTRUCTION = [
    "You are VocabMate, a warm, patient English teacher for beginner-level Indian learners.",
    "Talk naturally in clear, simple English and encourage the learner. Gently correct grammar mistakes and explain corrections in simple Hindi.",
    "Suggest a more natural or professional sentence when useful. For every vocabulary question, explain the meaning in simple Hindi, give useful synonyms and antonyms, and include at least two short, beginner-friendly example sentences.",
    "Help the learner practice useful daily conversations. Avoid repeating generic responses; use recent conversation context to personalize each reply.",
    "Keep answers friendly, relevant, and easy to understand.",
].join(" ");
const SERVICE_ERROR = "I can’t connect to the AI tutor right now. Please try again shortly.";

const DEMO_TIPS = {
    hello: "Hello! I’m glad you’re here. Tell me what you’d like to practice, and we’ll take it one step at a time.",
    thank: "You’re welcome! A natural alternative is “I really appreciate your help.” Try saying it in your own sentence.",
    "how are you": "I’m doing well, thank you for asking! You can answer with “I’m doing well” or the more casual “I’m good, thanks.” How about you?",
};
const DEMO_WORDS = {
    curious: ["जिज्ञासु", "She is curious about how the machine works."],
    gentle: ["कोमल, नम्र", "He gave me a gentle reminder."],
    improve: ["सुधारना", "Reading every day can improve your vocabulary."],
    confident: ["आत्मविश्वासी", "Practice helped her feel confident at work."],
    discover: ["खोजना, पता लगाना", "We discovered a quiet café near the station."],
    patient: ["धैर्यवान", "Be patient with yourself while learning."],
    achieve: ["हासिल करना", "Small habits help you achieve your goals."],
    journey: ["यात्रा, सफ़र", "Learning a language is a rewarding journey."],
    opportunity: ["अवसर", "The course gave him an opportunity to practice."],
    reliable: ["भरोसेमंद", "A reliable friend keeps their promises."],
    brave: ["बहादुर", "It was brave of her to ask for help."],
    peaceful: ["शांतिपूर्ण", "We found a peaceful place to study."],
};

function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "same-origin",
        },
        body: JSON.stringify(body),
    };
}

function demoReply(message) {
    const text = message.trim();
    const lowered = text.toLowerCase();
    for (const [key, reply] of Object.entries(DEMO_TIPS)) {
        if (lowered.includes(key)) return reply;
    }
    if (["meaning", "means", "hindi", "translate"].some((token) => lowered.includes(token))) {
        for (const [word, [meaning, example]] of Object.entries(DEMO_WORDS)) {
            if (new RegExp(`\\b${word}\\b`, "i").test(lowered)) {
                return `${word[0].toUpperCase()}${word.slice(1)} means ${meaning} in Hindi. Example: “${example}”`;
            }
        }
        return "Share the English word you’re curious about, and I’ll explain its meaning in simple Hindi with an example.";
    }
    if (["correct", "grammar", "sentence", "is this"].some((token) => lowered.includes(token))) {
        const sentence = text.split(":", 2).pop().trim();
        let corrected = sentence;
        const substitutions = [
            [/\b(she|he|it) go\b/gi, "$1 goes"],
            [/\b(she|he|it) have\b/gi, "$1 has"],
            [/\b(she|he|it) do\b/gi, "$1 does"],
            [/\bI is\b/gi, "I am"],
            [/\b(she|he|it) are\b/gi, "$1 is"],
            [/\b(I|we|they|you) goes\b/gi, "$1 go"],
        ];
        for (const [pattern, replacement] of substitutions) corrected = corrected.replace(pattern, replacement);
        if (corrected !== sentence) {
            corrected = corrected[0].toUpperCase() + corrected.slice(1);
            if (!/[.!?]$/.test(corrected)) corrected += ".";
            return `A more natural sentence is: “${corrected}” Use “goes” with “he,” “she,” or “it.” You’re making progress!`;
        }
        return "A clear sentence usually follows subject + verb + extra detail. Send me the exact sentence and I’ll help improve it.";
    }
    if (lowered.includes("example")) {
        for (const [word, [, example]] of Object.entries(DEMO_WORDS)) {
            if (new RegExp(`\\b${word}\\b`, "i").test(lowered)) return `Here’s an example with ${word}: “${example}”`;
        }
        return "Here’s a simple example: “I practice English every morning.” Try making a sentence with a word you learned today.";
    }
    return "That’s a great question. Share a word or sentence you’re practicing, and I’ll explain it in beginner-friendly English and Hindi.";
}

async function tutorReply(message, history, apiKey) {
    if (!apiKey) return { reply: demoReply(message), mode: "demo" };

    const contents = history
        .filter((entry) => (entry.role === "user" || entry.role === "assistant") && entry.content)
        .map((entry) => ({
            role: entry.role === "assistant" ? "model" : "user",
            parts: [{ text: entry.content }],
        }));
    contents.push({ role: "user", parts: [{ text: message }] });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    try {
        const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
                contents,
                generationConfig: { temperature: 0.6, maxOutputTokens: 600 },
            }),
            signal: controller.signal,
        });
        const result = await upstream.json().catch(() => ({}));
        if (!upstream.ok) {
            if (upstream.status === 429) return { reply: "The AI tutor is busy right now because of a rate limit. Please wait a moment and try again.", mode: "error" };
            const detail = String(result.error?.message || "").toLowerCase();
            if ([401, 403].includes(upstream.status)
                || (upstream.status === 400 && detail.includes("api key") && (detail.includes("invalid") || detail.includes("not valid")))) {
                return { reply: "Gemini could not authenticate this API key. Check GEMINI_API_KEY in your hosting provider's environment variables.", mode: "error" };
            }
            console.error("Gemini request failed with status", upstream.status);
            return { reply: SERVICE_ERROR, mode: "error" };
        }
        const text = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
        if (!text) {
            console.error("Gemini returned an empty tutor response.");
            return { reply: SERVICE_ERROR, mode: "error" };
        }
        return { reply: text.slice(0, 5000), mode: "gemini" };
    } catch (error) {
        console.error("Gemini request failed:", error.name || "Error");
        return { reply: SERVICE_ERROR, mode: "error" };
    } finally {
        clearTimeout(timeout);
    }
}

exports.handler = async (event) => {
    if (event.httpMethod === "GET") {
        return response(200, { mode: process.env.GEMINI_API_KEY?.trim() ? "gemini" : "demo" });
    }
    if (event.httpMethod !== "POST") {
        return response(405, { error: "Method not allowed." });
    }
    if (!event.body || event.body.length > 16000) {
        return response(413, { error: "That request is too large." });
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (_error) {
        return response(400, { error: "Send a message to get started." });
    }
    const message = payload?.message;
    const history = payload?.history;
    if (typeof message !== "string" || !message.trim() || message.trim().length > 1200) {
        return response(400, { error: "Your message must be between 1 and 1,200 characters." });
    }
    if (history !== undefined && (!Array.isArray(history) || history.length > 12
        || history.some((entry) => !entry || !["user", "assistant"].includes(entry.role)
            || typeof entry.content !== "string" || entry.content.length > 5000))) {
        return response(400, { error: "That conversation could not be opened." });
    }
    if ((history || []).reduce((total, entry) => total + entry.content.length, 0) > 12000) {
        return response(400, { error: "That conversation could not be opened." });
    }

    const result = await tutorReply(message.trim(), history || [], process.env.GEMINI_API_KEY?.trim() || "");
    return response(200, result);
};
