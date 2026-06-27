// ============================================================
// Universal Sub-Agent - 后台服务进程 (Service Worker)
// 从 chrome.storage.local 读取用户配置（厂商 / API Key / 模型），
// 向对应 LLM 发起流式请求，解析 SSE 增量 chunk，通过
// chrome.tabs.sendMessage 实时推回 content.js 供打字机渲染。
// 配置方式：右键扩展图标 → 选项，在设置页填写 API Key 并选择厂商。
// 说明：MV3 service worker 非持久化，但流式 fetch 期间会保持活跃；
//       API Key、模型等配置持久化在 chrome.storage.local。
// ============================================================
// ★ 模型厂商配置：默认厂商为 deepseek，用户可在设置页（右键扩展图标 → 选项）切换 ★
// 可选：'deepseek' | 'qwen' | 'glm' | 'kimi' | 'openrouter'
const DEFAULT_PROVIDER = 'deepseek';

// 各厂商预设（都走 OpenAI 兼容协议 + SSE 流式，核心代码无需改动）
// keyUrl: 该厂商 API Key 申请地址（设置页"获取 Key"按钮跳转用）
const PROVIDERS = {
  deepseek: {
    name: 'DeepSeek',
    url: 'https://api.deepseek.com/chat/completions',
    model: 'deepseek-chat',
    extraHeaders: {},
    keyUrl: 'https://platform.deepseek.com/api_keys'
  },
  qwen: {
    name: '通义千问',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-turbo',
    extraHeaders: {},
    keyUrl: 'https://bailian.console.aliyun.com/#/api-key'
  },
  glm: {
    name: '智谱GLM',
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    extraHeaders: {},
    keyUrl: 'https://open.bigmodel.cn/manage/apikey'
  },
  kimi: {
    name: 'Kimi',
    url: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    extraHeaders: {},
    keyUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  openrouter: {
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'meta-llama/llama-3-8b-instruct',
    extraHeaders: { 'HTTP-Referer': 'https://github.com/your-username/universal-sub-agent', 'X-Title': 'Universal Sub-Agent' },
    keyUrl: 'https://openrouter.ai/keys'
  }
};

// 从 chrome.storage.local 读取用户配置（API Key / 厂商 / 模型）
// Storage schema: { apiKey: string, provider: string, model: string }
async function getConfig() {
  const data = await chrome.storage.local.get(['apiKey', 'provider', 'model']);
  const provider = data.provider || DEFAULT_PROVIDER;
  const cfg = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  return {
    name: cfg.name,
    url: cfg.url,
    model: data.model || cfg.model,
    extraHeaders: cfg.extraHeaders,
    keyUrl: cfg.keyUrl,
    provider,
    apiKey: data.apiKey || ''
  };
}

const SYSTEM_PROMPT = '你是一个精准的局部解答助手。请仔细阅读用户提供的【全局背景资料】和【用户划选的局部片段】，在该语境下针对用户的疑问进行解答。支持多轮对话，请参考历史对话保持上下文连贯。';

// 插件首次安装 / 更新 / 浏览器更新时触发
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Universal Sub-Agent] onInstalled:', details.reason);
});

// 监听来自 content.js 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Universal Sub-Agent] 收到消息:', message, '来源:', sender);

  if (message && message.type === 'ASK_AI') {
    // 立即受理；真正的回答将以流式 chunk 形式异步推回 content.js
    sendResponse({ status: 'started' });
    streamAskAI(message, sender);
    return false; // 同步回执，不使用异步 sendResponse 通道
  }

  // 其它消息：同步回执
  sendResponse({ status: 'received', echo: message });
  return false;
});

