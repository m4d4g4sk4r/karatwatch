const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('frontend/KaratWatch.js', 'utf8');
const context = vm.createContext({
  FileManager: { local: () => ({ documentsDirectory: () => '/tmp', joinPath: (a,b) => a+'/'+b }) },
  Color: Object.assign(function () {}, { dynamic: () => null })
});
// Load real widget functions without executing Scriptable's top-level UI entrypoint.
vm.runInContext(source.slice(0, source.lastIndexOf('if (config.runsInWidget)')), context);
const call = expression => vm.runInContext(expression, context);
test('default needs no backend; mode parameters retain both gold purities', () => {
  assert.equal(call('SETTINGS.serverURL'), '');
  assert.equal(call('parseMode("gold:7").purity'), 'both');
  assert.equal(call('parseMode("gold:22k:7").days'), 7);
  assert.ok(call('parseMode("silver:11").error'));
});
test('gold source converts grams to 10g without incorporating price changes', () => {
  const result = call('parseSourceTables([[["1","₹14,351 (-256)","₹13,155 (-235)"]],[["Nov 06, 2026","₹14,351","₹13,155"]]], "gold")');
  assert.equal(result['24k'], 143510);
  assert.equal(result.history[0]['22k'], 131550);
  assert.equal(result.history[0].date, '2026-11-06');
});
test('silver converts current grams but preserves historical kilogram units', () => {
  const result = call('parseSourceTables([[["1","₹205"]],[["Nov 06, 2026","₹2,050","₹20,500","₹2,05,000 (-5,000)"]]], "silver")');
  assert.equal(result.price, 205000);
  assert.equal(result.history[0].price, 205000);
});
test('blocked pages, missing history and invalid dates fail closed', () => {
  assert.throws(() => call('parseSourceTables([], "gold")'));
  assert.throws(() => call('parseSourceTables([[["1","₹205"]],[]], "silver")'));
  assert.ok(Number.isNaN(call('dayTime("2026-02-30")')));
});
test('history rejects conflicting dates and invalid prices', () => {
  assert.throws(() => call('validateHistory([{date:"2026-11-06",price:1},{date:"2026-11-06",price:2}], ["price"])'));
  assert.throws(() => call('validateHistory([{date:"2026-11-06",price:0}], ["price"])'));
});
