// Background Service Worker for 划词翻译

// === NotionClient (inlined) ===
class NotionClient {
  constructor() {
    this.apiKey = null;
    this.databaseId = null;
    this.ready = false;
    this.dbSchema = null;
  }

  async init() {
    const result = await chrome.storage.local.get(['notionApiKey', 'notionDatabaseId']);
    this.apiKey = result.notionApiKey || null;
    this.databaseId = result.notionDatabaseId || null;
    this.ready = !!(this.apiKey && this.databaseId);
    return this.ready;
  }

  async setConfig(apiKey, databaseId) {
    this.apiKey = apiKey;
    this.databaseId = databaseId;
    await chrome.storage.local.set({ notionApiKey: apiKey, notionDatabaseId: databaseId });
    this.ready = true;
  }

  async clearConfig() {
    this.apiKey = null;
    this.databaseId = null;
    this.ready = false;
    await chrome.storage.local.remove(['notionApiKey', 'notionDatabaseId']);
  }

  async validate() {
    if (!this.ready) return { valid: false, error: 'Not configured' };
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch('https://api.notion.com/v1/databases/' + this.databaseId + '/query', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + this.apiKey,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ page_size: 1 }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (response.ok) {
        const c2 = new AbortController();
        const t2 = setTimeout(() => c2.abort(), 15000);

        const dbResp = await fetch('https://api.notion.com/v1/databases/' + this.databaseId, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + this.apiKey,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          signal: c2.signal
        });
        clearTimeout(t2);
        if (dbResp.ok) {
          const dbData = await dbResp.json();
          this.dbSchema = dbData.properties || {};
          await this.ensureDatabaseProperties();
          const props = Object.keys(this.dbSchema).map(n => n + '(' + this.dbSchema[n].type + ')').join(', ');
          return { valid: true, properties: props };
        }
        return { valid: true };
      }
      const errorData = await response.json();
      return { valid: false, error: errorData.message || 'Invalid credentials' };
    } catch (err) {
      return { valid: false, error: err.message };
    }
  }

  async ensureDatabaseProperties() {
    if (!this.dbSchema) return;
    var schema = this.dbSchema;
    var hasTitle = false, hasUrl = false, hasDate = false, richTextCount = 0;
    for (var name in schema) {
      var t = schema[name].type;
      if (t === 'title') hasTitle = true;
      if (t === 'url') hasUrl = true;
      if (t === 'date') hasDate = true;
      if (t === 'rich_text') richTextCount++;
    }
    var newProps = {};
    if (!hasUrl) newProps['来源'] = { url: {} };
    if (!hasDate) newProps['收藏时间'] = { date: {} };
    if (richTextCount < 1) newProps['单词'] = { rich_text: {} };
    if (richTextCount < 2) newProps['中文释义'] = { rich_text: {} };
    if (richTextCount < 3) newProps['音标'] = { rich_text: {} };
    if (Object.keys(newProps).length === 0) return;
    try {
      await fetch('https://api.notion.com/v1/databases/' + this.databaseId, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + this.apiKey,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ properties: newProps })
      });
    } catch (e) {}
  }

  async createPage(properties) {
    if (!this.ready) return { success: false, error: 'Not configured' };
    const { word, translation, phonetic, sourceUrl } = properties;
    if (!this.dbSchema) {
      try {
        const dbResp = await fetch('https://api.notion.com/v1/databases/' + this.databaseId, {
          method: 'GET',
          headers: {
            'Authorization': 'Bearer ' + this.apiKey,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          }
        });
        if (dbResp.ok) {
          const dbData = await dbResp.json();
          this.dbSchema = dbData.properties || {};
          await this.ensureDatabaseProperties();
        }
      } catch (e) {}
    }
    var titleProp = null, urlProp = null, dateProp = null, richTextProps = [];
    var schema = this.dbSchema || {};
    for (var name in schema) {
      var prop = schema[name];
      if (prop.type === 'title' && !titleProp) titleProp = name;
      else if (prop.type === 'url' && !urlProp) urlProp = name;
      else if (prop.type === 'date' && !dateProp) dateProp = name;
      else if (prop.type === 'rich_text') richTextProps.push(name);
    }
    var bodyProps = {};
    if (titleProp) bodyProps[titleProp] = { title: [{ text: { content: (word || '').slice(0, 2000) } }] };
    if (urlProp) bodyProps[urlProp] = { url: sourceUrl || null };
    if (dateProp) bodyProps[dateProp] = { date: { start: new Date().toISOString() } };
    var values = [
      { content: (word || '').slice(0, 2000) },
      { content: (translation || '').slice(0, 2000) },
      { content: (phonetic || '').slice(0, 2000) }
    ];
    for (var i = 0; i < Math.min(richTextProps.length, values.length); i++) {
      bodyProps[richTextProps[i]] = { rich_text: [{ text: values[i] }] };
    }
    try {
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + this.apiKey,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ parent: { database_id: this.databaseId }, properties: bodyProps })
      });
      if (response.ok) {
        const data = await response.json();
        return { success: true, pageId: data.id };
      }
      const data = await response.json();
      return { success: false, error: data.message || 'Failed' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

// === Service Worker Logic ===
let notion = null;

chrome.runtime.onInstalled.addListener(async () => {
  notion = new NotionClient();
  await notion.init();
});

chrome.runtime.onStartup.addListener(async () => {
  if (!notion) notion = new NotionClient();
  await notion.init();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[划词翻译] Message received:', request.type);

  // Translate: fast path, no Notion needed
  if (request.type === 'translate') {
    console.log('[划词翻译] Translating:', (request.text || '').slice(0, 30));
    translateText(request.text, request.targetLang, request.sourceLang)
      .then(result => { console.log('[划词翻译] Translate success'); sendResponse({ success: true, data: result }); })
      .catch(err => { console.error('[划词翻译] Translate error:', err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  // Ask AI: fast path, uses DeepSeek to answer questions about selected text
  if (request.type === 'askQuestion') {
    console.log('[划词翻译] Ask AI:', (request.question || '').slice(0, 30));
    askAI(request.text, request.question, request.conversationHistory)
      .then(result => sendResponse({ success: true, data: { answer: result } }))
      .catch(err => { console.error('[划词翻译] Ask AI error:', err); sendResponse({ success: false, error: err.message }); });
    return true;
  }

  handleMessage(request).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
  return true;
});

async function handleMessage(request) {
  // Lazy-init Notion
  if (!notion) { notion = new NotionClient(); await notion.init(); }

  const type = request.type;

  if (type === 'addWord') {
    await addWordToCollection(request.word, request.translation, request.sourceUrl, request.note);
    // Also sync to Notion if configured
    if (notion.ready) {
      await notion.createPage({ word: request.word, translation: request.translation, phonetic: '', sourceUrl: request.sourceUrl || '' });
    }
    return { success: true };
  }

  if (type === 'updateWordNote') {
    await updateWordNote(request.word, request.note);
    return { success: true };
  }

  if (type === 'removeWord') {
    await removeWordFromCollection(request.word);
    return { success: true };
  }

  if (type === 'getWords') {
    const words = await getCollectedWords();
    return { success: true, data: words };
  }

  if (type === 'checkWord') {
    const found = await checkWordCollected(request.word);
    return { success: true, data: found };
  }

  if (type === 'getSettings') {
    const settings = await getSettings();
    return { success: true, data: settings };
  }

  if (type === 'saveSettings') {
    await saveSettings(request.settings);
    return { success: true };
  }

  // Notion
  if (type === 'getNotionStatus') {
    return { success: true, data: { notionReady: notion.ready, apiKey: notion.apiKey ? (notion.apiKey.slice(0, 8) + '...') : null } };
  }

  if (type === 'setNotionConfig') {
    await notion.setConfig(request.apiKey, request.databaseId);
    const result = await notion.validate();
    if (!result.valid) await notion.clearConfig();
    return result;
  }

  if (type === 'clearNotionConfig') {
    await notion.clearConfig();
    return { success: true };
  }

  if (type === 'syncAllToNotion') {
    if (!notion.ready) return { success: false, error: 'Not configured' };
    const words = await getCollectedWords();
    var synced = 0, failed = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var res = await notion.createPage({ word: w.word, translation: w.translation, phonetic: '', sourceUrl: w.sourceUrl || '' });
      if (res.success) synced++; else failed++;
    }
    return { success: true, synced: synced, failed: failed, total: words.length };
  }

  return { success: false, error: 'Unknown type' };
}

// --- Translation API ---
async function translateText(text, targetLang = 'zh-CN', sourceLang = 'en') {
  const settings = await getSettings();

  // Determine actual source and target languages
  let sl = sourceLang;
  let tl = targetLang;
  if (sourceLang === 'zh-CN') {
    tl = 'en'; // Chinese-to-English always targets English
  }
  // For Japanese and Korean, translate to the user's chosen target language
  // (sl stays as 'ja' or 'ko', tl stays as targetLang or user's target language)

  // Choose engine (with fallback: any engine failing → MyMemory)
  const engine = settings.translateEngine || 'google';

  if (engine === 'deepseek' && settings.deepseekApiKey) {
    try {
      return await translateWithDeepSeek(text, sl, tl, settings.deepseekApiKey);
    } catch (dsErr) {
      console.warn('[划词翻译] DeepSeek失败，降级到MyMemory:', dsErr.message);
      // Fall through to MyMemory
    }
  }

  if (engine === 'google') {
    try {
      return await translateWithGoogle(text, sl, tl);
    } catch (googleErr) {
      console.warn('[划词翻译] Google失败，降级到MyMemory:', googleErr.message);
      // Fall through to MyMemory
    }
  }

  // MyMemory (or fallback from DeepSeek/Google)
  try {
    return await translateWithMyMemory(text, sl, tl);
  } catch (mmErr) {
    throw new Error('翻译失败：所有引擎均不可用。请检查网络或配置DeepSeek API Key');
  }
}

async function translateWithGoogle(text, sl, tl) {
  const encoded = encodeURIComponent(text);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encoded}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000); // Short timeout: Google may be blocked, fall back fast

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) throw new Error('Translation failed: ' + response.status);
    const data = await response.json();
    let translatedText = '';
    if (data && data[0]) {
      for (const segment of data[0]) {
        if (segment[0]) translatedText += segment[0];
      }
    }
    return { translatedText: translatedText || '无法获取翻译', phonetic: '', sourceLang: data && data[2] ? data[2] : sl };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('Google 翻译不可达（可能被网络屏蔽）');
    }
    throw err;
  }
}

