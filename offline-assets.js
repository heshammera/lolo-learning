(() => {
  // Bump this version whenever any precached application asset changes.
  const version = '2026-11-27-content-package-1';
  const paths = Object.freeze([
    '/index.html','/offline.html','/curriculum.json','/app.js','/storage.js',
    '/assessment-engine.js','/subject-catalog.js','/visual-question-bank.js','/visual-assessment-engine.js','/curriculum-engine.js','/learning-engine.js','/learning-path-engine.js',
    '/parent-gate.js','/session-timers.js','/brand.js','/network.js','/family-client.js','/activity-engine.js','/activity-pilot.js','/content-schema.js','/content-package.js','/pcm-processor.js',
    '/site.webmanifest','/favicon.ico','/favicon-16x16.png','/favicon-32x32.png',
    '/favicon-48x48.png','/apple-touch-icon.png',
    '/assets/branding/icons/lolo-icon.webp','/assets/branding/logos/lolo-logo.webp',
    '/assets/branding/icons/icon-192.png','/assets/branding/icons/icon-512.png',
    '/assets/branding/icons/icon-maskable-512.png','/assets/branding/brand-tokens.json',
  ]);
  const api = Object.freeze({version, paths});
  if (typeof self !== 'undefined') self.LoloOfflineAssets = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
