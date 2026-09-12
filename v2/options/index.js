// Options Page Script for 划词翻译

document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const databaseIdInput = document.getElementById('databaseId');
  const toggleApiKey = document.getElementById('toggleApiKey');
  const validateBtn = document.getElementById('validateBtn');
  const validateBtnText = document.getElementById('validateBtnText');
  const validateBtnLoading = document.getElementById('validateBtnLoading');
  const validateResult = document.getElementById('validateResult');
  const connectedBanner = document.getElementById('connectedBanner');
  const connectedDesc = document.getElementById('connectedDesc');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const setupSteps = document.getElementById('setupSteps');
  const syncSection = document.getElementById('syncSection');
  const syncAllBtn = document.getElementById('syncAllBtn');
  const syncResult = document.getElementById('syncResult');
  const localCount = document.getElementById('localCount');

  // --- Init ---
  async function init() {
    const status = await sendMessage({ type: 'getNotionStatus' });
    const wordsRes = await sendMessage({ type: 'getWords' });

    if (status.success && status.data.notionReady) {
      showConnectedState(status.data);
    } else {
      showSetupState();
    }

    if (wordsRes.success) {
      localCount.textContent = '本地词汇：' + (wordsRes.data || []).length + ' 条';
    }
  }

  function showConnectedState(data) {
    connectedBanner.style.display = 'flex';
    setupSteps.style.display = 'none';
    syncSection.style.display = 'block';
    connectedDesc.textContent = 'API Key: ' + (data.apiKey || '***');
  }

  function showSetupState() {
    connectedBanner.style.display = 'none';
    setupSteps.style.display = 'block';
    syncSection.style.display = 'none';
  }

  // --- Toggle API Key Visibility ---
  toggleApiKey.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // --- Extract Database ID ---
  function extractDatabaseId(input) {
    input = (input || '').trim();
    var m = input.match(/notion\.so\/[^/]+\/([0-9a-f]{32})/i);
    if (m) return m[1];
    m = input.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (m) return m[1].replace(/-/g, '');
    m = input.match(/([0-9a-f]{32})/i);
    if (m) return m[1];
    return input.replace(/-/g, '').replace(/[^0-9a-f]/gi, '');
  }

  // --- Validate & Connect ---
  validateBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const dbRaw = databaseIdInput.value.trim();

    if (!apiKey) { showResult('error', '请输入 API Key'); return; }
    if (!apiKey.startsWith('secret_') && !apiKey.startsWith('ntn_')) {
      showResult('error', 'API Key 应以 ntn_ 或 secret_ 开头'); return;
    }
    if (!dbRaw) { showResult('error', '请输入数据库 ID 或数据库页面 URL'); return; }

    const databaseId = extractDatabaseId(dbRaw);
    if (databaseId.length !== 32) {
      showResult('error', '数据库 ID 应为32位，当前解析出 ' + databaseId.length + ' 位，请检查 URL 是否正确');
      return;
    }

    validateBtn.disabled = true;
    validateBtnText.style.display = 'none';
    validateBtnLoading.style.display = 'inline';
    validateResult.style.display = 'none';

    try {
      const result = await sendMessage({
        type: 'setNotionConfig',
        apiKey: apiKey,
        databaseId: databaseId
      });

      if (result.valid) {
        showResult('success', '✅ 连接成功！数据库属性: ' + (result.properties || '已就绪') + '\n\n划词收藏时会自动同步到 Notion。');
        setTimeout(() => { showConnectedState({ apiKey: apiKey.slice(0, 8) + '...' }); }, 2000);
      } else {
        showResult('error', '❌ 连接失败: ' + (result.error || '请检查 API Key 和数据库 ID'));
      }
    } catch (err) {
      showResult('error', '❌ 网络错误: ' + err.message);
    } finally {
      validateBtn.disabled = false;
      validateBtnText.style.display = 'inline';
      validateBtnLoading.style.display = 'none';
    }
  });

  // --- Sync All ---
  syncAllBtn.addEventListener('click', async () => {
    if (!confirm('将本地全部词汇同步到 Notion？已有重复的会自动跳过。')) return;
    syncAllBtn.disabled = true;
    syncAllBtn.textContent = '同步中...';
    syncResult.style.display = 'none';

    const result = await sendMessage({ type: 'syncAllToNotion' });

    syncAllBtn.disabled = false;
    syncAllBtn.textContent = '一键同步全部';

    if (result && result.success) {
      const msg = '✅ 同步完成：' + result.synced + ' 条成功' + (result.failed > 0 ? '，' + result.failed + ' 条失败' : '') + '（共 ' + result.total + ' 条）';
      syncResult.className = 'sync-result ' + (result.failed > 0 ? 'warning' : 'success');
      syncResult.textContent = msg;
    } else {
      syncResult.className = 'sync-result error';
      syncResult.textContent = '❌ 同步失败: ' + ((result && result.error) || '未知错误');
    }
    syncResult.style.display = 'block';
  });

  // --- Disconnect ---
  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('确定要断开 Notion 连接？已收藏的词汇仍保留在 Notion 中。')) return;
    await sendMessage({ type: 'clearNotionConfig' });
    showSetupState();
    apiKeyInput.value = '';
    databaseIdInput.value = '';
    validateResult.style.display = 'none';
    syncResult.style.display = 'none';
  });

  // --- Flashcard Learning ---
  document.getElementById('openFlashcardBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('words/index.html') + '?mode=flashcard' });
  });

  // --- Result Display ---
  function showResult(type, message) {
    validateResult.style.display = 'block';
    validateResult.className = 'validate-result ' + type;
    validateResult.textContent = message;
  }

  // --- Helpers ---
  async function sendMessage(request) {
    return new Promise(function(resolve) {
      chrome.runtime.sendMessage(request, function(response) {
        resolve(response || { success: false, error: 'No response' });
      });
    });
  }

  await init();
});
