/**
 * =========================================================
 * API CONFIGURATION SECTION
 * =========================================================
 * Security Rule: NEVER place your GEMINI_API_KEY in frontend code.
 * All requests route securely through our Netlify Serverless Function.
 */
const API_CONFIG = {
  ENDPOINT: "/.netlify/functions/chat",
  MAX_HISTORY_TURNS: 20, // Keeps payload fast while maintaining deep context
  REQUEST_TIMEOUT_MS: 45000,
};

/**
 * =========================================================
 * APPLICATION STATE & STORAGE KEYS
 * =========================================================
 */
const STORAGE_KEYS = {
  SESSIONS: "nova_ai_sessions_v1",
  ACTIVE_ID: "nova_ai_active_id_v1",
  THEME: "nova_ai_theme_v1",
  TTS: "nova_ai_tts_v1",
};

let state = {
  sessions: [],
  activeSessionId: null,
  isGenerating: false,
  ttsEnabled: false,
  isListening: false,
};

// DOM References
const dom = {
  sidebar: document.getElementById("sidebar"),
  sidebarOverlay: document.getElementById("sidebarOverlay"),
  openSidebarBtn: document.getElementById("openSidebarBtn"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  newChatBtn: document.getElementById("newChatBtn"),
  historyList: document.getElementById("historyList"),
  clearHistoryBtn: document.getElementById("clearHistoryBtn"),
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  themeLabel: document.getElementById("themeLabel"),
  ttsToggleBtn: document.getElementById("ttsToggleBtn"),
  ttsStatusText: document.getElementById("ttsStatusText"),
  chatViewport: document.getElementById("chatViewport"),
  welcomeScreen: document.getElementById("welcomeScreen"),
  messagesContainer: document.getElementById("messagesContainer"),
  suggestedPrompts: document.getElementById("suggestedPrompts"),
  promptInput: document.getElementById("promptInput"),
  sendBtn: document.getElementById("sendBtn"),
  micBtn: document.getElementById("micBtn"),
  errorBanner: document.getElementById("errorBanner"),
  toast: document.getElementById("toast"),
};

/**
 * =========================================================
 * INITIALIZATION
 * =========================================================
 */
function init() {
  loadSettings();
  loadSessions();
  bindEvents();
  setupSpeechRecognition();
  renderSidebar();
  renderActiveChat();
}

function loadSettings() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  dom.themeLabel.textContent = savedTheme === "dark" ? "Light Mode" : "Dark Mode";

  state.ttsEnabled = localStorage.getItem(STORAGE_KEYS.TTS) === "true";
  updateTTSButtonUI();
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SESSIONS);
    state.sessions = raw ? JSON.parse(raw) : [];
  } catch {
    state.sessions = [];
  }

  const savedActiveId = localStorage.getItem(STORAGE_KEYS.ACTIVE_ID);
  if (savedActiveId && state.sessions.some((s) => s.id === savedActiveId)) {
    state.activeSessionId = savedActiveId;
  } else if (state.sessions.length > 0) {
    state.activeSessionId = state.sessions[0].id;
  } else {
    createNewSession(false);
  }
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(state.sessions));
  if (state.activeSessionId) {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_ID, state.activeSessionId);
  }
}

function getActiveSession() {
  return state.sessions.find((s) => s.id === state.activeSessionId) || null;
}

/**
 * =========================================================
 * SESSION MANAGEMENT
 * =========================================================
 */
function createNewSession(shouldRender = true) {
  const newSession = {
    id: `nova_${Date.now()}`,
    title: "New Conversation",
    updatedAt: Date.now(),
    messages: [],
  };
  state.sessions.unshift(newSession);
  state.activeSessionId = newSession.id;
  saveSessions();
  hideError();

  if (shouldRender) {
    renderSidebar();
    renderActiveChat();
    closeMobileSidebar();
  }
}

function switchSession(id) {
  if (state.isGenerating) return;
  state.activeSessionId = id;
  saveSessions();
  hideError();
  renderSidebar();
  renderActiveChat();
  closeMobileSidebar();
}

