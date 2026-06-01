/**
 * nav.js — Party Biz Hub shared sidebar navigation
 * Include on every inner page. Call setNavUser(name) after auth.
 */
(function () {
  const PAGES = [
    { id: 'dashboard', href: 'dashboard.html', icon: '🏠', label: 'Home' },
    { id: 'app',       href: 'app.html',       icon: '📄', label: 'Quote Builder' },
    { id: 'contract',  href: 'contract.html',  icon: '📝', label: 'Contract' },
    { id: 'profit',    href: 'profit.html',    icon: '💰', label: 'Profit Calc' },
    { id: 'prep',      href: 'prep.html',      icon: '📋', label: 'Event Checklist' },
    { id: 'vendors',   href: 'vendors.html',   icon: '🤝', label: 'Vendors' },
    { id: 'mywebsite', href: 'mywebsite.html', icon: '🌐', label: 'My Website', gated: true },
    { id: 'store',     href: 'store.html',     icon: '🛍️', label: 'Digital Store', gated: true },
    { id: 'assistant', href: 'assistant.html', icon: '🤖', label: 'PartyGenius AI' },
    { id: 'content',   href: 'content.html',   icon: '📱', label: 'Content Studio' },
    { id: 'guide',     href: 'guide.html',     icon: '🚀', label: 'Quick Start Guide' },
  ];

  const filename = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

  function build() {
    const items = PAGES.map(p => {
      const active = filename === p.id ? ' active' : '';
      const lock = (p.gated && !window.pbhProAccess) ? '<span class="snav-lock" title="KPPS feature">🔒</span>' : '';
      return `<a href="${p.href}" class="snav-item${active}">
        <span class="snav-icon">${p.icon}</span>
        <span class="snav-label">${p.label}</span>
        ${lock}
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

  window.setNavPlan = function (plan) {
    window.pbhProAccess = (plan === 'pro' || plan === 'kpps');
    const lockEl = document.querySelector('.snav-lock');
    if (lockEl) lockEl.style.display = window.pbhProAccess ? 'none' : '';
  };

  window.initNavSignout = function (handler) {
    // Mark session active so next page skips the spinner
    sessionStorage.setItem('pbh_auth', '1');
    const btn = document.getElementById('sidebarSignout');
    if (btn) btn.addEventListener('click', () => {
      sessionStorage.removeItem('pbh_auth');
      handler();
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
