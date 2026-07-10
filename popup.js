// ============================================================
// Universal Sub-Agent - 弹窗逻辑 (Popup)
// 显示配置状态 + 快速切换厂商
// ============================================================

var PROVIDER_NAMES = {
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  glm: '智谱GLM',
  kimi: 'Kimi',
  openrouter: 'OpenRouter',
  mimo: '小米 MiMo'
};

var statusBox = document.getElementById('statusBox');
var statusText = document.getElementById('statusText');
var info = document.getElementById('info');
var openSettingsBtn = document.getElementById('openSettings');
var providerSelect = document.getElementById('quickProvider');

chrome.storage.local.get(['apiKeys', 'apiKey', 'models', 'model', 'provider'], function (data) {
  var apiKeys = data.apiKeys || {};
  if (!data.apiKeys && data.apiKey) {
    var oldProvider = data.provider || 'deepseek';
    apiKeys[oldProvider] = data.apiKey;
    chrome.storage.local.set({ apiKeys: apiKeys });
    chrome.storage.local.remove('apiKey');
  }

  var models = data.models || {};
  if (!data.models && data.model) {
    var oldP = data.provider || 'deepseek';
    models[oldP] = data.model;
    chrome.storage.local.set({ models: models });
    chrome.storage.local.remove('model');
  }

  var provider = data.provider || 'deepseek';
  var providerName = PROVIDER_NAMES[provider] || provider;
  var hasKey = !!(apiKeys[provider]);

  if (hasKey) {
    statusBox.className = 'status-box ok';
    statusText.textContent = '✓ 已配置，可以使用了';
  } else {
    statusBox.className = 'status-box warn';
    statusText.textContent = '⚠ 尚未配置 API Key';
  }

  var customModel = models[provider] || '';
  var modelStr = customModel ? (' · 模型: <b>' + customModel + '</b>') : '';
  info.innerHTML = '厂商: <b>' + providerName + '</b>' + modelStr;

  // 填充快速切换下拉框（只显示已配置 Key 的厂商）
  providerSelect.innerHTML = '';
  var hasAny = false;
  Object.keys(PROVIDER_NAMES).forEach(function (p) {
    if (apiKeys[p]) {
      hasAny = true;
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = PROVIDER_NAMES[p];
      if (p === provider) opt.selected = true;
      providerSelect.appendChild(opt);
    }
  });

  if (!hasAny) {
    var opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（请先配置 Key）';
    providerSelect.appendChild(opt);
    providerSelect.disabled = true;
  }
});

// 快速切换厂商
providerSelect.addEventListener('change', function () {
  var newProvider = providerSelect.value;
  if (!newProvider) return;
  chrome.storage.local.set({ provider: newProvider }, function () {
    // 刷新 popup 显示
    location.reload();
  });
});

openSettingsBtn.addEventListener('click', function () {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});
