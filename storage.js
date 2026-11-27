(() => {
  let warningSent = false;

  function warn(message) {
    if (warningSent || typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    warningSent = true;
    queueMicrotask(() => window.dispatchEvent(new CustomEvent('lolo-storage-warning', {detail: message})));
  }

  function get(key) {
    try { return window.localStorage.getItem(key); }
    catch { warn('الحفظ على الجهاز مش متاح دلوقتي؛ ممكن التقدم مايتحفظش.'); return null; }
  }

  function getJSON(key, fallback) {
    const raw = get(key);
    if (raw === null) return fallback;
    try {
      const value = JSON.parse(raw);
      const valid = Array.isArray(fallback)
        ? Array.isArray(value)
        : !!value && typeof value === 'object' && !Array.isArray(value);
      if (valid) return value;
    } catch {}
    warn('في بيانات محفوظة محتاجة مراجعة؛ فتحنا التطبيق بالبيانات السليمة الموجودة.');
    return fallback;
  }

  function set(key, value) {
    try { window.localStorage.setItem(key, String(value)); return true; }
    catch { warn('ماقدرناش نحفظ التقدم على الجهاز. فضّي مساحة أو راجعي إعدادات المتصفح.'); return false; }
  }

  function remove(key) {
    try { window.localStorage.removeItem(key); return true; }
    catch { warn('ماقدرناش نحدّث البيانات المحفوظة على الجهاز.'); return false; }
  }

  window.LoloStorage = Object.freeze({get, getJSON, set, remove});
})();
