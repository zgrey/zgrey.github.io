// ===== Theme Toggle =====
(function () {
  const STORAGE_KEY = 'theme';
  const DARK = 'dark';
  const LIGHT = 'light';

  function getPreferred() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === LIGHT || stored === DARK) return stored;
    return DARK; // dark is default
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.textContent = theme === DARK ? '\u2600' : '\u263E'; // ☀ / ☾
      btn.setAttribute('aria-label',
        theme === DARK ? 'Switch to light theme' : 'Switch to dark theme');
    }
    // Notify canvas animation of theme change
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function toggle() {
    const current = document.documentElement.getAttribute('data-theme') || DARK;
    const next = current === DARK ? LIGHT : DARK;
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  // Apply on load (before DOMContentLoaded to avoid flash)
  applyTheme(getPreferred());

  document.addEventListener('DOMContentLoaded', function () {
    // Re-apply to update button text after DOM is ready
    applyTheme(getPreferred());
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggle);
  });

  // Expose for SPA router re-init
  window.__themeInit = function () {
    applyTheme(getPreferred());
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggle);
  };
})();
