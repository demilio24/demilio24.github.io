/* Vladimir Seminar — price estimator config loader (GHL form Zu7nHwEILIJnkKyvtnbB)
   Embed (one Custom Code element at the bottom of the form):
     <script src="https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/estimators/vlad-seminar.js"></script>
   Pricing model: pick one pass (Two Day Early $275 / Regular $325,
   Day Pass Sat or Sun Early $155 / Regular $200). Flat single price,
   plus any priced add-ons (e.g. Friday private session) if selected. */
(function () {
  window.SF_ESTIMATOR_CONFIG = {
    formName: "Vladimir Seminar",
    label: "Estimated Total",
    note: "Early-bird prices require payment before the listed deadline.",
  };
  var s = document.createElement("script");
  s.src =
    "https://demilio24.github.io/Websites/Tom_Systema_Floyd/form-scripts/price-estimator-core.js";
  (document.head || document.documentElement).appendChild(s);
})();
