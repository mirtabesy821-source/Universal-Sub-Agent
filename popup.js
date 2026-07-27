// ============================================================
// Universal Sub-Agent - 弹窗逻辑 (Popup)
// 显示配置状态 + 快速切换厂商
// ============================================================

var PROVIDERS = globalThis.USA_CONFIG.PROVIDERS;

var statusBox = document.getElementById('statusBox');
var statusText = document.getElementById('statusText');
var info = document.getElementById('info');
var openSettingsBtn = document.getElementById('openSettings');
var providerSelect = document.getElementById('quickProvider');

chrome.storage.local.get(['apiKeys', 'models', 'provider'], function (data) {
  var apiKeys = data.apiKeys || {};
  var models = data.models || {};

  var provider = data.provider || globalThis.USA_CONFIG.DEFAULT_PROVIDER;
  var providerName = PROVIDERS[provider] ? PROVIDERS[provider].name : provider;
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
  Object.keys(PROVIDERS).forEach(function (p) {
    if (apiKeys[p]) {
      hasAny = true;
      var opt = document.createElement('option');
      opt.value = p;
      opt.textContent = PROVIDERS[p].name;
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

document.getElementById('summarizePage').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'SUMMARIZE_PAGE' }, () => {
        if (chrome.runtime.lastError) {
          document.getElementById('info').innerHTML = '无法在这个页面提取内容（可能是系统页面或未加载完成）。';
        } else {
          window.close();
        }
      });
    }
  });
});

openSettingsBtn.addEventListener('click', function () {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});
