/**
 * nav.js — Party Biz Hub shared sidebar navigation
 * Include on every inner page. Call setNavUser(name) after auth.
 */
(function () {
  // PPP-only users see these items locked. KPPS users see everything.
  const PAGES = [
    { id: 'dashboard',  href: 'dashboard.html',  icon: '🏠', label: 'Home' },
    { id: 'store',      href: 'store.html',       icon: '🛍️', label: 'Party Profit Printables' },
    { id: 'mywebsite',  href: 'mywebsite.html',   icon: '🌐', label: 'My Website',       kppsOnly: true },
    { id: 'app',        href: 'app.html',          icon: '📄', label: 'Quote Builder',    kppsOnly: true },
    { id: 'contract',   href: 'contract.html',     icon: '📝', label: 'Contract',         kppsOnly: true },
    { id: 'profit',     href: 'profit.html',       icon: '💰', label: 'Profit Calc',      kppsOnly: true },
    { id: 'prep',       href: 'prep.html',         icon: '📋', label: 'Event Checklist',  kppsOnly: true },
    { id: 'vendors',    href: 'vendors.html',      icon: '🤝', label: 'Vendors',          kppsOnly: true },
    { id: 'assistant',  href: 'assistant.html',    icon: '🤖', label: 'PartyGenius AI',   kppsOnly: true },
    { id: 'content',    href: 'content.html',      icon: '📱', label: 'Content Studio',   kppsOnly: true },
  ];
  // Quick Start Guide and Marketing Guide live inside the Party Profit Printables tabs — not in the sidebar

  const filename = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

  function isPPPOnly() {
    // Set by each page after auth — 'printables' = PPP only, anything else = full KPPS access
    return window.pbhPlan === 'printables';
  }

  function build() {
    const locked = isPPPOnly();
    const items = PAGES.map(p => {
      const active = filename === p.id ? ' active' : '';
      const isLocked = p.kppsOnly && locked;
      if (isLocked) {
        return `<span class="snav-item snav-locked" title="Upgrade to Kids Party Profit System™" onclick="showUpgradePrompt()">
          <span class="snav-icon" style="opacity:.4">${p.icon}</span>
          <span class="snav-label" style="opacity:.4">${p.label}</span>
          <span class="snav-lock">🔒</span>
        </span>`;
      }
      return `<a href="${p.href}" class="snav-item${active}">
        <span class="snav-icon">${p.icon}</span>
        <span class="snav-label">${p.label}</span>
      </a>`;
    }).join('');

    return `<div class="sidebar-inner">
      <div class="sidebar-brand">
        <a href="dashboard.html"><img src="partybizhub-logo.svg" alt="Party Biz Hub"/></a>
        <button class="sidebar-close" id="sidebarClose" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-footer">
        <a href="profile.html" class="snav-item snav-settings">
          <span class="snav-icon">⚙</span>
          <span class="snav-label">Business Profile</span>
        </a>
        <div class="sidebar-user">
          <div class="sidebar-avatar" id="sidebarAvatar">?</div>
          <div class="sidebar-user-info">
            <div class="sidebar-user-name" id="sidebarName">Loading…</div>
            <button class="sidebar-signout" id="sidebarSignout">Sign out</button>
          </div>
        </div>
      </div>
    </div>`;
  }

  function init() {
    const mount = document.getElementById('pbhSidebar');
    if (!mount) return;
    mount.innerHTML = build();

    const hamburger = document.getElementById('pbhHamburger');
    const overlay   = document.getElementById('pbhOverlay');
    const closeBtn  = document.getElementById('sidebarClose');

    const open  = () => { mount.classList.add('open');  overlay && overlay.classList.add('show'); };
    const close = () => { mount.classList.remove('open'); overlay && overlay.classList.remove('show'); };

    if (hamburger) hamburger.addEventListener('click', open);
    if (overlay)   overlay.addEventListener('click', close);
    if (closeBtn)  closeBtn.addEventListener('click', close);
  }

  /* Public API */
  window.setNavUser = function (name, initial) {
    const n = document.getElementById('sidebarName');
    const a = document.getElementById('sidebarAvatar');
    if (n) n.textContent = name || '—';
    if (a) a.textContent = (initial || (name && name.charAt(0)) || '?').toUpperCase();
  };

  // Call this after auth to set the plan — re-renders the nav with correct lock state
  window.setNavPlan = function (plan) {
    window.pbhPlan = plan;
    const mount = document.getElementById('pbhSidebar');
    if (mount) mount.innerHTML = build();
    // Re-attach event listeners after rebuild
    const hamburger = document.getElementById('pbhHamburger');
    const overlay   = document.getElementById('pbhOverlay');
    const closeBtn  = document.getElementById('sidebarClose');
    const open  = () => { mount.classList.add('open');  overlay && overlay.classList.add('show'); };
    const close = () => { mount.classList.remove('open'); overlay && overlay.classList.remove('show'); };
    if (hamburger) hamburger.addEventListener('click', open);
    if (overlay)   overlay.addEventListener('click', close);
    if (closeBtn)  closeBtn.addEventListener('click', close);
    autoDetectAdmin();
  };

  // Upgrade prompt for PPP users trying to access KPPS features
  window.showUpgradePrompt = function () {
    if (document.getElementById('upgradeModal')) return;
    const modal = document.createElement('div');
    modal.id = 'upgradeModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(4px)';
    modal.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.3)">
      <div style="font-size:2.2rem;margin-bottom:10px">🔒</div>
      <h3 style="font-family:'Playfair Display',serif;font-size:1.25rem;font-weight:800;color:#1F1A24;margin-bottom:8px">Kids Party Profit System™ Feature</h3>
      <p style="font-size:.88rem;color:#6C6473;line-height:1.75;margin-bottom:6px">This tool is part of the full <strong style="color:#1F1A24">Kids Party Profit System™</strong> — quote builder, contracts, profit calculator, event checklist, vendor directory, content studio, and AI assistant.</p>
      <p style="font-size:.85rem;color:#7B3F9E;font-weight:700;background:#F5EAFF;border-radius:10px;padding:10px 14px;margin-bottom:20px">👑 Already have Party Profit Printables? Your $97 applies — upgrade for just <strong>$400 more</strong>.</p>
      <a href="https://buy.stripe.com/dRm8wPe8d70XgN0c4X7bW09" target="_blank" style="display:block;background:linear-gradient(135deg,#7B3F9E,#E8178A);color:#fff;font-weight:800;padding:14px;border-radius:12px;text-decoration:none;font-size:.92rem;margin-bottom:10px;box-shadow:0 6px 16px rgba(123,63,158,.35)">Upgrade to Full System — $400 →</a>
      <button onclick="document.getElementById('upgradeModal').remove()" style="background:none;border:none;color:#9990aa;font-size:.82rem;cursor:pointer;font-family:inherit">Not right now</button>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  };

  window.setNavAdmin = function () {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || nav.querySelector('.snav-admin')) return;
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
    const link = document.createElement('a');
    link.href = 'warehouse.html';
    link.className = 'snav-item snav-admin' + (currentPage === 'warehouse' ? ' active' : '');
    link.innerHTML = '<span class="snav-icon">📦</span><span class="snav-label">Template Warehouse</span>';
    nav.appendChild(link);
  };

  window.initNavSignout = function (handler) {
    sessionStorage.setItem('pbh_auth', '1');
    const btn = document.getElementById('sidebarSignout');
    if (btn) btn.addEventListener('click', () => {
      sessionStorage.removeItem('pbh_auth');
      localStorage.removeItem('pbh_plan');
      handler();
    });
  };

  function autoDetectAdmin() {
    try {
      const raw = localStorage.getItem('sb-dmqwoddwzpfnmpjtwiee-auth-token');
      if (!raw) return;
      const token = JSON.parse(raw);
      if ((token?.user?.email || '') === 'ggkidsspa@gmail.com') window.setNavAdmin && window.setNavAdmin();
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); autoDetectAdmin(); });
  } else {
    init();
    autoDetectAdmin();
  }
})();
