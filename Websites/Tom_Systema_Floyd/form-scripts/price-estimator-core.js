/* ============================================================
   SF PRICE ESTIMATOR — shared engine (GitHub-controlled)
   ============================================================
   A generic "Estimated Total" bar for GHL registration forms,
   distilled from the Summer Camp validator's estimator. It reads
   the prices written into each option's label, sums the ones the
   user has selected, and shows a live total above the submit button.

   DO NOT embed this file directly. Each form embeds its own tiny
   config loader in form-scripts/estimators/<form>.js, which sets
   window.SF_ESTIMATOR_CONFIG and then loads THIS engine. That way
   the math lives in one place (fix once → every form updates) and
   per-form tuning lives in its own small file.

   CONFIG (window.SF_ESTIMATOR_CONFIG):
     {
       formName:  "Rent-a-Sensei",          // for logs only
       label:     "Estimated Total",        // bar title (optional)
       note:      "Final price confirmed…",  // small grey sub-note (optional)
       // Per-unit pricing (e.g. $25/hour) needs a quantity. Point at
       // the field that holds it and how to read a number from the
       // chosen option. Applies to options priced /hour|/day|/week.
       multiplier: {
         unit: "hour",                       // which price unit this multiplies
         quantityFieldRe: /^\s*Duration/i,   // label of the quantity field
         quantityParse: function (text) {    // option text -> number
           var m = text.match(/(\d+)/); return m ? +m[1] : 0;
         }
       },
       // For forms whose option labels have NO "$" yet, supply prices
       // here keyed by a case-insensitive substring of the option text.
       // value: number (flat $) or { amount, unit:"once"|"day"|"week"|"hour" }
       fixedPrices: { "after school karate": 120, "extra day": { amount: 15, unit: "day" } }
     }
   ============================================================ */