// ---------- 核心：发起流式请求并逐 chunk 回推 ----------
async function streamAskAI(message, sender) {
  const tabId = sender.tab && sender.tab.id;
  const frameId = sender.frameId; // ★ 获取发出请求的具体框架 ID（子 frame 划词时精准回传）
  const requestId = message.requestId;
  console.log('[Universal Sub-Agent] streamAskAI 开始, tabId=', tabId, 'frameId=', frameId, 'requestId=', requestId);

  // 统一的消息回推：带 frameId 精准定向 + try/catch 防止标签页关闭后 SW 抛异常
  const sendToFrame = (payload) => {
    if (typeof tabId !== 'number') return;
    try { chrome.tabs.sendMessage(tabId, payload, { frameId }); } catch (_) { /* ignore */ }
  };

  // 统一的错误推送（无论哪一步失败，都确保前端能收到 AI_ERROR 而非一直"思考中"）
  const fail = (error) => {
    console.error('[Universal Sub-Agent] 错误:', error);
    sendToFrame({ type: 'AI_ERROR', requestId, error });
  };

  // tabId 缺失（理论上 content script 发来的消息一定带 tab，但兜底）
  if (typeof tabId !== 'number') {
    fail('无法定位来源标签页，请刷新页面后重试。');
    return;
  }

  // 从 chrome.storage 加载用户配置（API Key / 厂商 / 模型）
  const cfg = await getConfig();

  // 未配置 Key：引导用户去设置页
  if (!cfg.apiKey) {
    fail('尚未配置 API Key。请右键扩展图标 → 选项，填入 ' + cfg.name + ' 的 API Key。');
    return;
  }

  // 厂商提示：不同厂商 Key 格式不同，便于排查
  console.log('[Universal Sub-Agent] 当前厂商:', cfg.name, '模型:', cfg.model, '接口:', cfg.url);

  const selectedText = message.selectedText || '';
  const userQuestion = message.userQuestion || '';
  const pageContext = message.pageContext || '';
  const chatHistory = message.chatHistory || [];

  // ★ 多轮对话：上下文放在 system 消息中（所有轮次都能看到），
  //   chatHistory 是之前的 Q&A 对，userQuestion 是本轮新问题。
  const contextBlock =
    (pageContext ? '【全局背景资料】：\n' + pageContext + '\n\n' : '') +
    (selectedText ? '【用户划选的局部片段】：\n' + selectedText : '');
  const systemContent = SYSTEM_PROMPT + (contextBlock ? '\n\n' + contextBlock : '');

  const messages = [
    { role: 'system', content: systemContent },
    ...chatHistory,
    { role: 'user', content: userQuestion }
  ];

  // 带超时控制：90 秒兜底，防止网络挂起导致前端永远停在"思考中…"
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);

  try {
    let res;
    try {
      console.log('[Universal Sub-Agent] 发起 fetch, model=', cfg.model);
      res = await fetch(cfg.url, {
        method: 'POST',
        headers: Object.assign({
          'Authorization': 'Bearer ' + cfg.apiKey,
          'Content-Type': 'application/json'
        }, cfg.extraHeaders),
        body: JSON.stringify({
          model: cfg.model,
          messages: messages,
          stream: true
        }),
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeoutId);
      if (timedOut || e.name === 'AbortError') fail('请求超时（90 秒无响应），请检查网络或更换模型。');
      else fail('网络请求失败：' + (e && e.message ? e.message : String(e)));
      return;
    }

    if (!res.ok) {
      clearTimeout(timeoutId);
      let errBody = '';
      try { errBody = await res.text(); } catch (_) { /* ignore */ }
      let hint = '';
      if (res.status === 401) hint = '  ← API Key 无效或与当前厂商（' + cfg.name + '）不匹配。请在设置页确认 Key 和厂商匹配。';
      else if (res.status === 402) hint = '  ← 额度不足，请到 ' + cfg.name + ' 平台充值，或换带 :free 后缀的免费模型。';
      else if (res.status === 429) hint = '  ← 请求过于频繁，请稍后重试。';
      fail(cfg.name + ' 返回 HTTP ' + res.status + '：' + errBody.slice(0, 300) + hint);
      return;
    }

    // ---------- 解析 SSE 流 ----------
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // 按行处理：SSE 事件以 \n 分隔，空行直接跳过
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;

        const data = line.slice(5).trim(); // 去掉 "data:" 前缀
        if (data === '[DONE]') {
          clearTimeout(timeoutId);
          console.log('[Universal Sub-Agent] 流式完成, 共', chunkCount, '个 chunk');
          sendToFrame({ type: 'AI_DONE', requestId });
          return;
        }
        try {
          const json = JSON.parse(data);
          const chunk =
            json && json.choices && json.choices[0] &&
            json.choices[0].delta && json.choices[0].delta.content;
          if (chunk) {
            chunkCount++;
            sendToFrame({ type: 'AI_CHUNK', requestId, chunk });
          }
        } catch (_) { /* 跳过不完整 / 非 JSON 行 */ }
      }
    }
    // 流自然结束（未收到 [DONE]）
    clearTimeout(timeoutId);
    console.log('[Universal Sub-Agent] 流自然结束, 共', chunkCount, '个 chunk');
    sendToFrame({ type: 'AI_DONE', requestId });
  } catch (e) {
    clearTimeout(timeoutId);
    if (timedOut || e.name === 'AbortError') fail('响应中途中断超时。');
    else fail('流式解析异常：' + (e && e.message ? e.message : String(e)));
  }
}
