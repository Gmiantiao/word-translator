// Popup Script for WordPicker

document.addEventListener('DOMContentLoaded', async () => {
  const toggleEnabled = document.getElementById('toggleEnabled');
  const totalCount = document.getElementById('totalCount');
  const weekCount = document.getElementById('weekCount');
  const searchInput = document.getElementById('searchInput');
  const wordList = document.getElementById('wordList');
  const emptyState = document.getElementById('emptyState');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsPanel = document.getElementById('settingsPanel');
  const targetLang = document.getElementById('targetLang');
  const highlightColor = document.getElementById('highlightColor');
  const clearAll = document.getElementById('clearAll');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadLabel = document.getElementById('downloadLabel');
  const downloadHint = document.getElementById('downloadHint');
  const selectBar = document.getElementById('selectBar');
  const selectAll = document.getElementById('selectAll');
  const selectCount = document.getElementById('selectCount');
  const translateEngine = document.getElementById('translateEngine');
  const deepseekApiKey = document.getElementById('deepseekApiKey');
  const deepseekKeyRow = document.getElementById('deepseekKeyRow');
  const enableZhToEn = document.getElementById('enableZhToEn');
  const enableAsk = document.getElementById('enableAsk');

  const viewAllBar = document.getElementById('viewAllBar');
  const viewAllBtn = document.getElementById('viewAllBtn');
  const viewAllCount = document.getElementById('viewAllCount');
  const testDeepseekBtn = document.getElementById('testDeepseekBtn');
  const deepseekHint = document.getElementById('deepseekHint');

  let allWords = [];
  let selectedWords = new Set(); // tracks selected word text (lowercase)
  let currentSettings = {};

  // --- Load Settings ---
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getSettings' }, (res) => {
        if (res && res.success) {
          const s = res.data;
          currentSettings = s;
          toggleEnabled.checked = s.enabled;
          targetLang.value = s.targetLang || 'zh-CN';
          highlightColor.value = s.highlightColor || '#7C3AED';
          translateEngine.value = s.translateEngine || 'google';
          deepseekApiKey.value = s.deepseekApiKey || '';
          enableZhToEn.checked = s.enableZhToEn || false;
          enableAsk.checked = s.enableAsk !== false;
          deepseekKeyRow.style.display = (translateEngine.value === 'deepseek') ? 'flex' : 'none';
        }
        resolve();
      });
    });
  }

  // --- Load Words ---
  async function loadWords() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getWords' }, (res) => {
        if (res && res.success) {
          allWords = res.data || [];
        } else {
          allWords = [];
        }
        // Remove selections for words that no longer exist
        const validKeys = new Set(allWords.map(w => w.word.toLowerCase()));
        for (const key of selectedWords) {
          if (!validKeys.has(key)) selectedWords.delete(key);
        }
        renderStats();
        renderWordList(allWords);
        updateSelectUI();
        updateDownloadLabel();
        resolve();
      });
    });
  }

  // --- Render Stats ---
  function renderStats() {
    totalCount.textContent = allWords.length;
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const thisWeek = allWords.filter(w => w.addedAt >= oneWeekAgo).length;
    weekCount.textContent = thisWeek;
  }

  // --- Render Word List ---
  function renderWordList(words) {
    const existing = wordList.querySelectorAll('.word-item');
    existing.forEach(el => el.remove());

    if (words.length === 0) {
      emptyState.style.display = 'flex';
      selectBar.style.display = 'none';
      viewAllBar.style.display = 'none';
      return;
    }

    emptyState.style.display = 'none';
    selectBar.style.display = 'flex';

    const sorted = [...words].sort((a, b) => b.addedAt - a.addedAt);

    // Show only 5 most recent in popup; show "View All" if more exist
    const MAX_POPUP_ITEMS = 5;
    const displayItems = sorted.slice(0, MAX_POPUP_ITEMS);
    viewAllCount.textContent = sorted.length;
    viewAllBar.style.display = sorted.length > MAX_POPUP_ITEMS ? 'block' : 'none';

    for (const entry of displayItems) {
      const key = entry.word.toLowerCase();
      const isChecked = selectedWords.has(key);

      // Source URL link
      let wordTextHtml = `<span class="word-text">${escapeHtml(entry.word)}</span>`;
      let sourceHtml = '';
      let noteHtml = '';
      if (entry.sourceUrl) {
        let domain = extractDomain(entry.sourceUrl);
        wordTextHtml = `<span class="word-text"><a class="word-link" title="打开来源网页" data-url="${escapeAttr(entry.sourceUrl)}">${escapeHtml(entry.word)}</a></span>`;
        sourceHtml = `<span class="word-source" title="${escapeHtml(entry.sourceUrl)}">${escapeHtml(domain)}</span>`;
      }
      if (entry.note) {
        noteHtml = `<span class="word-note" data-word="${escapeHtml(key)}">
          <span class="word-note-text">${escapeHtml(entry.note)}</span>
          <button class="word-note-edit-btn" title="编辑注释">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="word-note-del-btn" title="删除注释">×</button>
        </span>`;
      } else {
        noteHtml = `<span class="word-note word-note-empty" data-word="${escapeHtml(key)}">
          <button class="word-note-add-btn" title="添加注释">+ 注释</button>
        </span>`;
      }

      const item = document.createElement('div');
      item.className = 'word-item';
      item.innerHTML = `
        <label class="word-checkbox">
          <input type="checkbox" data-word="${escapeHtml(key)}" ${isChecked ? 'checked' : ''}>
          <span class="checkbox-custom"></span>
        </label>
        <div class="word-info">
          ${wordTextHtml}
          <span class="word-translation">${escapeHtml(entry.translation)}</span>
          <div class="word-meta">
            ${sourceHtml}
            ${noteHtml}
          </div>
        </div>
        <button class="word-delete" data-word="${escapeHtml(key)}" title="删除">×</button>
      `;
      wordList.appendChild(item);
    }

    // Delete handlers
    wordList.querySelectorAll('.word-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.dataset.word;
        selectedWords.delete(key);
        await removeWordByKey(key);
        await loadWords();
      });
    });

    // Word link click handlers
    wordList.querySelectorAll('.word-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = link.dataset.url;
        if (url) {
          chrome.tabs.create({ url });
        }
      });
    });

    // Checkbox handlers
    wordList.querySelectorAll('.word-checkbox input').forEach(cb => {
      cb.addEventListener('change', () => {
        const key = cb.dataset.word;
        if (cb.checked) {
          selectedWords.add(key);
        } else {
          selectedWords.delete(key);
        }
        updateSelectUI();
        updateDownloadLabel();
      });
    });

    // Note edit button handlers
    wordList.querySelectorAll('.word-note-edit-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const noteEl = btn.closest('.word-note');
        startNoteEdit(noteEl);
      });
    });

    // Note delete button handlers
    wordList.querySelectorAll('.word-note-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.closest('.word-note').dataset.word;
        await updateWordNoteByKey(key, '');
        await loadWords();
      });
    });

    // Note add button handlers (for words without notes)
    wordList.querySelectorAll('.word-note-add-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const noteEl = btn.closest('.word-note');
        startNoteEdit(noteEl);
      });
    });
  }

  // Start inline note editing
  function startNoteEdit(noteEl) {
    const key = noteEl.dataset.word;
    const word = allWords.find(w => w.word.toLowerCase() === key);
    if (!word) return;
    const currentNote = word.note || '';

    noteEl.classList.add('word-note-editing');
    noteEl.innerHTML = `
      <input type="text" class="word-note-input" value="${escapeHtml(currentNote)}" maxlength="30" placeholder="添加注释...">
      <button class="word-note-confirm" title="确认">✓</button>
      <button class="word-note-cancel" title="取消">✗</button>
    `;

    const input = noteEl.querySelector('.word-note-input');
    const confirmBtn = noteEl.querySelector('.word-note-confirm');
    const cancelBtn = noteEl.querySelector('.word-note-cancel');

    input.focus();
    input.select();

    async function finishEdit(save) {
      if (save) {
        const newNote = input.value.trim();
        await updateWordNoteByKey(key, newNote);
      }
      await loadWords();
    }

    confirmBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      finishEdit(true);
    });

    cancelBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      finishEdit(false);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finishEdit(true); }
      if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
    });
  }

  async function updateWordNoteByKey(key, note) {
    const word = allWords.find(w => w.word.toLowerCase() === key);
    if (!word) return;
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'updateWordNote', word: word.word, note: note }, () => resolve());
    });
  }

  // --- Select All ---
  selectAll.addEventListener('change', () => {
    if (selectAll.checked) {
      const visibleCbs = wordList.querySelectorAll('.word-checkbox input');
      visibleCbs.forEach(cb => {
        cb.checked = true;
        selectedWords.add(cb.dataset.word);
      });
    } else {
      const visibleCbs = wordList.querySelectorAll('.word-checkbox input');
      visibleCbs.forEach(cb => {
        cb.checked = false;
        selectedWords.delete(cb.dataset.word);
      });
    }
    updateSelectUI();
    updateDownloadLabel();
  });

  function updateSelectUI() {
    const visibleCbs = wordList.querySelectorAll('.word-checkbox input');
    const visibleCount = visibleCbs.length;
    const checkedVisible = [...visibleCbs].filter(cb => cb.checked).length;

    selectCount.textContent = '已选 ' + selectedWords.size + ' 项';
    selectAll.checked = visibleCount > 0 && checkedVisible === visibleCount;
    selectAll.indeterminate = checkedVisible > 0 && checkedVisible < visibleCount;
  }

  function getDownloadWords() {
    if (selectedWords.size === 0) {
      return allWords; // download all
    }
    return allWords.filter(w => selectedWords.has(w.word.toLowerCase()));
  }

  function updateDownloadLabel() {
    const count = selectedWords.size;
    if (count === 0) {
      downloadLabel.textContent = '下载全部';
    } else {
      downloadLabel.textContent = '下载已选 (' + count + ')';
    }
  }

  // --- Download as Word Document ---
  downloadBtn.addEventListener('click', async () => {
    const wordsToDownload = getDownloadWords();
    if (wordsToDownload.length === 0) {
      showHint('暂无收藏词汇', 'warning');
      return;
    }

    downloadBtn.disabled = true;
    downloadBtn.classList.add('loading');

    try {
      const html = buildWordHtml(wordsToDownload);
      const blob = new Blob(['\uFEFF' + html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toLocaleDateString('zh-CN').replace(/\//g, '-');
      a.download = '生词收藏_' + date + '.html';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showHint('已导出 ' + wordsToDownload.length + ' 个词汇', 'success');
    } catch (err) {
      console.error('导出失败:', err);
      showHint('导出失败，请重试', 'error');
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.classList.remove('loading');
    }
  });

  // --- Build Word HTML ---
  function buildWordHtml(words) {
    var dateStr = new Date().toLocaleDateString('zh-CN');
    var total = words.length;

    var rows = words.map(function(w, i) {
      var dt = new Date(w.addedAt).toLocaleDateString('zh-CN');
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#999;width:40px;">' + (i + 1) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#333;">' + h(w.word) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">' + h(w.translation) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#999;font-size:12px;white-space:nowrap;">' + dt + '</td>' +
      '</tr>';
    }).join('');

    return '<!DOCTYPE html>\n' +
'<html lang="zh-CN">\n' +
'<head>\n' +
'<meta charset="UTF-8">\n' +
'<title>生词收藏</title>\n' +
'<style>\n' +
'  body { font-family: "Microsoft YaHei", "PingFang SC", "Helvetica Neue", Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #333; }\n' +
'  h1 { text-align: center; color: #7C3AED; font-size: 24px; margin-bottom: 4px; }\n' +
'  .meta { text-align: center; color: #999; font-size: 13px; margin-bottom: 24px; }\n' +
'  table { width: 100%; border-collapse: collapse; border-top: 2px solid #7C3AED; border-bottom: 2px solid #7C3AED; }\n' +
'  th { padding: 10px 12px; background: #f8f4ff; color: #7C3AED; font-size: 14px; text-align: left; border-bottom: 1px solid #ddd; }\n' +
'  td { font-size: 14px; }\n' +
'  tr:nth-child(even) td { background: #fafafa; }\n' +
'  .footer { text-align: center; color: #ccc; font-size: 12px; margin-top: 24px; }\n' +
'</style>\n' +
'</head>\n' +
'<body>\n' +
'<h1>\u{1F4D6} \u751f\u8bcd\u6536\u85cf</h1>\n' +
'<p class="meta">\u5bfc\u51fa\u65f6\u95f4\uff1a' + dateStr + '\u3000\uff5c\u3000\u5171 ' + total + ' \u4e2a\u8bcd\u6c47</p>\n' +
'<table>\n' +
'<thead>\n' +
'<tr>\n' +
'  <th style="width:40px;text-align:center;">#</th>\n' +
'  <th>\u82f1\u6587</th>\n' +
'  <th>\u4e2d\u6587\u7ffb\u8bd1</th>\n' +
'  <th style="width:90px;">\u6536\u85cf\u65e5\u671f</th>\n' +
'</tr>\n' +
'</thead>\n' +
'<tbody>\n' +
rows + '\n' +
'</tbody>\n' +
'</table>\n' +
'<p class="footer">\u7531\u300c\u62fe\u8bcd\u300dChrome \u63d2\u4ef6\u5bfc\u51fa \u00b7 ' + dateStr + '</p>\n' +
'</body>\n' +
'</html>';
  }

  function h(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Show Hint ---
  function showHint(text, type) {
    downloadHint.textContent = text;
    downloadHint.className = 'download-hint ' + (type || '');
    downloadHint.style.display = 'inline';
    setTimeout(function() { downloadHint.style.display = 'none'; }, 3000);
  }

  // --- Search ---
  searchInput.addEventListener('input', function() {
    var query = searchInput.value.toLowerCase().trim();
    if (!query) {
      renderWordList(allWords);
      return;
    }
    var filtered = allWords.filter(function(w) {
      return w.word.toLowerCase().indexOf(query) !== -1 ||
             w.translation.toLowerCase().indexOf(query) !== -1;
    });
    renderWordList(filtered);
  });

  // --- Toggle Enabled ---
  toggleEnabled.addEventListener('change', async function() {
    await saveSettings({ enabled: toggleEnabled.checked });
  });

  // --- Settings Panel ---
  settingsToggle.addEventListener('click', function() {
    var isVisible = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = isVisible ? 'none' : 'block';
    settingsToggle.querySelector('.settings-arrow').style.transform = isVisible ? '' : 'rotate(90deg)';
  });

  // --- Settings Changes ---
  targetLang.addEventListener('change', function() { saveSettings({ targetLang: targetLang.value }); });
  highlightColor.addEventListener('input', function() { saveSettings({ highlightColor: highlightColor.value }); });
  translateEngine.addEventListener('change', function() {
    saveSettings({ translateEngine: translateEngine.value });
    deepseekKeyRow.style.display = (translateEngine.value === 'deepseek') ? 'flex' : 'none';
  });

  deepseekApiKey.addEventListener('input', function() {
    saveSettings({ deepseekApiKey: deepseekApiKey.value });
  });

  enableZhToEn.addEventListener('change', function() {
    saveSettings({ enableZhToEn: enableZhToEn.checked });
  });

  enableAsk.addEventListener('change', function() {
    saveSettings({ enableAsk: enableAsk.checked });
  });

  // --- Clear All ---
  clearAll.addEventListener('click', async function() {
    if (!confirm('确定要清空全部收藏吗？此操作不可撤销。')) return;
    for (var i = 0; i < allWords.length; i++) {
      await removeWord(allWords[i].word);
    }
    await loadWords();
  });

  // --- Helpers ---
  async function saveSettings(partial) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ type: 'saveSettings', settings: partial }, function() { resolve(); });
    });
  }

  async function removeWord(word) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage({ type: 'removeWord', word: word }, function() { resolve(); });
    });
  }

  async function removeWordByKey(key) {
    var word = allWords.find(function(w) { return w.word.toLowerCase() === key; });
    if (word) await removeWord(word.word);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function extractDomain(url) {
    try {
      var u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) {
      return url;
    }
  }

  // --- Notion Connection ---
  const notionStatus = document.getElementById('notionStatus');
  const openNotionSettings = document.getElementById('openNotionSettings');
  const syncBtn = document.getElementById('syncBtn');
  const notionHint = document.getElementById('notionHint');

  function showNotionHint(text, type) {
    notionHint.textContent = text;
    notionHint.className = 'notion-hint ' + (type || '');
    notionHint.style.display = 'block';
    setTimeout(function() { notionHint.style.display = 'none'; }, 4000);
  }

  async function loadNotionStatus() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getNotionStatus' }, (res) => {
        if (res && res.success && res.data.notionReady) {
          notionStatus.textContent = '✅ 已连接';
          notionStatus.className = 'notion-status connected';
          syncBtn.style.display = '';
        } else {
          notionStatus.textContent = '未连接';
          notionStatus.className = 'notion-status';
          syncBtn.style.display = 'none';
        }
        resolve();
      });
    });
  }

  openNotionSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true;
    syncBtn.textContent = '同步中...';
    chrome.runtime.sendMessage({ type: 'syncAllToNotion' }, (res) => {
      syncBtn.disabled = false;
      syncBtn.textContent = '一键同步';
      if (res && res.success) {
        showNotionHint('✅ ' + res.synced + ' 成功，' + res.failed + ' 失败（共 ' + res.total + ' 条）', res.failed ? 'warning' : 'success');
      } else {
        showNotionHint('❌ 同步失败: ' + ((res && res.error) || '未知错误'), 'error');
      }
    });
  });

  // --- View All ---
  viewAllBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('words/index.html') });
  });

  // --- View Flashcard ---
  const viewFlashcardBtn = document.getElementById('viewFlashcardBtn');
  viewFlashcardBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('words/index.html') + '?mode=flashcard' });
  });

  // --- DeepSeek Test ---
  testDeepseekBtn.addEventListener('click', async () => {
    const key = deepseekApiKey.value.trim();
    if (!key) {
      showDeepseekHint('请输入 API Key', 'error');
      return;
    }

    testDeepseekBtn.disabled = true;
    testDeepseekBtn.textContent = '测试中...';
    deepseekHint.style.display = 'none';

    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + key,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'deepseek-v4-pro',
          messages: [
            { role: 'system', content: 'Reply with only the word "OK".' },
            { role: 'user', content: 'Test' }
          ],
          max_tokens: 10
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data && data.choices) {
          showDeepseekHint('连接成功', 'success');
        } else {
          showDeepseekHint('响应异常，请检查 API Key', 'error');
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        const errMsg = (errData.error && errData.error.message) || 'HTTP ' + response.status;
        showDeepseekHint('连接失败: ' + errMsg, 'error');
      }
    } catch (err) {
      showDeepseekHint('网络错误: ' + err.message, 'error');
    } finally {
      testDeepseekBtn.disabled = false;
      testDeepseekBtn.textContent = '测试';
    }
  });

  function showDeepseekHint(text, type) {
    deepseekHint.textContent = text;
    deepseekHint.className = 'notion-hint ' + (type || '');
    deepseekHint.style.display = 'block';
    setTimeout(() => { deepseekHint.style.display = 'none'; }, 5000);
  }

  // --- Init ---
  await loadSettings();
  await loadWords();
  await loadNotionStatus();
});
