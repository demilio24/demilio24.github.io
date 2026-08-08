/* After-School Registration — price estimator config loader (GHL form TkioOL4IoByeHU3K2gTs)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/after-school.js"></script>

   The "Select Class" options currently have NO "$" in their GHL labels,
   so nothing is totalled yet.

   TO ENABLE the estimate, EITHER:
     (a) add the price into each class option label in GHL
         (e.g. "Neighborhood Kids Karate ($120/month)") — read automatically; OR
     (b) fill in fixedPrices below, keyed by a substring of the option text.
         value: number (flat $) or { amount, unit:"once"|"day"|"week"|"hour" }

   NOTE: if after-school tuition is monthly, add a "/month"-style price into
   the label and tell me — I'll extend the engine's unit list to handle it. */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "After-School Registration",
    label: "Estimated Total",
    note: "Final tuition is confirmed at enrollment.",
    fixedPrices: {
      // EXAMPLES — replace with Tom's real class prices:
      // "neighborhood kids": 120,
      // "martial arts": 95
    },
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
