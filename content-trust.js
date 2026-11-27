/* Operator-reviewed, build-pinned public keys only. Empty until real key enrollment. */
(() => {
  const keys=Object.freeze({});
  if(typeof window!=='undefined')window.LoloContentTrust=keys;
  if(typeof module!=='undefined'&&module.exports)module.exports=keys;
})();
