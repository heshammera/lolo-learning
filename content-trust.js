// No production signing keys configured. Only trusted build-time public JWKs may be pinned here.
(() => {
  const keys=Object.freeze({});
  window.LoloContentTrust=keys;
})();
