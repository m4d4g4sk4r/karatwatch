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
test('city URLs normalize aliases and reject paths or foreign hosts', () => {
  try {
    call('applyCity(" Mumbai ")');
    assert.equal(call('SETTINGS.city'), 'Mumbai');
    assert.equal(call('sourceURL("gold")'), 'https://www.goodreturns.in/gold-rates/mumbai.html');
    assert.equal(call('sourceURL("silver")'), 'https://www.goodreturns.in/silver-rates/mumbai.html');
    call('applyCity("Bengaluru")');
    assert.equal(call('location.slug'), 'bangalore');
    for (const input of ['', '../mumbai', 'https://evil.test', 'mumbai?x=1']) {
      assert.throws(() => call(`resolveCity(${JSON.stringify(input)})`));
    }
  } finally { call('applyCity("Ahmedabad")'); }
});
test('switching city isolates cache, retry holds and alerts, preserving old defaults', () => {
  const original = call('[cacheFile, retryFile, alertsFile].join("|")');
  try {
    call('applyCity("Mumbai")');
    const next = call('[cacheFile, retryFile, alertsFile].join("|")');
    assert.notEqual(next, original);
    assert.ok(next.split('|').every(path => path.endsWith('-mumbai.json')));
    context.oldPayload = { city:'Ahmedabad', updatedAt:new Date().toISOString(), stale:false,
      gold:{'24k':143510,'22k':131550,history:[]}, silver:{price:205000,history:[]} };
    assert.throws(() => call('validate(oldPayload)'), /metadata/);
    context.oldPayload.city = 'Mumbai';
    assert.equal(call('validate(oldPayload).city'), 'Mumbai');
  } finally { call('applyCity("Ahmedabad")'); }
  assert.equal(call('[cacheFile, retryFile, alertsFile].join("|")'), original);
});
test('directory links are deduplicated, sorted and confined to Goodreturns city paths', () => {
  context.links = [
    {href:'/gold-rates/mumbai.html'},
    {href:'https://www.goodreturns.in/gold-rates/ahmedabad.html'},
    {href:'/gold-rates/mumbai.html'},
    {href:'https://evil.test/gold-rates/delhi.html'},
    {href:'/gold-rates/calculator/'},
    {href:'/silver-rates/chennai.html'}
  ];
  assert.equal(call('parseCityLinks(links).map(c => c.slug).join(",")'), 'ahmedabad,mumbai');
});
test('directory fetch excludes international tables and falls back to saved cities when blocked', async () => {
  const files = new Map();
  context.testFiles = files;
  call('fm.fileExists = path => testFiles.has(path); fm.readString = path => testFiles.get(path); fm.writeString = (path, value) => testFiles.set(path, value)');
  let blocked = false;
  context.Request = class {
    constructor(url) { assert.equal(url, 'https://www.goodreturns.in/gold-rates/'); this.response = {statusCode: blocked ? 403 : 200}; }
    async loadString() { return '<html>directory fixture</html>'; }
  };
  const heading = textContent => ({tagName:'H2',textContent});
  const table = href => ({tagName:'TABLE',querySelectorAll:()=>[{getAttribute:()=>href}]});
  const doc = {querySelectorAll:()=>[
    heading('Indian Major Cities Gold Rates Today (1 gram)'), table('/gold-rates/mumbai.html'),
    heading('Major Countries Gold Rates Today (1 gram)'), table('/gold-rates/dubai.html')
  ]};
  context.WebView = class {
    async loadHTML() {}
    async evaluateJavaScript(script) {
      return vm.runInNewContext(script, {DOMParser:class {parseFromString(){return doc;}}});
    }
  };
  const fresh = await call('availableCities()');
  assert.equal(fresh.cities.map(c=>c.slug).join(','), 'mumbai');
  assert.equal(fresh.cached, false);
  for (const [path, value] of files) {
    if (path.endsWith("karatwatch-cities-v1.json")) files.set(path, JSON.stringify({...JSON.parse(value), fetchedAt: 0}));
  }
  blocked = true;
  const saved = await call('availableCities()');
  assert.equal(saved.cities.map(c=>c.slug).join(','), 'mumbai');
  assert.equal(saved.cached, true);
  files.clear();
  assert.equal((await call('availableCities()')).cities.length, 0);
});
test('API requests replace city while preserving other query parameters', () => {
  assert.equal(call('apiURL("https://example.com/api/metals", "mumbai")'), 'https://example.com/api/metals?city=mumbai');
  assert.equal(call('apiURL("https://example.com/api/metals?x=1&city=delhi&%63ity=pune#fragment", "bangalore")'), 'https://example.com/api/metals?x=1&city=bangalore');
});
function isolatedWidget() {
  const files = new Map();
  const c = vm.createContext({
    FileManager: {local:()=>({documentsDirectory:()=>'/tmp',joinPath:(a,b)=>a+'/'+b,
      fileExists:path=>files.has(path),readString:path=>files.get(path),
      writeString:(path,value)=>files.set(path,value),remove:path=>files.delete(path)})},
    Color: Object.assign(function(){}, {dynamic:()=>null})
  });
  vm.runInContext(source.slice(0, source.lastIndexOf('if (config.runsInWidget)')), c);
  return {c,files,run:expression=>vm.runInContext(expression,c)};
}
test('upstream refusal persists across cities and honors long Retry-After', async () => {
  const {c,run} = isolatedWidget();
  let requests = 0;
  c.Request = class {
    constructor(){requests++;this.response={statusCode:429,headers:{'Retry-After':'172800'}};}
    async loadString(){return 'blocked';}
  };
  await assert.rejects(()=>run('requestSourceHTML(sourceURL("gold"))'));
  assert.ok(run('sourceCooldown().until - Date.now()') > 172799000);
  run('applyCity("Mumbai")');
  await assert.rejects(()=>run('requestSourceHTML(sourceURL("silver"))'));
  assert.equal(requests,1);
});
test('forced refresh uses recent prices and cannot bypass failure cooldown', async () => {
  const {c,run} = isolatedWidget();
  c.payload = {city:'Ahmedabad',updatedAt:new Date().toISOString(),stale:false,
    gold:{'24k':140000,'22k':130000,history:[]},silver:{price:200000,history:[]},source:{provider:'goodreturns'}};
  let requests=0;
  c.Request = class {constructor(){requests++;throw Error('must not fetch');}};
  run('saveFile(cacheFile,{retrievedAt:new Date().toISOString(),data:payload})');
  const result = await run('loadPrices(true)');
  assert.equal(result.data.city,'Ahmedabad');
  assert.match(result.reason,/refresh interval/);
  run('fm.remove(cacheFile); saveFile(retryFile,{until:Date.now()+60000,label:"Request failed"})');
  assert.equal((await run('loadPrices(true)')).reason,'Request failed');
  assert.equal(requests,0);
});
test('directory cache avoids network requests for seven days', async () => {
  const {c,run} = isolatedWidget();
  c.Request = class {constructor(){throw Error('must use directory cache');}};
  run('saveFile(fm.joinPath(fm.documentsDirectory(),"karatwatch-cities-v1.json"),{fetchedAt:Date.now(),links:[{href:"/gold-rates/mumbai.html"}]})');
  const result=await run('availableCities()');
  assert.equal(result.cities[0].slug,'mumbai');
  assert.equal(result.cached,true);
});
