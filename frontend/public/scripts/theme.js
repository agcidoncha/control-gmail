(() => {
  const root = document.documentElement;
  const toggle = document.querySelector('#themeToggle');
  const label = document.querySelector('#themeToggleLabel');
  if (!toggle) return;

  const storageKey = 'commercial-theme';
  const applyTheme = (theme, persist = true) => {
    const isDark = theme === 'dark';
    root.dataset.theme = isDark ? 'dark' : 'light';
    toggle.setAttribute('aria-pressed', String(isDark));
    toggle.setAttribute('aria-label', isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
    if (label) label.textContent = isDark ? 'Modo claro' : 'Modo oscuro';
    if (persist) window.localStorage.setItem(storageKey, isDark ? 'dark' : 'light');
  };

  applyTheme(window.localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light', false);
  toggle.addEventListener('click', () => applyTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));
})();
