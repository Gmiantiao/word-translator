// Exercises the real background/service-worker.js against a stubbed chrome.* API.
// No browser involved; the module is loaded into a vm context and driven with the
// same messages the popup sends.
//
//   node test/sw-test.js
//
// Needs a TypeSafe key, either:
//   TYPESAFE_API_KEY=apikey_... node test/sw-test.js
//   TYPESAFE_ENV_FILE=../jev/.env node test/sw-test.js
//
// It makes REAL API calls (token metered, fractions of a cent).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SW = path.join(ROOT, 'background', 'service-worker.js');

function loadKey() {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY.trim();
  if (process.env.TYPESAFE_ENV_FILE) {
    const match = /^TYPESAFE_API_KEY=(.*)$/m.exec(fs.readFileSync(process.env.TYPESAFE_ENV_FILE, 'utf8'));
    if (match) return match[1].trim();
  }
  console.error('No TypeSafe key.\n\n  TYPESAFE_API_KEY=apikey_... node test/sw-test.js\n  TYPESAFE_ENV_FILE=/path/to/.env node test/sw-test.js\n');
  process.exit(2);
}

const KEY = loadKey();

// ---- chrome.* stub ----
const store = {};
const messageListeners = [];

const chrome = {
  storage: {
    local: {
      get: async (keys) => {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') return keys in store ? { [keys]: store[keys] } : {};
        if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in store).map(k => [k, store[k]]));
        return Object.fromEntries(Object.keys(keys).map(k => [k, k in store ? store[k] : keys[k]]));
      },
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; }
    }
  },
  runtime: {
    onMessage: { addListener: fn => messageListeners.push(fn) },
    onInstalled: { addListener: () => {} },
    onStartup: { addListener: () => {} },
    getURL: p => 'chrome-extension://stub/' + p
  }
};

const sandbox = {
  chrome, console, fetch, AbortController, setTimeout, clearTimeout,
  Promise, JSON, Object, Array, Error, URL, crypto, Date, Math, String, Number, Boolean
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SW, 'utf8'), sandbox, { filename: 'service-worker.js' });

console.log('service worker loaded');
console.log('onMessage listeners registered:', messageListeners.length, '\n');

// The worker answers via sendResponse and returns true to keep the channel open.
function dispatch(request) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ __timeout: true }); }
    }, 60000);
    messageListeners[0](request, {}, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(response);
    });
  });
}

let pass = 0, fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  -- ' + detail : ''}`);
  ok ? pass++ : fail++;
}

(async () => {
  store.settings = { enableAnalyze: true, enableAsk: true, enabled: true, typesafeApiKey: KEY, deepseekApiKey: 'fake-ds-key-9999' };

  console.log('== getSettings: keys must not come back ==');
  const s = await dispatch({ type: 'getSettings' });
  check('response contains no real key', !JSON.stringify(s).includes(KEY));
  check('typesafeApiKey masked', /^····/.test(s.data.typesafeApiKey), s.data.typesafeApiKey);
  check('deepseekApiKey masked', /^····/.test(s.data.deepseekApiKey), s.data.deepseekApiKey);
  check('still truthy (content script gate relies on it)', !!s.data.typesafeApiKey && !!s.data.deepseekApiKey);

  console.log('\n== saveSettings: masked values must not clobber ==');
  await dispatch({ type: 'saveSettings', settings: { typesafeApiKey: '····ABCD', deepseekApiKey: '····WXYZ' } });
  check('real key untouched by masked write', store.settings.typesafeApiKey === KEY);
  await dispatch({ type: 'saveSettings', settings: { enableAnalyze: false } });
  check('ordinary fields still save', store.settings.enableAnalyze === false);
  check('key survives an unrelated save', store.settings.typesafeApiKey === KEY);

  console.log('\n== testTypesafeKey: real network call ==');
  const t1 = await dispatch({ type: 'testTypesafeKey' }); // no key -> falls back to storage
  check('omitting the key falls back to the stored one', t1.success === true, JSON.stringify(t1).slice(0, 110));
  check('returns the model list', !!(t1.data && t1.data.models && t1.data.models.length),
    t1.data && t1.data.models.join(', '));
  const t2 = await dispatch({ type: 'testTypesafeKey', apiKey: 'apikey_TOTALLY_BOGUS' });
  check('bad key gives a clear error', t2.success === false && /无效/.test(t2.error), t2.error && t2.error.slice(0, 70));

  console.log('\n== analyzeEnglish: real network call ==');
  const a = await dispatch({ type: 'analyzeEnglish', text: 'He kept putting off the decision, hoping the whole thing would blow over.' });
  check('call succeeds', a.success === true, a.success ? '' : JSON.stringify(a).slice(0, 140));
  if (a.success) {
    const d = a.data;
    check('flattened shape is complete',
      typeof d.casual === 'number' && typeof d.score === 'number'
      && typeof d.scoreConfidence === 'number' && typeof d.feature === 'string'
      && typeof d.featureConfidence === 'number',
      JSON.stringify(d));
    check('feature is one of the five labels',
      ['idiom_phrasal', 'collocation', 'grammar_pattern', 'slang', 'functional'].includes(d.feature), d.feature);
    check('no key leakage in the payload', !JSON.stringify(d).includes(KEY));
  }
  const a2 = await dispatch({ type: 'analyzeEnglish', text: 'The study examines the correlation between socioeconomic status and academic achievement.' });
  check('a second passage works too', a2.success === true, a2.success ? '' : JSON.stringify(a2).slice(0, 120));

  console.log('\n== unknown message type ==');
  const u = await dispatch({ type: 'nonsense' });
  check('falls through to handleMessage and errors', u.success === false, u.error);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
