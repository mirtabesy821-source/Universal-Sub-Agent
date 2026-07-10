// ============================================================
// 验证：System Prompt 可视化编辑
//  1) options.js：加载时预填默认 / 展示已存 / 清空为空 / 恢复默认 / 保存写入
//  2) background.js：四种场景下发给 LLM 的 system content 是否正确
// 真实加载源码（jsdom + vm），非伪造断言。
// ============================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { failCount++; console.log('  ✗ ' + msg); }
}

// 从真实源码抽取后台的 SYSTEM_PROMPT 常量，确保测试对照的是真值（避免漂移）
const bgSrc = fs.readFileSync('background.js', 'utf8');
const m = bgSrc.match(/const SYSTEM_PROMPT = '(.*?)';/);
const EXPECTED_DEFAULT = m[1];
ok(!!EXPECTED_DEFAULT, '从 background.js 提取到 SYSTEM_PROMPT 常量');

// options.js 中的 DEFAULT_SYSTEM_PROMPT 必须与后台 SYSTEM_PROMPT 完全一致
const optSrc = fs.readFileSync('options.js', 'utf8');
const m2 = optSrc.match(/var DEFAULT_SYSTEM_PROMPT = '(.*?)';/);
ok(m2 && m2[1] === EXPECTED_DEFAULT, 'options.js 的 DEFAULT_SYSTEM_PROMPT 与后台 SYSTEM_PROMPT 一致（单一事实源）');

// ============================================================
// 第 1 部分：options.js（jsdom 真实加载）
// ============================================================
console.log('\n=== 第 1 部分：options.js 设置页行为 ===');
const { JSDOM } = require('C:\\Users\\111\\node_modules\\jsdom');
const html = fs.readFileSync('options.html', 'utf8').replace('<script src="options.js"></script>', '');
const dom = new JSDOM(html, { runScripts: 'outside-only' });
const { window } = dom;

function makeChrome(initialStore) {
  const store = initialStore;
  return {
    storage: {
      local: {
        get: (keys, cb) => { cb(store); },
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete store[k]); cb && cb(); }
      }
    },
    runtime: { lastError: null }
  };
}

// --- 场景 1：从未设置 systemPrompt（storage 无此键）→ 预填默认 ---
let store = { provider: 'deepseek' };
window.chrome = makeChrome(store);
window.eval(optSrc);
ok(window.document.getElementById('systemPrompt').value === EXPECTED_DEFAULT,
  '场景1 未设置：文本框预填默认提示词');
ok(store.systemPrompt === undefined,
  '场景1 未设置：不写入 storage（保持后台走内置默认）');

// --- 场景 2：已保存自定义提示词 → 展示已存内容 ---
store = { provider: 'deepseek', systemPrompt: '请用文言文回答。' };
window.chrome = makeChrome(store);
window.eval(optSrc);
ok(window.document.getElementById('systemPrompt').value === '请用文言文回答。',
  '场景2 已设置：展示用户已存的自定义提示词');

// --- 场景 3：已保存空串（用户清空并保存过）→ 文本框为空 ---
store = { provider: 'deepseek', systemPrompt: '' };
window.chrome = makeChrome(store);
window.eval(optSrc);
ok(window.document.getElementById('systemPrompt').value === '',
  '场景3 已清空保存：文本框为空（不再隐藏默认）');

// --- 场景 4：点击"恢复默认提示词" → 文本框重置为默认 ---
window.document.getElementById('resetPrompt').click();
ok(window.document.getElementById('systemPrompt').value === EXPECTED_DEFAULT,
  '场景4 恢复默认按钮：文本框重置为默认提示词');

// --- 场景 5：清空后保存 → storage 写入空串 ---
store = { provider: 'deepseek' };
window.chrome = makeChrome(store);
window.eval(optSrc);
window.document.getElementById('apiKey').value = 'sk-test-xxx';
window.document.getElementById('systemPrompt').value = '';        // 用户清空
window.document.getElementById('saveBtn').click();
ok(store.systemPrompt === '',
  '场景5 清空保存：storage.systemPrompt 写入空串（后台将不再附加基础提示词）');

// --- 场景 6：在默认基础上修改后保存 → 写入修改版 ---
store = { provider: 'deepseek' };
window.chrome = makeChrome(store);
window.eval(optSrc);
window.document.getElementById('apiKey').value = 'sk-test-xxx';
const edited = EXPECTED_DEFAULT + '\n额外要求：回答尽量简短。';
window.document.getElementById('systemPrompt').value = edited;
window.document.getElementById('saveBtn').click();
ok(store.systemPrompt === edited,
  '场景6 修改后保存：storage 写入用户编辑后的提示词');