async function translateWithMyMemory(text, sl, tl) {
  // Map language codes to MyMemory format (en|zh-CN).
  // 'auto' → 'Autodetect' (lowercase 'auto' is rejected with HTTP 403).
  const src = sl === 'auto' ? 'Autodetect' : sl;
  const langPair = src + '|' + tl;
  const encoded = encodeURIComponent(text);
  const url = `https://api.mymemory.translated.net/get?q=${encoded}&langpair=${langPair}`;
  console.log('[划词翻译] MyMemory request:', url.slice(0, 120));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    console.log('[划词翻译] MyMemory response status:', response.status);

    if (!response.ok) throw new Error('MyMemory translation failed: ' + response.status);
    const data = await response.json();
    console.log('[划词翻译] MyMemory data:', JSON.stringify(data).slice(0, 200));

    let translatedText = '';
    if (data && data.responseData && data.responseData.translatedText) {
      translatedText = data.responseData.translatedText.trim();
    }

    // If match quality is low, try to indicate that
    const matchQuality = (data && data.responseData && data.responseData.match) || 0;

    // If match is very low (machine-generated fallback), prefix with indicator
    const result = translatedText || '无法获取翻译';
    return { translatedText: result, phonetic: '', sourceLang: sl };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('MyMemory 请求超时，请检查网络');
    }
    throw err;
  }
}

