globalThis.USA_CONFIG = {
  PROVIDERS: {
    deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash', extraHeaders: {}, keyUrl: 'https://platform.deepseek.com/api_keys' },
    qwen: { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-turbo', extraHeaders: {}, keyUrl: 'https://bailian.console.aliyun.com/#/api-key' },
    glm: { name: '智谱GLM', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash', extraHeaders: {}, keyUrl: 'https://open.bigmodel.cn/manage/apikey' },
    kimi: { name: 'Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k', extraHeaders: {}, keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
    openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'meta-llama/llama-3-8b-instruct', extraHeaders: { 'HTTP-Referer': 'https://github.com/mirtabesy821-source/Universal-Sub-Agent', 'X-Title': 'Universal Sub-Agent' }, keyUrl: 'https://openrouter.ai/keys' },
    mimo: { name: 'MiMo', url: 'https://api.xiaomimimo.com/v1/chat/completions', model: 'mimo-v2.5-pro', extraHeaders: {}, keyUrl: 'https://mimo.mi.com' }
  },
  DEFAULT_PROVIDER: 'deepseek',
  DEFAULT_SYSTEM_PROMPT: '你是一个精准的局部解答助手。请仔细阅读用户提供的【全局背景资料】、【用户划选位置】与【用户划选文字】，在该语境下针对用户的疑问进行解答。当用户划选的文字在资料中出现多处时，请以【用户划选位置】中用 ⟦ ⟧ 标出的确切实例为准，并结合其前后上下文进行精确分析。支持多轮对话，请参考历史对话保持上下文连贯。'
};
