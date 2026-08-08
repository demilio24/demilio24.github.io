/* ============================================================
   FREE CAMP — "CAMP IS FULL" OVERLAY (GitHub-controlled toggle)
   ============================================================
   Inject this file into the GoHighLevel Free Camp registration
   form via a single <script src> tag (see usage below).

   It is ALWAYS injected. Whether the overlay actually shows is
   controlled by the CAMP_IS_FULL flag right below — change that
   one value in GitHub (via VS Code / Claude) and the form flips
   between blocked and open. No GHL edits needed after the first.

       CAMP_IS_FULL = true   -> overlay ON  (form blocked)
       CAMP_IS_FULL = false  -> overlay OFF (form accessible)

   USAGE — paste this once into a GHL form Custom Code / <script>:
       <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/forms/free-camp-full-overlay.js"></script>
   ============================================================ */
(function () {
  /* ---- THE TOGGLE -------------------------------------------------- */
  var CAMP_IS_FULL = false; // <-- CHANGE THIS: true = block form, false = open
  /* ------------------------------------------------------------------ */

  // Run once the DOM exists (scripts injected into GHL forms may load early).
  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  ready(function () {
    if (document.getElementById("camp-full-overlay")) return; // guard: only inject once

    // --- Google Font: DM Sans ---
    function addLink(rel, href, crossorigin) {
      var l = document.createElement("link");
      l.rel = rel;
      l.href = href;
      if (crossorigin) l.crossOrigin = "";
      document.head.appendChild(l);
    }
    addLink("preconnect", "https://fonts.googleapis.com");
    addLink("preconnect", "https://fonts.gstatic.com", true);
    addLink(
      "stylesheet",
      "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800;900&display=swap"
    );

    // --- Overlay styles ---
    var style = document.createElement("style");
    style.textContent = [
      "#camp-full-overlay{",
      "  display:none;position:fixed;inset:0;z-index:99999;",
      "  background:rgba(10,18,40,0.82);",
      "  backdrop-filter:blur(7px) saturate(1.3);",
      "  -webkit-backdrop-filter:blur(7px) saturate(1.3);",
      "  justify-content:center;align-items:center;padding:16px;",
      "  box-sizing:border-box;font-family:'DM Sans',sans-serif;",
      "}",
      "#camp-full-overlay.active{display:flex;}",
      "#camp-full-box{",
      "  background:#ffffff;border-radius:12px;",
      "  box-shadow:0 0 0 4px #1a3a6b,0 20px 60px rgba(0,0,0,0.55);",
      "  padding:48px 52px 40px;text-align:center;max-width:460px;",
      "  width:100%;position:relative;overflow:hidden;box-sizing:border-box;",
      "}",
      "#camp-full-box::before{",
      "  content:'';position:absolute;top:0;left:0;right:0;height:6px;",
      "  background:linear-gradient(90deg,#1a3a6b 0%,#2e6be6 100%);",
      "}",
      "#camp-full-eyebrow{",
      "  display:inline-block;background:#eef3fc;color:#1a3a6b;",
      "  font-family:'DM Sans',sans-serif;font-size:0.7rem;font-weight:800;",
      "  letter-spacing:0.13em;text-transform:uppercase;padding:5px 14px;",
      "  border-radius:20px;margin-bottom:18px;border:1.5px solid #c5d6f5;",
      "}",
      "#camp-full-box h2{",
      "  margin:0 0 4px;font-family:'DM Sans',sans-serif;",
      "  font-size:clamp(1.6rem,5vw,2.1rem);font-weight:900;color:#0d1e40;",
      "  text-transform:uppercase;letter-spacing:-0.5px;line-height:1.1;",
      "}",
      "#camp-full-box h2 span{color:#2e6be6;}",
      "#camp-full-divider{",
      "  width:48px;height:4px;",
      "  background:linear-gradient(90deg,#1a3a6b,#2e6be6);",
      "  border-radius:2px;margin:14px auto 16px;",
      "}",
      "#camp-full-box p{",
      "  margin:0;font-family:'DM Sans',sans-serif;",
      "  font-size:clamp(0.85rem,2.5vw,0.97rem);color:#4a5568;",
      "  line-height:1.6;font-weight:500;",
      "}",
      "@media (max-width:480px){",
      "  #camp-full-box{padding:36px 28px 32px;border-radius:10px;}",
      "  #camp-full-eyebrow{font-size:0.65rem;padding:4px 12px;}",
      "}",
    ].join("\n");
    document.head.appendChild(style);

    // --- Overlay markup ---
    var overlay = document.createElement("div");
    overlay.id = "camp-full-overlay";
    overlay.innerHTML = [
      '<div id="camp-full-box">',
      '  <div id="camp-full-eyebrow">Free Camp Registration</div>',
      "  <h2>Camp Is <span>Full</span></h2>",
      '  <div id="camp-full-divider"></div>',
      "  <p>Registration is currently closed.<br>Check back soon for future sessions.</p>",
      "</div>",
    ].join("");
    document.body.appendChild(overlay);

    // --- Activation ---
    if (CAMP_IS_FULL) {
      overlay.classList.add("active");
    }
  });
})();
