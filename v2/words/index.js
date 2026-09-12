// Words Page Script for 划词翻译

document.addEventListener('DOMContentLoaded', async () => {
  const totalCount = document.getElementById('totalCount');
  const searchInput = document.getElementById('searchInput');
  const wordList = document.getElementById('wordList');
  const emptyState = document.getElementById('emptyState');
  const selectAll = document.getElementById('selectAll');
  const selectCount = document.getElementById('selectCount');
  const downloadBtn = document.getElementById('downloadBtn');
  const downloadHint = document.getElementById('downloadHint');
  const clearAll = document.getElementById('clearAll');

  let allWords = [];
  let selectedWords = new Set();

  // --- Load Words ---
  async function loadWords() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getWords' }, (res) => {
        if (res && res.success) {
          allWords = res.data || [];
        } else {
          allWords = [];
        }
        const validKeys = new Set(allWords.map(w => w.word.toLowerCase()));
        for (const key of selectedWords) {
          if (!validKeys.has(key)) selectedWords.delete(key);
        }
        totalCount.textContent = allWords.length + ' 条';
        const query = searchInput.value.toLowerCase().trim();
        renderWordList(query ? allWords.filter(w =>
          w.word.toLowerCase().indexOf(query) !== -1 ||
          w.translation.toLowerCase().indexOf(query) !== -1
        ) : allWords);
        updateSelectUI();
        resolve();
      });
    });
  }

  // --- Render Word List ---
  function renderWordList(words) {
    const existing = wordList.querySelectorAll('.word-row');
    existing.forEach(el => el.remove());

    if (words.length === 0) {
      emptyState.style.display = 'flex';
      return;
    }

    emptyState.style.display = 'none';

    const sorted = [...words].sort((a, b) => b.addedAt - a.addedAt);

    for (const entry of sorted) {
      const key = entry.word.toLowerCase();
      const isChecked = selectedWords.has(key);
      const dateStr = new Date(entry.addedAt).toLocaleDateString('zh-CN');

      let wordHtml = `<span class="row-word">${escapeHtml(entry.word)}</span>`;
      let sourceHtml = '';
      if (entry.sourceUrl) {
        const domain = extractDomain(entry.sourceUrl);
        wordHtml = `<span class="row-word"><a title="打开来源网页" data-url="${escapeAttr(entry.sourceUrl)}">${escapeHtml(entry.word)}</a></span>`;
        sourceHtml = `<span class="row-source" title="${escapeHtml(entry.sourceUrl)}">${escapeHtml(domain)}</span>`;
      }

      let noteHtml = '';
      if (entry.note) {
        noteHtml = `<span class="row-note" data-word="${escapeHtml(key)}">
          <span class="row-note-text">${escapeHtml(entry.note)}</span>
          <button class="row-note-edit-btn" title="编辑注释">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
          <button class="row-note-del-btn" title="删除注释">×</button>
        </span>`;
      } else {
        noteHtml = `<span class="row-note row-note-empty" data-word="${escapeHtml(key)}">
          <button class="row-note-add-btn" title="添加注释">+ 注释</button>
        </span>`;
      }

      const row = document.createElement('div');
      row.className = 'word-row';
      row.innerHTML = `
        <label class="row-checkbox">
          <input type="checkbox" data-word="${escapeHtml(key)}" ${isChecked ? 'checked' : ''}>
          <span class="checkbox-custom"></span>
        </label>
        <div class="row-info">
          <div class="row-main">
            ${wordHtml}
          </div>
          <span class="row-translation">${escapeHtml(entry.translation)}</span>
          <div class="row-meta">
            ${sourceHtml}
            ${noteHtml}
            <span class="row-date">${dateStr}</span>
          </div>
        </div>
        <button class="row-delete" data-word="${escapeHtml(key)}" title="删除">×</button>
      `;
      wordList.appendChild(row);
    }

    // Checkbox handlers
    wordList.querySelectorAll('.row-checkbox input').forEach(cb => {
      cb.addEventListener('change', () => {
        const k = cb.dataset.word;
        if (cb.checked) selectedWords.add(k);
        else selectedWords.delete(k);
        updateSelectUI();
      });
    });

    // Delete handlers
    wordList.querySelectorAll('.row-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const k = btn.dataset.word;
        selectedWords.delete(k);
        const w = allWords.find(w => w.word.toLowerCase() === k);
        if (w) {
          await sendMessage({ type: 'removeWord', word: w.word });
          await loadWords();
        }
      });
    });

    // Link click handlers
    wordList.querySelectorAll('.row-word a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const url = link.dataset.url;
        if (url) chrome.tabs.create({ url });
      });
    });

    // Note edit button handlers
    wordList.querySelectorAll('.row-note-edit-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const noteEl = btn.closest('.row-note');
        startRowNoteEdit(noteEl);
      });
    });

    // Note delete button handlers
    wordList.querySelectorAll('.row-note-del-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const key = btn.closest('.row-note').dataset.word;
        await updateWordNoteByKey(key, '');
        await loadWords();
      });
    });

    // Note add button handlers (for words without notes)
    wordList.querySelectorAll('.row-note-add-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const noteEl = btn.closest('.row-note');
        startRowNoteEdit(noteEl);
      });
    });
  }

  // Start inline note editing for word rows
  function startRowNoteEdit(noteEl) {
    const key = noteEl.dataset.word;
    const word = allWords.find(w => w.word.toLowerCase() === key);
    if (!word) return;
    const currentNote = word.note || '';

    noteEl.classList.add('row-note-editing');
    noteEl.innerHTML = `
      <input type="text" class="row-note-input" value="${escapeHtml(currentNote)}" maxlength="30" placeholder="添加注释...">
      <button class="row-note-confirm" title="确认">✓</button>
      <button class="row-note-cancel" title="取消">✗</button>
    `;

    const input = noteEl.querySelector('.row-note-input');
    const confirmBtn = noteEl.querySelector('.row-note-confirm');
    const cancelBtn = noteEl.querySelector('.row-note-cancel');

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
    return sendMessage({ type: 'updateWordNote', word: word.word, note: note });
  }

  // --- Select All ---
  selectAll.addEventListener('change', () => {
    const cbs = wordList.querySelectorAll('.row-checkbox input');
    if (selectAll.checked) {
      cbs.forEach(cb => { cb.checked = true; selectedWords.add(cb.dataset.word); });
    } else {
      cbs.forEach(cb => { cb.checked = false; selectedWords.delete(cb.dataset.word); });
    }
    updateSelectUI();
  });

  function updateSelectUI() {
    const cbs = wordList.querySelectorAll('.row-checkbox input');
    const visible = cbs.length;
    const checked = [...cbs].filter(cb => cb.checked).length;
    selectCount.textContent = '已选 ' + selectedWords.size + ' 项';
    selectAll.checked = visible > 0 && checked === visible;
    selectAll.indeterminate = checked > 0 && checked < visible;
  }

  // --- Search ---
  searchInput.addEventListener('input', async () => {
    const query = searchInput.value.toLowerCase().trim();
    const filtered = query ? allWords.filter(w =>
      w.word.toLowerCase().indexOf(query) !== -1 ||
      w.translation.toLowerCase().indexOf(query) !== -1
    ) : allWords;
    renderWordList(filtered);
    updateSelectUI();
  });

  // --- Download ---
  downloadBtn.addEventListener('click', async () => {
    let wordsToDownload;
    if (selectedWords.size > 0) {
      wordsToDownload = allWords.filter(w => selectedWords.has(w.word.toLowerCase()));
    } else {
      wordsToDownload = allWords;
    }
    if (wordsToDownload.length === 0) {
      showHint('暂无收藏词汇', 'error');
      return;
    }

    downloadBtn.disabled = true;
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
      showHint('已导出 ' + wordsToDownload.length + ' 条词汇', 'success');
    } catch (err) {
      showHint('导出失败，请重试', 'error');
    } finally {
      downloadBtn.disabled = false;
    }
  });

  function buildWordHtml(words) {
    const dateStr = new Date().toLocaleDateString('zh-CN');
    const rows = words.map((w, i) => {
      const dt = new Date(w.addedAt).toLocaleDateString('zh-CN');
      return '<tr>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#999;width:40px;">' + (i + 1) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;color:#333;">' + h(w.word) + '</td>' +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">' + h(w.translation) + '</td>' +
        (w.note ? '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#7C3AED;font-size:12px;">' + h(w.note) + '</td>' : '<td></td>') +
        '<td style="padding:8px 12px;border-bottom:1px solid #eee;color:#999;font-size:12px;white-space:nowrap;">' + dt + '</td>' +
      '</tr>';
    }).join('');

    const hasNotes = words.some(w => w.note);

    return '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>生词收藏</title>\n<style>\n' +
      'body{font-family:"Microsoft YaHei","PingFang SC","Helvetica Neue",Arial,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#333;}\n' +
      'h1{text-align:center;color:#7C3AED;font-size:24px;margin-bottom:4px;}\n' +
      '.meta{text-align:center;color:#999;font-size:13px;margin-bottom:24px;}\n' +
      'table{width:100%;border-collapse:collapse;border-top:2px solid #7C3AED;border-bottom:2px solid #7C3AED;}\n' +
      'th{padding:10px 12px;background:#f8f4ff;color:#7C3AED;font-size:14px;text-align:left;border-bottom:1px solid #ddd;}\n' +
      'td{font-size:14px;}\n' +
      'tr:nth-child(even) td{background:#fafafa;}\n' +
      '.footer{text-align:center;color:#ccc;font-size:12px;margin-top:24px;}\n' +
      '</style>\n</head>\n<body>\n' +
      '<h1>\u{1F4D6} \u751f\u8bcd\u6536\u85cf</h1>\n' +
      '<p class="meta">\u5bfc\u51fa\u65f6\u95f4\uff1a' + dateStr + '\u3000\uff5c\u3000\u5171 ' + words.length + ' \u4e2a\u8bcd\u6c47</p>\n' +
      '<table>\n<thead>\n<tr>\n<th style="width:40px;text-align:center;">#</th>\n<th>\u82f1\u6587/\u539f\u6587</th>\n<th>\u7ffb\u8bd1</th>\n' +
      (hasNotes ? '<th>\u6ce8\u91ca</th>\n' : '<th></th>\n') +
      '<th style="width:90px;">\u6536\u85cf\u65e5\u671f</th>\n</tr>\n</thead>\n<tbody>\n' + rows + '\n</tbody>\n</table>\n' +
      '<p class="footer">\u7531\u300c\u62fe\u8bcd\u300dChrome \u63d2\u4ef6\u5bfc\u51fa \u00b7 ' + dateStr + '</p>\n</body>\n</html>';
  }

  // --- Clear All ---
  clearAll.addEventListener('click', async () => {
    if (!confirm('确定要清空全部收藏吗？此操作不可撤销。')) return;
    for (let i = 0; i < allWords.length; i++) {
      await sendMessage({ type: 'removeWord', word: allWords[i].word });
    }
    await loadWords();
  });

  // --- Helpers ---
  function showHint(text, type) {
    downloadHint.textContent = text;
    downloadHint.className = 'download-hint ' + (type || '');
    downloadHint.style.display = 'block';
    setTimeout(() => { downloadHint.style.display = 'none'; }, 3000);
  }

  async function sendMessage(request) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(request, (response) => {
        resolve(response || { success: false, error: 'No response' });
      });
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function extractDomain(url) {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, '');
    } catch (e) { return url; }
  }

  function h(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Flashcard ---
  const flashcardModal = document.getElementById('flashcardModal');
  const flashcardBtn = document.getElementById('flashcardBtn');
  const flashcardClose = document.getElementById('flashcardClose');
  const flashcardDeck = document.getElementById('flashcardDeck');
  const flashcardCard = document.getElementById('flashcardCard');
  const flashcardWord = document.getElementById('flashcardWord');
  const flashcardTranslation = document.getElementById('flashcardTranslation');
  const flashcardNote = document.getElementById('flashcardNote');
  const flashcardCounter = document.getElementById('flashcardCounter');
  const flashcardBarFill = document.getElementById('flashcardBarFill');
  const knownCount = document.getElementById('knownCount');
  const unknownCount = document.getElementById('unknownCount');
  const flashcardFlip = document.getElementById('flashcardFlip');
  const flashcardKnown = document.getElementById('flashcardKnown');
  const flashcardUnknown = document.getElementById('flashcardUnknown');
  const flashcardComplete = document.getElementById('flashcardComplete');
  const flashcardRestart = document.getElementById('flashcardRestart');

  let flashcardWords = [];
  let currentIndex = 0;
  let knownTotal = 0;
  let unknownTotal = 0;
  let isFlipped = false;

  flashcardBtn.addEventListener('click', () => {
    if (allWords.length === 0) {
      showHint('暂无收藏词汇，请先收藏一些词汇后再开始闪词学习', 'error');
      return;
    }
    startFlashcard();
  });

  function startFlashcard() {
    // Shuffle words for better learning effect
    flashcardWords = [...allWords].sort(() => Math.random() - 0.5);
    currentIndex = 0;
    knownTotal = 0;
    unknownTotal = 0;
    isFlipped = false;
    updateFlashcardStats();
    flashcardComplete.style.display = 'none';
    flashcardDeck.style.display = '';
    document.querySelector('.flashcard-actions').style.display = '';
    flashcardModal.style.display = '';
    showCurrentCard();
  }

  function showCurrentCard() {
    if (currentIndex >= flashcardWords.length) {
      showFlashcardComplete();
      return;
    }
    const w = flashcardWords[currentIndex];
    flashcardWord.textContent = w.word;
    flashcardTranslation.textContent = w.translation;
    flashcardNote.textContent = w.note || '';
    flashcardCard.classList.remove('flipped');
    isFlipped = false;
    flashcardCounter.textContent = (currentIndex + 1) + ' / ' + flashcardWords.length;
    flashcardBarFill.style.width = ((currentIndex + 1) / flashcardWords.length * 100) + '%';
  }

  function updateFlashcardStats() {
    knownCount.textContent = knownTotal;
    unknownCount.textContent = unknownTotal;
  }

  flashcardCard.addEventListener('click', () => {
    if (flashcardComplete.style.display !== 'none') return;
    flipCard();
  });

  flashcardFlip.addEventListener('click', (e) => {
    e.stopPropagation();
    flipCard();
  });

  function flipCard() {
    isFlipped = !isFlipped;
    if (isFlipped) {
      flashcardCard.classList.add('flipped');
    } else {
      flashcardCard.classList.remove('flipped');
    }
  }

  flashcardKnown.addEventListener('click', (e) => {
    e.stopPropagation();
    markAndNext(true);
  });

  flashcardUnknown.addEventListener('click', (e) => {
    e.stopPropagation();
    markAndNext(false);
  });

  function markAndNext(known) {
    if (known) knownTotal++;
    else unknownTotal++;
    updateFlashcardStats();
    currentIndex++;
    showCurrentCard();
  }

  function showFlashcardComplete() {
    flashcardDeck.style.display = 'none';
    document.querySelector('.flashcard-actions').style.display = 'none';
    flashcardComplete.style.display = '';
    document.getElementById('completeTotal').textContent = flashcardWords.length;
    document.getElementById('completeKnown').textContent = knownTotal;
    document.getElementById('completeUnknown').textContent = unknownTotal;
  }

  flashcardClose.addEventListener('click', () => {
    flashcardModal.style.display = 'none';
  });

  flashcardModal.addEventListener('click', (e) => {
    if (e.target === flashcardModal) flashcardModal.style.display = 'none';
  });

  flashcardRestart.addEventListener('click', () => {
    startFlashcard();
  });

  // Keyboard shortcuts for flashcard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (flashcardModal.style.display !== 'none') flashcardModal.style.display = 'none';
      if (importModal.style.display !== 'none') importModal.style.display = 'none';
      return;
    }
    if (flashcardModal.style.display === 'none') return;
    if (flashcardComplete.style.display !== 'none') return;
    if (e.key === 'ArrowLeft') markAndNext(false);
    if (e.key === 'ArrowRight') markAndNext(true);
    if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); flipCard(); }
  });

  // --- Import ---
  const importModal = document.getElementById('importModal');
  const importBtn = document.getElementById('importBtn');
  const importClose = document.getElementById('importClose');
  const importTextarea = document.getElementById('importTextarea');
  const importPreviewBtn = document.getElementById('importPreviewBtn');
  const importPreview = document.getElementById('importPreview');
  const importPreviewList = document.getElementById('importPreviewList');
  const importPreviewCount = document.getElementById('importPreviewCount');
  const importConfirmBtn = document.getElementById('importConfirmBtn');
  const importCancelBtn = document.getElementById('importCancelBtn');

  let parsedImports = [];

  importBtn.addEventListener('click', () => {
    importTextarea.value = '';
    importPreview.style.display = 'none';
    parsedImports = [];
    importModal.style.display = '';
    importTextarea.focus();
  });

  importClose.addEventListener('click', () => {
    importModal.style.display = 'none';
  });

  importModal.addEventListener('click', (e) => {
    if (e.target === importModal) importModal.style.display = 'none';
  });

  importPreviewBtn.addEventListener('click', () => {
    const raw = importTextarea.value.trim();
    if (!raw) {
      showHint('请粘贴要导入的内容', 'error');
      return;
    }
    parsedImports = parseImportText(raw);
    if (parsedImports.length === 0) {
      showHint('未能解析到有效词条，请检查格式', 'error');
      return;
    }
    renderImportPreview();
  });

  function parseImportText(text) {
    // Try JSON first
    let trimmed = text.trim();
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(trimmed);
        const arr = Array.isArray(parsed) ? parsed : [parsed];
        return arr.map(item => ({
          word: (item.word || item.Word || item.text || '').toString().trim(),
          translation: (item.translation || item.Translation || item.meaning || '').toString().trim(),
          note: (item.note || item.Note || '').toString().trim()
        })).filter(item => item.word);
      } catch (e) { /* fall through to line parsing */ }
    }

    // Parse line by line
    const lines = trimmed.split(/\n/).map(l => l.trim()).filter(l => l);
    const results = [];
    const existingKeys = new Set(allWords.map(w => w.word.toLowerCase()));

    for (const line of lines) {
      // Skip lines that look like headers or comments
      if (line.startsWith('#') || line.startsWith('//')) continue;

      let word = '', translation = '', note = '';

      // Try | separator first (word | translation)
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        word = parts[0] || '';
        translation = parts[1] || '';
        note = parts[2] || '';
      }
      // Try tab separator
      else if (line.includes('\t')) {
        const parts = line.split('\t').map(p => p.trim());
        word = parts[0] || '';
        translation = parts[1] || '';
      }
      // Try " - " or " — " separator
      else if (line.includes(' - ') || line.includes(' — ')) {
        const sep = line.includes(' - ') ? ' - ' : ' — ';
        const idx = line.indexOf(sep);
        word = line.slice(0, idx).trim();
        translation = line.slice(idx + sep.length).trim();
      }
      // Just a word, no translation
      else {
        word = line;
        translation = '';
      }

      if (word) {
        const isDup = existingKeys.has(word.toLowerCase());
        results.push({ word, translation, note, isDuplicate: isDup });
      }
    }

    return results;
  }

  function renderImportPreview() {
    importPreview.style.display = '';
    importPreviewList.innerHTML = '';
    importPreviewCount.textContent = parsedImports.length;

    for (const item of parsedImports) {
      const div = document.createElement('div');
      div.className = 'import-preview-item';
      let dupTag = '';
      if (item.isDuplicate) {
        dupTag = '<span class="preview-dup">已存在，将跳过</span>';
      }
      div.innerHTML = `
        <span class="preview-word">${escapeHtml(item.word)}</span>
        <span class="preview-arrow">→</span>
        <span class="preview-translation">${escapeHtml(item.translation) || '(无翻译)'}</span>
        ${dupTag}
      `;
      importPreviewList.appendChild(div);
    }
  }

  importConfirmBtn.addEventListener('click', async () => {
    const newItems = parsedImports.filter(item => !item.isDuplicate);
    if (newItems.length === 0) {
      showImportHint('所有词条已存在，无需导入', 'warning');
      return;
    }

    importConfirmBtn.disabled = true;
    importConfirmBtn.textContent = '导入中...';

    let imported = 0;
    for (const item of newItems) {
      await sendMessage({
        type: 'addWord',
        word: item.word,
        translation: item.translation || '',
        note: item.note || '',
        sourceUrl: ''
      });
      imported++;
    }

    importConfirmBtn.disabled = false;
    importConfirmBtn.textContent = '确认导入';
    importModal.style.display = 'none';
    showHint('成功导入 ' + imported + ' 个词条' + (parsedImports.length - newItems.length > 0 ? '，跳过 ' + (parsedImports.length - newItems.length) + ' 个重复' : ''), 'success');
    await loadWords();
  });

  importCancelBtn.addEventListener('click', () => {
    importModal.style.display = 'none';
  });

  function showImportHint(text, type) {
    // Reuse download hint area for import messages
    showHint(text, type);
  }

  // --- Init ---
  await loadWords();

  // Auto-open flashcard if URL has ?mode=flashcard
  if (window.location.search.includes('mode=flashcard') && allWords.length > 0) {
    setTimeout(() => startFlashcard(), 300);
  }
});
