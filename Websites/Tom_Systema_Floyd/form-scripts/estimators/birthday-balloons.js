/* Birthday / Balloons — price estimator config loader (GHL form SvXq0KmUb1Ct2AR2t8Yl)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/birthday-balloons.js"></script>
   Pricing model: flat package prices (arches, garlands, numbers) plus
   add-on surcharges (setup, delivery distance). The engine sums every
   selected priced option. Items written as ranges / open-ended quotes
   ("$10 to $30 each", "Starting at $800 — request quote", "$750+") are
   intentionally EXCLUDED from the total since they need a custom quote. */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "Birthday / Balloons",
    label: "Estimated Total",
    note: "Estimate for fixed-price items only. Custom / quote-based items (marked 'starting at', a range, or '+') are confirmed separately.",
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
