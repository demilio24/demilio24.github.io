/*  Systema Floyd - shared app shell (GoHighLevel-style)
    -----------------------------------------------------
    Renders a fixed left sidebar (brand + gated nav + user area) and a content
    area with a GHL-style top bar (page title left, page filters/search right).

    Reusable across every dashboard page. Framework-free.

    Usage (after SF_AUTH.init has run and the page is authorised):

      const shell = SFShell.mount({ active: 'registrations', title: 'Registrations' });
      // shell.topbar  -> element to drop the page's filters/search into
      // shell.content -> the <main class="dash"> the page fills below the top bar

    Depends on:
      - SF_AUTH (auth.js) for profile / role / permissions + sign-out / change-pw.
        SF_AUTH.init() must have completed before SFShell.mount() is called so the
        profile/permissions are available for nav gating.
      - The page's existing --sf-* CSS tokens + Oswald/Inter fonts (already defined
        on every dashboard page). The shell injects only its own layout CSS.

    Gating:
      - Registrations: real link ONLY if profile.permissions.registrations === true
        (the raw boolean flag on sf_staff.permissions, returned by sf_get_my_profile).
        Everyone else gets a disabled "Coming soon" item (not a link, not clickable).
      - Billing: real link ONLY if profile.permissions.billing === true (a raw boolean
        flag on sf_staff.permissions, like registrations). NOBODY currently has it, so
        Billing shows as a disabled "Coming soon" item for everyone (incl. super-admins)
        until someone is explicitly granted permissions.billing.
      - Staff: super_admin only (role === 'super_admin').
      - Attendance / Lunches / Free Camp: visible to any signed-in active staff
        member (per-page access still enforced server-side + by SF_AUTH on the page).
*/
const SFShell = (() => {

  const LOGO = 'https://assets.cdn.filesafe.space/8IWtNFlmgJ8bif9DivHT/media/5d66f583-c02a-4140-91aa-5f3362ec9b01.png';

  /* ---- icons (inline SVG, currentColor) ---- */
  const ICONS = {
    dashboard:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>',
    registrations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>',
    attendance:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    lunches:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12a10 10 0 0 1 20 0z"/><path d="M2 12h20M7 12V7M12 12V5M17 12V7"/></svg>',
    free_camp:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21 12 3l9 18"/><path d="M12 3v18"/><path d="M7.5 12h9"/></svg>',
    billing:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>',
    staff:         '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  };

  /* ---- nav model ---- */
  // gate: function(profile) -> 'link' | 'disabled' | 'hidden'
  const isSuper = p => !!(p && p.role === 'super_admin');
  const hasRegPerm = p => !!(p && p.permissions && p.permissions.registrations === true);
  const hasBillingPerm = p => !!(p && p.permissions && p.permissions.billing === true);

  // Order matches the team's mental model: the main roster page first (renamed
  // "Dashboard" - it was misleadingly called "Attendance" and collided with the
  // separate Registrations tab), then the rest.
  const NAV = [
    { key:'attendance',    label:'Dashboard',     href:'./index.html',         icon:ICONS.dashboard,
      gate: () => 'link' },
    { key:'attendance_board', label:'Attendance', href:'./attendance.html',     icon:ICONS.attendance,
      gate: () => 'link' },
    { key:'registrations', label:'Registrations', href:'./registrations.html', icon:ICONS.registrations,
      gate: p => hasRegPerm(p) ? 'link' : 'disabled' },
    { key:'lunches',       label:'Lunches',       href:'./lunches.html',       icon:ICONS.lunches,
      gate: () => 'link' },
    { key:'free_camp',     label:'Free Camp',     href:'./free-camp.html',     icon:ICONS.free_camp,
      gate: () => 'link' },
    { key:'billing',       label:'Billing',       href:'./billing.html',       icon:ICONS.billing,
      gate: p => hasBillingPerm(p) ? 'link' : 'disabled' },
    { key:'staff',         label:'Staff',         href:'./staff.html',         icon:ICONS.staff,
      gate: p => isSuper(p) ? 'link' : 'hidden' },
  ];

  /* ---- CSS (injected once) ---- */
  const CSS = `
  :root{ --sfs-w:226px; }
  body.sfs-on{ margin:0; }
  /* Sidebar ----------------------------------------------------------------- */
  .sfs-sidebar{
    position:fixed; top:0; left:0; bottom:0; width:var(--sfs-w); z-index:1200;
    display:flex; flex-direction:column;
    background:var(--grad-blue-deep,linear-gradient(160deg,#1b2f6e,#0a1028));
    border-right:1px solid rgba(255,255,255,.06);
    box-shadow:4px 0 24px -12px rgba(10,16,40,.5);
  }
  .sfs-brand{
    display:flex; align-items:center; justify-content:center; gap:11px; padding:18px 18px 16px;
    border-bottom:1px solid rgba(255,255,255,.08); flex-shrink:0;
  }
  /* Logo is a dark/blue mark; render it WHITE so it reads on the dark sidebar */
  .sfs-brand img{ height:34px; width:auto; display:block; filter:brightness(0) invert(1); }
  .sfs-brand .sfs-brand-txt{
    font-family:'Oswald',sans-serif; font-size:12px; font-weight:600;
    letter-spacing:.22em; text-transform:uppercase; color:rgba(255,255,255,.78);
  }
  .sfs-nav{ flex:1; overflow-y:auto; padding:14px 12px; display:flex; flex-direction:column; gap:3px; }
  .sfs-nav::-webkit-scrollbar{ width:6px; }
  .sfs-nav::-webkit-scrollbar-thumb{ background:rgba(255,255,255,.14); border-radius:3px; }
  .sfs-navlabel{
    font-family:'Oswald',sans-serif; font-size:9.5px; font-weight:700;
    letter-spacing:.22em; text-transform:uppercase; color:rgba(255,255,255,.32);
    padding:6px 12px 4px;
  }
  .sfs-item{
    display:flex; align-items:center; gap:11px; padding:10px 12px; border-radius:9px;
    font-family:'Inter',sans-serif; font-size:13.5px; font-weight:500;
    color:rgba(255,255,255,.74); text-decoration:none; white-space:nowrap;
    border:1px solid transparent; transition:background .18s,color .18s,border-color .18s;
  }
  .sfs-item svg{ width:17px; height:17px; flex-shrink:0; opacity:.88; }
  a.sfs-item:hover{ background:rgba(255,255,255,.08); color:#fff; }
  .sfs-item.active{
    background:linear-gradient(135deg,#2f82c4,#234091); color:#fff; font-weight:600;
    box-shadow:0 6px 16px -8px rgba(47,130,196,.8); border-color:rgba(255,255,255,.12);
  }
  .sfs-item.active svg{ opacity:1; }
  .sfs-item.disabled{
    color:rgba(255,255,255,.34); cursor:default; user-select:none;
  }
  .sfs-item.disabled svg{ opacity:.4; }
  .sfs-soon{
    margin-left:auto; font-family:'Inter',sans-serif; font-size:8.5px; font-weight:700;
    letter-spacing:.07em; text-transform:uppercase; color:rgba(255,255,255,.6);
    background:rgba(255,255,255,.1); border:1px solid rgba(255,255,255,.14);
    border-radius:999px; padding:2px 7px; white-space:nowrap;
  }
  /* User area (bottom of sidebar) ------------------------------------------- */
  .sfs-user{
    flex-shrink:0; border-top:1px solid rgba(255,255,255,.08); padding:14px 14px 16px;
    display:flex; flex-direction:column; gap:9px;
  }
  .sfs-user-row{ display:flex; align-items:center; gap:10px; }
  .sfs-avatar{
    width:34px; height:34px; border-radius:50%; flex-shrink:0;
    background:linear-gradient(135deg,#2f82c4,#1b2f6e); color:#fff;
    display:flex; align-items:center; justify-content:center;
    font-family:'Oswald',sans-serif; font-size:14px; font-weight:700;
  }
  .sfs-user-meta{ min-width:0; line-height:1.25; }
  .sfs-user-name{
    font-family:'Inter',sans-serif; font-size:13px; font-weight:600; color:#fff;
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:120px;
  }
  .sfs-user-role{ font-family:'Inter',sans-serif; font-size:10.5px; font-weight:600; letter-spacing:.04em; }
  .sfs-user-role.admin{ color:#f4b63a; }
  .sfs-user-role.staff{ color:#4aa3e0; }
  .sfs-user-actions{ display:flex; gap:6px; }
  .sfs-ubtn{
    flex:1; font-family:'Inter',sans-serif; font-size:10.5px; font-weight:600;
    letter-spacing:.02em; color:rgba(255,255,255,.74);
    background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.1);
    border-radius:7px; padding:7px 6px; cursor:pointer; transition:background .15s,color .15s;
  }
  .sfs-ubtn:hover{ background:rgba(255,255,255,.14); color:#fff; }
  /* Content side ------------------------------------------------------------ */
  .sfs-shell{ margin-left:var(--sfs-w); min-height:100vh; display:flex; flex-direction:column; }
  .sfs-topbar{
    position:sticky; top:0; z-index:1100;
    display:flex; align-items:center; gap:18px;
    padding:14px 30px; min-height:66px;
    background:rgba(247,249,252,.92); backdrop-filter:blur(8px);
    border-bottom:1px solid var(--sf-border,#e2e8f2); flex-wrap:wrap;
  }
  .sfs-topbar-title{ display:flex; flex-direction:column; gap:2px; flex-shrink:0; }
  .sfs-topbar-title h1{
    font-family:'Oswald',sans-serif; font-size:22px; font-weight:700; letter-spacing:.03em;
    text-transform:uppercase; color:var(--sf-ink,#0d1534); margin:0; line-height:1.1;
  }
  .sfs-topbar-title .sfs-sub{
    font-family:'Space Grotesk','Inter',sans-serif; font-size:11.5px; color:var(--sf-ink-50,#6b7490);
    letter-spacing:.03em; margin:0;
  }
  /* the page drops its filters/search in here, right-aligned in the top bar */
  .sfs-topbar-tools{ display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:flex-end; margin-left:auto; }
  .sfs-content{ flex:1; padding:22px 30px 60px; }
  /* Mobile drawer ----------------------------------------------------------- */
  .sfs-hamburger{
    display:none; align-items:center; justify-content:center; width:44px; height:44px;
    border-radius:10px; background:var(--sf-white,#fff); border:1px solid var(--sf-border,#e2e8f2);
    color:var(--sf-ink,#0d1534); cursor:pointer; flex-shrink:0;
  }
  .sfs-hamburger svg{ width:22px; height:22px; }
  .sfs-hamburger:active{ background:var(--sf-cream,#f7f9fc); }
  /* Small logo chip shown in the mobile top bar so users always see the brand */
  .sfs-mobile-logo{ display:none; height:30px; width:auto; flex-shrink:0; margin-left:2px; }
  .sfs-overlay{
    display:none; position:fixed; inset:0; z-index:1150; background:rgba(10,16,40,.5);
    backdrop-filter:blur(2px);
  }
  @media (max-width:900px){
    /* Drawer: slide the fixed sidebar in/out; full-page can't scroll sideways */
    .sfs-sidebar{ transform:translateX(-100%); transition:transform .26s cubic-bezier(.16,1,.3,1);
      width:min(82vw,300px); }
    body.sfs-drawer-open .sfs-sidebar{ transform:translateX(0); }
    body.sfs-drawer-open .sfs-overlay{ display:block; }
    body.sfs-drawer-open{ overflow:hidden; }   /* lock page scroll while drawer is open */
    .sfs-shell{ margin-left:0; }
    .sfs-hamburger{ display:inline-flex; }
    .sfs-mobile-logo{ display:block; }
    /* Bigger tap targets on nav links + user buttons */
    .sfs-item{ padding:13px 14px; font-size:15px; min-height:48px; }
    .sfs-item svg{ width:19px; height:19px; }
    .sfs-ubtn{ padding:11px 8px; font-size:12px; }
    /* Top bar: hamburger + logo + title on row 1, tools wrap to full-width rows */
    .sfs-topbar{ padding:10px 14px; min-height:58px; gap:10px; }
    .sfs-topbar-title{ margin-right:auto; }
    .sfs-topbar-title h1{ font-size:18px; }
    .sfs-topbar-title .sfs-sub{ display:none; }   /* keep the bar compact on phones */
    .sfs-topbar-tools{ width:100%; justify-content:flex-start; gap:10px; }
    /* nothing in the chrome may push past the viewport */
    .sfs-sidebar, .sfs-overlay, .sfs-shell, .sfs-topbar, .sfs-content{ max-width:100vw; }
    /* search drops to its own full-width row under the title */
    .sfs-search{ flex:1 1 100%; min-width:0; }
    .sfs-search-input{ font-size:16px; }   /* >=16px stops iOS zoom-on-focus */
    .sfs-loader-core{ width:84px; height:84px; }
    .sfs-loader-logo{ width:46px; }
  }
  @media (max-width:480px){
    .sfs-topbar-title h1{ font-size:16px; }
  }

  /* ── Global people search (top-left of the topbar) ───────────────────────── */
  .sfs-search{ position:relative; flex:0 1 340px; min-width:190px; }
  .sfs-search-box{
    display:flex; align-items:center; gap:8px; padding:8px 12px;
    background:var(--sf-white,#fff); border:1px solid var(--sf-border,#e2e8f2);
    border-radius:10px; transition:border-color .18s, box-shadow .18s;
  }
  .sfs-search-box:focus-within{ border-color:var(--sf-blue-700,#2f82c4); box-shadow:0 0 0 3px rgba(47,130,196,.14); }
  .sfs-search-ic{ display:flex; color:var(--sf-ink-40,#9aa3bd); flex-shrink:0; }
  .sfs-search-ic svg{ width:16px; height:16px; }
  .sfs-search-input{
    flex:1; min-width:0; border:none; outline:none; background:transparent;
    font-family:'Inter',sans-serif; font-size:13.5px; color:var(--sf-ink,#0d1534);
  }
  .sfs-search-input::placeholder{ color:var(--sf-ink-40,#9aa3bd); }
  .sfs-search-input::-webkit-search-cancel-button{ -webkit-appearance:none; appearance:none; }
  .sfs-search-kbd{
    flex-shrink:0; font-family:'Inter',sans-serif; font-size:11px; font-weight:600; line-height:1.5;
    color:var(--sf-ink-40,#9aa3bd); background:var(--sf-cream,#f1f4fa);
    border:1px solid var(--sf-border,#e2e8f2); border-radius:5px; padding:1px 6px;
  }
  .sfs-search-box:focus-within .sfs-search-kbd, .sfs-search.has-q .sfs-search-kbd{ display:none; }
  .sfs-search-results{
    position:absolute; top:calc(100% + 8px); left:0; right:0; z-index:1300;
    background:var(--sf-white,#fff); border:1px solid var(--sf-border,#e2e8f2); border-radius:12px;
    box-shadow:0 18px 44px -16px rgba(15,23,42,.34); padding:6px;
    max-height:min(70vh,440px); overflow-y:auto; animation:sfsfade .14s ease;
  }
  .sfs-search-results[hidden]{ display:none; }
  @keyframes sfsfade{ from{ opacity:0; transform:translateY(-4px); } to{ opacity:1; transform:none; } }
  .sfs-sr-empty{ padding:16px 14px; font-family:'Inter',sans-serif; font-size:13px; color:var(--sf-ink-50,#6b7490); text-align:center; }
  .sfs-sr-item{ display:flex; align-items:center; gap:11px; padding:9px 10px; border-radius:9px; cursor:pointer; }
  .sfs-sr-item:hover, .sfs-sr-item.active{ background:var(--sf-blue-50,#eef5fc); }
  .sfs-sr-av{
    width:30px; height:30px; border-radius:50%; flex-shrink:0;
    display:flex; align-items:center; justify-content:center;
    background:linear-gradient(135deg,#2f82c4,#1b2f6e); color:#fff;
    font-family:'Oswald',sans-serif; font-size:12px; font-weight:700;
  }
  .sfs-sr-meta{ min-width:0; display:flex; flex-direction:column; gap:1px; flex:1; }
  .sfs-sr-name{
    font-family:'Inter',sans-serif; font-size:13.5px; font-weight:600; color:var(--sf-ink,#0d1534);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .sfs-sr-name mark{ background:transparent; color:var(--sf-blue-700,#2f82c4); font-weight:800; }
  .sfs-sr-sub{
    font-family:'Inter',sans-serif; font-size:11.5px; color:var(--sf-ink-50,#6b7490);
    white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  }
  .sfs-sr-tag{
    flex-shrink:0; font-family:'Inter',sans-serif; font-size:9.5px; font-weight:700; letter-spacing:.04em;
    text-transform:uppercase; color:#6b7490; background:#f1f4fa; border-radius:999px; padding:2px 8px;
  }
  .sfs-sr-tag.warn{ color:#8a6100; background:#fff3cd; }

  /* ── Page-transition loader (logo pulse + shimmer progress) ──────────────── */
  .sfs-loader{
    position:fixed; inset:0; z-index:3000; display:flex; flex-direction:column;
    align-items:center; justify-content:center; gap:22px;
    background:radial-gradient(130% 130% at 50% 0%, #1b2f6e 0%, #0a1028 72%);
    opacity:1; transition:opacity .42s ease;
  }
  .sfs-loader.is-hiding{ opacity:0; pointer-events:none; }
  .sfs-loader-bar{ position:absolute; top:0; left:0; right:0; height:3px; background:rgba(255,255,255,.08); overflow:hidden; }
  .sfs-loader-bar span{
    position:absolute; top:0; left:0; height:100%; width:38%;
    background:linear-gradient(90deg,transparent,#2f82c4 40%,#7cc0f5,transparent);
    animation:sfsbar 1.05s cubic-bezier(.4,0,.2,1) infinite;
  }
  @keyframes sfsbar{ 0%{ transform:translateX(-100%); } 100%{ transform:translateX(360%); } }
  .sfs-loader-core{ position:relative; width:96px; height:96px; display:flex; align-items:center; justify-content:center; }
  .sfs-loader-core::before{
    content:''; position:absolute; inset:-14px; border-radius:50%; z-index:0;
    background:radial-gradient(circle, rgba(63,143,208,.38), transparent 68%);
    animation:sfsglow 1.5s ease-in-out infinite;
  }
  .sfs-loader-ring{
    position:absolute; inset:0; border-radius:50%; z-index:1;
    border:2px solid rgba(255,255,255,.1); border-top-color:#3f8fd0; border-right-color:#3f8fd0;
    animation:sfsspin 1s linear infinite;
  }
  .sfs-loader-logo{ position:relative; z-index:2; width:52px; height:auto; filter:brightness(0) invert(1); animation:sfspulse 1.5s ease-in-out infinite; }
  .sfs-loader-cap{
    font-family:'Oswald',sans-serif; font-size:11px; font-weight:600; letter-spacing:.34em;
    text-transform:uppercase; color:rgba(255,255,255,.66); animation:sfspulse 1.5s ease-in-out infinite;
  }
  @keyframes sfsspin{ to{ transform:rotate(360deg); } }
  @keyframes sfspulse{ 0%,100%{ transform:scale(1); opacity:.85; } 50%{ transform:scale(1.09); opacity:1; } }
  @keyframes sfsglow{ 0%,100%{ opacity:.4; } 50%{ opacity:.85; } }
  @media (prefers-reduced-motion: reduce){
    .sfs-loader-bar span, .sfs-loader-ring, .sfs-loader-logo, .sfs-loader-core::before, .sfs-loader-cap{ animation:none; }
  }`;

  function injectCSS(){
    if (document.getElementById('sfs-css')) return;
    const s = document.createElement('style');
    s.id = 'sfs-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function initials(name){
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }

  function esc(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
    ));
  }
  // highlight every query token inside a (already-escaped-safe) name
  function highlight(name, q){
    const safe = esc(name);
    const toks = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return safe;
    // build one regex of the tokens, escaped for regex
    const pat = toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    try {
      return safe.replace(new RegExp('(' + pat + ')', 'ig'), '<mark>$1</mark>');
    } catch (e) { return safe; }
  }

  /* =======================================================================
     Page-transition loader  (logo pulse + shimmer progress bar)
     Shown the moment this script runs (covers the white blank while the next
     page authenticates + fetches), and on every internal nav click. Hidden
     once the shell mounts, or if the login card appears, with a safety timeout
     so it can never get stuck over the UI.
     ======================================================================= */
  let _loaderEl = null, _loaderShownAt = 0, _loaderSafety = null;

  function ensureLoader(){
    if (_loaderEl) return _loaderEl;
    injectCSS();
    const el = document.createElement('div');
    el.className = 'sfs-loader';
    el.id = 'sfs-loader';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-label', 'Loading');
    el.innerHTML =
      '<div class="sfs-loader-bar"><span></span></div>' +
      '<div class="sfs-loader-core">' +
        '<div class="sfs-loader-ring"></div>' +
        '<img class="sfs-loader-logo" src="' + LOGO + '" alt="" />' +
      '</div>' +
      '<div class="sfs-loader-cap">Loading</div>';
    (document.body || document.documentElement).appendChild(el);
    _loaderEl = el;
    return el;
  }

  function showLoader(){
    const el = ensureLoader();
    el.classList.remove('is-hiding');
    _loaderShownAt = Date.now();
    clearTimeout(_loaderSafety);
    _loaderSafety = setTimeout(() => hideLoader(true), 9000);   // never stuck
  }

  function hideLoader(force){
    if (!_loaderEl) return;
    clearTimeout(_loaderSafety);
    const el = _loaderEl;
    const min = force ? 0 : 300;                 // brief floor so it can't flicker
    const wait = Math.max(0, min - (Date.now() - _loaderShownAt));
    setTimeout(() => el.classList.add('is-hiding'), wait);
  }

  // Dismiss the loader if the not-signed-in login card shows (mount never runs).
  function watchAuthCard(){
    const root = document.getElementById('auth-card-root');
    if (!root) return;
    if (root.children.length){ hideLoader(); return; }
    try {
      const mo = new MutationObserver(() => {
        if (root.children.length){ hideLoader(); mo.disconnect(); }
      });
      mo.observe(root, { childList: true });
    } catch (e) { /* old browser: safety timeout covers it */ }
  }

  /* =======================================================================
     Global people finder  (top-left of the topbar)
     Searches campers + parents loaded from the public snapshot.json, then jumps
     to the right page for that person (Registrations if the user can see it,
     else Attendance / Free Camp) with the roster filtered + scrolled to them.
     ======================================================================= */
  let _people = null, _peopleLoading = false;

  async function loadPeople(){
    if (_people || _peopleLoading) return;
    _peopleLoading = true;
    try {
      const r = await fetch('./snapshot.json', { cache: 'force-cache' });
      _people = r.ok ? buildPeopleIndex(await r.json()) : [];
    } catch (e) { _people = []; }
    finally { _peopleLoading = false; }
  }

  function buildPeopleIndex(data){
    const map = new Map();
    const add = (name, email, type, week, campus, flags) => {
      name = String(name || '').trim();
      if (!name) return;
      const key = (name + '|' + (email || '')).toLowerCase();
      let p = map.get(key);
      if (!p){
        p = { name, email: email || '', types: new Set(), weeks: new Set(),
              campuses: new Set(), incomplete: false, allergy: false };
        map.set(key, p);
      }
      if (type) p.types.add(type);
      if (week) p.weeks.add(week);
      if (campus) p.campuses.add(campus);
      if (flags){ if (flags.incomplete) p.incomplete = true; if (flags.allergy) p.allergy = true; }
    };
    const roster = (data && data.roster) || {};
    Object.keys(roster).forEach(week => {
      const wk = roster[week] || {};
      ['upper', 'lower', 'free'].forEach(camp => {
        (Array.isArray(wk[camp]) ? wk[camp] : []).forEach(pp => {
          add(pp.name, pp.email, pp.type || (camp === 'free' ? 'free' : 'summer'),
              week, pp.campus, { incomplete: pp.incomplete, allergy: !!pp.allergy });
        });
      });
    });
    const as = (data && data.afterSchool && Array.isArray(data.afterSchool.roster)) ? data.afterSchool.roster : [];
    as.forEach(pp => add(pp.name, pp.email, 'afterschool', null, pp.campus,
                         { incomplete: pp.incomplete, allergy: !!pp.allergy }));
    return Array.from(map.values()).map(p => ({
      name: p.name, email: p.email,
      types: Array.from(p.types), weeks: Array.from(p.weeks), campuses: Array.from(p.campuses),
      incomplete: p.incomplete, allergy: p.allergy,
      hay: (p.name + ' ' + p.email).toLowerCase()
    }));
  }

  function searchPeople(list, q){
    q = q.trim().toLowerCase();
    if (!q) return [];
    const toks = q.split(/\s+/).filter(Boolean);
    const out = [];
    for (const p of list){
      if (!toks.every(t => p.hay.includes(t))) continue;
      const nl = p.name.toLowerCase();
      const score = nl.startsWith(q) ? 3 : nl.includes(q) ? 2 : 1;
      out.push({ p, score });
    }
    out.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name));
    return out.slice(0, 8).map(r => r.p);
  }

  function typeLabel(p){
    if (p.types.includes('summer')) return 'Summer camp';
    if (p.types.includes('free')) return 'Free camp';
    if (p.types.includes('afterschool')) return 'After school';
    return '';
  }
  function primaryType(p){
    if (p.types.includes('summer')) return 'summer';
    if (p.types.includes('free')) return 'free';
    if (p.types.includes('afterschool')) return 'afterschool';
    return 'summer';
  }

  // where a clicked result should take the user, respecting their access
  function targetFor(p, profile){
    const hasReg = !!(profile && profile.permissions && profile.permissions.registrations === true);
    const t = primaryType(p);
    if (hasReg) return { page: 'registrations.html', params: { q: p.name, t } };
    if (t === 'free') return { page: 'free-camp.html', params: { find: p.name } };
    return { page: 'index.html', params: { find: p.name } };   // Attendance (everyone)
  }

  function currentFile(){
    const f = (location.pathname.split('/').pop() || '').toLowerCase();
    return f || 'index.html';
  }

  // set the roster-search box on index.html / free-camp.html and scroll to it
  function setRosterSearchValue(name){
    const inp = document.getElementById('roster-search');
    if (!inp) return false;
    inp.value = name;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    const w = document.getElementById('roster-search-wrap');
    if (w) w.classList.add('has-query');
    try { inp.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {}
    return true;
  }

  // Honor ?find=<name> on this page (index/free-camp). Waits for the roster to
  // render, then filters to that person. Registrations uses its own ?q= path.
  function applyFindParam(){
    let find = null;
    try { find = new URLSearchParams(location.search).get('find'); } catch (e) {}
    if (!find) return;
    let tries = 0;
    const tick = () => {
      const inp  = document.getElementById('roster-search');
      const body = document.getElementById('roster-body');
      if (inp && body && body.children.length){ setRosterSearchValue(find); return; }
      if (tries++ < 40) setTimeout(tick, 150);
    };
    tick();
  }

  function buildSearch(){
    const wrap = document.createElement('div');
    wrap.className = 'sfs-search';
    wrap.innerHTML =
      '<div class="sfs-search-box">' +
        '<span class="sfs-search-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg></span>' +
        '<input type="search" class="sfs-search-input" id="sfs-search-input" autocomplete="off" spellcheck="false" placeholder="Search people…" aria-label="Search people" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="sfs-search-results" />' +
        '<kbd class="sfs-search-kbd">/</kbd>' +
      '</div>' +
      '<div class="sfs-search-results" id="sfs-search-results" role="listbox" hidden></div>';
    return wrap;
  }

  function initSearch(searchWrap, profile){
    const input   = searchWrap.querySelector('#sfs-search-input');
    const results = searchWrap.querySelector('#sfs-search-results');
    let matches = [];
    let active = -1;
    let debounce = null;

    const close = () => {
      results.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      active = -1;
    };

    const setActive = (i) => {
      const items = results.querySelectorAll('.sfs-sr-item');
      if (!items.length) return;
      active = (i + items.length) % items.length;
      items.forEach((el, idx) => el.classList.toggle('active', idx === active));
      items[active].scrollIntoView({ block: 'nearest' });
    };

    const render = (q) => {
      searchWrap.classList.toggle('has-q', q.length > 0);
      if (!q){ close(); return; }
      if (!_people && _peopleLoading){
        results.innerHTML = '<div class="sfs-sr-empty">Loading people…</div>';
        results.hidden = false; return;
      }
      matches = searchPeople(_people || [], q);
      active = -1;
      if (!matches.length){
        results.innerHTML = '<div class="sfs-sr-empty">No matches for “' + esc(q) + '”</div>';
        results.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        return;
      }
      results.innerHTML = matches.map((p, i) => {
        const sub = [typeLabel(p), Array.from(p.campuses)[0] || '',
                     p.weeks.length ? (p.weeks.length + ' wk') : '']
                    .filter(Boolean).join(' · ');
        const tag = p.incomplete ? '<span class="sfs-sr-tag warn">Incomplete</span>'
                  : p.allergy    ? '<span class="sfs-sr-tag">⚠ allergy</span>' : '';
        return '<div class="sfs-sr-item" role="option" data-i="' + i + '">' +
          '<span class="sfs-sr-av">' + esc(initials(p.name)) + '</span>' +
          '<span class="sfs-sr-meta">' +
            '<span class="sfs-sr-name">' + highlight(p.name, q) + '</span>' +
            '<span class="sfs-sr-sub">' + esc(sub) + (p.email ? ' · ' + esc(p.email) : '') + '</span>' +
          '</span>' + tag + '</div>';
      }).join('');
      results.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    };

    const choose = (p) => {
      if (!p) return;
      const tgt = targetFor(p, profile);
      // already on the destination roster page -> filter in place, no reload
      if (tgt.params.find && tgt.page === currentFile() && setRosterSearchValue(p.name)){
        close(); input.blur(); return;
      }
      const qs = Object.keys(tgt.params)
        .map(k => k + '=' + encodeURIComponent(tgt.params[k])).join('&');
      showLoader();
      window.location.href = './' + tgt.page + '?' + qs;
    };

    input.addEventListener('focus', () => { loadPeople().then(() => { if (input.value.trim()) render(input.value); }); });
    input.addEventListener('input', () => {
      const q = input.value;
      clearTimeout(debounce);
      if (!_people && !_peopleLoading) loadPeople().then(() => render(q));
      debounce = setTimeout(() => render(q), 90);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown'){ e.preventDefault(); setActive(active + 1); }
      else if (e.key === 'ArrowUp'){ e.preventDefault(); setActive(active - 1); }
      else if (e.key === 'Enter'){
        if (active >= 0 && matches[active]){ e.preventDefault(); choose(matches[active]); }
        else if (matches.length === 1){ e.preventDefault(); choose(matches[0]); }
      }
      else if (e.key === 'Escape'){ if (!results.hidden){ e.preventDefault(); close(); } else input.blur(); }
    });
    results.addEventListener('mousedown', (e) => {
      const item = e.target.closest('.sfs-sr-item');
      if (!item) return;
      e.preventDefault();   // keep focus, avoid blur-close race
      choose(matches[+item.dataset.i]);
    });
    document.addEventListener('click', (e) => { if (!searchWrap.contains(e.target)) close(); });
    // "/" anywhere (outside a field) focuses the search, GitHub-style
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (typing) return;
      e.preventDefault();
      input.focus();
    });
  }

  function buildNav(active, profile){
    const wrap = document.createElement('nav');
    wrap.className = 'sfs-nav';
    wrap.setAttribute('aria-label', 'Dashboard navigation');
    NAV.forEach(item => {
      const state = item.gate(profile);
      if (state === 'hidden') return;

      if (state === 'disabled'){
        const el = document.createElement('div');
        el.className = 'sfs-item disabled';
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('title', item.label + ' (coming soon)');
        el.innerHTML = item.icon + `<span>${item.label}</span><span class="sfs-soon">Soon</span>`;
        wrap.appendChild(el);
        return;
      }

      const a = document.createElement('a');
      a.className = 'sfs-item' + (item.key === active ? ' active' : '');
      a.href = item.href;
      if (item.key === active) a.setAttribute('aria-current', 'page');
      a.innerHTML = item.icon + `<span>${item.label}</span>`;
      wrap.appendChild(a);
    });

    return wrap;
  }

  function buildUserArea(profile){
    const area = document.createElement('div');
    area.className = 'sfs-user';
    if (!profile){
      area.innerHTML = '<button type="button" class="sfs-ubtn" id="sfs-signin">Sign in</button>';
      return area;
    }
    const isAdmin = profile.role === 'super_admin';
    area.innerHTML = `
      <div class="sfs-user-row">
        <div class="sfs-avatar">${initials(profile.display_name)}</div>
        <div class="sfs-user-meta">
          <div class="sfs-user-name" title="${(profile.display_name||'').replace(/"/g,'&quot;')}">${profile.display_name || 'User'}</div>
          <div class="sfs-user-role ${isAdmin ? 'admin' : 'staff'}">${isAdmin ? 'Admin' : 'Staff'}</div>
        </div>
      </div>
      <div class="sfs-user-actions">
        <button type="button" class="sfs-ubtn" id="sfs-changepw">Change password</button>
        <button type="button" class="sfs-ubtn" id="sfs-signout">Sign out</button>
      </div>`;
    return area;
  }

  /* mount({ active, title, subtitle }) -> { topbar, content, sidebar } */
  function mount(opts){
    opts = opts || {};
    const active = opts.active || '';
    const title  = opts.title  || '';
    const subtitle = opts.subtitle || '';
    const profile = (window.SF_AUTH && SF_AUTH.profile) || null;

    injectCSS();
    document.body.classList.add('sfs-on');

    /* sidebar */
    const sidebar = document.createElement('aside');
    sidebar.className = 'sfs-sidebar';
    const brand = document.createElement('div');
    brand.className = 'sfs-brand';
    brand.innerHTML = `<img src="${LOGO}" alt="Systema Floyd" />`;
    sidebar.appendChild(brand);
    sidebar.appendChild(buildNav(active, profile));
    sidebar.appendChild(buildUserArea(profile));

    /* overlay (mobile) */
    const overlay = document.createElement('div');
    overlay.className = 'sfs-overlay';

    /* content shell: topbar (title + tools) + content (<main class="dash">) */
    const shell = document.createElement('div');
    shell.className = 'sfs-shell';

    const topbar = document.createElement('header');
    topbar.className = 'sfs-topbar';

    const hamburger = document.createElement('button');
    hamburger.type = 'button';
    hamburger.className = 'sfs-hamburger';
    hamburger.setAttribute('aria-label', 'Open navigation');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';

    const mobileLogo = document.createElement('img');
    mobileLogo.className = 'sfs-mobile-logo';
    mobileLogo.src = LOGO;
    mobileLogo.alt = 'Systema Floyd';

    const titleBox = document.createElement('div');
    titleBox.className = 'sfs-topbar-title';
    titleBox.innerHTML = `<h1>${title}</h1>` + (subtitle ? `<p class="sfs-sub">${subtitle}</p>` : '');

    const search = buildSearch();

    const tools = document.createElement('div');
    tools.className = 'sfs-topbar-tools';
    tools.id = 'sfs-topbar-tools';

    topbar.appendChild(hamburger);
    topbar.appendChild(mobileLogo);
    topbar.appendChild(titleBox);
    topbar.appendChild(search);
    topbar.appendChild(tools);

    const content = document.createElement('main');
    content.className = 'dash sfs-content';   // keep `.dash` so SF_AUTH access-denied targeting still works

    shell.appendChild(topbar);
    shell.appendChild(content);

    document.body.appendChild(sidebar);
    document.body.appendChild(overlay);
    document.body.appendChild(shell);

    /* drawer toggle */
    const openDrawer  = () => {
      document.body.classList.add('sfs-drawer-open');
      hamburger.setAttribute('aria-expanded', 'true');
    };
    const closeDrawer = () => {
      document.body.classList.remove('sfs-drawer-open');
      hamburger.setAttribute('aria-expanded', 'false');
    };
    hamburger.addEventListener('click', openDrawer);
    overlay.addEventListener('click', closeDrawer);
    // Nav clicks: close the drawer and raise the transition loader so the next
    // page never flashes white. Skip new-tab / modified clicks.
    sidebar.querySelectorAll('a.sfs-item').forEach(a => a.addEventListener('click', (e) => {
      closeDrawer();
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (a.target === '_blank') return;
      showLoader();
    }));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

    /* global people finder (top-left search) */
    initSearch(search, profile);

    /* user actions -> delegate to SF_AUTH */
    const signoutBtn = sidebar.querySelector('#sfs-signout');
    const changepwBtn = sidebar.querySelector('#sfs-changepw');
    const signinBtn  = sidebar.querySelector('#sfs-signin');
    if (signoutBtn) signoutBtn.addEventListener('click', () => SF_AUTH.signOut());
    if (changepwBtn) changepwBtn.addEventListener('click', () => {
      // openChangePassword is internal to auth.js but exposed via the change-pw button there;
      // re-trigger by dispatching to a fresh modal: call the public path if present.
      if (SF_AUTH.openChangePassword) SF_AUTH.openChangePassword();
    });
    if (signinBtn) signinBtn.addEventListener('click', () => {
      const cardEl = document.getElementById('auth-card-root');
      if (cardEl && SF_AUTH.renderLoginCard && !cardEl.querySelector('.auth-backdrop')) {
        SF_AUTH.renderLoginCard(cardEl);
      }
    });

    /* shell chrome is in the DOM: drop the transition loader once it paints,
       then honor any ?find= deep-link from the people finder. */
    requestAnimationFrame(() => requestAnimationFrame(() => hideLoader()));
    applyFindParam();

    return { topbar, tools, content, sidebar, openDrawer, closeDrawer, showLoader, hideLoader };
  }

  /* Raise the loader the instant this (deferred) script runs, so the blank
     boot window is covered; dismiss it on mount, on the login card, on
     bfcache restore, or via the safety timeout. */
  showLoader();
  watchAuthCard();
  window.addEventListener('pageshow', e => { if (e.persisted) hideLoader(true); });

  return { mount, showLoader, hideLoader };
})();
window.SFShell = SFShell;
