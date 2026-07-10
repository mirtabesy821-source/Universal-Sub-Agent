// ============================================================
// Universal Sub-Agent - 后台服务进程 (Service Worker)
// 从 chrome.storage.local 读取用户配置（厂商 / API Key / 模型），
// 向对应 LLM 发起流式请求，解析 SSE 增量 chunk，通过
// chrome.tabs.sendMessage 实时推回 content.js 供打字机渲染。
// 配置方式：右键扩展图标 → 选项，在设置页填写 API Key 并选择厂商。
// 说明：MV3 service worker 非持久化，但流式 fetch 期间会保持活跃；
//       API Key、模型等配置持久化在 chrome.storage.local。
// ============================================================
// ★ 多厂商 Key 存储：apiKeys[provider] 按厂商独立存放，切换厂商无需重新填 Key ★
// 旧版兼容：首次读取时自动将 apiKey → apiKeys[provider] 迁移
// 可选厂商：'deepseek' | 'qwen' | 'glm' | 'kimi' | 'openrouter' | 'mimo'
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
    extraHeaders: { 'HTTP-Referer': 'https://github.com/mirtabesy821-source/Universal-Sub-Agent', 'X-Title': 'Universal Sub-Agent' },
    keyUrl: 'https://openrouter.ai/keys'
  },
  mimo: {
    name: 'MiMo',
    url: 'https://api.xiaomimimo.com/v1/chat/completions',
    model: 'mimo-v2.5-pro',
    extraHeaders: {},
    keyUrl: 'https://mimo.mi.com'
  }
};

// 从 chrome.storage.local 读取用户配置（API Key / 厂商 / 模型）
// Storage schema: { apiKeys: { provider: 'key', ... }, models: { provider: 'model', ... }, provider: string }
// 兼容旧版 { apiKey: string, model: string }：首次读取自动迁移到 apiKeys / models
// requestedProvider 可选参数：允许消息指定厂商（每个对话框独立选厂商）
async function getConfig(requestedProvider) {
  const data = await chrome.storage.local.get(['apiKeys', 'apiKey', 'models', 'model', 'provider', 'systemPrompt']);

  // 旧版迁移：apiKey / model 存在 → 一次性写入 apiKeys / models 并清理旧字段
  let needMigration = false;
  if (!data.apiKeys && data.apiKey) {
    data.apiKeys = {};
    data.apiKeys[data.provider || DEFAULT_PROVIDER] = data.apiKey;
    needMigration = true;
  }
  if (!data.models && data.model) {
    if (!data.models) data.models = {};
    data.models[data.provider || DEFAULT_PROVIDER] = data.model;
    needMigration = true;
  }
  if (needMigration) {
    const toSave = {};
    if (data.apiKeys) toSave.apiKeys = data.apiKeys;
    if (data.models) toSave.models = data.models;
    await chrome.storage.local.set(toSave);
    await chrome.storage.local.remove(['apiKey', 'model']);
  }

  const provider = requestedProvider || data.provider || DEFAULT_PROVIDER;
  const cfg = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  const apiKey = (data.apiKeys || {})[provider] || '';

  // 优先用 per-provider 自定义模型，否则用厂商默认
  const models = data.models || {};
  const model = models[provider] || cfg.model;

  return {
    name: cfg.name,
    url: cfg.url,
    model: model,
    extraHeaders: cfg.extraHeaders,
    keyUrl: cfg.keyUrl,
    provider,
    apiKey,
    // 注意：保留 systemPrompt 的 undefined 状态（不要 || ''），
    // 以便 streamAskAI 区分「用户从未设置（用内置默认）」与「用户已设置（含空串，严格按用户所写）」。
    systemPrompt: data.systemPrompt
  };
}

const SYSTEM_PROMPT = '你是一个精准的局部解答助手。请仔细阅读用户提供的【全局背景资料】、【用户划选位置】与【用户划选文字】，在该语境下针对用户的疑问进行解答。当用户划选的文字在资料中出现多处时，请以【用户划选位置】中用 ⟦ ⟧ 标出的确切实例为准，并结合其前后上下文进行精确分析。支持多轮对话，请参考历史对话保持上下文连贯。';

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

  // 从 chrome.storage 加载用户配置（API Key / 厂商 / 模型），支持对话框指定厂商
  const cfg = await getConfig(message.provider);

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
  // 选词精确定位信息（content.js 采集：带 ⟦⟧ 标记的局部片段 + 字符偏移 + 根容器标签）
  const selectionContext = message.selectionContext || null;

  // ★ 多轮对话：上下文放在 system 消息中（所有轮次都能看到），
  //   chatHistory 是之前的 Q&A 对，userQuestion 是本轮新问题。
  // 定位区块：用 ⟦⟧ 在局部片段中精确框定用户所选的"那一个"实例，
  // 并附字符偏移与根容器标签，使 AI 能在重复/相似文本中唯一锁定用户意图。
  let positionBlock = '';
  if (selectionContext && selectionContext.localFragment) {
    positionBlock = '【用户划选位置（精确锁定，⟦ ⟧ 内为所选确切实例）】：\n'
      + selectionContext.localFragment + '\n'
      + (selectionContext.absStart != null
        ? '（字符偏移：第 ' + selectionContext.absStart + '–' + selectionContext.absEnd + ' 位；所在位置：' + (selectionContext.rootLabel || '当前上下文') + '）\n'
        : '');
  }
  const contextBlock =
    (pageContext ? '【全局背景资料】：\n' + pageContext + '\n\n' : '')
    + (positionBlock ? positionBlock + '\n' : '')
    + (selectedText ? '【用户划选的局部片段】：\n' + selectedText : '');

  // 基础提示词（用户已在设置页看到并可编辑）：
  //   - 从未设置（cfg.systemPrompt === undefined）→ 使用内置 SYSTEM_PROMPT 默认提示词
  //   - 已设置（含空串）→ 严格按用户所写，空串表示不要基础提示词（仍会带上 contextBlock）
  const userPrompt =
    (cfg.systemPrompt !== undefined && cfg.systemPrompt !== null)
      ? cfg.systemPrompt
      : SYSTEM_PROMPT;
  const systemContent = userPrompt + (contextBlock ? '\n\n' + contextBlock : '');

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
    // 流自然结束（未收到 [DONE]），处理缓冲区残留的最后一帧数据
    clearTimeout(timeoutId);
    if (buffer.trim()) {
      const lastLine = buffer.trim();
      if (lastLine.startsWith('data:')) {
        const data = lastLine.slice(5).trim();
        if (data !== '[DONE]') {
          try {
            const json = JSON.parse(data);
            const chunk = json && json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
            if (chunk) { chunkCount++; sendToFrame({ type: 'AI_CHUNK', requestId, chunk }); }
          } catch (_) { /* ignore */ }
        }
      }
    }
    console.log('[Universal Sub-Agent] 流自然结束, 共', chunkCount, '个 chunk');
    sendToFrame({ type: 'AI_DONE', requestId });
  } catch (e) {
    clearTimeout(timeoutId);
    if (timedOut || e.name === 'AbortError') fail('响应中途中断超时。');
    else fail('流式解析异常：' + (e && e.message ? e.message : String(e)));
  }
}
