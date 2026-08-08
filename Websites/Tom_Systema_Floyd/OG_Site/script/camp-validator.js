<script>
/*
  Summer Camp form validator
  ------------------------------------------------------------------
  PASTE this ENTIRE file (including the <script> tags) into a
  Custom Code element at the bottom of the GHL form.
  ------------------------------------------------------------------
*/
(function () {
  'use strict';

  if (window.__campValidatorLoaded) return;
  window.__campValidatorLoaded = true;

  var DURATION_MAP = [
    { match: /full\s*week/i,       count: 5, label: 'Full Week'  },
    { match: /^\s*four\s*days?/i,  count: 4, label: 'Four days'  },
    { match: /^\s*three\s*days?/i, count: 3, label: 'Three days' },
    { match: /^\s*two\s*days?/i,   count: 2, label: 'Two days'   },
    { match: /^\s*one\s*day/i,     count: 1, label: 'One day'    }
  ];

  var WEEK_LABEL_RE     = /Which day\(s\) will you attend the week of/i;
  var DURATION_LABEL_RE = /^\s*Select Camp Duration/i;
  var DATES_LABEL_RE    = /^\s*Select Camp Dates/i;

  var tickOrder = new Map();
  var enforcing = false;
  var documentGuardAttached = false;

  // ---------- styles ----------
  var css = `
    .camp-week-hint {
      margin: 8px 0 12px;
      padding: 9px 13px;
      border-radius: 8px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .camp-week-hint.hint-warn {
      background: #FFF6E0;
      color: #8a5a00;
      border: 1px solid #F0C26A;
    }
    .camp-week-hint.hint-ok {
      background: #E8F7EE;
      color: #1b6b3a;
      border: 1px solid #7FCB9B;
    }
    .camp-week-hint .hint-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      font-size: 12px;
      font-weight: 700;
      flex-shrink: 0;
    }
    .camp-week-hint.hint-warn .hint-icon {
      background: #F0C26A;
      color: #5a3a00;
    }
    .camp-week-hint.hint-ok .hint-icon {
      background: #7FCB9B;
      color: #0f3a20;
    }

    .camp-select-all-btn {
      display: inline-block;
      margin-left: 10px;
      padding: 8px 14px;
      min-height: 36px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: .01em;
      color: #1e4fd6 !important;
      background: #EAF1FF;
      border: 1px solid #B9CCF7;
      border-radius: 999px;
      cursor: pointer;
      vertical-align: middle;
      transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
    }
    .camp-select-all-btn:hover {
      background: #DCE7FF;
      border-color: #8FAEF0;
      transform: translateY(-1px);
    }
    .camp-select-all-btn:active { transform: translateY(0); }
    .camp-select-all-btn.is-active {
      background: #1e4fd6;
      color: #fff !important;
      border-color: #1e4fd6;
    }

    .camp-copy-btn {
      display: inline-block;
      margin-left: 10px;
      padding: 8px 14px;
      min-height: 36px;
      font-family: 'Inter', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: .01em;
      color: #1e4fd6 !important;
      background: #EAF1FF;
      border: 1px solid #B9CCF7;
      border-radius: 999px;
      cursor: pointer;
      vertical-align: middle;
      transition: background .15s ease, color .15s ease, border-color .15s ease, transform .15s ease;
    }
    .camp-copy-btn:hover {
      background: #DCE7FF;
      border-color: #8FAEF0;
      transform: translateY(-1px);
    }
    .camp-copy-btn:active { transform: translateY(0); }
    .camp-copy-btn[disabled] {
      opacity: .45;
      cursor: not-allowed;
      transform: none;
    }
    .camp-copy-btn[disabled]:hover {
      background: #EAF1FF;
      border-color: #B9CCF7;
      transform: none;
    }
    .camp-copy-btn.is-flash {
      background: #1e4fd6;
      color: #fff;
      border-color: #1e4fd6;
    }

    @media (max-width: 480px) {
      .camp-select-all-btn,
      .camp-copy-btn {
        display: block;
        width: fit-content;
        margin: 8px 0 4px;
        padding: 10px 16px;
        min-height: 40px;
        font-size: 14px;
      }
    }
  `;

  (function injectCss() {
    if (document.getElementById('camp-validator-css')) return;
    var s = document.createElement('style');
    s.id = 'camp-validator-css';
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  })();

  // ---------- helpers ----------
  function findLabelContainer(regex) {
    var labels = document.querySelectorAll('.form-builder--item label.field-label, .form-builder--item label');
    for (var i = 0; i < labels.length; i++) {
      if (regex.test(labels[i].textContent)) {
        return {
          label: labels[i],
          wrapper: labels[i].closest('.form-field-wrapper') || labels[i].closest('.form-builder--item')
        };
      }
    }
    return null;
  }

  function getExpectedCount() {
    var d = findLabelContainer(DURATION_LABEL_RE);
    if (!d || !d.wrapper) return null;
    var txt = '';
    var sel = d.wrapper.querySelector('li.multiselect__element[aria-selected="true"]');
    if (sel) txt = sel.textContent;
    if (!txt) {
      var chip = d.wrapper.querySelector('.multiselect__tag, .multiselect__single');
      if (chip) txt = chip.textContent;
    }
    if (!txt) {
      var wrap = d.wrapper.querySelector('.multiselect__tags-wrap');
      if (wrap && wrap.textContent.trim()) txt = wrap.textContent;
    }
    if (!txt) return null;
    for (var i = 0; i < DURATION_MAP.length; i++) {
      if (DURATION_MAP[i].match.test(txt)) return DURATION_MAP[i];
    }
    if (!window.__campValidatorWarnedDurations) window.__campValidatorWarnedDurations = {};
    var key = txt.trim().toLowerCase();
    if (!window.__campValidatorWarnedDurations[key]) {
      window.__campValidatorWarnedDurations[key] = true;
      console.warn('[camp-validator] unrecognized duration text:', txt);
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
    var s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }

  function getVisibleWeekWrappers() {
    var out = [];
    var labels = document.querySelectorAll('.form-builder--item label.field-label, .form-builder--item label');
    for (var i = 0; i < labels.length; i++) {
      if (!WEEK_LABEL_RE.test(labels[i].textContent)) continue;
      var w = labels[i].closest('.form-field-wrapper') || labels[i].closest('.form-builder--item');
      if (w && isVisible(w)) out.push(w);
    }
    return out;
  }

  function getBoxes(wrapper) {
    return Array.prototype.slice.call(wrapper.querySelectorAll('input[type="checkbox"]'));
  }

  function getChecked(wrapper) {
    return getBoxes(wrapper).filter(function (b) { return b.checked; });
  }

  function uncheckCheckbox(cb) {
    if (!cb.checked) return;
    cb.click();
    if (cb.checked) {
      cb.checked = false;
      cb.dispatchEvent(new Event('input',  { bubbles: true }));
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // ---------- per-week enforcement ----------
  function enforceMaxForWrapper(wrapper, triggerCb) {
    if (enforcing) return;
    var expected = getExpectedCount();
    if (!expected) return;
    var checked = getChecked(wrapper);
    if (checked.length <= expected.count) return;
    checked.sort(function (a, b) {
      return (tickOrder.get(a) || 0) - (tickOrder.get(b) || 0);
    });
    enforcing = true;
    try {
      while (checked.length > expected.count) {
        var victim = checked.shift();
        if (victim === triggerCb && checked.length > 0) {
          var alt = checked.shift();
          if (alt) victim = alt;
        }
        if (!victim) break;
        tickOrder.delete(victim);
        uncheckCheckbox(victim);
      }
    } finally { enforcing = false; }
  }

  function enforceMaxAllWrappers() {
    if (enforcing) return;
    getVisibleWeekWrappers().forEach(function (w) { enforceMaxForWrapper(w); });
  }

  // ---------- Full Week auto-fill ----------
  function autoFillFullWeek() {
    if (enforcing) return;
    var expected = getExpectedCount();
    if (!expected || expected.label !== 'Full Week') return;
    var wrappers = getVisibleWeekWrappers();
    if (wrappers.length === 0) return;
    enforcing = true;
    try {
      wrappers.forEach(function (w) {
        getBoxes(w).forEach(function (b) {
          if (!b.checked) {
            b.click();
            tickOrder.set(b, performance.now());
          }
        });
      });
    } finally { enforcing = false; }
  }

  // ---------- per-week hint UI ----------
  function updateHints() {
    document.querySelectorAll('.camp-week-hint').forEach(function (h) {
      if (h.parentNode) h.parentNode.removeChild(h);
    });

    var expected = getExpectedCount();
    var wrappers = getVisibleWeekWrappers();
    if (!expected || wrappers.length === 0) return;

    wrappers.forEach(function (w) {
      var checked = getChecked(w).length;
      var hint = document.createElement('div');
      hint.className = 'camp-week-hint';

      if (checked < expected.count) {
        var need = expected.count - checked;
        hint.classList.add('hint-warn');
        hint.innerHTML =
          '<span class="hint-icon">!</span>' +
          '<span>Select <b>' + need + ' more day' + (need === 1 ? '' : 's') + '</b> for this week ' +
          '(' + checked + ' of ' + expected.count + ' selected)</span>';
      } else if (checked === expected.count) {
        hint.classList.add('hint-ok');
        hint.innerHTML =
          '<span class="hint-icon">&#10003;</span>' +
          '<span>All ' + expected.count + ' day' + (expected.count === 1 ? '' : 's') +
          ' selected for this week</span>';
      } else {
        hint.classList.add('hint-warn');
        hint.innerHTML = '<span class="hint-icon">!</span><span>Adjusting selections...</span>';
      }

      var label = w.querySelector('label.field-label') || w.querySelector('label');
      if (label && label.parentNode) {
        if (label.nextSibling) label.parentNode.insertBefore(hint, label.nextSibling);
        else label.parentNode.appendChild(hint);
      } else {
        w.insertBefore(hint, w.firstChild);
      }
    });
  }

  // ---------- submit validation ----------
  function validateOnSubmit() {
    var expected = getExpectedCount();
    if (!expected) return true;
    var wrappers = getVisibleWeekWrappers();
    if (wrappers.length === 0) return true;
    var firstBad = null;
    wrappers.forEach(function (w) {
      var checked = getChecked(w).length;
      if (checked !== expected.count && !firstBad) firstBad = w;
    });
    if (firstBad) {
      updateHints();
      if (firstBad.scrollIntoView) firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }
    return true;
  }

  // ---------- Select All button on Select Camp Dates ----------
  function installSelectAllButton() {
    var d = findLabelContainer(DATES_LABEL_RE);
    if (!d || !d.label) return;
    if (d.label.querySelector('.camp-select-all-btn')) return;

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'camp-select-all-btn';
    btn.textContent = 'Select All';

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var container = d.wrapper && d.wrapper.querySelector('[id$="-checkbox-container"]');
      if (!container) return;
      var boxes = container.querySelectorAll('input[type="checkbox"]');
      if (boxes.length === 0) return;
      var allChecked = Array.prototype.every.call(boxes, function (b) { return b.checked; });
      enforcing = true;
      try {
        boxes.forEach(function (b) {
          if (allChecked && b.checked)       b.click();
          else if (!allChecked && !b.checked) b.click();
        });
      } finally { enforcing = false; }
      setTimeout(function () {
        updateHints();
        syncSelectAllBtn();
      }, 30);
    });

    d.label.appendChild(btn);
  }

  function syncSelectAllBtn() {
    var d = findLabelContainer(DATES_LABEL_RE);
    if (!d) return;
    var btn = d.label && d.label.querySelector('.camp-select-all-btn');
    if (!btn) return;
    var container = d.wrapper && d.wrapper.querySelector('[id$="-checkbox-container"]');
    if (!container) return;
    var boxes = container.querySelectorAll('input[type="checkbox"]');
    if (boxes.length === 0) return;
    var allChecked = Array.prototype.every.call(boxes, function (b) { return b.checked; });
    btn.textContent = allChecked ? 'Deselect All' : 'Select All';
    btn.classList.toggle('is-active', allChecked);
  }

  // ---------- Copy to all weeks ----------
  function copyPatternFromWrapper(sourceWrapper) {
    var sourceBoxes = getBoxes(sourceWrapper);
    var pattern = sourceBoxes.map(function (b) { return !!b.checked; });
    var wrappers = getVisibleWeekWrappers();
    enforcing = true;
    try {
      wrappers.forEach(function (w) {
        if (w === sourceWrapper) return;
        var boxes = getBoxes(w);
        var len = Math.min(boxes.length, pattern.length);
        for (var i = 0; i < len; i++) {
          var want = pattern[i];
          var box = boxes[i];
          if (box.checked !== want) {
            box.click();
            if (want) tickOrder.set(box, performance.now() + i * 0.001);
            else tickOrder.delete(box);
          }
        }
      });
    } finally { enforcing = false; }
  }

  function installCopyButtons() {
    var wrappers = getVisibleWeekWrappers();
    wrappers.forEach(function (w) {
      var label = w.querySelector('label.field-label') || w.querySelector('label');
      if (!label) return;
      var existing = label.querySelector('.camp-copy-btn');
      if (wrappers.length < 2) {
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        return;
      }
      if (existing) {
        syncCopyBtnState(w, existing);
        return;
      }
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'camp-copy-btn';
      btn.textContent = 'Copy to all weeks';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled) return;
        copyPatternFromWrapper(w);
        btn.classList.add('is-flash');
        var original = 'Copy to all weeks';
        btn.textContent = 'Copied';
        btn.disabled = true;
        setTimeout(function () {
          btn.classList.remove('is-flash');
          btn.textContent = original;
          btn.disabled = false;
          syncCopyBtnState(w, btn);
          updateHints();
        }, 900);
      });
      label.appendChild(btn);
      syncCopyBtnState(w, btn);
    });
  }

  function syncCopyBtnState(wrapper, btn) {
    var expected = getExpectedCount();
    var checked = getChecked(wrapper).length;
    var visibleCount = getVisibleWeekWrappers().length;
    var ready = !!expected && checked === expected.count && visibleCount > 1;
    btn.disabled = !ready;
    btn.title = ready
      ? 'Apply this selection to every other visible week'
      : 'Pick your days for this week first, then copy to the others';
  }

  // ---------- wiring ----------
  function findWeekWrapperContaining(cb) {
    var wrappers = getVisibleWeekWrappers();
    for (var i = 0; i < wrappers.length; i++) {
      if (wrappers[i].contains(cb)) return wrappers[i];
    }
    return null;
  }

  function onChange(e) {
    var t = e.target;
    if (!t || t.type !== 'checkbox') {
      syncSelectAllBtn();
      return;
    }
    var wrapper = findWeekWrapperContaining(t);
    if (wrapper) {
      if (t.checked) {
        tickOrder.set(t, performance.now());
        if (!enforcing) enforceMaxForWrapper(wrapper, t);
      } else {
        tickOrder.delete(t);
      }
      updateHints();
    }
    syncSelectAllBtn();
  }

  function onClickBubble(e) {
    var liOption = e.target.closest && e.target.closest('li.multiselect__element, .multiselect__option');
    if (liOption) {
      setTimeout(function () {
        if (!enforcing) enforceMaxAllWrappers();
        autoFillFullWeek();
        updateHints();
      }, 50);
    }
  }

  function attachSubmitGuard() {
    var form = document.getElementById('_builder-form') || document.querySelector('form');
    if (form && !form.__campGuard) {
      form.__campGuard = true;
      form.addEventListener('submit', function (e) {
        if (!validateOnSubmit()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }, true);
    }
    if (!documentGuardAttached) {
      documentGuardAttached = true;
      document.addEventListener('click', function (e) {
        var btn = e.target.closest && e.target.closest('button[type="submit"], .hl-submit-button, .ghl-submit-btn, .hl-btn-submit');
        if (!btn) return;
        if (!validateOnSubmit()) {
          e.preventDefault();
          e.stopPropagation();
          if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        }
      }, true);
    }
  }

  function onReady() {
    getVisibleWeekWrappers().forEach(function (w) {
      getChecked(w).forEach(function (cb, i) {
        tickOrder.set(cb, performance.now() - 1e6 + i);
      });
    });

    document.addEventListener('change', onChange, true);
    document.addEventListener('click',  onClickBubble, true);

    installSelectAllButton();
    syncSelectAllBtn();
    installCopyButtons();
    attachSubmitGuard();
    autoFillFullWeek();
    updateHints();

    setInterval(function () {
      installSelectAllButton();
      syncSelectAllBtn();
      installCopyButtons();
      attachSubmitGuard();
      autoFillFullWeek();
      updateHints();
    }, 700);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
</script>
