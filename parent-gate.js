(function attachParentGate(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.LoloParentGate = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createParentGateModule() {
  const VERSION = 1;
  const PIN_KEY = 'lolo-parent-gate-v1';
  const ATTEMPTS_KEY = 'lolo-parent-gate-attempts-v1';
  const ITERATIONS = 180000;
  const AUTO_LOCK_MS = 5 * 60 * 1000;
  const MAX_LOCK_MS = 15 * 60 * 1000;
  const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
  function normalizePin(value) {
    return typeof value === 'string' ? value.replace(/[٠-٩۰-۹]/g, digit => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    }) : '';
  }
  function validPin(value) { return /^\d{6}$/.test(normalizePin(value)); }
  function normalizeRecovery(value) {
    return typeof value === 'string' ? value.toUpperCase().replace(/[^A-Z2-9]/g, '') : '';
  }
  function bytesToBase64(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  function base64ToBytes(value) {
    try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
    catch { return null; }
  }
  function equalBytes(left, right) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
    return difference === 0;
  }

  function create(storage, options = {}) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') throw new TypeError('Parent gate requires a storage adapter.');
    const cryptoApi = options.crypto || globalThis.crypto;
    const now = typeof options.now === 'function' ? options.now : Date.now;
    let unlockedAt = null;

    function requireCrypto() {
      if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') throw new Error('SECURE_CRYPTO_UNAVAILABLE');
    }
    function readPinRecord() {
      const raw = storage.get(PIN_KEY);
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (isObject(parsed) && parsed.version === VERSION && Number.isInteger(parsed.iterations) && parsed.iterations >= 100000 && parsed.iterations <= 500000 &&
            ['pinSalt', 'pinHash', 'recoverySalt', 'recoveryHash'].every(key => typeof parsed[key] === 'string')) return parsed;
      } catch (error) {
        return null;
      }
      return null;
    }
    function readAttempts() {
      const raw = storage.get(ATTEMPTS_KEY);
      if (!raw) return {failures: 0, blockedUntil: 0};
      try {
        const parsed = JSON.parse(raw);
        if (isObject(parsed)) return {
          failures: Number.isInteger(parsed.failures) && parsed.failures >= 0 ? Math.min(parsed.failures, 1000) : 0,
          blockedUntil: Number.isFinite(parsed.blockedUntil) && parsed.blockedUntil >= now() && parsed.blockedUntil <= now() + MAX_LOCK_MS ? parsed.blockedUntil : 0,
        };
      } catch (error) {
        return {failures: 0, blockedUntil: 0};
      }
      return {failures: 0, blockedUntil: 0};
    }
    function saveAttempts(attempts) { storage.set(ATTEMPTS_KEY, JSON.stringify(attempts)); }
    async function derive(secret, salt, iterations) {
      requireCrypto();
      const key = await cryptoApi.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveBits']);
      return new Uint8Array(await cryptoApi.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt, iterations}, key, 256));
    }
    function randomBytes(length) {
      requireCrypto();
      return cryptoApi.getRandomValues(new Uint8Array(length));
    }
    function newRecoveryCode() {
      const bytes = randomBytes(16);
      let value = '';
      for (const byte of bytes) value += RECOVERY_ALPHABET[byte & 31];
      return value.match(/.{1,4}/g).join('-');
    }
    function lockStatus() {
      const attempts = readAttempts();
      const remaining = Math.max(0, attempts.blockedUntil - now());
      return {locked: remaining > 0, retryAfterMs: remaining, failures: attempts.failures};
    }
    function failure() {
      const attempts = readAttempts();
      attempts.failures += 1;
      if (attempts.failures >= 5 && attempts.failures % 5 === 0) {
        const level = Math.floor(attempts.failures / 5) - 1;
        attempts.blockedUntil = now() + Math.min(60 * 1000 * (2 ** level), MAX_LOCK_MS);
      }
      saveAttempts(attempts);
      return lockStatus();
    }
    function success() {
      saveAttempts({failures: 0, blockedUntil: 0});
      unlockedAt = now();
      return {ok: true, unlockedUntil: unlockedAt + AUTO_LOCK_MS};
    }
    async function configure(pin) {
      pin = normalizePin(pin);
      if (!validPin(pin)) return {ok: false, reason: 'PIN_FORMAT'};
      const pinSalt = randomBytes(16);
      const recoverySalt = randomBytes(16);
      const recoveryCode = newRecoveryCode();
      const record = {
        version: VERSION,
        iterations: ITERATIONS,
        pinSalt: bytesToBase64(pinSalt),
        pinHash: bytesToBase64(await derive(pin, pinSalt, ITERATIONS)),
        recoverySalt: bytesToBase64(recoverySalt),
        recoveryHash: bytesToBase64(await derive(normalizeRecovery(recoveryCode), recoverySalt, ITERATIONS)),
        createdAt: new Date(now()).toISOString(),
      };
      if (storage.set(PIN_KEY, JSON.stringify(record)) === false) return {ok: false, reason: 'STORAGE_UNAVAILABLE'};
      return {ok: true, recoveryCode};
    }

    return Object.freeze({
      autoLockMs: AUTO_LOCK_MS,
      isConfigured: () => Boolean(readPinRecord()),
      getLockStatus: lockStatus,
      isUnlocked() {
        if (unlockedAt === null) return false;
        if (now() - unlockedAt >= AUTO_LOCK_MS) { unlockedAt = null; return false; }
        return true;
      },
      touch() { if (this.isUnlocked()) unlockedAt = now(); },
      lock() { unlockedAt = null; },
      async setup(pin, confirmation) {
        if (this.isConfigured()) return {ok: false, reason: 'ALREADY_CONFIGURED'};
        if (normalizePin(pin) !== normalizePin(confirmation)) return {ok: false, reason: 'PIN_MISMATCH'};
        const result = await configure(pin);
        if (result.ok) success();
        return result;
      },
      async verifyPin(pin) {
        pin = normalizePin(pin);
        const record = readPinRecord();
        if (!record) return {ok: false, reason: 'NOT_CONFIGURED'};
        const before = lockStatus();
        if (before.locked) return {ok: false, reason: 'LOCKED', retryAfterMs: before.retryAfterMs};
        if (!validPin(pin)) return {ok: false, reason: 'PIN_FORMAT', ...failure()};
        const salt = base64ToBytes(record.pinSalt);
        const expected = base64ToBytes(record.pinHash);
        if (!salt || !expected || salt.length !== 16 || expected.length !== 32) return {ok: false, reason: 'PIN_DATA_INVALID'};
        const actual = await derive(pin, salt, record.iterations);
        if (!equalBytes(actual, expected)) return {ok: false, reason: 'INCORRECT_PIN', ...failure()};
        return success();
      },
      async recover(recoveryCode, newPin, confirmation) {
        const record = readPinRecord();
        if (!record) return {ok: false, reason: 'NOT_CONFIGURED'};
        const before = lockStatus();
        if (before.locked) return {ok: false, reason: 'LOCKED', retryAfterMs: before.retryAfterMs};
        if (!validPin(newPin)) return {ok: false, reason: 'PIN_FORMAT'};
        if (normalizePin(newPin) !== normalizePin(confirmation)) return {ok: false, reason: 'PIN_MISMATCH'};
        if (normalizeRecovery(recoveryCode).length !== 16) return {ok: false, reason: 'INCORRECT_RECOVERY_CODE', ...failure()};
        const salt = base64ToBytes(record.recoverySalt);
        const expected = base64ToBytes(record.recoveryHash);
        if (!salt || !expected || salt.length !== 16 || expected.length !== 32) return {ok: false, reason: 'RECOVERY_DATA_INVALID'};
        const actual = await derive(normalizeRecovery(recoveryCode), salt, record.iterations);
        if (!equalBytes(actual, expected)) return {ok: false, reason: 'INCORRECT_RECOVERY_CODE', ...failure()};
        const result = await configure(newPin);
        if (result.ok) success();
        return result;
      },
      async changePin(currentPin, newPin, confirmation) {
        const checked = await this.verifyPin(currentPin);
        if (!checked.ok) return checked;
        if (!validPin(newPin)) return {ok: false, reason: 'PIN_FORMAT'};
        if (normalizePin(newPin) !== normalizePin(confirmation)) return {ok: false, reason: 'PIN_MISMATCH'};
        const result = await configure(newPin);
        if (result.ok) success();
        return result;
      },
    });
  }

  return Object.freeze({create, VERSION, PIN_KEY, ATTEMPTS_KEY, ITERATIONS, AUTO_LOCK_MS});
});
