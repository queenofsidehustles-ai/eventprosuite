/**
 * Party Biz Hub — Help Widget
 * Drop <script src="help-widget.js"></script> on any page.
 * Injects a floating ? bubble + slide-in chat panel.
 */
(function () {
  const ENDPOINT = '/api/help';
  const SUPPORT_EMAIL = 'queenofsidehustles@gmail.com';

  const QUICK_CHIPS = [
    { label: '📄 How do I create a quote?', q: 'How do I create a quote for a client?' },
    { label: '📅 How do I add a booking?', q: 'How do I add a new booking to my dashboard?' },
    { label: '🌐 How do I share my website?', q: 'How do I share my public website with clients?' },
    { label: '💰 How does profit tracking work?', q: 'How does the profit tracker work?' },
    { label: '📤 How do I send a quote to a client?', q: 'How do I email a quote to my client?' },
    { label: '🎨 How do I change my brand color?', q: 'How do I change my brand color or logo?' },
  ];

  const css = `
#pbh-help-btn{position:fixed;bottom:24px;right:24px;z-index:9000;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#5B21B6,#7C3AED);color:#fff;border:none;cursor:pointer;font-size:22px;box-shadow:0 4px 20px rgba(109,40,217,.38);display:flex;align-items:center;justify-content:center;transition:transform .18s,box-shadow .18s;font-family:inherit}
#pbh-help-btn:hover{transform:scale(1.1);box-shadow:0 8px 28px rgba(109,40,217,.45)}
#pbh-help-btn .pbh-btn-label{position:absolute;bottom:calc(100% + 8px);right:0;background:#1F1A24;color:#fff;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .15s}
#pbh-help-btn:hover .pbh-btn-label{opacity:1}
#pbh-help-panel{position:fixed;bottom:88px;right:24px;z-index:9001;width:340px;max-width:calc(100vw - 32px);background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(31,20,50,.22),0 4px 16px rgba(31,20,50,.1);display:none;flex-direction:column;overflow:hidden;border:1px solid #EAE3ED;max-height:520px}
#pbh-help-panel.open{display:flex}
.pbh-help-head{background:linear-gradient(135deg,#5B21B6,#7C3AED);padding:14px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0}
.pbh-help-avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
.pbh-help-title{color:#fff;font-weight:800;font-size:14px;font-family:inherit}
.pbh-help-sub{color:rgba(255,255,255,.75);font-size:11px;font-family:inherit}
.pbh-help-close{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:20px;line-height:1;padding:2px 4px;font-family:inherit}
.pbh-help-close:hover{color:#fff}
.pbh-help-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.pbh-help-msgs::-webkit-scrollbar{width:4px}
.pbh-help-msgs::-webkit-scrollbar-thumb{background:#DDD1E5;border-radius:99px}
.pbh-msg{max-width:88%;padding:8px 11px;border-radius:14px;font-size:13px;line-height:1.55;font-family:inherit}
.pbh-msg.bot{background:#F5F0FB;color:#1F1A24;border-bottom-left-radius:4px;align-self:flex-start}
.pbh-msg.user{background:linear-gradient(135deg,#5B21B6,#7C3AED);color:#fff;border-bottom-right-radius:4px;align-self:flex-end}
.pbh-help-chips{padding:8px 10px;display:flex;flex-wrap:wrap;gap:5px;border-top:1px solid #EAE3ED;flex-shrink:0}
.pbh-chip{background:#fff;border:1.5px solid #DDD1E5;border-radius:999px;padding:4px 9px;font-size:11px;font-weight:600;color:#5B21B6;cursor:pointer;font-family:inherit;transition:all .15s;white-space:nowrap}
.pbh-chip:hover{background:#5B21B6;color:#fff;border-color:#5B21B6}
.pbh-help-input-row{border-top:1px solid #EAE3ED;padding:8px 10px;display:flex;gap:6px;align-items:center;flex-shrink:0}
.pbh-help-input{flex:1;border:1.5px solid #DDD1E5;border-radius:10px;padding:7px 10px;font-size:13px;font-family:inherit;outline:none;transition:border-color .15s}
.pbh-help-input:focus{border-color:#A78BFA}
.pbh-help-send{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#5B21B6,#7C3AED);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;font-family:inherit}
.pbh-help-send:hover{opacity:.88}
.pbh-help-send:disabled{opacity:.4;cursor:not-allowed}
.pbh-typing{display:flex;gap:3px;padding:4px 2px;align-items:center}
.pbh-dot{width:6px;height:6px;border-radius:50%;background:#A78BFA;animation:pbh-bounce .7s infinite}
.pbh-dot:nth-child(2){animation-delay:.12s}
.pbh-dot:nth-child(3){animation-delay:.24s}
@keyframes pbh-bounce{0%,60%,100%{transform:translateY(0)}30%{transform:translateY(-4px)}}
.pbh-support-link{padding:6px 12px 10px;text-align:center;font-size:11px;color:#9B89A8;flex-shrink:0}
.pbh-support-link a{color:#7C3AED;font-weight:700;text-decoration:none}
.pbh-support-link a:hover{text-decoration:underline}
`;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const btn = document.createElement('button');
  btn.id = 'pbh-help-btn';
  btn.setAttribute('aria-label', 'Help');
  btn.innerHTML = '?<span class="pbh-btn-label">Need help?</span>';

  const panel = document.createElement('div');
  panel.id = 'pbh-help-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Help Assistant');
  panel.innerHTML = `
    <div class="pbh-help-head">
      <div class="pbh-help-avatar">🎈</div>
      <div>
        <div class="pbh-help-title">Hub Help Assistant</div>
        <div class="pbh-help-sub">Ask me how to use any feature</div>
      </div>
      <button class="pbh-help-close" id="pbhHelpClose" aria-label="Close">×</button>
    </div>
    <div class="pbh-help-msgs" id="pbhHelpMsgs">
      <div class="pbh-msg bot">Hi! 👋 I can help you navigate Party Biz Hub. Ask me anything — or pick a quick question below.</div>
    </div>
    <div class="pbh-help-chips" id="pbhHelpChips">
      ${QUICK_CHIPS.map(c => `<button class="pbh-chip" data-q="${c.q.replace(/"/g, '&quot;')}">${c.label}</button>`).join('')}
    </div>
    <div class="pbh-help-input-row">
      <input class="pbh-help-input" id="pbhHelpInput" type="text" placeholder="Type your question…" maxlength="300"/>
      <button class="pbh-help-send" id="pbhHelpSend" aria-label="Send">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
    <div class="pbh-support-link">Still stuck? <a href="mailto:${SUPPORT_EMAIL}">Email support →</a></div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(panel);

  let open = false;
  let busy = false;
  let history = [];

  function togglePanel() {
    open = !open;
    panel.classList.toggle('open', open);
    if (open) document.getElementById('pbhHelpInput').focus();
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function formatBot(text) {
    return esc(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n\n/g, '<br><br>')
      .replace(/\n/g, '<br>');
  }

  function addMsg(role, text) {
    const msgs = document.getElementById('pbhHelpMsgs');
    const div = document.createElement('div');
    div.className = 'pbh-msg ' + role;
    div.innerHTML = role === 'bot' ? formatBot(text) : esc(text);
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    const msgs = document.getElementById('pbhHelpMsgs');
    const div = document.createElement('div');
    div.className = 'pbh-msg bot';
    div.id = 'pbhTyping';
    div.innerHTML = '<div class="pbh-typing"><div class="pbh-dot"></div><div class="pbh-dot"></div><div class="pbh-dot"></div></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('pbhTyping');
    if (t) t.remove();
  }

  async function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    document.getElementById('pbhHelpSend').disabled = true;
    document.getElementById('pbhHelpChips').style.display = 'none';

    history.push({ role: 'user', content: text });
    addMsg('user', text);
    showTyping();

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history })
      });
      removeTyping();
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content || 'Sorry, I couldn\'t get an answer. Try emailing support.';
      history.push({ role: 'assistant', content: reply });
      addMsg('bot', reply);
    } catch {
      removeTyping();
      addMsg('bot', 'Connection error. Please try again or email support.');
    }

    busy = false;
    document.getElementById('pbhHelpSend').disabled = false;
    document.getElementById('pbhHelpInput').focus();
  }

  btn.addEventListener('click', togglePanel);
  document.getElementById('pbhHelpClose').addEventListener('click', togglePanel);

  document.getElementById('pbhHelpSend').addEventListener('click', () => {
    const input = document.getElementById('pbhHelpInput');
    const val = input.value.trim();
    if (val) { input.value = ''; ask(val); }
  });

  document.getElementById('pbhHelpInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) { e.target.value = ''; ask(val); }
    }
  });

  document.getElementById('pbhHelpChips').addEventListener('click', (e) => {
    const chip = e.target.closest('.pbh-chip');
    if (chip) ask(chip.dataset.q);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) togglePanel();
  });
})();
