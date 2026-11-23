// Theme and accent color for the extension pages. Kept in localStorage so it applies before
// the first paint; the accent is also mirrored to extension storage for the toolbar icon.
(() => {
  const ACCENTS = globalThis.FD_ACCENTS;
  const KEY = 'appearance';
  const DEFAULTS = { theme: 'system', accent: 'violet' };
  const systemDark = matchMedia('(prefers-color-scheme: dark)');

  function read() {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function apply() {
    const { theme, accent } = read();
    const dark = theme === 'dark' || (theme === 'system' && systemDark.matches);
    const root = document.documentElement;
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.setProperty('--accent', (ACCENTS[accent] ?? ACCENTS.violet)[dark ? 1 : 0]);
  }

  async function set(patch) {
    try { localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch })); } catch { /* storage blocked */ }
    apply();
    if (patch.accent) {
      const { settings } = await chrome.storage.local.get('settings');
      await chrome.storage.local.set({ settings: { ...settings, accent: patch.accent } });
    }
  }

  systemDark.addEventListener('change', apply);
  window.addEventListener('storage', (e) => { if (e.key === KEY) apply(); });
  apply();

  globalThis.FD_Theme = { ACCENTS, read, set };
})();
