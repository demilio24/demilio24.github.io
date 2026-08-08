/* Private Lessons Booking — price estimator config loader (GHL form Cpk2gmz9dcumDiz2KFun)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/private-lessons.js"></script>
   Pricing model: a per-session lesson price (Standard 30/45/60 min, or
   Mr. Floyd tiers) plus a student-count surcharge (+$25 / +$50). Both are
   flat per booking, so the engine just sums the selected priced options. */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "Private Lessons Booking",
    label: "Estimated Total (per session)",
    note: "Price shown is per session. Multiply by the number of sessions you book.",
    // The "Package" field's pack option carries no "$", so the parser
    // can't price it. Drive the total off the session count instead:
    // "10 Sessions Pack" -> per-session subtotal x 10 (pay 10, get 11).
    packageMultiplier: {
      fieldRe: /package/i,
      parse: function (text) {
        var m = String(text).match(/(\d+)\s*Sessions?\s*Pack/i);
        return m ? +m[1] : 1; // "Single Session" -> 1
      },
      labelWhenMultiplied: function (n) {
        return "Estimated Total (" + n + "-session pack)";
      },
      noteWhenMultiplied: function (n) {
        return (
          n +
          " sessions at your per-session rate. You pay for " +
          n +
          " and receive " +
          (n + 1) +
          " (1 free)."
        );
      },
    },
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
