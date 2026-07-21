/* Theme boot — applies the saved light/dark mode BEFORE first paint so the page
   never flashes the wrong palette. Mirrors src/hooks/useTheme.ts.

   This lives in /public as a same-origin file (NOT inline) on purpose: the site
   CSP in public/_headers sets `script-src 'self'` with no 'unsafe-inline' and no
   hash, so an inline copy of this is silently refused by the browser and the
   flash it exists to prevent happens on every load. Keep it external. */
(function () {
  try {
    var t = localStorage.getItem('vsr.theme');
    document.documentElement.setAttribute('data-theme', (t === 'light' || t === 'dark' || t === 'lab') ? t : 'lab');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'lab');
  }
})();
