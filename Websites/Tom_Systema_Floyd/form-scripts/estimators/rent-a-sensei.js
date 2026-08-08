/* Rent-a-Sensei — price estimator config loader (GHL form myEoOLL1SKGv0IvSF4ur)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/rent-a-sensei.js"></script>
   Pricing model: hourly rate by number of children ($25/$30/$35 per hour),
   multiplied by the chosen Duration (3 / 4 / 5+ hours). */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "Rent-a-Sensei",
    label: "Estimated Total",
    note: "Estimate based on your hourly rate and selected duration. Travel or extra children may adjust the final price.",
    multiplier: {
      unit: "hour",
      quantityFieldRe: /^\s*Duration/i,
      quantityParse: function (text) {
        // "3 hours (minimum)" -> 3, "4 hours" -> 4, "5+ hours" -> 5
        var m = String(text).match(/(\d+)/);
        return m ? +m[1] : 0;
      },
    },
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