async function translateWithDeepSeek(text, sl, tl, apiKey) {
  const langNames = { 'zh-CN': '中文', 'zh-TW': '繁体中文', 'en': '英文', 'ja': '日文', 'ko': '韩文', 'vi': '越南文', 'it': '意大利文', 'es': '西班牙文' };
  const sourceName = sl === 'auto' ? '外语' : (langNames[sl] || sl);
  const targetName = langNames[tl] || tl;
  const systemPrompt = `你是一个翻译助手。将用户输入的${sourceName}翻译成${targetName}，只返回翻译结果，不要解释。`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.1,
        max_tokens: 1024
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error('DeepSeek translation failed: ' + (errData.error && errData.error.message || response.status));
    }

    const data = await response.json();
    let translatedText = '';
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      translatedText = data.choices[0].message.content.trim();
    }

    return { translatedText: translatedText || '无法获取翻译', phonetic: '', sourceLang: sl };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('DeepSeek 请求超时，请检查网络或 API Key');
    }
    throw err;
  }
}

// --- Ask AI (DeepSeek) ---
async function askAI(selectedText, question, conversationHistory) {
  const settings = await getSettings();

  if (!settings.deepseekApiKey) {
    throw new Error('请先在设置中配置 DeepSeek API Key');
  }

  const systemPrompt = '你是一个知识渊博的AI助手，帮助用户理解网页中选中的文本内容。你可以解释单词、短语、句子的含义，分析语法结构，提供例句，回答相关问题。请用中文回答，简洁明了，不超过300字。当用户选中的是英文时，可附带英文解释。保持友好、教学式的语气。';

  // Build messages array
  const messages = [{ role: 'system', content: systemPrompt }];

  // Add conversation history if exists (multi-turn)
  if (conversationHistory && Array.isArray(conversationHistory)) {
    for (const msg of conversationHistory) {
      messages.push(msg);
    }
  } else {
    // First question: include the selected text as context
    messages.push({ role: 'user', content: '我选中了这段文本：\n"""\n' + selectedText + '\n"""\n\n我的问题是：' + question });
  }

  // If there's history, just add the new question
  if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    messages.push({ role: 'user', content: question });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + settings.deepseekApiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error('DeepSeek AI request failed: ' + (errData.error && errData.error.message || response.status));
    }

    const data = await response.json();
    let answer = '';
    if (data && data.choices && data.choices[0] && data.choices[0].message) {
      answer = data.choices[0].message.content.trim();
    }

    return answer || '抱歉，没有获取到回答，请重试。';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('AI 请求超时，请检查网络或 API Key');
    }
    throw err;
  }
}

