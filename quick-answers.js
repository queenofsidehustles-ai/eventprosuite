/**
 * quick-answers.js — a free, rule-based "Quick answers" helper for the public
 * websites Party Biz Hub students publish (site.html templates + Classic).
 *
 * No AI, no network calls: every answer comes straight from the owner's own
 * saved data. A question only appears when she has filled in the matching
 * data, and nothing is ever invented (no hours, availability, policies or
 * prices she did not enter).
 *
 * API: window.PBHQuickAnswers.init({businessName, ownerName, brand, phone,
 *   email, city, area, packages:[{name, price, includes:[...]}],
 *   addons:[{name, price}], faqs:[{q,a}], bookUrl, bookAnchor})
 */
(function (root) {
  'use strict';
  if (!root || !root.document) return;

  const text = v => String(v == null ? '' : v).trim();
  const list = v => (Array.isArray(v) ? v : []);
  const esc = s => text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  // "350" -> "$350"; "$350+" stays as typed; 0 / empty -> '' (no price shown).
  function money(v) {
    const t = text(v);
    if (!t) return '';
    if (/^[0-9]+(\.[0-9]+)?$/.test(t)) return Number(t) > 0 ? '$' + t.replace(/\.0+$/, '') : '';
    return t;
  }
  function includesOf(p) {
    const src = p.includes != null ? p.includes : p.included;
    if (Array.isArray(src)) return src.map(text).filter(Boolean);
    return text(src).split('\n').map(l => l.trim()).filter(Boolean);
  }
  // Only links we expect: relative paths, #anchors or http(s).
  function safeUrl(u) {
    const t = text(u);
    if (!t) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return /^https?:/i.test(t) ? t : '';
    return t;
  }
  function hexRgb(hex) {
    let h = text(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lum(rgb) {
    const c = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mix(rgb, to, t) { return rgb.map((v, i) => Math.round(v + (to[i] - v) * t)); }
  const css = rgb => 'rgb(' + rgb.join(',') + ')';

  // Brand colour, its readable text colour, and a deeper shade for text on white.
  function palette(brand) {
    const rgb = hexRgb(brand);
    if (!rgb) {
      const b = text(brand) || '#6D28D9';
      return { bg: b, fg: '#fff', ink: b, soft: 'rgba(0,0,0,.05)' };
    }
    const light = lum(rgb) > 0.45;
    // Darken until it reads on white (≥ 4.5:1) for links and question bubbles.
    let ink = rgb, k = 0;
    while ((1.05 / (lum(ink) + 0.05)) < 4.5 && k < 12) { ink = mix(rgb, [0, 0, 0], (++k) * 0.07); }
    return { bg: css(rgb), fg: light ? '#1f1a24' : '#fff', ink: css(ink), soft: 'rgba(' + rgb.join(',') + ',.10)' };
  }

  const STYLE = `
.pbhqa,.pbhqa *{box-sizing:border-box}
.pbhqa{position:fixed;right:16px;bottom:16px;right:max(16px,env(safe-area-inset-right));bottom:max(16px,env(safe-area-inset-bottom));z-index:950;font-family:inherit;font-size:15px;line-height:1.45;color:#1f1a24;text-align:left;letter-spacing:normal;text-transform:none}
.pbhqa button{font:inherit;letter-spacing:normal;text-transform:none;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.pbhqa-pill{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 16px 10px 14px;border:0;border-radius:999px;background:var(--qa-bg);color:var(--qa-fg);font-weight:700;font-size:14px;box-shadow:0 6px 20px rgba(20,10,30,.22),0 1px 3px rgba(20,10,30,.18)}
.pbhqa-pill:hover{filter:brightness(1.06)}
.pbhqa-pill:focus-visible,.pbhqa-x:focus-visible,.pbhqa-chip:focus-visible,.pbhqa-act:focus-visible{outline:3px solid var(--qa-ink);outline-offset:2px}
.pbhqa-pill[aria-expanded="true"]{display:none}
.pbhqa-panel{position:absolute;right:0;bottom:0;width:360px;max-width:calc(100vw - 32px);max-height:min(560px,calc(100vh - 32px));max-height:min(560px,calc(100dvh - 32px));display:flex;flex-direction:column;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 18px 50px rgba(20,10,30,.28),0 2px 8px rgba(20,10,30,.12);border:1px solid rgba(20,10,30,.08)}
.pbhqa-panel[hidden]{display:none}
.pbhqa-hd{display:flex;align-items:center;gap:10px;padding:14px 12px 14px 16px;background:var(--qa-bg);color:var(--qa-fg)}
.pbhqa-hd-t{flex:1;min-width:0}
.pbhqa-title{margin:0;font-size:16px;font-weight:800;line-height:1.2;color:inherit;font-family:inherit;letter-spacing:normal;text-transform:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pbhqa-sub{margin:2px 0 0;font-size:12.5px;opacity:.88;color:inherit}
.pbhqa-x{flex:none;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.18);background:color-mix(in srgb,currentColor 16%,transparent);color:inherit;font-size:20px;line-height:1;display:flex;align-items:center;justify-content:center;padding:0}
.pbhqa-x:hover{background:color-mix(in srgb,currentColor 26%,transparent)}
.pbhqa-body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:14px 14px 4px;background:#faf8fb}
.pbhqa-log{display:flex;flex-direction:column;gap:8px}
.pbhqa-b{max-width:88%;padding:9px 12px;border-radius:14px;font-size:14px;overflow-wrap:anywhere;margin:0}
.pbhqa-a{align-self:flex-start;background:#fff;border:1px solid rgba(20,10,30,.09);border-bottom-left-radius:4px;color:#1f1a24}
.pbhqa-q{align-self:flex-end;background:var(--qa-ink);color:#fff;border-bottom-right-radius:4px;font-weight:600}
.pbhqa-a p{margin:0}.pbhqa-a p+p,.pbhqa-a p+ul,.pbhqa-a ul+p{margin-top:6px}
.pbhqa-a ul{margin:4px 0 0;padding:0;list-style:none}
.pbhqa-a li{margin:0;padding:3px 0;display:flex;gap:8px;justify-content:space-between;border-bottom:1px dashed rgba(20,10,30,.1)}
.pbhqa-a li:last-child{border-bottom:0}
.pbhqa-a li.pbhqa-li-plain{display:block;padding:1px 0 1px 14px;position:relative;border:0}
.pbhqa-a li.pbhqa-li-plain:before{content:"";position:absolute;left:3px;top:.62em;width:5px;height:5px;border-radius:50%;background:var(--qa-ink)}
.pbhqa-steps li.pbhqa-li-plain{padding-left:0}.pbhqa-steps li.pbhqa-li-plain:before{display:none}
.pbhqa-a strong{font-weight:700;color:#1f1a24}
.pbhqa-price{font-weight:700;color:var(--qa-ink);white-space:nowrap}
.pbhqa-acts{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.pbhqa-act{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:7px 12px;border-radius:999px;text-decoration:none;font-weight:700;font-size:13.5px;background:var(--qa-bg);color:var(--qa-fg);border:0}
.pbhqa-act.alt{background:#fff;color:var(--qa-ink);border:1.5px solid var(--qa-ink)}
.pbhqa-act:hover{filter:brightness(1.06)}
.pbhqa-more{margin:14px 0 6px;font-size:11.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b5f7a}
.pbhqa-chips{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:10px}
.pbhqa-chip{display:inline-block;max-width:100%;padding:8px 12px;border-radius:999px;border:1.5px solid var(--qa-ink);background:#fff;color:var(--qa-ink);font-size:13.5px;font-weight:600;line-height:1.3;text-align:left;overflow-wrap:anywhere}
.pbhqa-chip:hover{background:var(--qa-soft)}
.pbhqa-chip[aria-pressed="true"]{background:var(--qa-soft)}
.pbhqa-ft{padding:8px 14px 10px;font-size:11.5px;color:#6b5f7a;background:#faf8fb;border-top:1px solid rgba(20,10,30,.06)}
@media (max-width:480px){
  .pbhqa{right:12px;bottom:12px;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom))}
  .pbhqa-panel{max-width:calc(100vw - 24px);max-height:calc(100vh - 88px);max-height:calc(100dvh - 88px)}
  .pbhqa-pill{font-size:13.5px;padding:9px 14px 9px 12px}
}
@media (prefers-reduced-motion:no-preference){
  .pbhqa-panel{animation:pbhqa-in .18s ease-out;transform-origin:bottom right}
  @keyframes pbhqa-in{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
}
@media print{.pbhqa{display:none}}`;

  let mounted = null;

  function init(opts) {
    try { return mount(opts || {}); } catch (e) { if (root.console) console.warn('Quick answers unavailable', e); return null; }
  }

  function mount(o) {
    const doc = root.document;
    if (!doc.body) return null;
    if (mounted && mounted.parentNode) mounted.parentNode.removeChild(mounted);

    const biz = text(o.businessName) || 'us';
    const owner = text(o.ownerName);
    const talkName = owner && owner !== biz ? owner : biz;
    const phone = text(o.phone);
    const phoneDigits = phone.replace(/[^0-9+]/g, '');
    const email = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(text(o.email)) ? text(o.email) : '';
    const city = text(o.city);
    let area = text(o.area);
    if (/^your area$/i.test(area) || area.toLowerCase() === city.toLowerCase()) area = '';
    const packages = list(o.packages).filter(p => p && text(p.name)).map(p => ({ name: text(p.name), price: money(p.price), includes: includesOf(p) }));
    const addons = list(o.addons).filter(a => a && text(a.name)).map(a => ({ name: text(a.name), price: money(a.price) }));
    const faqs = list(o.faqs).map(f => ({ q: text(f && (f.q != null ? f.q : f.question)), a: text(f && (f.a != null ? f.a : f.answer)) })).filter(f => f.q && f.a);
    const bookAnchor = text(o.bookAnchor);
    let bookUrl = safeUrl(o.bookUrl);
    if (!bookUrl && /^#[A-Za-z][\w-]*$/.test(bookAnchor)) bookUrl = bookAnchor;
    const pal = palette(o.brand);

    const bookBtn = bookUrl ? `<div class="pbhqa-acts"><a class="pbhqa-act" href="${esc(bookUrl)}" data-qa-book>📅 Book your party</a></div>` : '';
    const contactBtns = () => {
      const b = [];
      if (phoneDigits.replace(/\D/g, '').length >= 7) {
        b.push(`<a class="pbhqa-act" href="sms:${esc(phoneDigits)}">💬 Text ${esc(phone)}</a>`);
        b.push(`<a class="pbhqa-act alt" href="tel:${esc(phoneDigits)}">📞 Call</a>`);
      }
      if (email) b.push(`<a class="pbhqa-act alt" href="mailto:${esc(email)}">✉️ Email</a>`);
      return b.length ? `<div class="pbhqa-acts">${b.join('')}</div>` : '';
    };
    const hasContact = (phoneDigits.replace(/\D/g, '').length >= 7) || !!email;

    // Each entry: [chip label, answer HTML]. Built only from real data.
    const qa = [];
    if (packages.length) {
      qa.push(['How much are your parties?',
        `<p>Here are our packages:</p><ul>${packages.map(p => `<li><span>${esc(p.name)}</span><span class="pbhqa-price">${p.price ? esc(p.price) : 'Ask for a quote'}</span></li>`).join('')}</ul>${bookBtn}`]);
    } else {
      qa.push(['How much are your parties?',
        `<p>Every party is a little different, so ${esc(biz)} sends a personalized quote. Ask for a quote with your date and details.</p>${bookBtn || contactBtns()}`]);
    }
    const withIncl = packages.filter(p => p.includes.length);
    if (withIncl.length) {
      qa.push(["What's included?", withIncl.map(p =>
        `<p><strong>${esc(p.name)}</strong>${p.price ? ` · <span class="pbhqa-price">${esc(p.price)}</span>` : ''}</p><ul>${p.includes.slice(0, 6).map(l => `<li class="pbhqa-li-plain">${esc(l)}</li>`).join('')}${p.includes.length > 6 ? `<li class="pbhqa-li-plain">+ ${p.includes.length - 6} more</li>` : ''}</ul>`).join('')]);
    }
    if (city || area) {
      const lines = [];
      if (city) lines.push(`<p>${esc(biz)} is based in <strong>${esc(city)}</strong>.</p>`);
      if (area) lines.push(`<p>Service area: <strong>${esc(area)}</strong></p>`);
      if (hasContact) lines.push(`<p>Not sure if you're in range? Just ask ${esc(talkName)}.</p>`);
      qa.push(['Where do you serve?', lines.join('')]);
    }
    if (bookUrl) {
      qa.push(['How do I book?',
        `<p>It's simple:</p><ul class="pbhqa-steps"><li class="pbhqa-li-plain"><strong>1.</strong> Send a booking request with your date and party details.</li><li class="pbhqa-li-plain"><strong>2.</strong> ${esc(talkName)} sends you a quote.</li><li class="pbhqa-li-plain"><strong>3.</strong> Pay the deposit to hold your date.</li></ul>${bookBtn}`]);
    }
    if (addons.length) {
      qa.push(['Do you have add-ons?',
        `<p>Yes! Add any of these to your party:</p><ul>${addons.map(a => `<li><span>${esc(a.name)}</span>${a.price ? `<span class="pbhqa-price">${esc(a.price)}</span>` : ''}</li>`).join('')}</ul>`]);
    }
    faqs.forEach(f => qa.push([f.q, f.a.split(/\n\s*\n|\n/).filter(x => x.trim()).map(x => `<p>${esc(x)}</p>`).join('')]));
    if (hasContact) qa.push([`Talk to ${talkName}`, `<p>Reach ${esc(talkName)} directly:</p>${contactBtns()}`]);

    if (!doc.getElementById('pbhqa-style')) {
      const st = doc.createElement('style'); st.id = 'pbhqa-style'; st.textContent = STYLE;
      (doc.head || doc.body).appendChild(st);
    }

    const wrap = doc.createElement('div');
    wrap.className = 'pbhqa';
    wrap.style.setProperty('--qa-bg', pal.bg);
    wrap.style.setProperty('--qa-fg', pal.fg);
    wrap.style.setProperty('--qa-ink', pal.ink);
    wrap.style.setProperty('--qa-soft', pal.soft);
    wrap.innerHTML =
      `<button type="button" class="pbhqa-pill" aria-expanded="false" aria-controls="pbhqa-panel"><span aria-hidden="true">💬</span> Quick answers</button>` +
      `<div class="pbhqa-panel" id="pbhqa-panel" role="dialog" aria-modal="false" aria-labelledby="pbhqa-title" hidden>` +
        `<div class="pbhqa-hd"><div class="pbhqa-hd-t"><p class="pbhqa-title" id="pbhqa-title">${esc(biz)}</p><p class="pbhqa-sub">Quick answers · tap a question</p></div>` +
        `<button type="button" class="pbhqa-x" aria-label="Close quick answers">×</button></div>` +
        `<div class="pbhqa-body"><div class="pbhqa-log" aria-live="polite"><div class="pbhqa-b pbhqa-a"><p>Hi! 👋 Tap a question below for an instant answer.</p></div></div>` +
        `<p class="pbhqa-more" id="pbhqa-more">Questions</p><div class="pbhqa-chips" role="group" aria-labelledby="pbhqa-more">` +
        qa.map((x, i) => `<button type="button" class="pbhqa-chip" data-qa="${i}" aria-pressed="false">${esc(x[0])}</button>`).join('') +
        `</div></div>` +
        `<div class="pbhqa-ft">Answers use only what ${esc(biz)} has shared.${hasContact ? ` Anything else? Tap “Talk to ${esc(talkName)}”.` : ''}</div>` +
      `</div>`;
    doc.body.appendChild(wrap);
    mounted = wrap;

    const pill = wrap.querySelector('.pbhqa-pill');
    const panel = wrap.querySelector('.pbhqa-panel');
    const body = wrap.querySelector('.pbhqa-body');
    const log = wrap.querySelector('.pbhqa-log');
    const closeBtn = wrap.querySelector('.pbhqa-x');

    function open() {
      panel.hidden = false; pill.setAttribute('aria-expanded', 'true');
      const firstChip = wrap.querySelector('.pbhqa-chip');
      (firstChip || closeBtn).focus({ preventScroll: true });
    }
    function close(returnFocus) {
      panel.hidden = true; pill.setAttribute('aria-expanded', 'false');
      if (returnFocus !== false) pill.focus({ preventScroll: true });
    }
    pill.addEventListener('click', open);
    closeBtn.addEventListener('click', () => close());
    wrap.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !panel.hidden) { e.preventDefault(); close(); }
    });
    doc.addEventListener('click', e => { if (!panel.hidden && !wrap.contains(e.target)) close(false); });

    wrap.querySelector('.pbhqa-chips').addEventListener('click', e => {
      const chip = e.target.closest('.pbhqa-chip');
      if (!chip) return;
      const item = qa[+chip.getAttribute('data-qa')];
      if (!item) return;
      chip.setAttribute('aria-pressed', 'true');
      const q = doc.createElement('p'); q.className = 'pbhqa-b pbhqa-q'; q.textContent = item[0];
      const a = doc.createElement('div'); a.className = 'pbhqa-b pbhqa-a'; a.innerHTML = item[1];
      log.appendChild(q); log.appendChild(a);
      const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      body.scrollTo({ top: q.offsetTop - log.offsetTop, behavior: reduce ? 'auto' : 'smooth' });
    });
    // Classic: "Book" scrolls to its own booking form on the same page.
    wrap.addEventListener('click', e => {
      const link = e.target.closest('[data-qa-book]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (href.charAt(0) === '#') {
        const target = doc.getElementById(href.slice(1));
        if (target) {
          e.preventDefault(); close(false);
          const reduce = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
          target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
        }
      }
    });
    return { open, close, el: wrap };
  }

  root.PBHQuickAnswers = { init: init, _money: money };
})(typeof window !== 'undefined' ? window : null);
