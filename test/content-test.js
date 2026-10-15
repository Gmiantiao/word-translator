// Drives the real content/index.js with a fake DOM and a stubbed chrome API, then
// pushes synthetic selections through the mouseup listener. No browser needed.
//
//   node test/content-test.js
//
// Focuses on the selection gate (500 -> 3000 chars) and on which selections get an
// English-analysis section. Makes no network calls.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'content', 'index.js');

// ---- fake DOM ----
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    className: '', value: '', placeholder: '',
    // A real element always exposes a CSSStyleDeclaration here; the extension
    // writes the highlight color onto documentElement.style via setProperty.
    style: {
      _props: {},
      setProperty(name, value) { this._props[name] = String(value); },
      getPropertyValue(name) { return this._props[name] || ''; },
      removeProperty(name) { delete this._props[name]; }
    },
    dataset: {}, children: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { on ? this._s.add(c) : this._s.delete(c); }
    },
    addEventListener(type, fn) { (this._l || (this._l = {}))[type] = fn; },
    querySelector(sel) { return (this._q || (this._q = {}))[sel] || makeEl('div'); },
    querySelectorAll() { return []; },
    appendChild(c) { this.children.push(c); return c; },
    remove() { this.removed = true; },
    focus() {}, select() {}, setAttribute() {}, getAttribute() { return null; },
    closest() { return null; },
    getBoundingClientRect() { return { top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20 }; }
  };

  // Mirror a real div: set textContent and read innerHTML to escape -- which is
  // exactly how the extension's escapeHtml() works.
  let raw = '', html = '', mode = 'html';
  Object.defineProperty(el, 'textContent', {
    get: () => raw,
    set: v => { raw = String(v); mode = 'text'; }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: () => mode === 'text'
      ? raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      : html,
    set: v => { html = String(v); mode = 'html'; }
  });
  return el;
}

const documentListeners = {};
const created = [];

const document = {
  title: 'test',
  body: makeEl('body'),
  documentElement: makeEl('html'),
  addEventListener(type, fn) { (documentListeners[type] || (documentListeners[type] = [])).push(fn); },
  removeEventListener() {},
  createElement(tag) { const el = makeEl(tag); created.push(el); return el; },
  getElementById() { return null; },
  querySelector() { return null; },
  querySelectorAll() { return []; }
};

let currentSelection = null;
const window = {
  __wordPickerInjected: false,
  innerWidth: 1200, innerHeight: 900, pageYOffset: 0, pageXOffset: 0,
  getSelection: () => currentSelection,
  addEventListener() {}
};

// ---- chrome stub ----
const sent = [];
const responses = {
  getSettings: {
    success: true,
    data: {
      enabled: true, enableAnalyze: true, enableAsk: true, enableZhToEn: true,
      targetLang: 'zh-CN',
      // Masked, as the worker now sends them -- truthy is all this script needs.
      typesafeApiKey: '····ABCD', deepseekApiKey: '····WXYZ'
    }
  },
  checkWord: { success: true, data: null },
  translate: { success: true, data: { translatedText: 'translated' } }
};
const chrome = {
  runtime: {
    onMessage: { addListener() {} },
    sendMessage(msg, cb) {
      sent.push(msg);
      if (cb) setTimeout(() => cb(responses[msg.type] || { success: false, error: 'n/a' }), 0);
    }
  },
  storage: { onChanged: { addListener() {} }, local: { get: async () => ({}) } }
};

