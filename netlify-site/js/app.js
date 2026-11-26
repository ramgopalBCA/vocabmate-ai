(() => {
    "use strict";

    const STORAGE_KEY = "vocabmate-netlify-v1";
    const WORDS = window.VOCABMATE_WORDS;
    const names = {
        dashboard: "Dashboard",
        vocabulary: "Vocabulary",
        daily: "Daily words",
        quiz: "Quick quiz",
        progress: "My progress",
        tutor: "AI tutor",
        history: "Chat history",
    };
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
    const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
    const today = () => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    };
    const initialData = () => ({
        version: 1,
        favorites: [],
        learned: {},
        quizAttempts: [],
        conversations: [],
    });

    let data;
    let activeFilter = "all";
    let activeQuiz = null;
    let quizAnswers = {};
    let conversationId = null;
    let toastTimer;
    let sending = false;

    function toast(message) {
        const element = $("#toast");
        element.textContent = message;
        element.classList.add("show");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => element.classList.remove("show"), 3000);
    }

    function persist() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.error("Unable to save VocabMate data in this browser.", error);
            toast("Your browser could not save this change. Check its storage settings.");
        }
    }

    function readData() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (!saved) return initialData();
            const parsed = JSON.parse(saved);
            if (parsed.version !== 1 || !Array.isArray(parsed.favorites)
                || !parsed.learned || !Array.isArray(parsed.quizAttempts)
                || !Array.isArray(parsed.conversations)) {
                throw new Error("Saved learning data has an unsupported format.");
            }
            return parsed;
        } catch (error) {
            console.error("Unable to read saved VocabMate data.", error);
            toast("Saved learning data could not be read. New changes may not be saved.");
            return initialData();
        }
    }

    function dateLabel(value) {
        const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
        return Number.isNaN(date.getTime())
            ? ""
            : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function dayDifference(left, right) {
        return Math.round((new Date(`${left}T12:00:00`) - new Date(`${right}T12:00:00`)) / 86400000);
    }

    function dailyWords() {
        const ordinal = Math.floor(new Date(`${today()}T00:00:00`).getTime() / 86400000) + 719163;
        const offset = ordinal % WORDS.length;
        return Array.from({ length: 5 }, (_, index) => WORDS[(offset + index) % WORDS.length]);
    }

    function decorate(word) {
        return { ...word, favorite: data.favorites.includes(word.id), learned: Boolean(data.learned[word.id]) };
    }

    function weeklyCounts() {
        const start = new Date(`${today()}T12:00:00`);
        start.setDate(start.getDate() - 6);
        return Array.from({ length: 7 }, (_, index) => {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
            return {
                date: isoDate,
                count: Object.values(data.learned).filter((learnedOn) => learnedOn === isoDate).length,
            };
        });
    }

    function quizHistory(limit = 20) {
        return [...data.quizAttempts].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
    }

    function dashboard() {
        const learnedDates = new Set(Object.values(data.learned));
        let streak = 0;
        let streakDate = today();
        if (!learnedDates.has(streakDate)) {
            const yesterday = new Date(`${streakDate}T12:00:00`);
            yesterday.setDate(yesterday.getDate() - 1);
            streakDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
        }
        while (learnedDates.has(streakDate)) {
            streak += 1;
            const previous = new Date(`${streakDate}T12:00:00`);
            previous.setDate(previous.getDate() - 1);
            streakDate = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}-${String(previous.getDate()).padStart(2, "0")}`;
        }
        const allAttempts = data.quizAttempts;
        const attempts = quizHistory();
        const average = allAttempts.length
            ? Math.round(allAttempts.reduce((sum, attempt) => sum + attempt.score / attempt.total * 100, 0) / allAttempts.length)
            : 0;
        const learnedToday = Object.values(data.learned).filter((date) => date === today()).length;
        return {
            learned_words: Object.keys(data.learned).length,
            daily_learned: learnedToday,
            daily_goal: 5,
            streak,
            quiz_attempts: data.quizAttempts.length,
            average_score: average,
            recent_scores: attempts.slice(0, 5),
            word_of_day: decorate(dailyWords()[0]),
        };
    }

    function wordCard(word) {
        return `<article class="word-card"><div class="word-card-head"><div><h3>${esc(word.word)}</h3><div class="word-card-type">${esc(word.part_of_speech)} · ${esc(word.level)}</div></div><button class="round-favorite ${word.favorite ? "is-favorite" : ""}" data-favorite="${esc(word.id)}" aria-label="Toggle favorite">${word.favorite ? "♥" : "♡"}</button></div><p class="word-card-meaning">${esc(word.hindi)}</p><p class="word-card-example">${esc(word.example)}</p><p class="word-related"><strong>Synonyms</strong> · ${esc(word.synonyms.join(", "))}<br><strong>Antonyms</strong> · ${esc(word.antonyms.join(", "))}</p><div class="word-card-bottom"><small>/${esc(word.pronunciation)}/</small><button class="small-action ${word.learned ? "done" : ""}" data-learn="${esc(word.id)}">${word.learned ? "Learned ✓" : "Mark learned"}</button></div></article>`;
    }

    function drawChart(element, days) {
        const maximum = Math.max(1, ...days.map((day) => day.count));
        element.innerHTML = days.map((day) => `<div class="chart-column"><div class="chart-bar-track"><div class="chart-bar ${day.date === today() ? "today" : ""}" style="height:${day.count ? Math.max(8, day.count / maximum * 100) : 3}%" title="${day.count} words"></div></div><span class="chart-day">${new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span></div>`).join("");
    }

    function renderDashboard() {
        const summary = dashboard();
        const learnedCount = Object.keys(data.learned).length;
        $("#stat-learned").textContent = learnedCount;
        $("#stat-total-words").textContent = `${WORDS.length} words in your library`;
        $("#nav-word-count").textContent = WORDS.length;
        $("#stat-daily").textContent = summary.daily_learned;
        $("#daily-progress-fill").style.width = `${Math.min(100, summary.daily_learned / summary.daily_goal * 100)}%`;
        $("#stat-average").textContent = summary.average_score;
        $("#stat-quiz-count").textContent = summary.quiz_attempts ? `${summary.quiz_attempts} quizzes completed` : "No quizzes yet";
        $("#streak-count").textContent = `${summary.streak} day streak`;
        const word = summary.word_of_day;
        $("#feature-word").textContent = word.word;
        $("#feature-part").textContent = word.part_of_speech.toUpperCase();
        $("#feature-meaning").textContent = word.hindi;
        $("#feature-pronunciation").textContent = `/${word.pronunciation}/`;
        $("#feature-example").textContent = word.example;
        $("#word-date").textContent = dateLabel(today());
        $("#feature-favorite").classList.toggle("is-favorite", word.favorite);
        $("#feature-favorite").textContent = word.favorite ? "♥" : "♡";
        $("#feature-favorite").dataset.favorite = word.id;
        $("#feature-learn").textContent = word.learned ? "Learned ✓" : "Mark as learned";
        $("#feature-learn").dataset.learn = word.id;
        drawChart($("#week-chart"), weeklyCounts());
        $("#week-total").textContent = `${weeklyCounts().reduce((sum, day) => sum + day.count, 0)} this week`;
        $("#daily-preview").innerHTML = dailyWords().map((entry) => {
            const current = decorate(entry);
            return `<button class="preview-word" data-go="daily"><strong>${esc(current.word)}</strong><span>${esc(current.hindi)}</span>${current.learned ? '<i class="preview-check">✓</i>' : ""}</button>`;
        }).join("");
    }

    function renderVocabulary() {
        const query = $("#word-search").value.toLowerCase().trim();
        const matching = WORDS.map(decorate).filter((word) => {
            const matchesQuery = `${word.word} ${word.hindi} ${word.part_of_speech}`.toLowerCase().includes(query);
            const matchesFilter = activeFilter === "all"
                || (activeFilter === "favorites" ? word.favorite : word.learned);
            return matchesQuery && matchesFilter;
        });
        $("#vocabulary-grid").innerHTML = matching.map(wordCard).join("");
        $("#vocabulary-empty").classList.toggle("hidden", matching.length > 0);
        $("#favorite-count").textContent = data.favorites.length;
    }

    function renderDaily() {
        const list = dailyWords().map(decorate);
        $("#daily-date-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
        $("#daily-learned-count").textContent = list.filter((word) => word.learned).length;
        $("#daily-list").innerHTML = list.map((word, index) => `<article class="daily-word-row ${word.learned ? "learned" : ""}"><span class="daily-number">${String(index + 1).padStart(2, "0")}</span><div class="daily-word-main"><strong>${esc(word.word)}</strong><small>${esc(word.part_of_speech)} · /${esc(word.pronunciation)}/</small></div><div class="daily-word-meaning">${esc(word.hindi)}<small>${esc(word.example)}</small></div><div class="daily-word-actions"><button class="round-favorite ${word.favorite ? "is-favorite" : ""}" data-favorite="${esc(word.id)}" aria-label="Toggle favorite">${word.favorite ? "♥" : "♡"}</button><button class="small-action ${word.learned ? "done" : ""}" data-learn="${esc(word.id)}">${word.learned ? "Learned ✓" : "Learned"}</button></div></article>`).join("");
    }

    function renderProgress() {
        const attempts = quizHistory();
        const average = attempts.length
            ? Math.round(attempts.reduce((sum, attempt) => sum + attempt.score / attempt.total * 100, 0) / attempts.length)
            : 0;
        $("#progress-learned").textContent = Object.keys(data.learned).length;
        $("#progress-quizzes").textContent = data.quizAttempts.length;
        $("#progress-average").textContent = `${average}%`;
        drawChart($("#progress-chart"), weeklyCounts());
        $("#score-history").innerHTML = attempts.length
            ? attempts.map((attempt) => `<div class="score-row"><span>${dateLabel(attempt.created_at)}</span><strong>${attempt.score} / ${attempt.total} correct</strong><span class="score-pill">${Math.round(attempt.score / attempt.total * 100)}%</span></div>`).join("")
            : '<p class="empty-state">Your quiz results will appear here.</p>';
    }

    function render() {
        renderDashboard();
        renderVocabulary();
        renderDaily();
        renderProgress();
    }

    function go(view) {
        if (!names[view]) return;
        $$(".view").forEach((section) => section.classList.toggle("active", section.id === `view-${view}`));
        $$(".nav-link").forEach((link) => link.classList.toggle("active", link.dataset.view === view));
        $("#current-page-name").textContent = names[view];
        $("#sidebar").classList.remove("open");
        $("#mobile-overlay").classList.remove("show");
        history.replaceState(null, "", `#${view}`);
        if (view === "history") renderHistoryList();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function toggleFavorite(id) {
        const index = data.favorites.indexOf(id);
        if (index >= 0) {
            data.favorites.splice(index, 1);
        } else {
            data.favorites.push(id);
        }
        persist();
        render();
        toast(index >= 0 ? "Removed from favorites." : "Added to favorites.");
    }

    function markLearned(id) {
        if (data.learned[id]) {
            toast("This word is already in your learned list.");
            return;
        }
        data.learned[id] = today();
        persist();
        render();
        toast("Word added to your learned list.");
    }

    function shuffle(items) {
        const result = [...items];
        for (let index = result.length - 1; index > 0; index -= 1) {
            const swap = Math.floor(Math.random() * (index + 1));
            [result[index], result[swap]] = [result[swap], result[index]];
        }
        return result;
    }

    function startQuiz() {
        const selected = shuffle(WORDS).slice(0, 5);
        activeQuiz = {
            quiz_id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`,
            questions: selected.map((word, index) => {
                const options = shuffle(WORDS).slice(0, 4);
                if (!options.some((option) => option.id === word.id)) options[options.length - 1] = word;
                return {
                    id: String(index + 1),
                    word: word.word,
                    part_of_speech: word.part_of_speech,
                    answerId: word.id,
                    options: shuffle(options).map((option) => ({ id: option.id, text: option.hindi })),
                };
            }),
        };
        quizAnswers = {};
        renderQuiz();
    }

    function renderQuiz(result) {
        const panel = $("#quiz-panel");
        if (result) {
            panel.innerHTML = `<div class="quiz-result"><strong class="quiz-result-score">${result.score}/${result.total}</strong><div><strong>${result.percentage === 100 ? "Beautifully done!" : "Nice work showing up."}</strong><p>${result.percentage}% correct · Every answer is a chance to learn.</p></div></div>${result.results.map((entry) => `<div class="score-row"><span>${esc(entry.word)}</span><strong>${esc(entry.correct_answer)}</strong><span class="score-pill">${entry.correct ? "Correct" : `Your answer: ${esc(entry.selected_answer)}`}</span></div>`).join("")}<button class="button button-primary" id="start-quiz">Try another quiz →</button>`;
            activeQuiz = null;
            return;
        }
        panel.innerHTML = `<div class="quiz-question-list">${activeQuiz.questions.map((question, index) => `<article class="quiz-question"><small>QUESTION ${index + 1} OF ${activeQuiz.questions.length} · ${esc(question.part_of_speech)}</small><h3>${esc(question.word)}</h3><div class="quiz-options">${question.options.map((option) => `<button class="quiz-option ${quizAnswers[question.id] === option.id ? "selected" : ""}" data-question="${question.id}" data-option="${esc(option.id)}">${esc(option.text)}</button>`).join("")}</div></article>`).join("")}<div class="quiz-submit-row"><span class="quiz-feedback">${Object.keys(quizAnswers).length} of ${activeQuiz.questions.length} answered</span><button class="button button-primary" id="submit-quiz">Check answers →</button></div></div>`;
    }

    function submitQuiz() {
        if (!activeQuiz || Object.keys(quizAnswers).length !== activeQuiz.questions.length) {
            toast("Choose an answer for each question first.");
            return;
        }
        const results = activeQuiz.questions.map((question) => {
            const selectedId = quizAnswers[question.id];
            const selected = WORDS.find((word) => word.id === selectedId);
            const answer = WORDS.find((word) => word.id === question.answerId);
            return {
                word: question.word,
                correct: selectedId === question.answerId,
                correct_answer: answer.hindi,
                selected_answer: selected.hindi,
            };
        });
        const score = results.filter((entry) => entry.correct).length;
        const result = { score, total: results.length, percentage: Math.round(score / results.length * 100), results };
        data.quizAttempts.push({ score, total: results.length, created_at: new Date().toISOString() });
        persist();
        renderQuiz(result);
        render();
    }

    function parseTimestamp(value) {
        const timestamp = new Date(value);
        return timestamp;
    }

    function formattedTime(value = new Date(), includeDate = false) {
        const timestamp = parseTimestamp(value);
        if (Number.isNaN(timestamp.getTime())) return "";
        return includeDate
            ? timestamp.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
            : timestamp.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }

    function appendMessage(role, content, options = {}) {
        const row = document.createElement("div");
        row.className = `message-row ${role === "user" ? "user-row" : "assistant-row"}${options.error ? " message-error" : ""}`;
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = role === "user" ? "S" : "V";
        const bubble = document.createElement("div");
        bubble.className = "message-bubble";
        const text = document.createElement("p");
        text.textContent = content;
        const time = document.createElement("time");
        const timestamp = parseTimestamp(options.timestamp || new Date());
        time.className = "message-time";
        time.dateTime = Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
        time.textContent = formattedTime(options.timestamp);
        bubble.append(text, time);
        row.append(avatar, bubble);
        $("#chat-messages").append(row);
        row.scrollIntoView({ block: "nearest" });
        $("#chat-messages").scrollTop = $("#chat-messages").scrollHeight;
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
        for (let index = 0; index < 3; index += 1) bubble.append(document.createElement("span"));
        row.append(avatar, bubble);
        $("#chat-messages").append(row);
        row.scrollIntoView({ block: "nearest" });
        return row;
    }

    function setTutorMode(mode) {
        const badge = $("#chat-mode");
        badge.classList.remove("demo-mode", "unavailable-mode");
        if (mode === "demo") {
            badge.classList.add("demo-mode");
            badge.lastElementChild.textContent = "Demo Mode";
            badge.title = "Set GEMINI_API_KEY in your hosting provider to enable live AI responses.";
        } else if (mode === "error") {
            badge.classList.add("unavailable-mode");
            badge.lastElementChild.textContent = "Gemini temporarily unavailable";
            badge.title = "Your messages are saved. Please try again shortly.";
        } else {
            badge.lastElementChild.textContent = "Gemini AI connected";
            badge.title = "Responses are powered by Google Gemini.";
        }
    }

    async function checkTutorMode() {
        try {
            const response = await fetch("/api/chat/status");
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "Unable to check tutor mode.");
            setTutorMode(result.mode);
        } catch (error) {
            console.error("Unable to check the tutor mode.", error);
            setTutorMode("error");
        }
    }

    function currentConversation() {
        return data.conversations.find((conversation) => conversation.id === conversationId);
    }

    function saveConversation(conversation) {
        conversation.updated_at = new Date().toISOString();
        persist();
    }

    async function sendChat(message) {
        const trimmed = message.trim();
        if (!trimmed || sending) return;
        if (trimmed.length > 1200) {
            toast("Your message must be 1,200 characters or fewer.");
            return;
        }
        sending = true;
        const input = $("#chat-input");
        const sendButton = $(".send-button");
        appendMessage("user", trimmed);
        input.value = "";
        input.disabled = true;
        sendButton.disabled = true;
        const typing = appendTypingIndicator();

        if (!conversationId || !currentConversation()) {
            conversationId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            data.conversations.unshift({
                id: conversationId,
                title: trimmed.slice(0, 48),
                updated_at: new Date().toISOString(),
                messages: [],
            });
        }
        const conversation = currentConversation();
        const history = [];
        let historyLength = 0;
        for (const previous of conversation.messages.slice(-12).reverse()) {
            if (historyLength + previous.content.length > 12000) break;
            history.unshift({ role: previous.role, content: previous.content });
            historyLength += previous.content.length;
        }
        if (history[0]?.role === "assistant") history.shift();
        conversation.messages.push({ role: "user", content: trimmed, created_at: new Date().toISOString() });
        saveConversation(conversation);

        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: trimmed, history }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(result.error || "The tutor could not reply. Please try again.");
            setTutorMode(result.mode);
            typing.remove();
            const reply = typeof result.reply === "string" ? result.reply : "The tutor could not reply. Please try again.";
            appendMessage("assistant", reply, { error: result.mode === "error" });
            conversation.messages.push({ role: "assistant", content: reply, created_at: new Date().toISOString() });
            saveConversation(conversation);
        } catch (error) {
            console.error("Tutor request failed.", error);
            typing.remove();
            setTutorMode("error");
            const reply = error.message || "Unable to reach the tutor. Please check your connection and try again.";
            appendMessage("assistant", reply, { error: true });
            conversation.messages.push({ role: "assistant", content: reply, created_at: new Date().toISOString() });
            saveConversation(conversation);
        } finally {
            sending = false;
            input.disabled = false;
            sendButton.disabled = false;
            renderHistoryList();
            input.focus();
        }
    }

    function renderHistoryList() {
        const list = $("#history-list");
        const conversations = [...data.conversations].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 30);
        list.innerHTML = conversations.length
            ? conversations.map((conversation) => `<button class="history-item ${conversation.id === conversationId ? "selected" : ""}" data-conversation="${esc(conversation.id)}"><strong>${esc(conversation.title)}</strong><span>${dateLabel(conversation.updated_at)}</span></button>`).join("")
            : '<p class="empty-state">No conversations yet.</p>';
    }

    function openHistory(id, button) {
        const conversation = data.conversations.find((item) => item.id === id);
        if (!conversation) {
            toast("That conversation could not be opened.");
            renderHistoryList();
            return;
        }
        $$(".history-item").forEach((item) => item.classList.toggle("selected", item === button));
        const transcript = document.createElement("div");
        transcript.className = "chat-messages";
        conversation.messages.forEach((message) => {
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
            time.className = "message-time";
            time.textContent = formattedTime(message.created_at, true);
            bubble.append(text, time);
            row.append(avatar, bubble);
            transcript.append(row);
        });
        $("#history-detail").replaceChildren(transcript);
    }

    function clearChat() {
        conversationId = null;
        $("#chat-messages").replaceChildren();
        appendMessage("assistant", "Hi there! I'm happy to practice with you. Ask me about a word, or send a sentence you'd like to improve.");
        $("#chat-input").focus();
    }

    document.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button) return;
        if (button.dataset.view) go(button.dataset.view);
        if (button.dataset.go) go(button.dataset.go);
        if (button.dataset.favorite) toggleFavorite(button.dataset.favorite);
        if (button.dataset.learn) markLearned(button.dataset.learn);
        if (button.dataset.filter) {
            activeFilter = button.dataset.filter;
            $$(".filter-button").forEach((filter) => filter.classList.toggle("selected", filter === button));
            renderVocabulary();
        }
        if (button.id === "start-quiz") startQuiz();
        if (button.id === "submit-quiz") submitQuiz();
        if (button.dataset.question) {
            quizAnswers[button.dataset.question] = button.dataset.option;
            renderQuiz();
        }
        if (button.dataset.prompt) sendChat(button.dataset.prompt);
        if (button.dataset.conversation) openHistory(button.dataset.conversation, button);
        if (button.id === "menu-toggle") {
            $("#sidebar").classList.toggle("open");
            $("#mobile-overlay").classList.toggle("show");
        }
        if (button.id === "clear-chat") clearChat();
    });

    $("#mobile-overlay").addEventListener("click", () => {
        $("#sidebar").classList.remove("open");
        $("#mobile-overlay").classList.remove("show");
    });
    $("#word-search").addEventListener("input", renderVocabulary);
    $("#chat-form").addEventListener("submit", (event) => {
        event.preventDefault();
        sendChat($("#chat-input").value);
    });
    $("#chat-input").addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing && window.innerWidth > 560) {
            event.preventDefault();
            sendChat($("#chat-input").value);
        }
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
            event.preventDefault();
            go("vocabulary");
            $("#word-search").focus();
        }
        if (event.key === "Escape") {
            $("#sidebar").classList.remove("open");
            $("#mobile-overlay").classList.remove("show");
        }
    });

    data = readData();
    $("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    $("#welcome-date").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
    render();
    const initialView = location.hash.slice(1);
    if (names[initialView]) go(initialView);
    checkTutorMode();
})();
