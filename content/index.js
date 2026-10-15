// Content Script for NoodlePicker - 划词翻译 + 收藏高亮 + AI提问

(function () {
  'use strict';

  // Avoid duplicate injection
  if (window.__wordPickerInjected) return;
  window.__wordPickerInjected = true;

  // Kept in sync by hand with the authoritative copy in background/service-worker.js.
  const DEFAULT_SETTINGS = { enabled: true, targetLang: 'zh-CN', highlightColor: '#7C3AED', enableZhToEn: false, enableAsk: true, enableAnalyze: true, typesafeApiKey: '' };

  // Translation engines degrade badly past a few hundred chars; the English analysis
  // handles far more, so the two limits differ.
  const MAX_TRANSLATE_CHARS = 500;
  const MAX_ANALYZE_CHARS = 3000;
  const CONFIDENCE_FLOOR = 0.70; // mirrors jev/jev.py:42
  const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const FEATURE_LABELS = {
    idiom_phrasal: '习语 / 短语动词',
    collocation: '地道搭配',
    grammar_pattern: '句型结构',
    slang: '俚语 / 口语缩略',
    functional: '场景功能句'
  };

  // This script runs on every page and only ever tests these for truthiness, so it
  // never needs the real values. Both the message path and chrome.storage.onChanged
  // would otherwise leave live API keys in every page's JS context.
  function withoutKeys(s) {
    return {
      ...s,
      typesafeApiKey: s.typesafeApiKey ? '····' : '',
      deepseekApiKey: s.deepseekApiKey ? '····' : ''
    };
  }

  let currentPopup = null;
  let settings = { ...DEFAULT_SETTINGS };
  let conversationHistory = []; // For AI multi-turn conversation
  let selectedTextForAsk = ''; // Store the selected text context for AI
  let translationRequestId = 0; // Track latest translation request to prevent stale popups

  // --- Init ---
  async function init() {
    settings = withoutKeys(await getSettings());
    applyHighlightColor();
    if (settings.enabled) {
      highlightCollectedWords();
    }
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
    chrome.runtime.onMessage.addListener(onMessage);
    observeDomChanges();
  }

  function onMessage(request, sender, sendResponse) {
    if (request.type === 'settingsChanged') {
      settings = withoutKeys(request.settings);
      applyHighlightColor();
      if (settings.enabled) {
        highlightCollectedWords();
      } else {
        removeAllHighlights();
      }
    }
    if (request.type === 'wordRemoved') {
      removeHighlightForWord(request.word);
    }
  }

  // Listen for storage changes (settings saved from popup)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) {
      const newSettings = changes.settings.newValue;
      if (newSettings) {
        // Raw storage value -- strip the keys before it lands in page context.
        settings = withoutKeys({ ...DEFAULT_SETTINGS, ...newSettings });
        applyHighlightColor();
        if (settings.enabled) {
          highlightCollectedWords();
        } else {
          removeAllHighlights();
        }
      }
    }
  });

  // --- Settings ---

  // The highlight mark is a background image, and an SVG inside one can't
  // inherit currentColor -- so the color is baked into the data URI.
  function noodleWaveUrl(color) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="8" viewBox="0 0 16 8">'
      + '<path d="M0 4 Q 4 2 8 4 T 16 4" fill="none" stroke="' + color + '" '
      + 'stroke-width="2" stroke-linecap="round"/></svg>';
    return 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  }

  // Nothing else sets these, so without this the popup's color picker never
  // reaches the page. Both values go into page context, so the color is
  // validated as a hex literal rather than trusted as-is.
  function applyHighlightColor() {
    const stored = settings.highlightColor || '';
    const color = /^#[0-9a-f]{3,8}$/i.test(stored) ? stored : DEFAULT_SETTINGS.highlightColor;
    const root = document.documentElement.style;
    root.setProperty('--wp-highlight-color', color);
    root.setProperty('--wp-noodle-wave', noodleWaveUrl(color));
  }

  async function getSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getSettings' }, (res) => {
        resolve(res && res.success ? res.data : settings);
      });
    });
  }

  // --- Translation Popup ---

  function onMouseUp(e) {
    if (!settings.enabled) return;
    // Ignore clicks inside our popup
    if (e.target.closest('.wp-popup')) return;

    // Click on a highlighted word: show popup to uncollect
    const highlightEl = e.target.closest('.wp-highlight');
    if (highlightEl && highlightEl.dataset.wpWord) {
      if (currentPopup) dismissPopup();
      showHighlightPopup(highlightEl.dataset.wpWord, highlightEl.getBoundingClientRect());
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // Remove existing popup if clicking outside (also cancels pending translation)
    if (currentPopup) {
      dismissPopup();
      return;
    }

    if (!selectedText || selectedText.length === 0) return;
    if (selectedText.length > MAX_ANALYZE_CHARS) return;
    if (isMostlyJapanese(selectedText)) {
      requestTranslation(selectedText, selection, 'ja');
      return;
    }
    if (isMostlyKorean(selectedText)) {
      requestTranslation(selectedText, selection, 'ko');
      return;
    }
    if (isMostlyVietnamese(selectedText)) {
      requestTranslation(selectedText, selection, 'vi');
      return;
    }
    if (isMostlyItalian(selectedText)) {
      requestTranslation(selectedText, selection, 'it');
      return;
    }
    if (isMostlySpanish(selectedText)) {
      requestTranslation(selectedText, selection, 'es');
      return;
    }
    if (isMostlyEnglish(selectedText)) {
      // Latin-script text (English, Spanish, Portuguese, French, German, etc.)
      // can't be reliably told apart by characters alone (e.g. "hola" vs "hello").
      // Let the translation engine auto-detect instead of assuming English.
      requestTranslation(selectedText, selection, 'auto');
      return;
    }
    if (settings.enableZhToEn && isMostlyChinese(selectedText)) {
      requestTranslation(selectedText, selection, 'zh-CN');
      return;
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && currentPopup) {
      dismissPopup();
      window.getSelection().removeAllRanges();
    }
  }

  function isMostlyEnglish(text) {
    const englishChars = text.match(/[a-zA-Z]/g) || [];
    const ratio = englishChars.length / text.length;
    return ratio > 0.6;
  }

  function isMostlyChinese(text) {
    const chineseChars = text.match(/[一-鿿㐀-䶿豈-﫿　-〿＀-￯]/g) || [];
    const ratio = chineseChars.length / text.length;
    return ratio > 0.4;
  }

  function isMostlyJapanese(text) {
    // Hiragana (぀-ゟ) and Katakana (゠-ヿ) are unique to Japanese
    const kanaChars = text.match(/[぀-ゟ゠-ヿ]/g) || [];
    const ratio = kanaChars.length / text.length;
    return ratio > 0.15;
  }

  function isMostlyKorean(text) {
    // Hangul syllables (가-힣) and Hangul Jamo
    const koreanChars = text.match(/[가-힯ᄀ-ᇿ]/g) || [];
    const ratio = koreanChars.length / text.length;
    return ratio > 0.3;
  }

  function isMostlyVietnamese(text) {
    // Vietnamese-specific characters: tone-marked vowels (U+1EA0-1EF9),
    // đ (U+0111), ơ (U+01A1), ư (U+01B0)
    const viChars = text.match(/[Ạ-ỹđơư]/g) || [];
    const ratio = viChars.length / text.length;
    return ratio > 0.08;
  }

  function isMostlyItalian(text) {
    // Italian accented vowels: àèéìòóù (U+00E0, U+00E8, U+00E9, U+00EC, U+00F2, U+00F9)
    const itChars = text.match(/[àèéìòù]/g) || [];
    const ratio = itChars.length / text.length;
    return ratio > 0.03;
  }

  function isMostlySpanish(text) {
    // Spanish-only characters: ñ/Ñ (U+00F1/00D1), ¿ (U+00BF), ¡ (U+00A1).
    // Accented vowels á é í ó ú ü and their caps are shared with other Latin
    // languages, so rely on the strong markers; anything else falls through
    // to 'auto' so the translation engine detects the language.
    const esChars = text.match(/[ñÑ¿¡]/g) || [];
    return esChars.length > 0;
  }

  async function requestTranslation(text, selection, sourceLang) {
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Store selected text for AI context
    selectedTextForAsk = text;
    conversationHistory = []; // Reset conversation when new selection

    // Capture request ID to prevent stale callbacks from recreating popup
    const requestId = ++translationRequestId;

    // Long selections skip translation -- but the panel still opens, otherwise the
    // English analysis below would be unreachable for exactly the passages it suits.
    if (text.length > MAX_TRANSLATE_CHARS) {
      showPopup(text, `（${text.length} 字符，已跳过翻译）`, rect, false);
      return;
    }

    // Show loading popup
    showPopup(text, null, rect, true);

    chrome.runtime.sendMessage({ type: 'translate', text, targetLang: settings.targetLang, sourceLang: sourceLang }, (res) => {
      // Discard stale response if popup was dismissed or a newer translation started
      if (requestId !== translationRequestId) return;

      if (res && res.success) {
        showPopup(text, res.data.translatedText, rect, false);
      } else {
        const errMsg = (res && res.error) ? res.error : '翻译失败，请重试';
        showPopup(text, '❌ ' + errMsg, rect, false);
      }
    });
  }

  async function showPopup(originalText, translation, rect, loading) {
    // Check if word is already collected BEFORE removing old popup,
    // so there's no async gap between removePopup() and setting currentPopup.
    let isCollected = false;
    let existingNote = '';
    if (!loading) {
      const collectedEntry = await checkIfCollected(originalText);
      if (collectedEntry) {
        isCollected = true;
        existingNote = collectedEntry.note || '';
      }
    }

    // Now synchronously replace the popup — no await between remove and create
    removePopup();

    const showAsk = settings.enableAsk && settings.deepseekApiKey && !loading;
    // English only -- judging the CEFR level of a Chinese passage is meaningless.
    const showAnalyze = settings.enableAnalyze && settings.typesafeApiKey
      && !loading && isMostlyEnglish(originalText);
    // The collection is a word list; keep 3000-char passages out of it even though
    // the raised selection gate now lets them reach this popup.
    const showFooter = !loading && originalText.length <= MAX_TRANSLATE_CHARS;

    const popup = document.createElement('div');
    popup.className = 'wp-popup';
    popup.innerHTML = `
      <div class="wp-popup-header">
        <span class="wp-popup-word">${escapeHtml(originalText)}</span>
      </div>
      <div class="wp-popup-translation">${loading ? '<span class="wp-loading"></span> 翻译中...' : escapeHtml(translation || '')}</div>
      <div class="wp-popup-note-display" ${existingNote ? '' : 'style="display:none"'} title="注释"><span class="wp-note-text">${escapeHtml(existingNote)}</span><button class="wp-note-delete" title="删除注释">×</button></div>
      <div class="wp-popup-note-area" style="display:none;">
        <div class="wp-note-editor">
          <input type="text" class="wp-note-input" maxlength="30" placeholder="添加注释..." value="${escapeHtml(existingNote)}">
          <button class="wp-note-confirm" title="确认">✓</button>
          <button class="wp-note-cancel" title="取消">✗</button>
        </div>
      </div>
      ${showAsk ? `
      <div class="wp-ask-section">
        <div class="wp-ask-toggle" id="wpAskToggle">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>AI 提问</span>
        </div>
        <div class="wp-ask-body" style="display:none;">
          <div class="wp-ask-answer" id="wpAskAnswer" style="display:none;"></div>
          <div class="wp-ask-input-row">
            <input type="text" class="wp-ask-input" id="wpAskInput" maxlength="500" placeholder="对这段内容提问...">
            <button class="wp-ask-send" id="wpAskSend" title="发送">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      ` : ''}
      ${showAnalyze ? `
      <div class="wp-analyze-section">
        <div class="wp-analyze-toggle" id="wpAnalyzeToggle">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
          </svg>
          <span>英语判定</span>
        </div>
        <div class="wp-analyze-body" style="display:none;">
          <div class="wp-analyze-result" id="wpAnalyzeResult" style="display:none;"></div>
        </div>
      </div>
      ` : ''}
      <div class="wp-popup-footer">
        ${showFooter ? `<button class="wp-collect-btn ${isCollected ? 'wp-collected' : ''}" title="${isCollected ? '取消收藏' : '收藏'}">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="${isCollected ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="wp-note-btn ${existingNote ? 'wp-has-note' : ''}" title="添加注释">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>` : ''}
      </div>
    `;

    // Position popup
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    let top = rect.bottom + scrollTop + 8;
    let left = rect.left + scrollLeft;

    popup.style.position = 'absolute';
    popup.style.top = `${top}px`;
    popup.style.left = `${left}px`;
    popup.style.zIndex = '2147483647';

    document.body.appendChild(popup);
    currentPopup = popup;

    // Adjust position if popup overflows viewport
    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) {
      left = left - (popupRect.right - window.innerWidth) - 10;
      popup.style.left = `${left}px`;
    }
    if (popupRect.bottom > window.innerHeight) {
      top = rect.top + scrollTop - popupRect.height - 8;
      popup.style.top = `${top}px`;
    }

    // Get references
    const noteBtn = popup.querySelector('.wp-note-btn');
    const noteArea = popup.querySelector('.wp-popup-note-area');
    const noteDisplay = popup.querySelector('.wp-popup-note-display');
    const noteInput = popup.querySelector('.wp-note-input');
    const noteConfirm = popup.querySelector('.wp-note-confirm');
    const noteCancel = popup.querySelector('.wp-note-cancel');

    function updateNoteDisplay() {
      const hasNote = !!existingNote;
      noteBtn && noteBtn.classList.toggle('wp-has-note', hasNote);
      if (noteDisplay) {
        const noteText = noteDisplay.querySelector('.wp-note-text');
        if (noteText) noteText.textContent = existingNote;
        noteDisplay.style.display = hasNote ? 'block' : 'none';
      }
    }

    function getEditorNote() {
      return noteInput ? noteInput.value.trim() : '';
    }

    function saveNoteToCollection(note) {
      existingNote = note;
      updateNoteDisplay();
      chrome.runtime.sendMessage({ type: 'updateWordNote', word: originalText, note: note });
    }

    // Collect button handler
    const collectBtn = popup.querySelector('.wp-collect-btn');
    if (collectBtn) {
      collectBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        // Auto-save note from editor if it's open
        if (noteArea && noteArea.style.display !== 'none') {
          const editorNote = getEditorNote();
          saveNoteToCollection(editorNote);
          noteArea.style.display = 'none';
        }
        if (collectBtn.classList.contains('wp-collected')) {
          await removeWord(originalText);
          collectBtn.classList.remove('wp-collected');
          collectBtn.querySelector('svg').setAttribute('fill', 'none');
          removeHighlightForWord(originalText);
        } else {
          await collectWord(originalText, translation, existingNote);
          collectBtn.classList.add('wp-collected');
          collectBtn.querySelector('svg').setAttribute('fill', 'currentColor');
          highlightWordInPage(originalText, { animate: true });
        }
      });
    }

    // Note button handler
    if (noteBtn && noteArea) {
      noteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        noteArea.style.display = 'block';
        noteInput.focus();
        noteInput.select();
      });
    }

    function closeNoteEditor(save) {
      noteArea.style.display = 'none';
      if (save) {
        saveNoteToCollection(noteInput.value.trim());
      }
    }

    if (noteConfirm) {
      noteConfirm.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNoteEditor(true);
      });
    }

    if (noteCancel) {
      noteCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNoteEditor(false);
      });
    }

    if (noteInput) {
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          closeNoteEditor(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeNoteEditor(false);
        }
      });
    }

    // Note delete button handler
    const noteDeleteBtn = popup.querySelector('.wp-note-delete');
    if (noteDeleteBtn) {
      noteDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveNoteToCollection('');
      });
    }

    // --- Ask AI Section ---
    setupAskSection(popup, originalText);

    // --- English Analysis Section ---
    setupAnalyzeSection(popup, originalText);
  }

  function setupAskSection(popup, originalText) {
    const askToggle = popup.querySelector('#wpAskToggle');
    const askBody = popup.querySelector('.wp-ask-body');
    const askInput = popup.querySelector('#wpAskInput');
    const askSend = popup.querySelector('#wpAskSend');
    const askAnswer = popup.querySelector('#wpAskAnswer');

    if (!askToggle || !askBody) return;

    let askExpanded = false;

    askToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      askExpanded = !askExpanded;
      askBody.style.display = askExpanded ? 'block' : 'none';
      askToggle.classList.toggle('wp-ask-expanded', askExpanded);
      if (askExpanded) {
        askInput.focus();
      }
    });

    async function submitQuestion() {
      const question = askInput.value.trim();
      if (!question) return;

      // Show loading in answer area
      askAnswer.style.display = 'block';
      askAnswer.innerHTML = '<span class="wp-loading"></span> AI 思考中...';
      askAnswer.className = 'wp-ask-answer';
      askInput.value = '';
      askSend.disabled = true;
      askInput.disabled = true;

      try {
        const res = await sendAskRequest(question);
        if (res && res.success) {
          askAnswer.innerHTML = escapeHtml(res.data.answer);
          askAnswer.className = 'wp-ask-answer wp-ask-done';
        } else {
          askAnswer.innerHTML = '❌ ' + escapeHtml((res && res.error) || '请求失败');
          askAnswer.className = 'wp-ask-answer wp-ask-error';
        }
      } catch (err) {
        askAnswer.innerHTML = '❌ ' + escapeHtml(err.message || '网络错误');
        askAnswer.className = 'wp-ask-answer wp-ask-error';
      } finally {
        askSend.disabled = false;
        askInput.disabled = false;
        askInput.focus();
      }
    }

    // Send button click
    askSend.addEventListener('click', (e) => {
      e.stopPropagation();
      submitQuestion();
    });

    // Enter to send
    askInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitQuestion();
      }
      // Don't close popup on Escape when typing in ask input
      if (e.key === 'Escape') {
        e.stopPropagation();
      }
    });
  }

  // --- English Analysis Section (TypeSafe / Jev) ---

  // Map Jev's fractional score onto a CEFR band, hinting when it leans to a neighbour.
  // Same logic as jev-study/study.py:cefr_label().
  function cefrLabel(score) {
    const index = Math.min(Math.max(Math.round(score), 0), CEFR.length - 1);
    const offset = score - index;
    if (offset >= 0.25 && index + 1 < CEFR.length) return CEFR[index] + ' 偏 ' + CEFR[index + 1];
    if (offset <= -0.25 && index - 1 >= 0) return CEFR[index] + ' 偏 ' + CEFR[index - 1];
    return CEFR[index];
  }

  function analyzeRow(label, value, confidence) {
    const warn = (typeof confidence === 'number' && confidence < CONFIDENCE_FLOOR)
      ? ' <span class="wp-analyze-flag">⚠</span>'
      : '';
    return `<div class="wp-analyze-row">
        <span class="wp-analyze-label">${label}</span>
        <span class="wp-analyze-value">${escapeHtml(value)}${warn}</span>
      </div>`;
  }

  function renderAnalysis(result) {
    // The noul primitive returns only a probability, no confidence -- the number
    // speaks for itself, so that row carries no flag.
    const casual = result.casual >= 0.5 ? '是' : '否';
    const feature = FEATURE_LABELS[result.feature] || result.feature;
    return analyzeRow('日常口语?', casual + ' · ' + result.casual.toFixed(2)) +
      analyzeRow('CEFR 难度', cefrLabel(result.score) + ' · ' + result.scoreConfidence.toFixed(2), result.scoreConfidence) +
      analyzeRow('最值得学', feature + ' · ' + result.featureConfidence.toFixed(2), result.featureConfidence);
  }

  function setupAnalyzeSection(popup, originalText) {
    const toggle = popup.querySelector('#wpAnalyzeToggle');
    const body = popup.querySelector('.wp-analyze-body');
    const result = popup.querySelector('#wpAnalyzeResult');

    if (!toggle || !body) return;

    let expanded = false;
    let analyzed = false;

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      expanded = !expanded;
      body.style.display = expanded ? 'block' : 'none';
      toggle.classList.toggle('wp-analyze-expanded', expanded);

      // Analyze once per popup -- re-expanding shouldn't spend another call.
      if (expanded && !analyzed) {
        analyzed = true;
        runAnalysis(result, originalText);
      }
    });
  }

  async function runAnalysis(result, text) {
    // Same stale-guard the translation path uses: drop the result if this popup
    // was dismissed or replaced while the request was in flight.
    const requestId = translationRequestId;

    result.style.display = 'block';
    result.className = 'wp-analyze-result';
    result.innerHTML = '<span class="wp-loading"></span> 分析中...';

    try {
      const res = await sendAnalyzeRequest(text);
      if (requestId !== translationRequestId) return;

      if (res && res.success) {
        result.innerHTML = renderAnalysis(res.data);
      } else {
        result.innerHTML = '❌ ' + escapeHtml((res && res.error) || '判定失败');
        result.className = 'wp-analyze-result wp-analyze-error';
      }
    } catch (err) {
      if (requestId !== translationRequestId) return;
      result.innerHTML = '❌ ' + escapeHtml(err.message || '网络错误');
      result.className = 'wp-analyze-result wp-analyze-error';
    }
  }

  function sendAnalyzeRequest(text) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'analyzeEnglish', text: text }, (res) => {
        resolve(res || { success: false, error: '无响应' });
      });
    });
  }

  function sendAskRequest(question) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: 'askQuestion',
          text: selectedTextForAsk,
          question: question,
          conversationHistory: conversationHistory.length > 0 ? conversationHistory : undefined
        },
        (res) => {
          if (res && res.success) {
            // Save to conversation history
            conversationHistory.push(
              { role: 'user', content: question },
              { role: 'assistant', content: res.data.answer }
            );
            // Keep history manageable (last 10 messages = 5 turns)
            if (conversationHistory.length > 10) {
              conversationHistory = conversationHistory.slice(-10);
            }
            resolve(res);
          } else {
            resolve(res);
          }
        }
      );
    });
  }

  function removePopup() {
    if (currentPopup) {
      currentPopup.remove();
      currentPopup = null;
    }
  }

  // Dismiss popup and cancel any pending translation request
  function dismissPopup() {
    translationRequestId++; // Invalidate pending async translation callbacks
    removePopup();
  }

  // --- Highlighted Word Popup (click to uncollect) ---
  async function showHighlightPopup(wordKey, rect) {
    const words = await getCollectedWords();
    const entry = words.find(w => w.word.toLowerCase() === wordKey.toLowerCase());
    if (!entry) return;

    let existingNote = entry.note || '';
    selectedTextForAsk = entry.word;
    conversationHistory = [];

    const showAsk = settings.enableAsk && settings.deepseekApiKey;

    const popup = document.createElement('div');
    popup.className = 'wp-popup';
    popup.innerHTML = `
      <div class="wp-popup-header">
        <span class="wp-popup-word">${escapeHtml(entry.word)}</span>
      </div>
      <div class="wp-popup-translation">${escapeHtml(entry.translation)}</div>
      <div class="wp-popup-note-display" ${existingNote ? '' : 'style="display:none"'} title="注释"><span class="wp-note-text">${escapeHtml(existingNote)}</span><button class="wp-note-delete" title="删除注释">×</button></div>
      <div class="wp-popup-note-area" style="display:none;">
        <div class="wp-note-editor">
          <input type="text" class="wp-note-input" maxlength="30" placeholder="添加注释..." value="${escapeHtml(existingNote)}">
          <button class="wp-note-confirm" title="确认">✓</button>
          <button class="wp-note-cancel" title="取消">✗</button>
        </div>
      </div>
      ${showAsk ? `
      <div class="wp-ask-section">
        <div class="wp-ask-toggle" id="wpAskToggle">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span>AI 提问</span>
        </div>
        <div class="wp-ask-body" style="display:none;">
          <div class="wp-ask-answer" id="wpAskAnswer" style="display:none;"></div>
          <div class="wp-ask-input-row">
            <input type="text" class="wp-ask-input" id="wpAskInput" maxlength="500" placeholder="对这个词提问...">
            <button class="wp-ask-send" id="wpAskSend" title="发送">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
      ` : ''}
      <div class="wp-popup-footer">
        <button class="wp-collect-btn wp-collected" title="取消收藏">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="currentColor" stroke-width="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>
        <button class="wp-note-btn ${existingNote ? 'wp-has-note' : ''}" title="添加注释">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
        </button>
      </div>
    `;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    let top = rect.bottom + scrollTop + 8;
    let left = rect.left + scrollLeft;

    popup.style.position = 'absolute';
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
    popup.style.zIndex = '2147483647';

    document.body.appendChild(popup);
    currentPopup = popup;

    const popupRect = popup.getBoundingClientRect();
    if (popupRect.right > window.innerWidth) {
      left = left - (popupRect.right - window.innerWidth) - 10;
      popup.style.left = left + 'px';
    }
    if (popupRect.bottom > window.innerHeight) {
      top = rect.top + scrollTop - popupRect.height - 8;
      popup.style.top = top + 'px';
    }

    // Get references
    const noteBtn = popup.querySelector('.wp-note-btn');
    const noteArea = popup.querySelector('.wp-popup-note-area');
    const noteDisplay = popup.querySelector('.wp-popup-note-display');
    const noteInput = popup.querySelector('.wp-note-input');
    const noteConfirm = popup.querySelector('.wp-note-confirm');
    const noteCancel = popup.querySelector('.wp-note-cancel');

    function updateNoteDisplay() {
      const hasNote = !!existingNote;
      noteBtn && noteBtn.classList.toggle('wp-has-note', hasNote);
      if (noteDisplay) {
        const noteText = noteDisplay.querySelector('.wp-note-text');
        if (noteText) noteText.textContent = existingNote;
        noteDisplay.style.display = hasNote ? 'block' : 'none';
      }
    }

    function saveNoteToCollection(note) {
      existingNote = note;
      updateNoteDisplay();
      chrome.runtime.sendMessage({ type: 'updateWordNote', word: entry.word, note: note });
    }

    // Uncollect button
    const btn = popup.querySelector('.wp-collect-btn');
    if (btn) {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeWord(entry.word);
        removeHighlightForWord(entry.word);
        removePopup();
      });
    }

    // Note button handler
    if (noteBtn && noteArea) {
      noteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        noteArea.style.display = 'block';
        noteInput.focus();
        noteInput.select();
      });
    }

    function closeNoteEditor(save) {
      noteArea.style.display = 'none';
      if (save) {
        saveNoteToCollection(noteInput.value.trim());
      }
    }

    if (noteConfirm) {
      noteConfirm.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNoteEditor(true);
      });
    }

    if (noteCancel) {
      noteCancel.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNoteEditor(false);
      });
    }

    if (noteInput) {
      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          closeNoteEditor(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeNoteEditor(false);
        }
      });
    }

    // Note delete button handler
    const noteDeleteBtn = popup.querySelector('.wp-note-delete');
    if (noteDeleteBtn) {
      noteDeleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        saveNoteToCollection('');
      });
    }

    // --- Ask AI Section ---
    setupAskSection(popup, entry.word);
  }

  // --- Word Collection ---

  async function checkIfCollected(word) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'checkWord', word }, (res) => {
        resolve(res && res.success ? res.data : null);
      });
    });
  }

  async function collectWord(word, translation, note) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        type: 'addWord',
        word,
        translation,
        sourceUrl: window.location.href,
        note: note || ''
      }, () => resolve());
    });
  }

  async function removeWord(word) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'removeWord', word }, () => resolve());
    });
  }

  // --- Highlight Collected Words ---

  async function highlightCollectedWords() {
    const words = await getCollectedWords();
    if (!words || words.length === 0) return;

    // Debounce to avoid excessive DOM manipulation
    if (window.__wpHighlightTimer) clearTimeout(window.__wpHighlightTimer);
    window.__wpHighlightTimer = setTimeout(() => {
      for (const entry of words) {
        highlightWordInPage(entry.word);
      }
    }, 300);
  }

  function highlightWordInPage(word, opts) {
    if (!word || word.length === 0) return;

    // Only the collect action asks for the draw-in, so a page load with
    // hundreds of existing highlights stays still.
    const animate = !!(opts && opts.animate);
    let freshIndex = 0;

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip our own popup and already-highlighted spans
          if (node.parentElement && node.parentElement.closest('.wp-popup')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && node.parentElement.classList.contains('wp-highlight')) return NodeFilter.FILTER_REJECT;
          if (node.parentElement && (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE')) return NodeFilter.FILTER_REJECT;
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    const isSingleWord = /^\w+$/.test(word);
    const pattern = isSingleWord
      ? new RegExp(`\\b(${escapeRegExp(word)})\\b`, 'gi')
      : new RegExp(`(${escapeRegExp(word)})`, 'gi');

    for (const node of textNodes) {
      const text = node.textContent;
      if (!pattern.test(text)) continue;

      pattern.lastIndex = 0; // Reset regex
      const frag = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = pattern.exec(text)) !== null) {
        // Text before match
        if (match.index > lastIndex) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }
        // Highlighted match
        const span = document.createElement('span');
        span.className = 'wp-highlight';
        span.textContent = match[1];
        span.dataset.wpWord = match[1].toLowerCase();
        span.title = '已收藏词汇 - 点击查看翻译';
        if (animate) markFreshNoodle(span, freshIndex++);
        frag.appendChild(span);

        lastIndex = pattern.lastIndex;
      }

      // Remaining text
      if (lastIndex < text.length) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      if (frag.childNodes.length > 0) {
        node.parentNode.replaceChild(frag, node);
      }
    }

    // Add hover listeners for highlighted words
    document.querySelectorAll('.wp-highlight').forEach(el => {
      if (!el.__wpHoverBound) {
        el.__wpHoverBound = true;
        el.addEventListener('mouseenter', onHighlightHover);
        el.addEventListener('mouseleave', onHighlightLeave);
      }
    });
  }

  // Draw the noodle under a word that was just collected. The class hands the
  // mark over to the ::after overlay in content/index.css; dropping it on
  // animationend swaps back to the static background at identical pixels.
  function markFreshNoodle(span, index) {
    // Honour the OS setting. Without the animation the overlay would never
    // finish and the class would stick, so leave the static mark alone.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // Repeated occurrences cascade instead of flashing at once.
    span.style.setProperty('--wp-noodle-delay', Math.min(index, 6) * 0.04 + 's');
    span.classList.add('wp-highlight--fresh');

    const restore = () => span.classList.remove('wp-highlight--fresh');
    span.addEventListener('animationend', restore, { once: true });
    // Backstop: the class suppresses the static mark, so it must come off even
    // if the animation never runs (backgrounded tab, throttled rendering).
    setTimeout(restore, 1200);
  }

  async function onHighlightHover(e) {
    const word = e.target.dataset.wpWord;
    if (!word) return;

    // Check if there's already a tooltip
    if (e.target.querySelector('.wp-tooltip')) return;

    const words = await getCollectedWords();
    const entry = words.find(w => w.word.toLowerCase() === word.toLowerCase());
    if (!entry) return;

    const tooltip = document.createElement('span');
    tooltip.className = 'wp-tooltip';
    tooltip.textContent = entry.translation;
    e.target.appendChild(tooltip);
  }

  function onHighlightLeave(e) {
    const tooltip = e.target.querySelector('.wp-tooltip');
    if (tooltip) tooltip.remove();
  }

  function removeHighlightForWord(word) {
    const normalisedKey = word.toLowerCase();
    document.querySelectorAll(`.wp-highlight[data-wp-word="${CSS.escape(normalisedKey)}"]`).forEach(el => {
      const textNode = document.createTextNode(el.textContent.replace(/\n/g, ''));
      el.parentNode.replaceChild(textNode, el);
    });
  }

  function removeAllHighlights() {
    document.querySelectorAll('.wp-highlight').forEach(el => {
      const textNode = document.createTextNode(el.textContent);
      el.parentNode.replaceChild(textNode, el);
    });
  }

  // --- Observe DOM changes (async / SPA content) ---
  // Pages that load content after the initial render (async fetch, SPA routing)
  // need a re-scan when new nodes appear. Debounced to keep the cost low.
  // highlightWordInPage() skips already-wrapped nodes, so re-scans converge
  // and never double-highlight.
  function observeDomChanges() {
    if (window.__wpMutationObserver) return;
    const observer = new MutationObserver(() => {
      if (window.__wpRescanTimer) clearTimeout(window.__wpRescanTimer);
      window.__wpRescanTimer = setTimeout(() => {
        if (settings.enabled) highlightCollectedWords();
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__wpMutationObserver = observer;
  }

  async function getCollectedWords() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getWords' }, (res) => {
        resolve(res && res.success ? res.data : []);
      });
    });
  }

  // --- Utilities ---

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // --- Start ---
  init();
})();
