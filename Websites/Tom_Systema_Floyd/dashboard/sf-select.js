/* sf-select.js — custom dropdown panels for every native <select> on the
   Systema Floyd dashboard.

   Approach: keep the real <select> as the source of truth (its value, its
   `change`/`input` events, every existing listener and `.value` read keep
   working) but suppress the operating-system popup and render our own styled,
   keyboard-accessible panel instead. Wired with event delegation on document,
   so it covers EVERY select — including the many that the dashboard builds
   dynamically (filters, modals, table rows) — with zero per-element setup.

   The closed box keeps whatever styling each page already gives its selects
   (rounded + chevron); this only replaces the ugly native open list. */
(function () {
  if (window.__sfSelectReady) return;
  window.__sfSelectReady = true;

  /* ---- inject styles once ---- */
  var css = ''
    + '.sfsel-panel{position:absolute;z-index:100000;background:#fff;border:1px solid var(--sf-border,#e2e6ec);'
    + 'border-radius:12px;box-shadow:0 14px 36px rgba(20,40,80,.18),0 3px 10px rgba(20,40,80,.10);'
    + 'padding:6px;max-height:300px;overflow-y:auto;min-width:150px;'
    + "font-family:'Inter',system-ui,sans-serif;animation:sfsel-in .13s cubic-bezier(.2,.8,.3,1)}"
    + '@keyframes sfsel-in{from{opacity:0;transform:translateY(-5px) scale(.99)}to{opacity:1;transform:none}}'
    + '.sfsel-opt{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:8px;'
    + 'font-size:13.5px;color:var(--sf-ink,#1f2a44);cursor:pointer;white-space:nowrap;line-height:1.25;user-select:none}'
    + '.sfsel-opt .sfsel-check{width:14px;height:14px;flex:0 0 14px;opacity:0;color:var(--sf-blue-700,#2f82c4)}'
    + '.sfsel-opt.sel{font-weight:600;color:var(--sf-blue-700,#2f82c4)}'
    + '.sfsel-opt.sel .sfsel-check{opacity:1}'
    + '.sfsel-opt.active,.sfsel-opt:hover{background:var(--sf-blue-50,#eef6fc)}'
    + '.sfsel-opt.is-disabled{opacity:.42;cursor:default;pointer-events:none}'
    + '.sfsel-open{border-color:var(--sf-blue-700,#2f82c4)!important;'
    + 'box-shadow:0 0 0 3px rgba(47,130,196,.16)!important;outline:none!important}';
  var st = document.createElement('style');
  st.id = 'sfsel-styles';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var CHECK = '<svg class="sfsel-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

  var panel = null, current = null, activeIdx = -1, typeBuf = '', typeTimer = null;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function build(sel) {
    var p = document.createElement('div');
    p.className = 'sfsel-panel';
    p.setAttribute('role', 'listbox');
    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var d = document.createElement('div');
      d.className = 'sfsel-opt' + (i === sel.selectedIndex ? ' sel' : '') + (o.disabled ? ' is-disabled' : '');
      d.setAttribute('role', 'option');
      d.setAttribute('aria-selected', i === sel.selectedIndex ? 'true' : 'false');
      d.dataset.i = i;
      d.innerHTML = CHECK + '<span>' + esc(o.textContent) + '</span>';
      if (!o.disabled) {
        (function (idx) {
          d.addEventListener('click', function () { choose(sel, idx); });
        })(i);
      }
      p.appendChild(d);
    }
    return p;
  }

  function reposition() {
    if (!panel || !current) return;
    var r = current.getBoundingClientRect();
    panel.style.minWidth = r.width + 'px';
    var pw = Math.max(r.width, panel.offsetWidth);
    var ph = panel.offsetHeight;
    var top = r.bottom + window.scrollY + 4;
    var left = r.left + window.scrollX;
    if (r.bottom + ph + 8 > window.innerHeight && r.top - ph - 4 > 0) {
      top = r.top + window.scrollY - ph - 4; // flip above when no room below
    }
    left = Math.min(left, window.scrollX + window.innerWidth - pw - 8);
    panel.style.top = top + 'px';
    panel.style.left = Math.max(8, left) + 'px';
  }

  function setActive(i) {
    if (!panel) return;
    var items = panel.querySelectorAll('.sfsel-opt');
    for (var k = 0; k < items.length; k++) items[k].classList.remove('active');
    if (i >= 0 && items[i]) {
      items[i].classList.add('active');
      items[i].scrollIntoView({ block: 'nearest' });
      activeIdx = i;
    }
  }

  function onScroll() { reposition(); }
  function onDocDown(e) { if (panel && !panel.contains(e.target) && e.target !== current) close(); }

  function open(sel) {
    if (current === sel) { close(); return; }
    close();
    if (sel.disabled || sel.multiple || !sel.options.length) return;
    current = sel;
    sel.classList.add('sfsel-open');
    panel = build(sel);
    document.body.appendChild(panel);
    reposition();
    setActive(sel.selectedIndex);
    setTimeout(function () {
      document.addEventListener('mousedown', onDocDown, true);
      window.addEventListener('resize', close);
      window.addEventListener('scroll', onScroll, true);
    }, 0);
  }

  function close() {
    if (panel) { panel.remove(); panel = null; }
    if (current) { current.classList.remove('sfsel-open'); current = null; }
    activeIdx = -1;
    document.removeEventListener('mousedown', onDocDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('scroll', onScroll, true);
  }

  function choose(sel, i) {
    if (i < 0 || i >= sel.options.length || sel.options[i].disabled) return;
    if (sel.selectedIndex !== i) {
      sel.selectedIndex = i;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    close();
    sel.focus();
  }

  function step(dir) {
    var n = current.options.length, i = activeIdx;
    for (var k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!current.options[i].disabled) { setActive(i); return; }
    }
  }
  function edge(start, dir) {
    var n = current.options.length, i = start;
    for (var k = 0; k < n; k++) {
      if (i >= 0 && i < n && !current.options[i].disabled) { setActive(i); return; }
      i += dir;
    }
  }
  function typeahead(ch) {
    clearTimeout(typeTimer);
    typeBuf += ch.toLowerCase();
    typeTimer = setTimeout(function () { typeBuf = ''; }, 600);
    var opts = current.options;
    for (var i = 0; i < opts.length; i++) {
      if (!opts[i].disabled && opts[i].textContent.toLowerCase().indexOf(typeBuf) === 0) { setActive(i); return; }
    }
  }

  function isSel(t) { return t && t.closest ? t.closest('select') : null; }

  /* open on mousedown — suppress the native popup */
  document.addEventListener('mousedown', function (e) {
    var sel = isSel(e.target);
    if (sel && !sel.disabled && !sel.multiple) {
      e.preventDefault();
      sel.focus();
      open(sel);
    }
  }, true);

  /* keyboard: navigate the panel when open, or open it from the focused select */
  document.addEventListener('keydown', function (e) {
    if (panel && current) {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); step(1); break;
        case 'ArrowUp': e.preventDefault(); step(-1); break;
        case 'Home': e.preventDefault(); edge(0, 1); break;
        case 'End': e.preventDefault(); edge(current.options.length - 1, -1); break;
        case 'Enter':
        case ' ': e.preventDefault(); choose(current, activeIdx); break;
        case 'Escape': e.preventDefault(); var c = current; close(); if (c) c.focus(); break;
        case 'Tab': close(); break;
        default: if (e.key.length === 1) { e.preventDefault(); typeahead(e.key); }
      }
      return;
    }
    var sel = isSel(e.target);
    if (sel && !sel.disabled && !sel.multiple &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      open(sel);
    }
  }, true);
})();
