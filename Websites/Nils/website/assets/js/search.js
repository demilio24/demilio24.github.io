// Initialize Pagefind search when the page has a #search-ui mount point.
// Pagefind UI is loaded lazily from /Nils/website/pagefind/.
document.addEventListener('DOMContentLoaded', () => {
  const mount = document.getElementById('search-ui');
  if (!mount) return;

  // Lazy-load Pagefind UI bundle
  const styles = document.createElement('link');
  styles.rel = 'stylesheet';
  styles.href = '/Nils/website/pagefind/pagefind-ui.css';
  document.head.appendChild(styles);

  const script = document.createElement('script');
  script.src = '/Nils/website/pagefind/pagefind-ui.js';
  script.onload = () => {
    new window.PagefindUI({
      element: '#search-ui',
      bundlePath: '/Nils/website/pagefind/',
      showImages: false,
      showSubResults: true,
      resetStyles: false
    });
  };
  document.head.appendChild(script);

  // Cmd+K / Ctrl+K to focus the search input
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      const input = mount.querySelector('.pagefind-ui__search-input');
      if (input) input.focus();
    }
  });
});