function deleteSession(id, event) {
  event.stopPropagation();
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.sessions.length === 0) {
    createNewSession(false);
  } else if (state.activeSessionId === id) {
    state.activeSessionId = state.sessions[0].id;
  }
  saveSessions();
  renderSidebar();
  renderActiveChat();
}

function clearAllHistory() {
  if (!confirm("Delete all saved NOVA AI conversations?")) return;
  window.speechSynthesis?.cancel();
  state.sessions = [];
  createNewSession(true);
  showToast("Chat history cleared");
}

/**
 * =========================================================
 * RENDERING UI & MARKDOWN ENGINE
 * =========================================================
 */
function renderSidebar() {
  dom.historyList.innerHTML = "";
  state.sessions.forEach((session) => {
    const item = document.createElement("div");
    item.className = `history-item ${session.id === state.activeSessionId ? "active" : ""}`;
    item.onclick = () => switchSession(session.id);

    const titleSpan = document.createElement("span");
    titleSpan.className = "history-title";
    titleSpan.textContent = session.title;

    const delBtn = document.createElement("button");
    delBtn.className = "delete-chat-btn";
    delBtn.innerHTML = "&times;";
    delBtn.title = "Delete conversation";
    delBtn.onclick = (e) => deleteSession(session.id, e);

    item.append(titleSpan, delBtn);
    dom.historyList.appendChild(item);
  });
}

function renderActiveChat() {
  const session = getActiveSession();
  dom.messagesContainer.innerHTML = "";

  if (!session || session.messages.length === 0) {
    dom.welcomeScreen.hidden = false;
    return;
  }

  dom.welcomeScreen.hidden = true;
  session.messages.forEach((msg, index) => {
    const isLastAi = msg.role === "model" && index === session.messages.length - 1;
    appendMessageElement(msg.role, msg.text, isLastAi);
  });
  scrollToBottom();
}

function appendMessageElement(role, text, showRegenerate = false) {
  const row = document.createElement("div");
  row.className = `message-row ${role === "user" ? "user" : "ai"}`;

  if (role !== "user") {
    const avatar = document.createElement("div");
    avatar.className = "avatar ai";
    avatar.textContent = "N";
    row.appendChild(avatar);
  }

  const contentCol = document.createElement("div");
  contentCol.style.maxWidth = "85%";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble";

  if (role === "user") {
    bubble.textContent = text;
  } else {
    bubble.innerHTML = parseMarkdown(text);
  }

  contentCol.appendChild(bubble);

  // Action buttons for AI messages
  if (role !== "user") {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const copyBtn = document.createElement("button");
    copyBtn.className = "msg-action-btn";
    copyBtn.textContent = "Copy";
    copyBtn.onclick = () => copyTextToClipboard(text, "Response copied");

    const speakBtn = document.createElement("button");
    speakBtn.className = "msg-action-btn";
    speakBtn.textContent = "Listen";
    speakBtn.onclick = () => speakText(text);

    actions.append(copyBtn, speakBtn);

    if (showRegenerate) {
      const regenBtn = document.createElement("button");
      regenBtn.className = "msg-action-btn";
      regenBtn.textContent = "Regenerate";
      regenBtn.onclick = handleRegenerate;
      actions.appendChild(regenBtn);
    }

    contentCol.appendChild(actions);
  }

  row.appendChild(contentCol);
  dom.messagesContainer.appendChild(row);
  return row;
}

function showTypingIndicator() {
  const row = document.createElement("div");
  row.className = "message-row ai";
  row.id = "typingRow";
  row.innerHTML = `
    <div class="avatar ai">N</div>
    <div class="message-bubble">
      <div class="typing-indicator" aria-label="NOVA AI is thinking">
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
    </div>
  `;
  dom.messagesContainer.appendChild(row);
  scrollToBottom();
}

function removeTypingIndicator() {
  document.getElementById("typingRow")?.remove();
}

/**
 * Lightweight, XSS-Safe Markdown Parser with Code Block Copy Buttons
 */
