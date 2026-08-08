/* Free Camp / Scholarship — price estimator config loader (GHL form 3Z4E9y7WlWgkZDxViBUW)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/free-camp.js"></script>

   The camp itself is FREE — lunch and breakfast are labelled "Free". The
   total only shows if a PAID add-on is selected (e.g. Additional Care,
   paid T-shirt). Those options currently have NO "$" in their GHL labels,
   so nothing is totalled yet.

   TO ENABLE the estimate, EITHER:
     (a) add the price into the GHL option label (e.g. "Additional Care
         ($175/week)") — the engine reads it automatically; OR
     (b) fill in fixedPrices below, keyed by a substring of the option text.
         value: number (flat $) or { amount, unit:"once"|"day"|"week"|"hour" } */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "Free Camp / Scholarship",
    label: "Estimated Add-On Total",
    note: "Camp is free. This total reflects optional paid add-ons only.",
    fixedPrices: {
      // EXAMPLES — replace with Tom's real prices (or delete and add "$" to the GHL labels):
      // "additional care": { amount: 175, unit: "week" },
      // "t-shirt": 15
    },
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
