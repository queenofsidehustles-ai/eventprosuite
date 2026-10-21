/**
 * nav.js — Party Biz Hub shared sidebar navigation
 * Include on every inner page. Call setNavUser(name) after auth.
 */
(function () {
  // PPP-only users see these items locked. KPPS users see everything.
  // Simplified menu: 6 top-level items. Groups open to show their tools.
  // kppsOnly items are hidden for Printables-only customers.
  const PAGES = [
    { id: 'course',    href: 'course.html',    icon: '🚀', label: '14-Day Launch' },
    { id: 'community', href: 'community.html', icon: '💬', label: 'Community', kppsOnly: true },
    { id: 'dashboard', href: 'dashboard.html', icon: '🏠', label: 'Home' },
    { id: 'profile',   href: 'profile.html',   icon: '💼', label: 'My Business' },
    { id: 'mywebsite', href: 'mywebsite.html', icon: '🌐', label: 'Website & Booking', kppsOnly: true },
    { group: 'clients', icon: '🎉', label: 'Clients & Quotes', kppsOnly: true, children: [
      { id: 'app',      href: 'app.html',          icon: '📄', label: 'New Quote' },
      { id: 'quotes',   href: 'app.html?quotes=1', icon: '📁', label: 'My Quotes' },
      { id: 'contract', href: 'contract.html',     icon: '📝', label: 'Contracts' },
      { id: 'prep',     href: 'prep.html',         icon: '📋', label: 'Event Checklist' },
      { id: 'profit',   href: 'profit.html',       icon: '💰', label: 'Profit Calculator' },
      { id: 'vendors',  href: 'vendors.html',      icon: '🤝', label: 'Vendors' },
    ]},
    { group: 'grow', icon: '📈', label: 'Grow', children: [
      { id: 'store',     href: 'store.html',     icon: '🎨', label: 'Party Printables' },
      { id: 'birthdays', href: 'birthdays.html', icon: '🎂', label: 'Birthday List', kppsOnly: true },
      { id: 'content',  href: 'content.html',   icon: '📱', label: 'Content Studio', kppsOnly: true },
      { id: 'assistant', href: 'assistant.html', icon: '🤖', label: 'PartyGenius AI', kppsOnly: true },
    ]},
  ];
  // Quick Start Guide and Marketing Guide live inside the Party Profit Printables tabs — not in the sidebar

  const filename = window.location.pathname.split('/').pop().replace('.html', '') || 'dashboard';
  // My Quotes shares app.html with the Quote Builder; tell them apart by ?quotes=1
  const currentId = (filename === 'app' && /[?&]quotes=1/.test(window.location.search)) ? 'quotes' : filename;
  const GROUP_KEY = 'pbh_nav_groups';
  function openGroups(){ try { return JSON.parse(localStorage.getItem(GROUP_KEY) || '{}'); } catch (_) { return {}; } }

  function isPPPOnly() {
    // Set by each page after auth — 'printables' = PPP only, anything else = full KPPS access
    return window.pbhPlan === 'printables';
  }

  function build() {
    const locked = isPPPOnly();
    const keep = p => !(locked && p.kppsOnly);
    const link = (p, child) => `<a href="${p.href}" class="snav-item${child ? ' snav-child' : ''}${currentId === p.id ? ' active' : ''}" title="${p.label}">
        <span class="snav-icon">${p.icon}</span>
        <span class="snav-label">${p.label}</span>
      </a>`;
    const groupsOpen = openGroups();
    const items = PAGES.filter(keep).map(p => {
      if (!p.group) return link(p, false);
      const kids = p.children.filter(keep);
      if (!kids.length) return '';
      if (kids.length === 1) return link(kids[0], false);
      const hasActive = kids.some(k => k.id === currentId);
      const open = hasActive || groupsOpen[p.group];
      return `<div class="snav-group${open ? ' open' : ''}${hasActive ? ' has-active' : ''}" data-group="${p.group}">
        <button type="button" class="snav-item snav-group-btn" title="${p.label}" data-first="${kids[0].href}">
          <span class="snav-icon">${p.icon}</span>
          <span class="snav-label">${p.label}</span>
          <span class="snav-caret">▾</span>
        </button>
        <div class="snav-children">${kids.map(k => link(k, true)).join('')}</div>
      </div>`;
    }).join('') + (locked ? `<button class="snav-item snav-upgrade" onclick="showUpgradePrompt()">
      <span class="snav-icon">✨</span><span class="snav-label">Unlock Full System</span>
    </button>` : '');

    return `<div class="sidebar-inner">
      <div class="sidebar-brand">
        <a href="dashboard.html"><img src="partybizhub-logo.svg" alt="Party Biz Hub"/></a>
        <button class="sidebar-collapse" id="sidebarCollapse" type="button" aria-label="Collapse menu" title="Collapse menu">«</button>
        <button class="sidebar-close" id="sidebarClose" aria-label="Close">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-footer">
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

  // Always-visible sign-out pill (top-right) so users don't have to hunt in the menu
  function addFloatingSignout() {
    if (document.getElementById('pbhFloatingSignout')) return;
    const btn = document.createElement('button');
    btn.id = 'pbhFloatingSignout';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Sign out');
    btn.innerHTML = '<span style="font-size:14px;line-height:1">⎋</span> Sign out';
    btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:1200;display:inline-flex;align-items:center;gap:6px;background:#fff;color:#6D28D9;border:1.5px solid #DDD1E5;border-radius:999px;padding:8px 14px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(90,52,118,.18)';
    btn.addEventListener('mouseover', () => { btn.style.background = '#F7F1FB'; });
    btn.addEventListener('mouseout',  () => { btn.style.background = '#fff'; });
    document.body.appendChild(btn);
  }


  // Desktop: collapse the sidebar to icons for more room. Remembered per browser.
  const COLLAPSE_KEY = 'pbh_nav_collapsed';
  function injectCollapseCss() {
    if (document.getElementById('pbhCollapseCss')) return;
    const st = document.createElement('style');
    st.id = 'pbhCollapseCss';
    st.textContent = `
      .sidebar-collapse{display:none;margin-left:auto;border:none;background:transparent;color:inherit;opacity:.65;font-size:18px;font-weight:800;width:30px;height:30px;border-radius:8px;cursor:pointer;line-height:1}
      .sidebar-collapse:hover{opacity:1;background:rgba(124,58,237,.08)}
      .snav-group-btn{width:100%;border:none;background:transparent;font-family:inherit;cursor:pointer;text-align:left}
      .snav-caret{font-size:11px;opacity:.6;transition:transform .15s ease}
      .snav-group.open .snav-caret{transform:rotate(180deg)}
      .snav-children{display:none;flex-direction:column;gap:2px;margin:2px 0 6px}
      .snav-group.open .snav-children{display:flex}
      .snav-child{padding-left:22px!important;font-size:12.5px!important}
      .snav-group.has-active>.snav-group-btn{font-weight:700}
      @media(min-width:901px){
        .sidebar-collapse{display:inline-flex;align-items:center;justify-content:center}
        .pbh-sidebar{transition:width .18s ease}
        .pbh-sidebar.collapsed{width:68px}
        .pbh-sidebar.collapsed .sidebar-brand{justify-content:center;padding-left:6px;padding-right:6px;flex-direction:column;gap:6px}
        .pbh-sidebar.collapsed .sidebar-brand img{height:28px;width:28px;object-fit:cover;object-position:left}
        .pbh-sidebar.collapsed .sidebar-collapse{margin-left:0;transform:rotate(180deg)}
        .pbh-sidebar.collapsed .snav-label,.pbh-sidebar.collapsed .snav-section,.pbh-sidebar.collapsed .sidebar-user-info,.pbh-sidebar.collapsed .snav-caret{display:none}
        .pbh-sidebar.collapsed .snav-children{display:none!important}
        .pbh-sidebar.collapsed .snav-item{justify-content:center;padding-left:0;padding-right:0}
        .pbh-sidebar.collapsed .sidebar-user{justify-content:center}
      }`;
    document.head.appendChild(st);
  }
  function wireCollapse(mount) {
    injectCollapseCss();
    let on = false;
    try { on = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) {}
    mount.classList.toggle('collapsed', on);
    const btn = document.getElementById('sidebarCollapse');
    const label = () => { const c = mount.classList.contains('collapsed'); if (btn) { btn.title = c ? 'Expand menu' : 'Collapse menu'; btn.setAttribute('aria-label', btn.title); } };
    label();
    if (btn) btn.addEventListener('click', () => {
      const c = !mount.classList.contains('collapsed');
      mount.classList.toggle('collapsed', c);
      try { localStorage.setItem(COLLAPSE_KEY, c ? '1' : '0'); } catch (_) {}
      label();
    });
  }


  // Groups open and close; in the icon-only menu a group jumps to its first tool.
  function wireGroups(mount) {
    mount.querySelectorAll('.snav-group-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (mount.classList.contains('collapsed')) { window.location.href = btn.dataset.first; return; }
        const g = btn.parentElement;
        const open = !g.classList.contains('open');
        g.classList.toggle('open', open);
        const st = openGroups(); st[g.dataset.group] = open;
        try { localStorage.setItem(GROUP_KEY, JSON.stringify(st)); } catch (_) {}
      });
    });
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
    wireCollapse(mount);
    wireGroups(mount);

    addFloatingSignout();
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
    wireCollapse(mount);
    wireGroups(mount);
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
      <p style="font-size:.85rem;color:#7B3F9E;font-weight:700;background:#F5EAFF;border-radius:10px;padding:10px 14px;margin-bottom:20px">Build your offer, website, booking process, and back office with the complete business-in-a-box system.</p>
      <a href="https://partybusinesscoach.com" target="_blank" rel="noopener" style="display:block;background:linear-gradient(135deg,#7B3F9E,#E8178A);color:#fff;font-weight:800;padding:14px;border-radius:12px;text-decoration:none;font-size:.92rem;margin-bottom:10px;box-shadow:0 6px 16px rgba(123,63,158,.35)">See the Full System — $197 →</a>
      <button onclick="document.getElementById('upgradeModal').remove()" style="background:none;border:none;color:#9990aa;font-size:.82rem;cursor:pointer;font-family:inherit">Not right now</button>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  };

  window.setNavAdmin = function () {
    const nav = document.querySelector('.sidebar-nav');
    if (!nav || nav.querySelector('.snav-admin')) return;
    const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
    const section = document.createElement('div');
    section.className = 'snav-section snav-admin';
    section.textContent = 'Admin';
    const link = document.createElement('a');
    link.href = 'warehouse.html';
    link.className = 'snav-item snav-admin' + (currentPage === 'warehouse' ? ' active' : '');
    link.innerHTML = '<span class="snav-icon">📦</span><span class="snav-label">Template Warehouse</span>';
    nav.appendChild(section);
    nav.appendChild(link);
  };

  window.initNavSignout = function (handler) {
    sessionStorage.setItem('pbh_auth', '1');
    addFloatingSignout();
    const doSignout = () => {
      sessionStorage.removeItem('pbh_auth');
      localStorage.removeItem('pbh_plan');
      handler();
    };
    const btn = document.getElementById('sidebarSignout');
    if (btn) btn.addEventListener('click', doSignout);
    const floating = document.getElementById('pbhFloatingSignout');
    if (floating) floating.addEventListener('click', doSignout);
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
