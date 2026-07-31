// ═══════════════════════════════════════════════════════
// S.A.R.A. Chat Widget — Embeddable JavaScript
// ═══════════════════════════════════════════════════════
// Usage: <script src="https://app.scalaai.it/sara-widget.js"></script>
// ═══════════════════════════════════════════════════════

(function() {
    'use strict';

    const SARA_API = window.SARA_API_URL || 'https://app.scalaai.it/api/sara/widget/chat';
    const WIDGET_ID = 'sara-chat-widget';

    // Prevent double-init
    if (document.getElementById(WIDGET_ID)) return;

    // ─── CSS ───
    const style = document.createElement('style');
    style.textContent = `
        #sara-chat-widget * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

        #sara-chat-bubble {
            position: fixed; bottom: 24px; right: 24px; z-index: 99999;
            width: 64px; height: 64px; border-radius: 50%;
            background: linear-gradient(135deg, #6366f1, #8b5cf6, #a855f7);
            box-shadow: 0 8px 32px rgba(99,102,241,0.4), 0 0 0 0 rgba(99,102,241,0.3);
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            animation: sara-pulse 2.5s infinite;
        }
        #sara-chat-bubble:hover { transform: scale(1.1); box-shadow: 0 12px 40px rgba(99,102,241,0.5); }
        #sara-chat-bubble svg { width: 32px; height: 32px; fill: white; }

        @keyframes sara-pulse {
            0%, 100% { box-shadow: 0 8px 32px rgba(99,102,241,0.4), 0 0 0 0 rgba(99,102,241,0.3); }
            50% { box-shadow: 0 8px 32px rgba(99,102,241,0.4), 0 0 0 12px rgba(99,102,241,0); }
        }

        #sara-chat-window {
            position: fixed; bottom: 100px; right: 24px; z-index: 99999;
            width: 380px; max-width: calc(100vw - 32px); height: 520px; max-height: calc(100vh - 140px);
            background: #0f172a; border: 1px solid rgba(99,102,241,0.3);
            border-radius: 20px; overflow: hidden;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.1);
            display: none; flex-direction: column;
            animation: sara-slide-up 0.3s ease;
        }
        #sara-chat-window.sara-open { display: flex; }

        @keyframes sara-slide-up {
            from { opacity: 0; transform: translateY(20px) scale(0.95); }
            to { opacity: 1; transform: translateY(0) scale(1); }
        }

        #sara-chat-header {
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            padding: 16px 20px; display: flex; align-items: center; gap: 12px;
            border-bottom: 1px solid rgba(255,255,255,0.1);
        }
        #sara-chat-header .sara-avatar {
            width: 40px; height: 40px; border-radius: 50%;
            background: rgba(255,255,255,0.2); display: flex; align-items: center;
            justify-content: center; font-size: 20px; flex-shrink: 0;
        }
        #sara-chat-header .sara-info { flex: 1; }
        #sara-chat-header .sara-name { color: white; font-weight: 700; font-size: 15px; }
        #sara-chat-header .sara-status { color: rgba(255,255,255,0.7); font-size: 12px; display: flex; align-items: center; gap: 4px; }
        #sara-chat-header .sara-dot { width: 6px; height: 6px; border-radius: 50%; background: #4ade80; }
        #sara-chat-header .sara-close {
            width: 32px; height: 32px; border-radius: 50%; border: none;
            background: rgba(255,255,255,0.15); color: white; font-size: 18px;
            cursor: pointer; display: flex; align-items: center; justify-content: center;
            transition: background 0.2s;
        }
        #sara-chat-header .sara-close:hover { background: rgba(255,255,255,0.3); }

        #sara-chat-messages {
            flex: 1; overflow-y: auto; padding: 16px;
            display: flex; flex-direction: column; gap: 12px;
            scrollbar-width: thin; scrollbar-color: #334155 transparent;
        }
        #sara-chat-messages::-webkit-scrollbar { width: 4px; }
        #sara-chat-messages::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }

        .sara-msg {
            max-width: 85%; padding: 12px 16px; border-radius: 16px;
            font-size: 14px; line-height: 1.5; word-wrap: break-word;
            animation: sara-msg-in 0.3s ease;
        }
        @keyframes sara-msg-in {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .sara-msg.sara-bot {
            background: #1e293b; color: #e2e8f0;
            border-bottom-left-radius: 4px; align-self: flex-start;
            border: 1px solid rgba(99,102,241,0.15);
        }
        .sara-msg.sara-user {
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            color: white; border-bottom-right-radius: 4px; align-self: flex-end;
        }

        .sara-typing { display: flex; gap: 4px; padding: 12px 16px; align-self: flex-start; }
        .sara-typing span {
            width: 8px; height: 8px; border-radius: 50%; background: #6366f1;
            animation: sara-typing-bounce 1.4s infinite;
        }
        .sara-typing span:nth-child(2) { animation-delay: 0.2s; }
        .sara-typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes sara-typing-bounce {
            0%, 100% { transform: translateY(0); opacity: 0.4; }
            50% { transform: translateY(-6px); opacity: 1; }
        }

        #sara-chat-input-area {
            padding: 12px 16px; border-top: 1px solid #1e293b;
            display: flex; gap: 8px; background: #0f172a;
        }
        #sara-chat-input {
            flex: 1; background: #1e293b; border: 1px solid #334155;
            border-radius: 12px; padding: 10px 16px; color: #e2e8f0;
            font-size: 14px; outline: none; resize: none;
            transition: border-color 0.2s;
        }
        #sara-chat-input:focus { border-color: #6366f1; }
        #sara-chat-input::placeholder { color: #64748b; }

        #sara-chat-send {
            width: 44px; height: 44px; border-radius: 12px; border: none;
            background: linear-gradient(135deg, #6366f1, #7c3aed);
            color: white; cursor: pointer; display: flex;
            align-items: center; justify-content: center;
            transition: transform 0.2s, opacity 0.2s;
        }
        #sara-chat-send:hover { transform: scale(1.05); }
        #sara-chat-send:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        #sara-chat-send svg { width: 20px; height: 20px; fill: white; }

        #sara-chat-footer {
            padding: 8px 16px; text-align: center;
            font-size: 11px; color: #475569;
            border-top: 1px solid #1e293b;
        }
        #sara-chat-footer a { color: #6366f1; text-decoration: none; }
        #sara-chat-footer a:hover { text-decoration: underline; }

        @media (max-width: 480px) {
            #sara-chat-window { width: calc(100vw - 16px); right: 8px; bottom: 80px; height: calc(100vh - 100px); border-radius: 16px; }
            #sara-chat-bubble { bottom: 16px; right: 16px; width: 56px; height: 56px; }
        }
    `;
    document.head.appendChild(style);

    // ─── HTML ───
    const widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.innerHTML = `
        <div id="sara-chat-bubble" title="Chatta con S.A.R.A.">
            <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
        </div>
        <div id="sara-chat-window">
            <div id="sara-chat-header">
                <div class="sara-avatar">🤖</div>
                <div class="sara-info">
                    <div class="sara-name">S.A.R.A.</div>
                    <div class="sara-status"><span class="sara-dot"></span> Online — AI Assistant</div>
                </div>
                <button class="sara-close" id="sara-close-btn">✕</button>
            </div>
            <div id="sara-chat-messages"></div>
            <div id="sara-chat-input-area">
                <input type="text" id="sara-chat-input" placeholder="Scrivi un messaggio..." autocomplete="off" />
                <button id="sara-chat-send" title="Invia">
                    <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                </button>
            </div>
            <div id="sara-chat-footer">
                Powered by <a href="https://scalaai.it" target="_blank" rel="noopener">SCALA AI OS</a>
            </div>
        </div>
    `;
    document.body.appendChild(widget);

    // ─── State ───
    const sessionId = 'web_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
    let isOpen = false;
    let isSending = false;

    const bubble = document.getElementById('sara-chat-bubble');
    const chatWindow = document.getElementById('sara-chat-window');
    const closeBtn = document.getElementById('sara-close-btn');
    const messagesEl = document.getElementById('sara-chat-messages');
    const inputEl = document.getElementById('sara-chat-input');
    const sendBtn = document.getElementById('sara-chat-send');

    // ─── Toggle ───
    function toggle() {
        isOpen = !isOpen;
        chatWindow.classList.toggle('sara-open', isOpen);
        bubble.style.display = isOpen ? 'none' : 'flex';
        if (isOpen) {
            inputEl.focus();
            if (messagesEl.children.length === 0) {
                addMessage('bot', 'Ciao! 👋 Sono S.A.R.A., l\'assistente AI di SCALA. Come posso aiutarti oggi?');
            }
        }
    }

    bubble.addEventListener('click', toggle);
    closeBtn.addEventListener('click', toggle);

    // ─── Add Message ───
    function addMessage(type, text) {
        const msg = document.createElement('div');
        msg.className = `sara-msg sara-${type}`;
        msg.textContent = text;
        messagesEl.appendChild(msg);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return msg;
    }

    function showTyping() {
        const el = document.createElement('div');
        el.className = 'sara-typing';
        el.id = 'sara-typing-indicator';
        el.innerHTML = '<span></span><span></span><span></span>';
        messagesEl.appendChild(el);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return el;
    }

    function hideTyping() {
        const el = document.getElementById('sara-typing-indicator');
        if (el) el.remove();
    }

    // ─── Send Message ───
    async function sendMessage() {
        const text = inputEl.value.trim();
        if (!text || isSending) return;

        isSending = true;
        sendBtn.disabled = true;
        inputEl.value = '';

        addMessage('user', text);
        const typing = showTyping();

        try {
            const res = await fetch(SARA_API, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, sessionId }),
            });

            hideTyping();

            if (!res.ok) {
                addMessage('bot', 'Mi scuso, c\'è stato un errore. Riprova tra un momento. 🙏');
                console.error('[SARA Widget] API error:', res.status);
                return;
            }

            const data = await res.json();
            const reply = data.reply || data.message || data.response || 'Ricevuto!';

            // Simulate typing delay for natural feel
            await new Promise(r => setTimeout(r, 300 + Math.random() * 500));
            addMessage('bot', reply);

        } catch (err) {
            hideTyping();
            addMessage('bot', 'Non riesco a connettermi. Verifica la connessione e riprova. 🔄');
            console.error('[SARA Widget] Network error:', err);
        } finally {
            isSending = false;
            sendBtn.disabled = false;
            inputEl.focus();
        }
    }

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    console.log('[SARA Widget] v1.0 initialized — session:', sessionId);
})();
