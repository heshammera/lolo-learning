const assert = require('node:assert/strict');
const {webcrypto} = require('node:crypto');
const parentGateModule = require('../parent-gate.js');

function makeStorage() {
  const values = new Map();
  return {
    get(key) { return values.get(key) ?? null; },
    set(key, value) { values.set(key, String(value)); return true; },
    remove(key) { values.delete(key); return true; },
    values,
  };
}

async function runParentGateTests() {
  let now = 1_800_000_000_000;
  const storage = makeStorage();
  const gate = parentGateModule.create(storage, {crypto: webcrypto, now: () => now});

  assert.equal(gate.isConfigured(), false);
  assert.equal((await gate.setup('12345', '12345')).reason, 'PIN_FORMAT');
  assert.equal((await gate.setup('123456', '111111')).reason, 'PIN_MISMATCH');
  const first = await gate.setup('١٢٣٤٥٦', '123456');
  assert.equal(first.ok, true);
  assert.equal(first.recoveryCode.replaceAll('-', '').length, 16);
  assert.equal(gate.isConfigured(), true);

  const storedRecord = storage.get(parentGateModule.PIN_KEY);
  assert.equal(storedRecord.includes('123456'), false);
  assert.equal(storedRecord.includes(first.recoveryCode.replaceAll('-', '')), false);
  assert.equal((await gate.verifyPin('000000')).reason, 'INCORRECT_PIN');
  const valid = await gate.verifyPin('123456');
  assert.equal(valid.ok, true);
  assert.equal(gate.isUnlocked(), true);
  now += parentGateModule.AUTO_LOCK_MS - 1;
  gate.touch();
  now += parentGateModule.AUTO_LOCK_MS - 1;
  assert.equal(gate.isUnlocked(), true);
  now += 2;
  assert.equal(gate.isUnlocked(), false);

  for (let attempt = 0; attempt < 5; attempt += 1) await gate.verifyPin('000000');
  assert.equal(gate.getLockStatus().locked, true);
  assert.equal((await gate.verifyPin('123456')).reason, 'LOCKED');
  now += 60_001;
  assert.equal(gate.getLockStatus().locked, false);
  const recovered = await gate.recover(first.recoveryCode, '654321', '654321');
  assert.equal(recovered.ok, true);
  assert.notEqual(recovered.recoveryCode, first.recoveryCode);
  assert.equal((await gate.verifyPin('654321')).ok, true);
  const changed = await gate.changePin('654321', '246810', '246810');
  assert.equal(changed.ok, true);
  assert.equal((await gate.verifyPin('654321')).reason, 'INCORRECT_PIN');
  assert.equal((await gate.verifyPin('246810')).ok, true);

  const blockedStorage = makeStorage();
  blockedStorage.set = () => false;
  const blockedGate = parentGateModule.create(blockedStorage, {crypto: webcrypto, now: () => now});
  assert.equal((await blockedGate.setup('123456', '123456')).reason, 'STORAGE_UNAVAILABLE');

  console.log('Parent gate hashing, lockout, recovery, and idle timeout checks passed.');
  return true;
}

module.exports = runParentGateTests;
if (require.main === module) runParentGateTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