// --- 场景 7：结构面板展示两个自动块标签，且括号内文字不在可编辑文本框内（锁定）---
const struct = window.document.querySelector('.prompt-structure');
ok(struct && struct.textContent.indexOf('【全局背景资料】') >= 0,
  '场景7 结构面板展示【全局背景资料】标签');
ok(struct && struct.textContent.indexOf('【用户划选的局部片段】') >= 0,
  '场景7 结构面板展示【用户划选的局部片段】标签');
ok(store.systemPrompt.indexOf('②') < 0 && store.systemPrompt.indexOf('③') < 0,
  '场景7 保存内容不含系统自动块的锁定序号标记（②/③），不会被当作用户输入');
const lockedEls = window.document.querySelectorAll('.ps-locked');
let allLocked = lockedEls.length === 2;
lockedEls.forEach(function (el) { if (el.getAttribute('contenteditable') === 'true') allLocked = false; });
ok(allLocked, '场景7 两个自动块标签均为非编辑元素（contenteditable 不为 true）');

// ============================================================
// 第 2 部分：background.js（vm 真实加载，捕获实际发出的 messages）
// ============================================================
console.log('\n=== 第 2 部分：background.js 实际发给 LLM 的 system content ===');

let lastMessages = null;
let scenarioData = null;
const ctx = {
  console,
  setTimeout, clearTimeout,
  AbortController,
  TextDecoder,
  fetch: async (url, opts) => {
    lastMessages = JSON.parse(opts.body).messages;
    return {
      ok: true,
      body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) }
    };
  },
  chrome: {
    storage: {
      local: {
        get: (keys) => Promise.resolve(scenarioData),
        set: (obj, cb) => { cb && cb(); },
        remove: (keys, cb) => { cb && cb(); }
      }
    },
    tabs: { sendMessage: () => {} },
    runtime: {
      lastError: null,
      onInstalled: { addListener: () => {} },
      onMessage: { addListener: (fn) => { ctx.__handler = fn; } }
    }
  }
};
vm.createContext(ctx);
vm.runInContext(bgSrc, ctx);

async function runScenario(name, data, assertFn) {
  scenarioData = data;
  lastMessages = null;
  ctx.__handler(
    { type: 'ASK_AI', requestId: 'r1', provider: 'deepseek',
      selectedText: '用户划选的局部片段内容', pageContext: '网页全局背景资料',
      userQuestion: '这是什么？', chatHistory: [] },
    { tab: { id: 1 }, frameId: 0 },
    () => {}
  );
  await new Promise(r => setTimeout(r, 30));
  const sys = lastMessages && lastMessages[0] ? lastMessages[0].content : '';
  console.log('  [' + name + '] system 前缀: ' + sys.slice(0, 30).replace(/\n/g, '\\n') + '...');
  assertFn(sys);
}

(async () => {
  // 场景 A：从未设置 systemPrompt → 用内置默认 + 上下文
  await runScenario('A 未设置', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek'
  }, (sys) => {
    ok(sys.startsWith(EXPECTED_DEFAULT), '场景A：使用内置默认提示词');
    ok(sys.indexOf('【全局背景资料】') >= 0 && sys.indexOf('网页全局背景资料') >= 0, '场景A：附加上下文');
  });

  // 场景 B：已设置空串 → 不要基础提示词，但仍附加上下文
  await runScenario('B 已清空', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek', systemPrompt: ''
  }, (sys) => {
    ok(sys.indexOf(EXPECTED_DEFAULT) < 0, '场景B：不含默认提示词（用户已清空）');
    ok(sys.indexOf('【全局背景资料】') >= 0 && sys.indexOf('网页全局背景资料') >= 0, '场景B：仍附加上下文块');
    ok(sys.trim().startsWith('【全局背景资料】'), '场景B：system 直接以上下文块开头');
  });

  // 场景 C：已设置自定义 → 严格按用户所写 + 上下文
  await runScenario('C 自定义', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek', systemPrompt: '请用文言文回答。'
  }, (sys) => {
    ok(sys.startsWith('请用文言文回答。'), '场景C：使用用户自定义提示词');
    ok(sys.indexOf(EXPECTED_DEFAULT) < 0, '场景C：不含默认提示词');
    ok(sys.indexOf('【用户划选的局部片段】') >= 0, '场景C：附加上下文块');
  });

  // 场景 D：设置成默认文本本身 → 与默认一致
  await runScenario('D 默认文本', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek', systemPrompt: EXPECTED_DEFAULT
  }, (sys) => {
    ok(sys.startsWith(EXPECTED_DEFAULT), '场景D：使用与默认一致的提示词');
    ok(sys.indexOf('【全局背景资料】') >= 0, '场景D：附加上下文块');
  });

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过，' + failCount + ' 失败');
  console.log('========================================');
  process.exit(failCount === 0 ? 0 : 1);
})();
