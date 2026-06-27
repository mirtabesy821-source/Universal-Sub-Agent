// ============================================================
// Universal Sub-Agent - 弹窗逻辑 (Popup)
// 显示配置状态，提供打开设置页的入口
// ============================================================

var PROVIDER_NAMES = {
  deepseek: 'DeepSeek',
  qwen: '通义千问',
  glm: '智谱GLM',
  kimi: 'Kimi',
  openrouter: 'OpenRouter'
};

var statusBox = document.getElementById('statusBox');
var statusText = document.getElementById('statusText');
var info = document.getElementById('info');
var openSettingsBtn = document.getElementById('openSettings');

chrome.storage.local.get(['apiKey', 'provider', 'model'], function (data) {
  var provider = data.provider || 'deepseek';
  var providerName = PROVIDER_NAMES[provider] || provider;
  var hasKey = !!(data.apiKey && data.apiKey.length > 0);

  if (hasKey) {
    statusBox.className = 'status-box ok';
    statusText.textContent = '✓ 已配置，可以使用了';
  } else {
    statusBox.className = 'status-box warn';
    statusText.textContent = '⚠ 尚未配置 API Key';
  }

  var model = data.model || '';
  var modelStr = model ? (' · 模型: <b>' + model + '</b>') : '';
  info.innerHTML = '厂商: <b>' + providerName + '</b>' + modelStr;
});

openSettingsBtn.addEventListener('click', function () {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});
