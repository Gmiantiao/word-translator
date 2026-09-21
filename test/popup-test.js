// Drives the real popup/index.js with a fake DOM, and cross-checks every
// getElementById against the real popup/index.html. No browser, no network.
//
//   node test/popup-test.js
//
// Focuses on API-key handling: masking on load, save-on-blur, the clear buttons,
// and that the test buttons never ship a key from the page.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.join(__dirname, '..', 'popup');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

const idsInHtml = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const idsRequested = new Set();

function makeEl(id) {
  return {
    id, value: '', placeholder: '', textContent: '', innerHTML: '', checked: false,
    disabled: false, style: {}, className: '', dataset: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }
    },
    addEventListener(type, fn) { (this._l || (this._l = {}))[type] = fn; },
    querySelector() { return makeEl('sub'); },
    querySelectorAll() { return []; },
    appendChild(c) { return c; },
    remove() {}, focus() {}, select() {}, setAttribute() {}, getAttribute() { return null; },
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  };
}

const registry = {};
const documentListeners = {};
const document = {
  getElementById(id) { idsRequested.add(id); return registry[id] || (registry[id] = makeEl(id)); },
  createElement(tag) { return makeEl(tag); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  // The whole popup body is wrapped in a DOMContentLoaded handler, so capture it.
  addEventListener(type, fn) { (documentListeners[type] || (documentListeners[type] = [])).push(fn); },
  body: makeEl('body'),
  documentElement: makeEl('html')
};

// ---- chrome stub ----
const sent = [];
const chrome = {
  runtime: {
    sendMessage(msg, cb) {
      sent.push(msg);
      const data = {
        getSettings: {
          enabled: true, targetLang: 'zh-CN', highlightColor: '#7C3AED', translateEngine: 'deepseek',
          // Masked, as the worker sends them.
          deepseekApiKey: '····WXYZ', enableZhToEn: false, enableAsk: true, enableAnalyze: true,
          typesafeApiKey: '····ABCD'
        },
        getWords: [],
        getNotionStatus: { notionReady: false, apiKey: null }
      }[msg.type];
      if (cb) setTimeout(() => cb({ success: true, data }), 0);
    },
    getURL: p => 'chrome-extension://stub/' + p,
    openOptionsPage() {}
  },
  storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  tabs: { create() {} },
  notifications: { create() {} }
};

const sandbox = {
  chrome, document, console, setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Object, Array, Error, Math, Date, String, Number, Boolean, RegExp, Map, Set,
  confirm: () => true
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  -- ' + detail : ''}`);
  ok ? pass++ : fail++;
}

try {
  vm.runInContext(fs.readFileSync(path.join(DIR, 'index.js'), 'utf8'), sandbox, { filename: 'popup/index.js' });
  check('popup/index.js loads and runs', true);
} catch (err) {
  check('popup/index.js loads and runs', false, err.message);
  process.exit(1);
}

(async () => {
  const domReady = (documentListeners.DOMContentLoaded || [])[0];
  if (typeof domReady !== 'function') { console.log('  no DOMContentLoaded handler found'); process.exit(1); }
  await domReady();
  await new Promise(r => setTimeout(r, 150));

  console.log('\n== id cross-check ==');
  check('the body actually ran (ids were requested)', idsRequested.size > 10, idsRequested.size + ' ids');
  const missing = [...idsRequested].filter(id => !idsInHtml.has(id));
  check('every getElementById target exists in index.html', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : idsRequested.size + ' ids all matched');

  console.log('\n== masked hydration ==');
  check('TypeSafe field is not filled with a real key', registry.typesafeApiKey.value === '',
    'value=' + JSON.stringify(registry.typesafeApiKey.value));
  check('TypeSafe field shows the masked hint', /^····/.test(registry.typesafeApiKey.placeholder),
    registry.typesafeApiKey.placeholder);
  check('DeepSeek field is not filled with a real key', registry.deepseekApiKey.value === '');
  check('DeepSeek field shows the masked hint', /^····/.test(registry.deepseekApiKey.placeholder),
    registry.deepseekApiKey.placeholder);

  console.log('\n== save on blur ==');
  sent.length = 0;
  registry.typesafeApiKey.value = 'apikey_NEW_value_1234';
  registry.typesafeApiKey._l.change();
  await new Promise(r => setTimeout(r, 50));
  const save = sent.find(m => m.type === 'saveSettings');
  check('a typed key is saved', !!save && save.settings.typesafeApiKey === 'apikey_NEW_value_1234',
    JSON.stringify(save && save.settings));
  check('field clears after saving', registry.typesafeApiKey.value === '');
  check('placeholder becomes the mask', registry.typesafeApiKey.placeholder === '····1234',
    registry.typesafeApiKey.placeholder);

  sent.length = 0;
  registry.typesafeApiKey.value = '   ';
  registry.typesafeApiKey._l.change();
  await new Promise(r => setTimeout(r, 50));
  check('empty input saves nothing (means "keep the stored key")',
    sent.filter(m => m.type === 'saveSettings').length === 0);

  sent.length = 0;
  registry.typesafeApiKey.value = 'TYPESAFE_API_KEY=apikey_whole_line';
  registry.typesafeApiKey._l.change();
  await new Promise(r => setTimeout(r, 30));
  check('a pasted .env line is rejected, not stored',
    sent.filter(m => m.type === 'saveSettings').length === 0);

  console.log('\n== clear button ==');
  sent.length = 0;
  registry.clearTypesafeBtn._l.click();
  await new Promise(r => setTimeout(r, 50));
  const clr = sent.find(m => m.type === 'saveSettings');
  check('clear saves an empty value', !!clr && clr.settings.typesafeApiKey === '');
  check('placeholder resets', registry.typesafeApiKey.placeholder === 'apikey_...',
    registry.typesafeApiKey.placeholder);

  console.log('\n== test button (empty field -> use the stored key) ==');
  sent.length = 0;
  registry.typesafeApiKey.value = '';
  registry.testTypesafeBtn._l.click();
  await new Promise(r => setTimeout(r, 80));
  const t = sent.find(m => m.type === 'testTypesafeKey');
  check('sends testTypesafeKey', !!t);
  check('no key sent when the field is empty (worker falls back)', !!t && t.apiKey === undefined,
    'apiKey=' + JSON.stringify(t && t.apiKey));

  sent.length = 0;
  registry.typesafeApiKey.value = 'apikey_TYPED_abcd';
  registry.testTypesafeBtn._l.click();
  await new Promise(r => setTimeout(r, 80));
  const t2 = sent.find(m => m.type === 'testTypesafeKey');
  check('a typed key is sent through', !!t2 && t2.apiKey === 'apikey_TYPED_abcd');

  console.log('\n== DeepSeek test also goes through the worker ==');
  sent.length = 0;
  registry.deepseekApiKey.value = '';
  registry.testDeepseekBtn._l.click();
  await new Promise(r => setTimeout(r, 80));
  const d = sent.find(m => m.type === 'testDeepseekKey');
  check('sends testDeepseekKey with no key', !!d && d.apiKey === undefined);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
