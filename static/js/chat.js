(() => {
    const form = document.querySelector("#chat-form");
    const input = document.querySelector("#chat-input");
    const messages = document.querySelector("#chat-messages");
    const sendButton = form.querySelector(".send-button");
    const modeBadge = document.querySelector("#chat-mode");
    let conversationId = null;
    let sending = false;

    function parseTimestamp(value) {
        if (value instanceof Date) {
            return value;
        }
        const text = String(value);
        const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(text)
            ? new Date(`${text.replace(" ", "T")}Z`)
            : new Date(text);
        return timestamp;
    }

    function formatTime(value = new Date(), includeDate = false) {
        const timestamp = parseTimestamp(value);
        if (Number.isNaN(timestamp.getTime())) {
            return "";
        }
        const options = includeDate
            ? { dateStyle: "medium", timeStyle: "short" }
            : { hour: "numeric", minute: "2-digit" };
        return timestamp.toLocaleString([], options);
    }

    function scrollToLatest(row) {
        row.scrollIntoView({ block: "nearest" });
        messages.scrollTop = messages.scrollHeight;
    }

    function appendMessage(role, content, options = {}) {
        const row = document.createElement("div");
        row.className = `message-row ${role === "user" ? "user-row" : "assistant-row"}`;
        if (options.error) {
            row.classList.add("message-error");
        }
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = role === "user" ? "S" : "V";
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        const text = document.createElement("p");
        text.textContent = content;
        const time = document.createElement("time");
        time.className = "message-time";
        const timestamp = parseTimestamp(options.timestamp || new Date());
        time.dateTime = Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
        time.textContent = formatTime(options.timestamp);
        bubble.append(text, time);
        row.append(avatar, bubble);
        messages.append(row);
        scrollToLatest(row);
        return row;
    }

    function appendTypingIndicator() {
        const row = document.createElement("div");
        row.className = "message-row assistant-row typing-row";
        row.setAttribute("aria-label", "Tutor is typing");
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = "V";
        const bubble = document.createElement("div");
        bubble.className = "message-bubble typing-indicator";
        bubble.setAttribute("aria-hidden", "true");
        for (let index = 0; index < 3; index += 1) {
            bubble.append(document.createElement("span"));
        }
        row.append(avatar, bubble);
        messages.append(row);
        scrollToLatest(row);
        return row;
    }

    function setTutorMode(mode) {
        modeBadge.classList.remove("demo-mode", "unavailable-mode");
        if (mode === "demo") {
            modeBadge.classList.add("demo-mode");
            modeBadge.lastElementChild.textContent = "Demo Mode";
            modeBadge.title = "Add a Gemini key to the server's .env file to enable AI.";
        } else if (mode === "error") {
            modeBadge.classList.add("unavailable-mode");
            modeBadge.lastElementChild.textContent = "Gemini temporarily unavailable";
            modeBadge.title = "Your messages are saved. Please try again shortly.";
        } else {
            modeBadge.lastElementChild.textContent = "Gemini AI connected";
            modeBadge.title = "Responses are powered by Google Gemini.";
        }
    }

    async function refreshTutorMode() {
        try {
            const response = await fetch("/api/chat/status");
            if (!response.ok) {
                throw new Error("Unable to check tutor mode.");
            }
            const status = await response.json();
            setTutorMode(status.mode);
        } catch (_error) {
            setTutorMode("error");
        }
    }

    async function sendMessage(message) {
        const trimmedMessage = message.trim();
        if (!trimmedMessage || sending) {
            return;
        }

        sending = true;
        appendMessage("user", trimmedMessage);
        input.value = "";
        input.disabled = true;
        sendButton.disabled = true;
        const typingRow = appendTypingIndicator();

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: trimmedMessage,
                    conversation_id: conversationId,
                }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || "The tutor could not reply. Please try again.");
            }
            conversationId = result.conversation_id;
            setTutorMode(result.mode);
            typingRow.remove();
            appendMessage("assistant", result.reply, { error: result.mode === "error" });
        } catch (error) {
            typingRow.remove();
            setTutorMode("error");
            appendMessage(
                "assistant",
                error.message || "Unable to reach the tutor. Please check your connection and try again.",
                { error: true },
            );
        } finally {
            sending = false;
            input.disabled = false;
            sendButton.disabled = false;
            input.focus();
        }
    }

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        sendMessage(input.value);
    }, true);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            sendMessage(input.value);
        }
    }, true);

    document.addEventListener("click", (event) => {
        const prompt = event.target.closest("[data-prompt]");
        if (prompt) {
            event.preventDefault();
            event.stopImmediatePropagation();
            sendMessage(prompt.dataset.prompt);
        }
    }, true);

    document.addEventListener("click", async (event) => {
        const conversation = event.target.closest("[data-conversation]");
        if (!conversation) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        document.querySelectorAll(".history-item").forEach((item) => {
            item.classList.toggle("selected", item === conversation);
        });

        const historyPanel = document.querySelector("#history-detail");
        historyPanel.replaceChildren();
        const loading = document.createElement("p");
        loading.className = "empty-state";
        loading.textContent = "Loading conversation…";
        historyPanel.append(loading);
        try {
            const response = await fetch(`/api/history/${encodeURIComponent(conversation.dataset.conversation)}`);
            const result = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(result.error || "Unable to load this conversation.");
            }
            const transcript = document.createElement("div");
            transcript.className = "chat-messages";
            result.messages.forEach((message) => {
                const row = document.createElement("div");
                row.className = `message-row ${message.role === "user" ? "user-row" : "assistant-row"}`;
                const avatar = document.createElement("div");
                avatar.className = "message-avatar";
                avatar.textContent = message.role === "user" ? "S" : "V";
                const bubble = document.createElement("div");
                bubble.className = "message-bubble";
                const text = document.createElement("p");
                text.textContent = message.content;
                const time = document.createElement("time");
                const timestamp = parseTimestamp(message.created_at);
                time.className = "message-time";
                time.dateTime = Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
                time.textContent = formatTime(message.created_at, true);
                bubble.append(text, time);
                row.append(avatar, bubble);
                transcript.append(row);
            });
            historyPanel.replaceChildren(transcript);
        } catch (error) {
            const message = document.createElement("p");
            message.className = "empty-state";
            message.textContent = error.message || "Unable to load this conversation.";
            historyPanel.replaceChildren(message);
        }
    }, true);

    document.querySelector("#clear-chat").addEventListener("click", () => {
        conversationId = null;
        messages.replaceChildren();
        appendMessage(
            "assistant",
            "Hi there! I'm happy to practice with you. Ask me about a word, or send a sentence you'd like to improve.",
        );
        input.focus();
    });

    messages.querySelectorAll(".message-row").forEach((row) => {
        const time = row.querySelector(".message-time");
        if (time) {
            time.textContent = `VocabMate · ${formatTime()}`;
        }
    });

    refreshTutorMode();
})();
