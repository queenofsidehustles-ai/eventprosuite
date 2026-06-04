/**
 * nav.js — Party Biz Hub shared sidebar navigation
 * Include on every inner page. Call setNavUser(name) after auth.
 */
(function () {
  const PAGES = [
    { id: 'dashboard', href: 'dashboard.html', icon: '🏠', label: 'Home' },
    { id: 'store',     href: 'store.html',     icon: '🛍️', label: 'Digital Store' },
    { id: 'mywebsite', href: 'mywebsite.html', icon: '🌐', label: 'My Website' },
    { id: 'app',       href: 'app.html',       icon: '📄', label: 'Quote Builder',   pbhOnly: true },
    { id: 'contract',  href: 'contract.html',  icon: '📝', label: 'Contract',        pbhOnly: true },
    { id: 'profit',    href: 'profit.html',    icon: '💰', label: 'Profit Calc',     pbhOnly: true },
    { id: 'prep',      href: 'prep.html',      icon: '📋', label: 'Event Checklist', pbhOnly: true },
    { id: 'vendors',   href: 'vendors.html',   icon: '🤝', label: 'Vendors',         pbhOnly: true },
    { id: 'assistant', href: 'assistant.html', icon: '🤖', label: 'PartyGenius AI',  pbhOnly: true },
    { id: 'content',   href: 'content.html',   icon: '📱', label: 'Content Studio',  pbhOnly: true },
    { id: 'guide',     href: 'guide.html',     icon: '🚀', label: 'Quick Start Guide' },
  ];

  const filename = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

  function build() {
    const isPrintablesOnly = (window.pbhPlan === 'printables');
    const items = PAGES.map(p => {
      const active = filename === p.id ? ' active' : '';
      const isLocked = p.pbhOnly && isPrintablesOnly;
      if (isLocked) {
        return `<span class="snav-item snav-locked" title="Upgrade to Party Biz Hub" onclick="showUpgradePrompt()">
          <span class="snav-icon" style="opacity:.45">${p.icon}</span>
          <span class="snav-label" style="opacity:.45">${p.label}</span>
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

  window.setNavPlan = function (plan) {
    window.pbhPlan = plan;
    window.pbhProAccess = (plan === 'pro' || plan === 'kpps');
    const mount = document.getElementById('pbhSidebar');
    if (mount) mount.innerHTML = build();
  };

  window.showUpgradePrompt = function () {
    let modal = document.getElementById('upgradeModal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'upgradeModal';
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
      modal.innerHTML = `<div style="background:#fff;border-radius:20px;padding:32px 28px;max-width:400px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3)">
        <div style="font-size:2.5rem;margin-bottom:12px">🔒</div>
        <h3 style="font-family:'Playfair Display',serif;font-size:1.3rem;font-weight:800;color:#1F1A24;margin-bottom:8px">Party Biz Hub Feature</h3>
        <p style="font-size:.88rem;color:#6C6473;line-height:1.7;margin-bottom:20px">This tool is included with the full <strong>Party Biz Hub</strong> membership — quote builder, contracts, profit calculator, vendor directory, and more.</p>
        <a href="https://buy.stripe.com/3cI28r0hndpl0O2d917bW06" target="_blank" style="display:block;background:linear-gradient(135deg,#7B3F9E,#E8178A);color:#fff;font-weight:800;padding:14px;border-radius:12px;text-decoration:none;font-size:.9rem;margin-bottom:10px">Upgrade to Party Biz Hub →</a>
        <button onclick="document.getElementById('upgradeModal').remove()" style="background:none;border:none;color:#9990aa;font-size:.82rem;cursor:pointer;font-family:inherit">Not right now</button>
      </div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
    }
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
