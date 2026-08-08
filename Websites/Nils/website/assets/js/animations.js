// Reveals elements with .anim when they enter the viewport.
// Pair with the .anim / .anim.visible / .d1..d4 classes from globals.css.
(function () {
  if (typeof IntersectionObserver === 'undefined') {
    // Graceful fallback: show everything immediately on legacy browsers.
    document.querySelectorAll('.anim').forEach(el => el.classList.add('visible'));
    return;
  }

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.anim').forEach(el => io.observe(el));
  });
})();