function parseMarkdown(raw) {
  const escapeHtml = (str) =>
    str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // Extract fenced code blocks first
  const codeBlocks = [];
  let processed = raw.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang = "code", code) => {
    const id = `code_${codeBlocks.length}_${Date.now()}`;
    const safeCode = escapeHtml(code.trim());
    codeBlocks.push(`
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span>${escapeHtml(lang)}</span>
          <button class="copy-code-btn" type="button" onclick="copyCodeBlock('${id}', this)">Copy code</button>
        </div>
        <pre><code id="${id}">${safeCode}</code></pre>
      </div>
    `);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });

  processed = escapeHtml(processed);

  // Inline code
  processed = processed.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  // Bold & Italic
  processed = processed.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  processed = processed.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Headings
  processed = processed.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  processed = processed.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  // Bullet lists
  processed = processed.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  processed = processed.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Paragraphs
  processed = processed
    .split(/\n{2,}/)
    .map((block) => {
      if (block.startsWith("__CODE_BLOCK_") || block.startsWith("<ul>") || block.startsWith("<h")) {
        return block;
      }
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

  // Restore code blocks
  codeBlocks.forEach((html, idx) => {
    processed = processed.replace(`__CODE_BLOCK_${idx}__`, html);
  });

  return processed;
}

window.copyCodeBlock = function (elementId, btn) {
  const codeEl = document.getElementById(elementId);
  if (!codeEl) return;
  copyTextToClipboard(codeEl.textContent, "Code copied to clipboard");
  btn.textContent = "Copied!";
  setTimeout(() => (btn.textContent = "Copy code"), 1800);
};

/**
 * =========================================================
 * GEMINI BACKEND COMMUNICATION
 * =========================================================
 */
async function sendMessage(overrideText = null) {
  if (state.isGenerating) return;

  const text = (overrideText ?? dom.promptInput.value).trim();
  if (!text) return;

  const session = getActiveSession();
  if (!session) return;

  hideError();
  dom.welcomeScreen.hidden = true;

  // Set conversation title from first prompt
  if (session.messages.length === 0) {
    session.title = text.slice(0, 38) + (text.length > 38 ? "..." : "");
  }

  session.messages.push({ role: "user", text });
  session.updatedAt = Date.now();
  saveSessions();
  renderSidebar();

  dom.promptInput.value = "";
  autoResizeTextarea();
  updateSendButtonState();

  appendMessageElement("user", text);
  scrollToBottom();

  await fetchAIResponse(session);
}

async function handleRegenerate() {
  if (state.isGenerating) return;
  const session = getActiveSession();
  if (!session || session.messages.length === 0) return;

  // Remove last model response if present
  if (session.messages[session.messages.length - 1].role === "model") {
    session.messages.pop();
  }
  saveSessions();
  renderActiveChat();
  await fetchAIResponse(session);
}

async function fetchAIResponse(session) {
  state.isGenerating = true;
  updateSendButtonState();
  showTypingIndicator();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.REQUEST_TIMEOUT_MS);

  try {
    // Send sliding window of conversation context
    const contextMessages = session.messages.slice(-API_CONFIG.MAX_HISTORY_TURNS);

    const response = await fetch(API_CONFIG.ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: contextMessages }),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Server responded with status ${response.status}`);
    }

    if (!data.reply) {
      throw new Error("Received an empty response from NOVA AI.");
    }

    removeTypingIndicator();
    session.messages.push({ role: "model", text: data.reply });
    session.updatedAt = Date.now();
    saveSessions();
    renderActiveChat();

    if (state.ttsEnabled) {
      speakText(data.reply);
    }
  } catch (err) {
    removeTypingIndicator();
    const message =
      err.name === "AbortError"
        ? "Request timed out. Please try again."
        : err.message || "Unable to connect to NOVA AI backend.";
    showError(message);
  } finally {
    clearTimeout(timeoutId);
    state.isGenerating = false;
    updateSendButtonState();
  }
}

/**
 * =========================================================
 * VOICE INPUT (STT) & VOICE OUTPUT (TTS)
 * =========================================================
 */
let recognition = null;

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    dom.micBtn.style.display = "none";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    state.isListening = true;
    dom.micBtn.classList.add("recording");
    showToast("Listening...");
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    dom.promptInput.value = (dom.promptInput.value + " " + transcript).trim();
    autoResizeTextarea();
    updateSendButtonState();
  };

  recognition.onerror = (event) => {
    showToast(`Voice input error: ${event.error}`);
  };

  recognition.onend = () => {
    state.isListening = false;
    dom.micBtn.classList.remove("recording");
  };
}

function toggleVoiceInput() {
  if (!recognition) return;
  if (state.isListening) {
    recognition.stop();
  } else {
    recognition.start();
  }
}

function toggleTTS() {
  state.ttsEnabled = !state.ttsEnabled;
  localStorage.setItem(STORAGE_KEYS.TTS, String(state.ttsEnabled));
  if (!state.ttsEnabled) {
    window.speechSynthesis?.cancel();
  }
  updateTTSButtonUI();
  showToast(state.ttsEnabled ? "Auto-voice enabled" : "Auto-voice muted");
}

function updateTTSButtonUI() {
  dom.ttsToggleBtn.classList.toggle("active", state.ttsEnabled);
  dom.ttsToggleBtn.setAttribute("aria-pressed", String(state.ttsEnabled));
  dom.ttsStatusText.textContent = state.ttsEnabled ? "Voice: ON" : "Voice: OFF";
}

function speakText(markdownText) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  // Strip markdown symbols for natural speech
  const cleanText = markdownText
    .replace(/```[\s\S]*?```/g, "Code block omitted.")
    .replace(/[#*`_>-]/g, "")
    .trim();

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.rate = 1.02;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}