// --- Word Collection Storage ---
async function addWordToCollection(word, translation, sourceUrl = '', note = '') {
  const words = await getCollectedWords();
  const key = word.toLowerCase().trim();
  if (words.some(w => w.word.toLowerCase() === key)) return;
  words.push({ word: word.trim(), translation: translation, sourceUrl: sourceUrl, note: note || '', addedAt: Date.now() });
  await chrome.storage.local.set({ collectedWords: words });
}

async function updateWordNote(word, note) {
  const words = await getCollectedWords();
  const key = word.toLowerCase().trim();
  const entry = words.find(w => w.word.toLowerCase() === key);
  if (entry) {
    entry.note = (note || '').slice(0, 30);
    await chrome.storage.local.set({ collectedWords: words });
  }
}

async function removeWordFromCollection(word) {
  const words = await getCollectedWords();
  const key = word.toLowerCase().trim();
  const filtered = words.filter(w => w.word.toLowerCase() !== key);
  await chrome.storage.local.set({ collectedWords: filtered });
}

async function getCollectedWords() {
  const result = await chrome.storage.local.get('collectedWords');
  return result.collectedWords || [];
}

async function checkWordCollected(word) {
  const words = await getCollectedWords();
  const key = word.toLowerCase().trim();
  return words.find(w => w.word.toLowerCase() === key) || null;
}

// --- Settings ---
const DEFAULT_SETTINGS = { enabled: true, targetLang: 'zh-CN', highlightColor: '#7C3AED', enableZhToEn: false, translateEngine: 'google', deepseekApiKey: '', enableAsk: true };
async function getSettings() {
  const result = await chrome.storage.local.get('settings');
  const merged = { ...DEFAULT_SETTINGS, ...result.settings };
  return merged;
}
async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ settings: merged });
}