(function () {
  "use strict";

  if (window.__sfEstimatorLoaded) return;
  window.__sfEstimatorLoaded = true;

  var CFG = window.SF_ESTIMATOR_CONFIG || {};
  var BAR_LABEL = CFG.label || "Estimated Total";
  var BAR_NOTE = CFG.note || "";
  var MULT = CFG.multiplier || null;
  var FIXED = CFG.fixedPrices || null;
  // Package multiplier: when a "pack" option is chosen, the per-session
  // subtotal is multiplied by the number of sessions in the pack. Lets a
  // form whose package option carries NO "$" (e.g. "10 Sessions Pack
  // (Get 1 Free)") still drive the total. See estimators/private-lessons.js.
  var PKG = CFG.packageMultiplier || null;
  var TAG = "[SF-ESTIMATOR]";

  function log() {
    try {
      console.log.apply(console, [TAG].concat([].slice.call(arguments)));
    } catch (e) {}
  }

  // ---- mute flag so our own DOM writes don't retrigger the observer
  var muted = 0;
  function mutate(fn) {
    muted++;
    try {
      fn();
    } finally {
      setTimeout(function () {
        if (muted > 0) muted--;
      }, 0);
    }
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        fn();
      }, ms);
    };
  }

  // ============================================================
  // Styles
  // ============================================================
  var css = `
    .sf-total-bar {
      margin:16px 0 12px; padding:14px 18px;
      background:#F8FAFC; border:1px solid #E5E7EB; border-radius:10px;
      font-family:'Inter', system-ui, sans-serif; display:none;
    }
    .sf-total-bar.is-visible { display:block; }
    .sf-total-content {
      display:flex; align-items:center; justify-content:space-between; gap:12px;
    }
    .sf-total-label {
      font-size:12px; font-weight:600; color:#6B7280;
      text-transform:uppercase; letter-spacing:.06em;
    }
    .sf-total-value {
      font-size:22px; font-weight:700; color:#155EEF;
      font-variant-numeric:tabular-nums;
    }
    .sf-total-note { margin-top:6px; font-size:11.5px; color:#9CA3AF; line-height:1.4; }
    .sf-total-bar.is-flash .sf-total-value { animation:sf-total-flash .35s ease; }
    @keyframes sf-total-flash {
      0% { transform:scale(1); } 50% { transform:scale(1.06); } 100% { transform:scale(1); }
    }
    @media (max-width: 480px) {
      .sf-total-bar { padding:12px 14px; }
      .sf-total-label { font-size:11px; }
      .sf-total-value { font-size:20px; }
    }
  `;
  if (!document.getElementById("sf-estimator-css")) {
    var s = document.createElement("style");
    s.id = "sf-estimator-css";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ============================================================
  // Price parsing
  // ============================================================
  // "$215/week", "(+$30)", "($7.75/day)", "$25/hour", "$150/session"
  //   -> { amount, unit }   unit = week|day|hour|session|once
  // Skips ranges/quotes/open-ended: "$10 to $30", "Starting at $800",
  // "request a quote", "$750+".
  function parsePrice(text) {
    if (!text) return null;
    var t = String(text).replace(/[–—]/g, "-");
    if (/\bto\b|starting at|request|quote/i.test(t)) return null;
    var m = t.match(
      /\$\s*(\d+(?:\.\d{1,2})?)(\+)?(?:\s*\/\s*(week|wk|day|hour|hr|session|sess|d|h))?/i,
    );
    if (!m) return null;
    if (m[2]) return null; // "$750+" open-ended
    var amount = parseFloat(m[1]);
    if (!(amount > 0)) return null;
    var u = (m[3] || "").toLowerCase();
    var unit =
      u.charAt(0) === "w"
        ? "week"
        : u.charAt(0) === "d"
          ? "day"
          : u.charAt(0) === "h"
            ? "hour"
            : u.charAt(0) === "s"
              ? "session"
              : "once";
    return { amount: amount, unit: unit };
  }

  // Look up a fixed (config-supplied) price for an option whose label
  // carries no "$". Matches by case-insensitive substring.
  function fixedPriceFor(text) {
    if (!FIXED || !text) return null;
    var hay = String(text).toLowerCase();
    for (var key in FIXED) {
      if (!Object.prototype.hasOwnProperty.call(FIXED, key)) continue;
      if (hay.indexOf(key.toLowerCase()) !== -1) {
        var v = FIXED[key];
        if (typeof v === "number") return { amount: v, unit: "once" };
        if (v && typeof v.amount === "number")
          return { amount: v.amount, unit: v.unit || "once" };
      }
    }
    return null;
  }

  function priceOf(text) {
    return parsePrice(text) || fixedPriceFor(text);
  }

  // ============================================================
  // Field reading
  // ============================================================
  // Is this field actually visible to the user? GHL conditional logic
  // hides a non-matching field by COLLAPSING ITS HEIGHT to ~0 (not
  // display:none), and crucially leaves the field's previously-chosen
  // value in the DOM. Without this guard a stale selection in a hidden
  // field is still summed — e.g. picking a Standard instructor + price,
  // then switching to Mr. Floyd (Premium) and picking a Premium price,
  // would count BOTH lesson prices (double-count). Only count fields the
  // user can actually see.
  function isFieldVisible(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (parseFloat(cs.opacity) === 0) return false;
    // display:none on an ancestor (offsetParent null), except position:fixed
    if (el.offsetParent === null && cs.position !== "fixed") return false;
    // collapsed-to-zero conditional field (the GHL hide mechanism above)
    if (el.getBoundingClientRect().height < 4) return false;
    return true;
  }

  function fieldWrappers() {
    var set = [];
    document
      .querySelectorAll(".form-builder--item, .form-field-wrapper")
      .forEach(function (w) {
        // keep only the outermost wrapper of each field
        if (
          !set.some(function (x) {
            return x.contains(w);
          })
        )
          set.push(w);
      });
    // drop fields hidden by conditional logic so their stale values
    // don't leak into the total (see isFieldVisible).
    return set.filter(isFieldVisible);
  }

  function labelText(wrapper) {
    var l =
      wrapper.querySelector("label.field-label") ||
      wrapper.querySelector("label");
    return l ? l.textContent : "";
  }

  // All currently-selected option texts inside a field wrapper.
  // Covers vue-multiselect (single + tags), native select, radios,
  // and checkboxes (multiple).
  function selectedTexts(wrapper) {
    var out = [];

    wrapper
      .querySelectorAll(".multiselect__single, .multiselect__tag")
      .forEach(function (el) {
        var t = el.textContent.trim();
        if (t) out.push(t);
      });

    wrapper
      .querySelectorAll(
        'li.multiselect__element[aria-selected="true"], .multiselect__option--selected',
      )
      .forEach(function (el) {
        var t = el.textContent.trim();
        if (t) out.push(t);
      });

    wrapper.querySelectorAll("select").forEach(function (sel) {
      var opt = sel.options[sel.selectedIndex];
      if (opt && opt.value) {
        var t = opt.textContent.trim();
        if (t) out.push(t);
      }
    });

    wrapper
      .querySelectorAll(
        'input[type="radio"]:checked, input[type="checkbox"]:checked',
      )
      .forEach(function (inp) {
        var lbl =
          inp.closest("label") ||
          (inp.id
            ? document.querySelector('label[for="' + cssEscape(inp.id) + '"]')
            : null);
        var t = lbl ? lbl.textContent.trim() : (inp.value || "").trim();
        if (t) out.push(t);
      });

    // de-dupe (multiselect single + tag can both echo the same text)
    return out.filter(function (t, i) {
      return out.indexOf(t) === i;
    });
  }

  function cssEscape(id) {
    return String(id).replace(/([^\w-])/g, "\\$1");
  }

  // Resolve the per-unit quantity (e.g. number of hours) from the
  // configured quantity field. Returns a number (0 if unreadable).
  function resolveQuantity() {
    if (!MULT || !MULT.quantityFieldRe) return 0;
    var re = MULT.quantityFieldRe;
    var wrappers = fieldWrappers();
    for (var i = 0; i < wrappers.length; i++) {
      if (!re.test(labelText(wrappers[i]))) continue;
      var texts = selectedTexts(wrappers[i]);
      for (var j = 0; j < texts.length; j++) {
        var n = MULT.quantityParse
          ? MULT.quantityParse(texts[j])
          : (texts[j].match(/(\d+)/) || [])[1];
        if (n) return +n;
      }
    }
    return 0;
  }

  // Resolve the package multiplier (e.g. 10 for a "10 Sessions Pack").
  // Returns 1 when no package field is configured or none is selected,
  // so the per-session subtotal passes through unchanged.
  function resolvePackageMultiplier() {
    if (!PKG || !PKG.fieldRe) return 1;
    var wrappers = fieldWrappers();
    for (var i = 0; i < wrappers.length; i++) {
      if (!PKG.fieldRe.test(labelText(wrappers[i]))) continue;
      var texts = selectedTexts(wrappers[i]);
      for (var j = 0; j < texts.length; j++) {
        var n = PKG.parse ? PKG.parse(texts[j]) : 0;
        if (n && n > 0) return n;
      }
    }
    return 1;
  }

  // ============================================================
  // Total
  // ============================================================
  function computeTotal() {
    var grand = 0;
    var qty = MULT ? resolveQuantity() : 0;
    fieldWrappers().forEach(function (w) {
      selectedTexts(w).forEach(function (text) {
        var p = priceOf(text);
        if (!p) return;
        if (MULT && p.unit === MULT.unit) {
          grand += p.amount * (qty > 0 ? qty : 0);
        } else if (p.unit === "week" || p.unit === "day") {
          // per-unit price with no matching multiplier configured:
          // count it once (a single week/day) rather than guess.
          grand += p.amount;
        } else {
          // once / session / hour-without-multiplier -> flat
          grand += p.amount;
        }
      });
    });
    // A package selection ("10 Sessions Pack") scales the per-session
    // subtotal by the number of sessions. multiplier is 1 by default.
    return grand * resolvePackageMultiplier();
  }

  function formatMoney(n) {
    var s = (Math.round(n * 100) / 100).toFixed(2);
    return "$" + s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  function ensureBar() {
    var bar = document.getElementById("sf-total-bar");
    if (bar && bar.parentNode) return bar;
    bar = document.createElement("div");
    bar.id = "sf-total-bar";
    bar.className = "sf-total-bar";
    bar.innerHTML =
      '<div class="sf-total-content">' +
      '<span class="sf-total-label" id="sf-total-label">' +
      BAR_LABEL +
      "</span>" +
      '<span class="sf-total-value" id="sf-total-value">$0.00</span>' +
      "</div>" +
      '<div class="sf-total-note" id="sf-total-note"' +
      (BAR_NOTE ? "" : ' style="display:none"') +
      ">" +
      BAR_NOTE +
      "</div>";
    var submit = document.querySelector(
      'button[type="submit"], .hl-submit-button, .ghl-submit-btn, .hl-btn-submit',
    );
    var anchor =
      submit &&
      (submit.closest(".form-field-wrapper") ||
        submit.closest(".form-builder--item") ||
        submit.parentNode);
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
    else {
      var form = document.getElementById("_builder-form");
      (form || document.body).appendChild(bar);
    }
    return bar;
  }

  var lastValue = -1;
  function update() {
    var bar = ensureBar();
    var total = computeTotal();
    var v = bar.querySelector("#sf-total-value");
    if (v) v.textContent = formatMoney(total);

    // When a multi-session package is chosen, relabel the bar so the
    // total reads as the pack total rather than a per-session price.
    if (PKG) {
      var mult = resolvePackageMultiplier();
      var labelEl = bar.querySelector("#sf-total-label");
      var noteEl = bar.querySelector("#sf-total-note");
      if (labelEl) {
        labelEl.textContent =
          mult > 1 && PKG.labelWhenMultiplied
            ? PKG.labelWhenMultiplied(mult)
            : BAR_LABEL;
      }
      if (noteEl) {
        var noteTxt =
          mult > 1 && PKG.noteWhenMultiplied
            ? PKG.noteWhenMultiplied(mult)
            : BAR_NOTE;
        noteEl.textContent = noteTxt;
        noteEl.style.display = noteTxt ? "" : "none";
      }
    }

    bar.classList.toggle("is-visible", total > 0);
    if (total !== lastValue && total > 0) {
      bar.classList.remove("is-flash");
      void bar.offsetWidth;
      bar.classList.add("is-flash");
    }
    lastValue = total;
  }

  // ============================================================
  // Boot
  // ============================================================
  function onReady() {
    var debounced = debounce(function () {
      mutate(update);
    }, 120);

    document.addEventListener("change", debounced, true);
    document.addEventListener(
      "click",
      function (e) {
        if (
          e.target.closest &&
          e.target.closest("li.multiselect__element, .multiselect__option")
        ) {
          setTimeout(function () {
            mutate(update);
          }, 50);
        }
      },
      true,
    );

    mutate(update);

    var bodyMO = new MutationObserver(function () {
      if (muted > 0) return;
      debounced();
    });
    bodyMO.observe(document.body, { childList: true, subtree: true });
    setTimeout(function () {
      bodyMO.disconnect();
      log("Observer stopped");
    }, 60000);

    log("Ready —", CFG.formName || "(unnamed form)");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }

  // DevTools helper: __sfEstimatorDebug() lists every priced option
  // currently selected and the running total.
  window.__sfEstimatorDebug = function () {
    var rows = [];
    fieldWrappers().forEach(function (w) {
      selectedTexts(w).forEach(function (text) {
        var p = priceOf(text);
        if (p)
          rows.push({
            field: labelText(w).replace(/\s+/g, " ").trim().slice(0, 40),
            option: text.replace(/\s+/g, " ").trim().slice(0, 50),
            amount: p.amount,
            unit: p.unit,
          });
      });
    });
    var info = {
      formName: CFG.formName,
      quantity: MULT ? resolveQuantity() : null,
      multiplierUnit: MULT ? MULT.unit : null,
      pricedSelections: rows,
      total: computeTotal(),
    };
    console.log("[SF-ESTIMATOR DEBUG]", info);
    return info;
  };
})();