const sandbox = {
  chrome, document, window, console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  MutationObserver: class { observe() {} disconnect() {} },
  Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  Promise, JSON, Object, Array, Error, Math, Date, String, Number, Boolean, RegExp, Map, Set
};
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let pass = 0, fail = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? '  -- ' + detail : ''}`);
  ok ? pass++ : fail++;
}

try {
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'content/index.js' });
  check('content/index.js loads and runs', true);
} catch (err) {
  check('content/index.js loads and runs', false, err.message);
  process.exit(1);
}

function select(text) {
  currentSelection = {
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ top: 100, left: 100, bottom: 120, right: 300, width: 200, height: 20 }) }),
    removeAllRanges() {}
  };
  return { target: { closest: () => null }, stopPropagation() {} };
}

(async () => {
  // init() is async: its listeners land only after the getSettings round-trip.
  await new Promise(r => setTimeout(r, 120));
  const onMouseUp = (documentListeners.mouseup || [])[0];
  check('mouseup listener registered', typeof onMouseUp === 'function');
  if (typeof onMouseUp !== 'function') { console.log('\ncannot continue'); process.exit(1); }

  const tick = () => new Promise(r => setTimeout(r, 80));
  const popups = () => created.filter(el => el.className === 'wp-popup');
  const lastPopup = () => popups().pop();

  // Mirrors the real interaction: with a popup already open, the next mouseup only
  // dismisses it and returns -- you click again to get a new one.
  async function selectFresh(text) {
    onMouseUp(select(''));
    await tick();
    created.length = 0;
    sent.length = 0;
    onMouseUp(select(text));
    await tick();
  }

  console.log('\n== selection gate: 500 -> 3000 ==');

  await selectFresh('a'.repeat(400));
  check('400 chars -> popup opens', !!lastPopup(), 'popups=' + popups().length);
  check('400 chars -> translation requested', sent.filter(m => m.type === 'translate').length === 1);
  check('400 chars -> popup shows the translation', !!lastPopup() && lastPopup().innerHTML.includes('translated'));

  await selectFresh('a'.repeat(600));
  check('600 chars -> popup still opens (old code returned early)', !!lastPopup(), 'popups=' + popups().length);
  check('600 chars -> translation skipped', sent.filter(m => m.type === 'translate').length === 0,
    'translate calls=' + sent.filter(m => m.type === 'translate').length);
  const longMarkup = lastPopup() ? lastPopup().innerHTML : '';
  check('600 chars -> shows the skip notice', longMarkup.includes('已跳过翻译'));
  check('600 chars -> no collect/note footer', !longMarkup.includes('wp-collect-btn'));

  await selectFresh('a'.repeat(2900));
  check('2900 chars -> popup opens, translation skipped',
    !!lastPopup() && sent.filter(m => m.type === 'translate').length === 0);

  await selectFresh('a'.repeat(3500));
  check('3500 chars -> over the cap, no popup', !lastPopup(), 'popups=' + popups().length);

  console.log('\n== analysis section markup ==');
  check('has the 英语判定 toggle', longMarkup.includes('wp-analyze-section') && longMarkup.includes('英语判定'));
  check('has the toggle id', longMarkup.includes('id="wpAnalyzeToggle"'));
  check('has the result container id', longMarkup.includes('id="wpAnalyzeResult"'));

  console.log('\n== Chinese selection (zh->en on, so the popup does open) ==');
  await selectFresh('这是一段中文文本，用来验证判定区不会出现。');
  const cnMarkup = lastPopup() ? lastPopup().innerHTML : '';
  check('Chinese -> popup opens as usual', !!lastPopup(), 'popups=' + popups().length);
  check('Chinese -> no analysis section', !cnMarkup.includes('wp-analyze-section'));

  console.log('\n== English sentence ==');
  await selectFresh('a'.repeat(400));
  const shortMarkup = lastPopup() ? lastPopup().innerHTML : '';
  check('English -> analysis section present', shortMarkup.includes('wp-analyze-section'));
  check('English -> collect footer still there', shortMarkup.includes('wp-collect-btn'));

  // Regression guard: the highlight stylesheet reads these off documentElement,
  // and nothing else on the page sets them. When that link was missing, the
  // popup's color picker silently did nothing.
  console.log('\n== highlight color reaches page context ==');
  const color = document.documentElement.style.getPropertyValue('--wp-highlight-color');
  check('--wp-highlight-color is set', color === '#7C3AED', color || '(unset)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
