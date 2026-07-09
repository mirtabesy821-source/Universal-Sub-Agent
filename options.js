// ============================================================
// Universal Sub-Agent - 设置页逻辑 (Options Page)
// 读取/保存 API Key、厂商、模型、系统提示词到 chrome.storage.local
// ============================================================

var PROVIDERS = {
  deepseek: { name: 'DeepSeek', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { name: '通义千问', model: 'qwen-turbo', keyUrl: 'https://bailian.console.aliyun.com/#/api-key' },
  glm: { name: '智谱GLM', model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/manage/apikey' },
  kimi: { name: 'Kimi', model: 'moonshot-v1-8k', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  openrouter: { name: 'OpenRouter', model: 'meta-llama/llama-3-8b-instruct', keyUrl: 'https://openrouter.ai/keys' }
};

var DEFAULT_SYSTEM_PROMPT = '你是一个精准的局部解答助手。请仔细阅读用户提供的【全局背景资料】和【用户划选的局部片段】，在该语境下针对用户的疑问进行解答。支持多轮对话，请参考历史对话保持上下文连贯。';

var providerEl = document.getElementById('provider');
var apiKeyEl = document.getElementById('apiKey');
var modelEl = document.getElementById('model');
var systemPromptEl = document.getElementById('systemPrompt');
var saveBtn = document.getElementById('saveBtn');
var statusEl = document.getElementById('status');
var toggleBtn = document.getElementById('toggleKey');
var getKeyLink = document.getElementById('getKeyLink');

// 厂商切换时：更新模型 placeholder + Key 链接
function onProviderChange() {
  var p = PROVIDERS[providerEl.value];
  if (!p) return;
  modelEl.placeholder = '留空使用默认：' + p.model;
  getKeyLink.href = p.keyUrl;
}

console.log('[Universal Sub-Agent] 设置页已加载 v1.2.1, systemPromptEl=', !!systemPromptEl, 'value length=', systemPromptEl ? systemPromptEl.value.length : 0);

// 页面加载时读取已保存的配置
chrome.storage.local.get(['apiKey', 'provider', 'model', 'systemPrompt'], function (data) {
  if (data.provider && PROVIDERS[data.provider]) {
    providerEl.value = data.provider;
  }
  if (data.apiKey) {
    apiKeyEl.value = data.apiKey;
  }
  if (data.model) {
    modelEl.value = data.model;
  }
  if (data.systemPrompt) {
    systemPromptEl.value = data.systemPrompt;
  }
  onProviderChange();
});

// 厂商切换事件
providerEl.addEventListener('change', onProviderChange);

// 显示/隐藏 API Key
toggleBtn.addEventListener('click', function () {
  if (apiKeyEl.type === 'password') {
    apiKeyEl.type = 'text';
    toggleBtn.textContent = '隐藏';
  } else {
    apiKeyEl.type = 'password';
    toggleBtn.textContent = '显示';
  }
});

// 保存配置
saveBtn.addEventListener('click', function () {
  var config = {
    apiKey: apiKeyEl.value.trim(),
    provider: providerEl.value,
    model: modelEl.value.trim(),
    systemPrompt: systemPromptEl.value.trim()
  };

  if (!config.apiKey) {
    showStatus('请填写 API Key / Please enter your API Key', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  chrome.storage.local.set(config, function () {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存设置';
    if (chrome.runtime.lastError) {
      showStatus('保存失败：' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('✓ 设置已保存', 'success');
    }
  });
});

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = 'status' + (type ? ' ' + type : '');
  if (type === 'success') {
    setTimeout(function () {
      statusEl.textContent = '';
      statusEl.className = 'status';
    }, 3000);
  }
}