/**
 * =========================================================
 * UTILITIES & EVENT BINDINGS
 * =========================================================
 */
function bindEvents() {
  dom.newChatBtn.addEventListener("click", () => createNewSession(true));
  dom.clearHistoryBtn.addEventListener("click", clearAllHistory);
  dom.ttsToggleBtn.addEventListener("click", toggleTTS);
  dom.micBtn.addEventListener("click", toggleVoiceInput);
  dom.sendBtn.addEventListener("click", () => sendMessage());

  dom.themeToggleBtn.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(STORAGE_KEYS.THEME, next);
    dom.themeLabel.textContent = next === "dark" ? "Light Mode" : "Dark Mode";
  });

  // Mobile sidebar drawers
  dom.openSidebarBtn.addEventListener("click", () => {
    dom.sidebar.classList.add("open");
    dom.sidebarOverlay.classList.add("active");
  });
  dom.closeSidebarBtn.addEventListener("click", closeMobileSidebar);
  dom.sidebarOverlay.addEventListener("click", closeMobileSidebar);

  // Suggested prompt cards
  dom.suggestedPrompts.addEventListener("click", (e) => {
    const card = e.target.closest(".prompt-card");
    if (card?.dataset.prompt) {
      sendMessage(card.dataset.prompt);
    }
  });

  // Textarea auto-grow & Enter key handling
  dom.promptInput.addEventListener("input", () => {
    autoResizeTextarea();
    updateSendButtonState();
  });

  dom.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}

function closeMobileSidebar() {
  dom.sidebar.classList.remove("open");
  dom.sidebarOverlay.classList.remove("active");
}

function autoResizeTextarea() {
  dom.promptInput.style.height = "auto";
  dom.promptInput.style.height = `${Math.min(dom.promptInput.scrollHeight, 160)}px`;
}

function updateSendButtonState() {
  dom.sendBtn.disabled = state.isGenerating || dom.promptInput.value.trim().length === 0;
}

function scrollToBottom() {
  dom.chatViewport.scrollTop = dom.chatViewport.scrollHeight;
}

function showError(msg) {
  dom.errorBanner.textContent = msg;
  dom.errorBanner.hidden = false;
}

function hideError() {
  dom.errorBanner.hidden = true;
  dom.errorBanner.textContent = "";
}

function copyTextToClipboard(text, toastMsg) {
  navigator.clipboard?.writeText(text).then(() => showToast(toastMsg));
}

let toastTimer;
function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 2400);
}

document.addEventListener("DOMContentLoaded", init);