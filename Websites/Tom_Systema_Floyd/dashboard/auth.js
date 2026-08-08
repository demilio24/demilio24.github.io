/*  Systema Floyd - shared auth module
    Loaded by every dashboard page before the page's own <script>. */

const SF_AUTH = (() => {
  const SUPABASE_URL  = 'https://nroeiabeirifurdaybyo.supabase.co';
  const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yb2VpYWJlaXJpZnVyZGF5YnlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTE2MDc2MjgsImV4cCI6MjA2NzE4MzYyOH0.ic9QulLj2JmKepFg3WlA6ux2urUwQFoNDrfK5b5Fh-M';
  const REQUIRE_LOGIN = true;
  // Username + password is the primary (and currently only) login method.
  // Magic-link sign-in is the planned secondary option for once staff have
  // real email addresses on file. Hidden for now - flip to true to bring it
  // back as a second tab beside Password.
  const SHOW_MAGIC_LINK = false;

  // persistSession keeps the user signed in on this device across reloads and
  // browser restarts (token stored in localStorage + auto-refreshed).
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  let _session = null;
  let _profile = null;
  let _perms   = null;   // effective permissions (super_admin expanded to full)

  async function fetchProfile() {
    const { data, error } = await sb.rpc('sf_get_my_profile');
    if (error || !data || data.length === 0) return null;
    return data[0];
  }

  async function fetchPerms() {
    const { data, error } = await sb.rpc('sf_get_my_permissions');
    if (error || !data || typeof data !== 'object') return null;
    return data;
  }

  // page slug ("free-camp") -> surface key ("free_camp")
  function surfaceKey(slug) { return (slug || '').replace(/-/g, '_'); }

  // access level for a surface: 'none' | 'view' | 'edit'
  function can(surface) {
    if (!_perms || !_perms.surfaces) return 'none';
    return _perms.surfaces[surfaceKey(surface)] || 'none';
  }
  function canEdit(surface) { return can(surface) === 'edit'; }
  function canView(surface) { return can(surface) !== 'none'; }
  function manageFlag(name) { return !!(_perms && _perms.manage && _perms.manage[name]); }
  function hasCampus(c) { return !!(_perms && Array.isArray(_perms.campuses) && _perms.campuses.includes(c)); }

  // ── Token freshness ────────────────────────────────────────────────
  // Access tokens are ~1h JWTs. `autoRefreshToken` is on, but iPad/iOS Safari
  // throttles (or suspends) the SDK's background refresh timer whenever the tab
  // is inactive or the device sleeps — so a page left open on a long attendance
  // session hands out a STALE token and every manual `Bearer` fetch 401s with
  // PGRST301 "JWT expired". These helpers refresh on demand at call time so the
  // manual REST calls in the dashboard/attendance engine never send a dead JWT.
  function tokenExpiresSoon() {
    if (!_session) return false;
    const exp = _session.expires_at ? _session.expires_at * 1000 : 0;
    return !exp || Date.now() > exp - 60000;   // expired or within 60s of it
  }
  // Returns a valid (non-expired) access token, refreshing first if needed.
  async function freshToken() {
    try {
      if (!_session) {
        const { data: { session } } = await sb.auth.getSession();
        _session = session;
      }
      if (_session && tokenExpiresSoon()) {
        const { data, error } = await sb.auth.refreshSession();
        if (!error && data && data.session) _session = data.session;
      }
    } catch (e) { /* fall back to whatever token we currently hold */ }
    return (_session && _session.access_token) || SUPABASE_ANON;
  }
  // Force a refresh regardless of expiry — used to recover from a 401 mid-write.
  async function refreshToken() {
    try {
      const { data, error } = await sb.auth.refreshSession();
      if (!error && data && data.session) _session = data.session;
    } catch (e) { /* keep current session on failure */ }
    return (_session && _session.access_token) || SUPABASE_ANON;
  }

  async function signInWithMagicLink(email) {
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    return { error };
  }

  async function signInWithPassword(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    return { data, error };
  }

  async function signOut() {
    await sb.auth.signOut();
    _session = null;
    _profile = null;
    window.location.reload();
  }

  function renderLoginCard(container) {
    container.innerHTML = `
      <div class="auth-backdrop" id="auth-backdrop">
        <div class="auth-card">
          <div class="auth-brand">
            <img src="https://assets.cdn.filesafe.space/8IWtNFlmgJ8bif9DivHT/media/5d66f583-c02a-4140-91aa-5f3362ec9b01.png" alt="Systema Floyd" style="height:48px" />
            <span class="auth-title">Staff Login</span>
          </div>
          ${SHOW_MAGIC_LINK ? `<div class="auth-tabs" role="tablist">
            <button type="button" class="auth-tab active" data-auth-tab="password" role="tab" aria-selected="true">Password</button>
            <button type="button" class="auth-tab" data-auth-tab="magic" role="tab" aria-selected="false">Magic Link</button>
          </div>
          <form class="auth-form" id="auth-form-magic" hidden>
            <label class="auth-label">Email
              <input type="email" class="auth-input" id="auth-email-magic" required autocomplete="email" placeholder="you@example.com" />
            </label>
            <button type="submit" class="auth-submit">Send login link</button>
          </form>` : ''}
          <form class="auth-form" id="auth-form-password">
            <label class="auth-label">Username or email
              <input type="text" class="auth-input" id="auth-email-pw" required autocomplete="username" placeholder="username or email" autocapitalize="none" autocorrect="off" spellcheck="false" />
            </label>
            <label class="auth-label">Password</label>
            <div style="position:relative">
              <input type="password" class="auth-input" id="auth-pw" required autocomplete="current-password" placeholder="Your password" style="padding-right:64px" />
              <button type="button" id="auth-pw-toggle" aria-label="Show password" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#2f82c4;font-size:12px;font-weight:700;cursor:pointer;padding:4px 6px;font-family:inherit">Show</button>
            </div>
            <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:#475067;margin:12px 0 2px;cursor:pointer;user-select:none">
              <input type="checkbox" id="auth-remember" checked style="width:16px;height:16px;cursor:pointer" />
              Keep me signed in on this device
            </label>
            <button type="submit" class="auth-submit">Sign in</button>
          </form>
          <div class="auth-feedback" id="auth-feedback"></div>
          ${REQUIRE_LOGIN ? '' : '<button type="button" class="auth-skip" id="auth-skip">Continue without signing in</button>'}
        </div>
      </div>`;

    container.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.auth-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected','false'); });
        tab.classList.add('active');
        tab.setAttribute('aria-selected','true');
        const mode = tab.dataset.authTab;
        document.getElementById('auth-form-magic').hidden  = mode !== 'magic';
        document.getElementById('auth-form-password').hidden = mode !== 'password';
        document.getElementById('auth-feedback').textContent = '';
      });
    });

    const magicForm = document.getElementById('auth-form-magic');
    if (magicForm) magicForm.addEventListener('submit', async e => {
      e.preventDefault();
      const fb = document.getElementById('auth-feedback');
      const email = document.getElementById('auth-email-magic').value.trim();
      fb.className = 'auth-feedback';
      fb.textContent = 'Sending...';
      const { error } = await signInWithMagicLink(email);
      if (error) { fb.className = 'auth-feedback error'; fb.textContent = error.message; }
      else { fb.className = 'auth-feedback success'; fb.textContent = 'Check your email for the login link.'; }
    });

    // Show/Hide password toggle
    const pwInput  = document.getElementById('auth-pw');
    const pwToggle = document.getElementById('auth-pw-toggle');
    if (pwToggle) pwToggle.addEventListener('click', () => {
      const show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      pwToggle.textContent = show ? 'Hide' : 'Show';
      pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });

    // Prefill the last username saved on this device
    const userInput = document.getElementById('auth-email-pw');
    try {
      const saved = localStorage.getItem('sf-last-user');
      if (saved && userInput) userInput.value = saved;
    } catch (e) { /* ignore */ }

    document.getElementById('auth-form-password').addEventListener('submit', async e => {
      e.preventDefault();
      const fb = document.getElementById('auth-feedback');
      // Case-insensitive: lowercase the whole entry. Works with either a bare
      // username (-> <username>@systemafloyd.com) or a full email (passed through).
      const raw   = document.getElementById('auth-email-pw').value.trim().toLowerCase();
      const email = raw.includes('@') ? raw : raw + '@systemafloyd.com';
      const pw    = document.getElementById('auth-pw').value;
      const remember = document.getElementById('auth-remember');
      fb.className = 'auth-feedback';
      fb.textContent = 'Signing in...';
      const { error } = await signInWithPassword(email, pw);
      if (error) { fb.className = 'auth-feedback error'; fb.textContent = error.message; }
      else {
        try {
          if (!remember || remember.checked) localStorage.setItem('sf-last-user', document.getElementById('auth-email-pw').value.trim());
          else localStorage.removeItem('sf-last-user');
        } catch (e) { /* ignore */ }
        window.location.reload();
      }
    });

    const skipBtn = document.getElementById('auth-skip');
    if (skipBtn) {
      skipBtn.addEventListener('click', () => {
        container.innerHTML = '';
      });
    }
  }

  function renderUserArea(container) {
    if (!_profile) {
      container.innerHTML = '<button type="button" class="auth-signin-btn" id="auth-signin-btn">Sign in</button>';
      document.getElementById('auth-signin-btn').addEventListener('click', () => {
        const cardEl = document.getElementById('auth-card-root');
        if (cardEl && !cardEl.querySelector('.auth-backdrop')) renderLoginCard(cardEl);
      });
      return;
    }
    const badge = _profile.role === 'super_admin'
      ? '<span class="auth-badge admin">Admin</span>'
      : '<span class="auth-badge staff">Staff</span>';
    container.innerHTML = `
      <span class="auth-user-name">${_profile.display_name}</span>
      ${badge}
      <button type="button" class="auth-signout-btn" id="auth-changepw-btn" style="margin-right:4px">Change password</button>
      <button type="button" class="auth-signout-btn" id="auth-signout-btn">Sign out</button>`;
    document.getElementById('auth-signout-btn').addEventListener('click', signOut);
    document.getElementById('auth-changepw-btn').addEventListener('click', openChangePassword);
  }

  /* Self-service password change - uses the caller's own session, no admin rights.
     Self-contained inline-styled modal so it works on every dashboard page
     regardless of that page's CSS. */
  function openChangePassword() {
    if (document.getElementById('cpw-backdrop')) return;
    const wrap = document.createElement('div');
    wrap.id = 'cpw-backdrop';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(10,16,40,.5);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:20px;font-family:Inter,system-ui,sans-serif';
    wrap.innerHTML = `
      <div style="background:#fff;border-radius:16px;box-shadow:0 24px 60px -20px rgba(27,47,110,.4);width:380px;max-width:92vw;padding:24px">
        <h3 style="font-family:Oswald,Inter,sans-serif;font-size:18px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0d1534;margin:0 0 6px">Change Password</h3>
        <p style="font-size:12.5px;color:#6b7490;margin:0 0 16px">Choose a new password (at least 8 characters).</p>
        <input type="password" id="cpw-new" placeholder="New password" autocomplete="new-password" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f2;border-radius:8px;font-size:14px;margin-bottom:10px" />
        <input type="password" id="cpw-confirm" placeholder="Confirm new password" autocomplete="new-password" style="display:block;width:100%;padding:10px 12px;border:1px solid #e2e8f2;border-radius:8px;font-size:14px;margin-bottom:8px" />
        <label style="display:flex;align-items:center;gap:7px;font-size:12.5px;color:#475067;margin:0 0 12px;cursor:pointer;user-select:none">
          <input type="checkbox" id="cpw-show" style="width:15px;height:15px;cursor:pointer" /> Show passwords
        </label>
        <div id="cpw-fb" style="font-size:12px;min-height:16px;margin-bottom:10px;text-align:center"></div>
        <div style="display:flex;gap:8px">
          <button type="button" id="cpw-cancel" style="flex:1;padding:11px;border-radius:8px;border:1px solid #e2e8f2;background:#fff;color:#475067;font-family:Oswald,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Cancel</button>
          <button type="button" id="cpw-save" style="flex:2;padding:11px;border-radius:8px;border:none;background:linear-gradient(135deg,#2f82c4,#1b2f6e);color:#fff;font-family:Oswald,sans-serif;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;cursor:pointer">Update Password</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const close = () => wrap.remove();
    const fb = wrap.querySelector('#cpw-fb');
    const setFb = (msg, ok) => { fb.textContent = msg; fb.style.color = ok ? '#2da375' : '#d8453d'; };
    wrap.querySelector('#cpw-cancel').addEventListener('click', close);
    wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
    wrap.querySelector('#cpw-show').addEventListener('change', function () {
      const t = this.checked ? 'text' : 'password';
      wrap.querySelector('#cpw-new').type = t;
      wrap.querySelector('#cpw-confirm').type = t;
    });
    wrap.querySelector('#cpw-new').focus();

    wrap.querySelector('#cpw-save').addEventListener('click', async () => {
      const pw = wrap.querySelector('#cpw-new').value;
      const confirm = wrap.querySelector('#cpw-confirm').value;
      if (pw.length < 8) { setFb('Password must be at least 8 characters.', false); return; }
      if (pw !== confirm) { setFb('Passwords do not match.', false); return; }
      const btn = wrap.querySelector('#cpw-save');
      btn.disabled = true; setFb('Updating...', true);
      const { error } = await sb.auth.updateUser({ password: pw });
      if (error) { setFb(error.message || 'Update failed.', false); btn.disabled = false; return; }
      setFb('Password updated.', true);
      setTimeout(close, 1100);
    });
  }

  function renderStaffNavLink() {
    if (!_profile || _profile.role !== 'super_admin') return;
    const pagesGroup = document.querySelector('.dash-nav .nav-group');
    if (!pagesGroup) return;
    if (pagesGroup.querySelector('[href="./staff.html"]')) return;
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = './staff.html';
    link.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg> Staff';
    if (window.location.pathname.endsWith('staff.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    pagesGroup.appendChild(link);
  }

  function renderBillingNavLink() {
    if (!_profile || _profile.role !== 'super_admin') return;   // billing is super-admin only
    const pagesGroup = document.querySelector('.dash-nav .nav-group');
    if (!pagesGroup) return;
    if (pagesGroup.querySelector('[href="./billing.html"]')) return;
    const link = document.createElement('a');
    link.className = 'nav-link';
    link.href = './billing.html';
    link.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6"/><path d="M9 17h6"/></svg> Billing';
    if (window.location.pathname.endsWith('billing.html')) {
      link.classList.add('active');
      link.setAttribute('aria-current', 'page');
    }
    pagesGroup.appendChild(link);
  }

  function checkPageAccess(pageSlug) {
    if (!_session) return true;
    if (!_profile) return false;
    if (!_profile.is_active) return false;
    if (_profile.role === 'super_admin') return true;
    return canView(pageSlug);   // surface level != 'none'
  }

  function showAccessDenied() {
    const main = document.querySelector('main.dash');
    if (!main) return;
    main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px"><div><h2 style="font-size:22px;margin-bottom:12px">Access Restricted</h2><p style="color:var(--sf-ink-50);margin-bottom:20px">You don\'t have access to this page. Contact your administrator.</p><a href="./" style="color:var(--sf-blue-700);font-weight:600;text-decoration:underline">Go to Registrations</a></div></div>';
  }

  function showDeactivated() {
    const main = document.querySelector('main.dash');
    if (!main) return;
    main.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;min-height:60vh;text-align:center;padding:40px"><div><h2 style="font-size:22px;margin-bottom:12px">Account Deactivated</h2><p style="color:var(--sf-ink-50);margin-bottom:20px">Your account has been deactivated. Contact your administrator.</p><button type="button" onclick="SF_AUTH.signOut()" style="color:var(--sf-blue-700);font-weight:600;text-decoration:underline;border:none;background:none;cursor:pointer;font-size:15px">Sign out</button></div></div>';
  }

  async function init(pageSlug) {
    const { data: { session } } = await sb.auth.getSession();
    _session = session;

    if (_session) {
      _profile = await fetchProfile();
      _perms   = await fetchPerms();
    }

    const userArea = document.getElementById('user-area');
    if (userArea) renderUserArea(userArea);

    renderStaffNavLink();
    renderBillingNavLink();

    if (!_session) {
      if (REQUIRE_LOGIN) {
        const cardEl = document.getElementById('auth-card-root');
        if (cardEl) renderLoginCard(cardEl);
        const main = document.querySelector('main.dash');
        if (main) main.style.display = 'none';
      }
      return { session: null, profile: null };
    }

    if (_profile && !_profile.is_active) {
      showDeactivated();
      return { session: _session, profile: _profile };
    }

    if (!checkPageAccess(pageSlug)) {
      showAccessDenied();
      return { session: _session, profile: _profile, access: 'none' };
    }

    // View-only: pages can react to this flag/class to hide edit controls.
    const access = (_profile.role === 'super_admin') ? 'edit' : can(pageSlug);
    if (access === 'view') document.body.classList.add('sf-readonly');

    sb.auth.onAuthStateChange((event, session) => {
      _session = session;
      if (event === 'SIGNED_OUT') window.location.reload();
    });

    return { session: _session, profile: _profile, access: access };
  }

  return {
    init,
    get session() { return _session; },
    get profile() { return _profile; },
    get permissions() { return _perms; },
    get campuses() { return (_perms && _perms.campuses) || []; },
    get supabase() { return sb; },
    get markedBy() { return _profile ? _profile.display_name : null; },
    can, canEdit, canView, manageFlag, hasCampus, surfaceKey,
    freshToken, refreshToken,
    signOut,
    renderLoginCard,
    openChangePassword,   // exposed so sf-shell.js's user-area button can trigger the change-pw modal
    REQUIRE_LOGIN,
  };
})();

// Expose on window: SF_AUTH is a top-level `const`, which is NOT a window
// property, so `window.SF_AUTH` would otherwise be undefined. Pages reference
// window.SF_AUTH (token helper, permission gating, marked_by attribution).
window.SF_AUTH = SF_AUTH;

/* ── SF_UPDATE: stale-build self-healing ─────────────────────────────────
   The dashboard is iframed by a GHL funnel (systemafloyd.nilsdigital.com).
   iOS Safari caches the iframed HTML + JS hard, and refreshing the OUTER
   funnel page does not re-fetch the iframe — staff ended up running
   week-old code that still had fixed bugs ("works on your side, not mine").

   Fix: every page re-fetches ITS OWN html with cache:'no-store' and compares
   the `?v=` cache-bust versions of auth.js / sf-attendance.js in the fetched
   HTML against the <script> tags actually in the DOM. A mismatch means the
   DOM is a stale cached copy -> reload once via location.replace with a
   `_fresh` timestamp param (a new URL, so the HTML cache can't serve it).

   Checks: ~2s after load (catches an already-stale boot immediately), every
   5 min, and whenever the tab becomes visible. Reloads are deferred (retried
   every minute) while the user might lose work: unsaved attendance marks, a
   focused field, an open modal/dialog, or any input event in the last 10 min.
   Loop guards: a still-stale page that ALREADY arrived via _fresh never
   re-reloads within 10 min (storage-free, works in Safari cross-site iframes
   where sessionStorage may be blocked) + a per-page sessionStorage budget.
   Only a strictly NEWER fetched version triggers (an old CDN edge serving
   older HTML is a no-op). After a successful heal the plain URL's poisoned
   cache entry is repaired with one fetch({cache:'reload'}), so future
   navigations don't repeat the double-load.
   Convention this relies on: any deploy that should force-propagate bumps a
   `?v=` (already our practice; see the 2026-07-05 cache-bust). */
window.SF_UPDATE = (function () {
  var VERSION_RE = /((?:auth|sf-attendance)\.js)\?v=([0-9]+)/g;
  var CHECK_MS = 5 * 60 * 1000;    // periodic re-check
  var RETRY_MS = 60 * 1000;        // re-try after a deferred reload
  var MAX_RELOADS = 2;             // per WINDOW_MS per page, guards against reload loops
  var WINDOW_MS = 10 * 60 * 1000;
  var EDIT_MS = 10 * 60 * 1000;    // "recently edited something" window: defer reloads
  var LS_KEY = 'sf-fresh-reloads:' + window.location.pathname;  // per page, so one page's heals can't starve another's
  var timer = null, retryTimer = null, lastEditAt = 0;
  // `checking` as a timestamp, not a boolean: iOS BFCache suspends can freeze a
  // fetch promise forever, and a stuck boolean would silently kill the checker
  // on exactly its target platform. A timestamp self-expires after 60s.
  var checkingSince = 0;
  // Storage-free loop guard: if we arrived VIA a _fresh reload and the page is
  // STILL stale (CDN mid-propagation), don't reload again for WINDOW_MS.
  // Safari can block sessionStorage in cross-site iframes (the GHL embed is
  // exactly that), so the budget below can't be the only guard. Time-scoped so
  // a genuinely new deploy later in a long-lived tab can still self-heal.
  var arrivedFreshAt = window.location.search.indexOf('_fresh=') !== -1 ? Date.now() : 0;

  function domVersions() {
    var map = {};
    var scripts = document.querySelectorAll('script[src]');
    for (var i = 0; i < scripts.length; i++) {
      var m = /((?:auth|sf-attendance)\.js)\?v=([0-9]+)/.exec(scripts[i].getAttribute('src') || '');
      if (m) map[m[1]] = m[2];
    }
    return map;
  }
  function htmlVersions(html) {
    var map = {}, m;
    VERSION_RE.lastIndex = 0;
    while ((m = VERSION_RE.exec(html))) map[m[1]] = m[2];
    return map;
  }
  function isStale(dom, fresh) {
    // strictly NEWER only: an old CDN edge serving OLDER html than the DOM
    // must not trigger a spurious reload of an up-to-date page
    for (var f in dom) { if (fresh[f] && +fresh[f] > +dom[f]) return true; }
    return false;
  }
  function typing() {
    var el = document.activeElement;
    return !!(el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  }
  function unsaved() {
    try { return !!(window.SFAtt && window.SFAtt.hasUnsaved && window.SFAtt.hasUnsaved()); }
    catch (e) { return false; }
  }
  function dialogOpen() {
    // any open modal across the dashboard: change-password (#cpw-backdrop only
    // exists while open), staff/billing modals (.open convention), the
    // attendance/day modals (role=dialog, hidden attr removed while open).
    // NOTE: the export/photo backdrops (.exp-backdrop, ids #exp-backdrop /
    // #ph-backdrop) are role=dialog but hide via the .open class with NO hidden
    // attribute, so a bare [role=dialog]:not([hidden]) matched them even while
    // CLOSED — permanently pinning busy() true and killing the self-update on
    // index.html/free-camp.html. Exclude them here; when actually open they are
    // still caught by the [id$="backdrop"].open clause.
    try {
      return !!document.querySelector(
        '#cpw-backdrop, .modal.open, [id$="backdrop"].open, [role="dialog"]:not([hidden]):not(.exp-backdrop)');
    } catch (e) { return false; }
  }
  // Defer while the user might lose work: unsaved marks, focused field, an
  // open dialog, or ANY input typed in the last EDIT_MS (a filled-but-blurred
  // form, e.g. iPad keyboard dismissed by tapping the background).
  function busy() {
    return unsaved() || typing() || dialogOpen() || (lastEditAt && Date.now() - lastEditAt < EDIT_MS);
  }
  function reloadBudgetOk() {
    try {
      var now = Date.now();
      var log = JSON.parse(sessionStorage.getItem(LS_KEY) || '[]').filter(function (t) { return now - t < WINDOW_MS; });
      if (log.length >= MAX_RELOADS) return false;
      log.push(now);
      sessionStorage.setItem(LS_KEY, JSON.stringify(log));
      return true;
    } catch (e) { return true; }
  }
  function freshUrl() {
    var u = new URL(window.location.href);
    u.searchParams.set('_fresh', String(Date.now()));
    return u.pathname + u.search + u.hash;
  }
  function doReload() {
    // already reloaded once and still stale (CDN propagating): wait it out
    if (arrivedFreshAt && Date.now() - arrivedFreshAt < WINDOW_MS) return;
    if (!reloadBudgetOk()) return;         // secondary budget (sessionStorage, may be blocked in iframes)
    window.location.replace(freshUrl());
  }
  // After a successful heal (arrived via _fresh AND no longer stale): refund
  // the budget entry this heal consumed, and repair the PLAIN url's poisoned
  // HTTP cache entry (cache:'reload' forces a network fetch AND stores it), so
  // navigating back to this page later loads fresh directly - no double-load.
  var healedOnce = false;
  function onHealed() {
    if (healedOnce) return;
    healedOnce = true;
    try { sessionStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
    try {
      var u = new URL(window.location.href);
      u.searchParams.delete('_fresh');
      fetch(u.pathname + u.search, { cache: 'reload' }).catch(function () {});
    } catch (e) { /* ignore */ }
  }
  function check(isBoot) {
    if (checkingSince && Date.now() - checkingSince < 60000) return;
    checkingSince = Date.now();
    fetch(window.location.href, { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.text() : null; })
      .then(function (html) {
        checkingSince = 0;
        if (!html) return;
        if (!isStale(domVersions(), htmlVersions(html))) {
          if (arrivedFreshAt) onHealed();
          return;
        }
        // Stale. Never interrupt work in progress - defer and retry instead.
        if (busy()) {
          clearTimeout(retryTimer);
          retryTimer = setTimeout(function () { check(isBoot); }, RETRY_MS);
          return;
        }
        doReload();
      })
      .catch(function () { checkingSince = 0; /* offline etc - silent */ });
  }
  function start() {
    // any input anywhere counts as "user is working" (capture phase sees all)
    document.addEventListener('input', function () { lastEditAt = Date.now(); }, true);
    // strip a leftover _fresh param so bookmarks/links stay clean
    try {
      if (window.location.search.indexOf('_fresh=') !== -1) {
        var u = new URL(window.location.href);
        u.searchParams.delete('_fresh');
        window.history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash);
      }
    } catch (e) { /* ignore */ }
    setTimeout(function () { check(true); }, 2000);
    timer = setInterval(function () { check(false); }, CHECK_MS);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) check(false);
    });
    // BFCache restore (iOS): reset the in-flight guard so a frozen fetch from
    // before the suspend can't block future checks.
    window.addEventListener('pageshow', function (e) { if (e.persisted) checkingSince = 0; });
  }
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);

  return { check: check };   // exposed for tests/manual: SF_UPDATE.check(false)
})();
