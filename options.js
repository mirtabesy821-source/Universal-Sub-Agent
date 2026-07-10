// ============================================================
// Universal Sub-Agent - 设置页逻辑 (Options Page)
// 读取/保存 API Key、厂商、模型到 chrome.storage.local
// 多厂商 Key 和 Model 各自独立存储，切换厂商自动加载对应配置
// ============================================================

var PROVIDERS = {
  deepseek: { name: 'DeepSeek', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys' },
  qwen: { name: '通义千问', model: 'qwen-turbo', keyUrl: 'https://bailian.console.aliyun.com/#/api-key' },
  glm: { name: '智谱GLM', model: 'glm-4-flash', keyUrl: 'https://open.bigmodel.cn/manage/apikey' },
  kimi: { name: 'Kimi', model: 'moonshot-v1-8k', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  openrouter: { name: 'OpenRouter', model: 'meta-llama/llama-3-8b-instruct', keyUrl: 'https://openrouter.ai/keys' },
  mimo: { name: 'MiMo', model: 'mimo-v2.5-pro', keyUrl: 'https://mimo.mi.com' }
};

// ★ 系统默认提示词：必须与 background.js 中的 SYSTEM_PROMPT 保持完全一致 ★
// 设置框默认预填此内容，用户可在此基础上增 / 删 / 改；也可清空后自写。
// 后台据此区分「从未设置（用此默认）」与「已设置（含空串，严格按用户所写）」。
var DEFAULT_SYSTEM_PROMPT = '你是一个精准的局部解答助手。请仔细阅读用户提供的【全局背景资料】、【用户划选位置】与【用户划选文字】，在该语境下针对用户的疑问进行解答。当用户划选的文字在资料中出现多处时，请以【用户划选位置】中用 ⟦ ⟧ 标出的确切实例为准，并结合其前后上下文进行精确分析。支持多轮对话，请参考历史对话保持上下文连贯。';

var providerEl = document.getElementById('provider');
var apiKeyEl = document.getElementById('apiKey');
var modelEl = document.getElementById('model');
var systemPromptEl = document.getElementById('systemPrompt');
var resetPromptBtn = document.getElementById('resetPrompt');
var saveBtn = document.getElementById('saveBtn');
var statusEl = document.getElementById('status');
var toggleBtn = document.getElementById('toggleKey');
var getKeyLink = document.getElementById('getKeyLink');
var keyBadge = document.getElementById('keyBadge');

var allKeys = {};
var allModels = {};

// 厂商切换时：加载该厂商的已保存 Key + Model + 更新 placeholder + Key 链接
function onProviderChange() {
  var p = PROVIDERS[providerEl.value];
  if (!p) return;
  modelEl.placeholder = '留空使用默认：' + p.model;
  getKeyLink.href = p.keyUrl;
  // 加载该厂商的已保存 Key 和 Model
  apiKeyEl.value = allKeys[providerEl.value] || '';
  modelEl.value = allModels[providerEl.value] || '';
  // 更新 Key 已配置状态标识
  var hasKey = !!(allKeys[providerEl.value]);
  keyBadge.textContent = hasKey ? '● 已配置' : '○ 未配置';
  keyBadge.className = 'key-badge' + (hasKey ? ' configured' : '');
}

// 页面加载时读取已保存的配置
chrome.storage.local.get(['apiKeys', 'apiKey', 'models', 'model', 'provider', 'systemPrompt'], function (data) {
  allKeys = data.apiKeys || {};
  if (!data.apiKeys && data.apiKey) {
    var oldProvider = data.provider || 'deepseek';
    allKeys[oldProvider] = data.apiKey;
    chrome.storage.local.set({ apiKeys: allKeys });
    chrome.storage.local.remove('apiKey');
  }

  allModels = data.models || {};
  if (!data.models && data.model) {
    var oldP = data.provider || 'deepseek';
    allModels[oldP] = data.model;
    chrome.storage.local.set({ models: allModels });
    chrome.storage.local.remove('model');
  }

  if (data.provider && PROVIDERS[data.provider]) {
    providerEl.value = data.provider;
  }
  // System Prompt：后台实际发送的"基础提示词"此前对用户不可见。
  // 现在把它显式呈现给用户：
  //   - 从未设置（storage 中无此键 / undefined）→ 预填默认提示词，但【不写入】，
  //     直到用户主动保存，期间后台仍走内置 SYSTEM_PROMPT，行为不变。
  //   - 已保存过（含空串 ''）→ 直接展示已存内容（空串意味着用户清空、想自写）。
  if (typeof data.systemPrompt === 'string') {
    systemPromptEl.value = data.systemPrompt;
  } else {
    systemPromptEl.value = DEFAULT_SYSTEM_PROMPT;
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

// 恢复默认提示词：把文本框重置为内置 SYSTEM_PROMPT，方便在默认基础上修改
resetPromptBtn.addEventListener('click', function () {
  systemPromptEl.value = DEFAULT_SYSTEM_PROMPT;
  systemPromptEl.focus();
});

// 保存配置：当前厂商的 Key 写入 apiKeys[provider]，Model 写入 models[provider]
saveBtn.addEventListener('click', function () {
  var provider = providerEl.value;
  var key = apiKeyEl.value.trim();

  if (!key) {
    showStatus('请填写 ' + PROVIDERS[provider].name + ' 的 API Key', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = '保存中...';

  // 更新内存中的数据
  allKeys[provider] = key;
  var m = modelEl.value.trim();
  if (m) {
    allModels[provider] = m;
  } else {
    delete allModels[provider]; // 留空则使用厂商默认
  }

  chrome.storage.local.set({
    apiKeys: allKeys,
    models: allModels,
    provider: provider,
    systemPrompt: systemPromptEl.value.trim()
  }, function () {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存设置';
    if (chrome.runtime.lastError) {
      showStatus('保存失败：' + chrome.runtime.lastError.message, 'error');
    } else {
      onProviderChange();
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
