// ============================================================
// Universal Sub-Agent - 设置页逻辑 (Options Page)
// 读取/保存 API Key、厂商、模型到 chrome.storage.local
// 多厂商 Key 和 Model 各自独立存储，切换厂商自动加载对应配置
// ============================================================

var PROVIDERS = globalThis.USA_CONFIG.PROVIDERS;
var DEFAULT_SYSTEM_PROMPT = globalThis.USA_CONFIG.DEFAULT_SYSTEM_PROMPT;

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
chrome.storage.local.get(['apiKeys', 'models', 'provider', 'systemPrompt'], function (data) {
  allKeys = data.apiKeys || {};
  allModels = data.models || {};

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


// Tab 切换逻辑
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.getAttribute('data-target')).classList.add('active');
    
    if (btn.getAttribute('data-target') === 'tab-history') {
      loadHistory();
    }
  });
});

function loadHistory() {
  const container = document.getElementById('historyListContainer');
  chrome.storage.local.get(['chatHistoryList'], (data) => {
    const list = data.chatHistoryList || [];
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align:center; padding: 32px 0;">暂无对话记录。</div>';
      return;
    }
    
    container.innerHTML = '';
    list.forEach(item => {
      const el = document.createElement('div');
      el.className = 'history-item';
      
      const d = new Date(item.date);
      const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
      
      let msgsHtml = '';
      if (item.messages && item.messages.length > 0) {
        item.messages.forEach(m => {
          msgsHtml += `
            <div class="hm-row">
              <div class="hm-role ${m.role === 'user' ? 'user' : 'assistant'}">${m.role === 'user' ? '🧑 用户' : '🤖 AI'}</div>
              <div class="hm-content">${escapeHtml(m.content)}</div>
            </div>
          `;
        });
      }
      
      el.innerHTML = `
        <div class="hi-header">
          <div>
            <div class="hi-title">${escapeHtml(item.title || '未知网页')}</div>
            <span class="hi-url-wrap"></span>
          </div>
          <div class="hi-date">${dateStr}</div>
        </div>
        <div class="hi-summary">💬 ${escapeHtml(item.summary || '...')} <span style="font-size:11px;color:#9aa0a6;">(点击展开详情)</span></div>
        <div class="hi-messages">${msgsHtml}</div>
      `;

      // 历史链接：用 DOM 构建 + 协议白名单校验，杜绝 javascript:/data: 等危险协议注入
      const urlWrap = el.querySelector('.hi-url-wrap');
      const safe = safeUrl(item.url);
      if (urlWrap) {
        const a = document.createElement('a');
        a.className = 'hi-url';
        a.textContent = item.url || '';
        if (safe) {
          a.href = safe;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        urlWrap.appendChild(a);
      }
      
      const summaryBox = el.querySelector('.hi-summary');
      const msgsBox = el.querySelector('.hi-messages');
      summaryBox.addEventListener('click', () => {
        msgsBox.classList.toggle('open');
      });
      
      container.appendChild(el);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, match => {
    const escape = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
    return escape[match];
  });
}

// 仅允许 http/https/file 协议的 URL；解析失败或危险协议一律返回 null（不生成可点击链接）
function safeUrl(raw) {
  if (!raw) return null;
  try {
    const u = new URL(String(raw), 'https://invalid.invalid/');
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'file:') {
      return u.href;
    }
  } catch (_) { /* 解析失败视为不安全 */ }
  return null;
}

document.getElementById('clearHistoryBtn').addEventListener('click', () => {
  if (confirm('确定要清空所有对话记录吗？此操作不可恢复。')) {
    chrome.storage.local.set({ chatHistoryList: [] }, () => {
      loadHistory();
    });
  }
});

// 在 options 页加载时尝试检测是否有 hash 跳转
if (location.hash === '#history') {
  const btn = document.querySelector('.tab-btn[data-target="tab-history"]');
  if (btn) btn.click();
}
