// ============================================================
// 验证：选词精确定位（字符偏移 + ⟦⟧ 标记局部片段）
//  1) content.js（jsdom 真实加载）：在含多处重复"平方"的公式中选中【第二个】平方，
//     断言采集到的 localFragment 用 ⟦平方⟧ 精确框定在第二个实例、字符偏移正确、根容器标签正确，
//     且经 ASK_AI 载荷完整透传给后台。
//  2) background.js（vm 真实加载）：断言 system 消息包含【用户划选位置】区块、
//     ⟦⟧ 标记片段、字符偏移说明；无 selectionContext 时不出现该区块（回归）。
//  3) 一致性：options.js DEFAULT_SYSTEM_PROMPT 与 background.js SYSTEM_PROMPT 完全一致。
// ============================================================
const fs = require('fs');
const vm = require('vm');
const path = require('path');

let pass = 0, failCount = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { failCount++; console.log('  ✗ ' + msg); }
}

// 从真实源码抽取常量，避免对照值漂移
const bgSrc = fs.readFileSync('background.js', 'utf8');
const mSys = bgSrc.match(/const SYSTEM_PROMPT = '(.*?)';/);
const EXPECTED_DEFAULT = mSys[1];
ok(!!EXPECTED_DEFAULT, '从 background.js 提取到 SYSTEM_PROMPT');
const optSrc = fs.readFileSync('options.js', 'utf8');
const mOpt = optSrc.match(/var DEFAULT_SYSTEM_PROMPT = '(.*?)';/);
ok(mOpt && mOpt[1] === EXPECTED_DEFAULT, 'options.js 与 background.js 默认提示词一致（单一事实源）');
ok(EXPECTED_DEFAULT.indexOf('⟦ ⟧') >= 0, '默认提示词已引导 AI 以 ⟦⟧ 标记实例为准');

// ============================================================
// 第 1 部分：content.js —— 精确锁定重复文本中的"那一个"
// ============================================================
console.log('\n=== 第 1 部分：content.js 选词精确定位（重复文本场景）===');
const { JSDOM } = require('C:\\Users\\111\\node_modules\\jsdom');
const CONTENT_JS = path.join(__dirname, 'content.js');
const src = fs.readFileSync(CONTENT_JS, 'utf8');

// 公式中含多处"平方"：a平方 + b平方 + c平方 + d平方
const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <div id="formula">能量 a平方 + b平方 + c平方 + d平方 守恒定理</div>
  </body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' }
);
const { window } = dom;
const { document } = window;

// 可控选区：让 window.getSelection() 返回我们构造的真实 Range
let fakeSel = {
  _text: '', _range: null, rangeCount: 0,
  toString() { return this._text; },
  getRangeAt() { return this._range; }
};
window.getSelection = () => fakeSel;

const sentMessages = [];
const storedData = { apiKeys: { deepseek: 'sk-test' }, provider: 'deepseek' };
window.chrome = {
  runtime: {
    id: 'test-extension-id', lastError: undefined,
    getURL: (p) => 'chrome-extension://test-extension-id/' + p,
    sendMessage: (msg, cb) => { sentMessages.push(msg); if (typeof cb === 'function') cb(undefined); },
    onMessage: { addListener: () => {} }
  },
  storage: { local: { get: (k, cb) => cb(Object.assign({}, storedData)), set: (d, cb) => { Object.assign(storedData, d); cb && cb(); } } }
};
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
}

// 加载真实 content.js（会创建 #universal-sub-agent-host 并挂监听）
window.eval(src);

const host = document.getElementById('universal-sub-agent-host');
const shadow = host.shadowRoot;
const btn = shadow.querySelector('.usa-btn');

function dispatchMouseUp(x, y) {
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
}
function clickBtn() {
  btn.dispatchEvent(new window.MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
}
function getDialogs() { return Array.from(shadow.querySelectorAll('.usa-dialog')); }
function sendQuestion(win, q) {
  const input = win.querySelector('.usa-input');
  const send = win.querySelector('.usa-send');
  input.value = q;
  send.dispatchEvent(new window.MouseEvent('click', { clientX: 1, clientY: 1, bubbles: true }));
  return sentMessages[sentMessages.length - 1];
}

// 构造"选中第二个 平方"的真实 Range
const div = document.getElementById('formula');
const textNode = div.firstChild;           // 单一文本节点
const full = textNode.nodeValue;
const firstIdx = full.indexOf('平方');
const secondIdx = full.indexOf('平方', firstIdx + 1);   // 第二个"平方"的起始索引
ok(firstIdx >= 0 && secondIdx > firstIdx, '测试数据：公式中存在多处"平方"（first=' + firstIdx + ', second=' + secondIdx + '）');

const range = {
  startContainer: textNode, startOffset: secondIdx,
  endContainer: textNode, endOffset: secondIdx + 2,   // "平方" 长度 = 2
  getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
};
fakeSel._text = '平方';
fakeSel.rangeCount = 1;
fakeSel._range = range;

// 触发 mouseup → content.js 采集 currentSelectionCtx
dispatchMouseUp(60, 60);

// currentSelectionCtx 是私有变量，无法直接读；通过 ASK_AI 载荷间接验证。
clickBtn();
const dlg = getDialogs()[0];
ok(!!dlg, '已打开对话框（用于驱动 send 以捕获载荷）');
const msg = sendQuestion(dlg, '请推导这个平方项的来源');
ok(!!msg && msg.type === 'ASK_AI', '捕获到 ASK_AI 载荷');

const selCtx = msg && msg.selectionContext;
ok(!!selCtx && typeof selCtx.localFragment === 'string', '载荷携带 selectionContext.localFragment');
if (selCtx) {
  const frag = selCtx.localFragment;
  const markerIdx = frag.indexOf('⟦平方⟧');
  ok(markerIdx >= 0, 'localFragment 用 ⟦平方⟧ 标出了所选实例');
  // 关键断言：标记落在 SECOND 平方（而非第一个），且全片段仅一处标记
  ok(markerIdx === secondIdx, '⟦平方⟧ 精确定位在【第二个】平方（偏移=' + secondIdx + '，非第一个）');
  ok(frag.indexOf('⟦平方⟧') === frag.lastIndexOf('⟦平方⟧'), '整段片段中仅一处 ⟦⟧ 标记，绝不混淆重复文本');
  // 片段应展示该实例独有的前后文，使 AI 能区分：
  // 选中的「平方」是 "b平方" 中的那个（紧接 b 之后），其后紧跟 " + c平方" —— 以此唯一锁定，而非 a/c/d 的「平方」。
  ok(frag.indexOf('b⟦平方⟧') >= 0, '局部片段显示标记实例紧接在 b 之后（即 b平方 中的那个平方）');
  ok(frag.indexOf('⟦平方⟧ + c平方') >= 0, '局部片段显示标记实例其后紧跟 + c平方，可唯一区分重复文本');
  // 字符偏移
  ok(selCtx.absStart === secondIdx && selCtx.absEnd === secondIdx + 2,
    '字符偏移正确：absStart=' + secondIdx + ', absEnd=' + (secondIdx + 2));
  // 根容器标签
  ok(typeof selCtx.rootLabel === 'string' && selCtx.rootLabel.indexOf('div') >= 0 && selCtx.rootLabel.indexOf('#formula') >= 0,
    '根容器标签正确：' + selCtx.rootLabel);
}

// ============================================================
// 第 2 部分：background.js —— 实际发给 LLM 的 system 内容
// ============================================================
console.log('\n=== 第 2 部分：background.js 拼接【用户划选位置】区块 ===');

let lastMessages = null;
let scenarioData = null;
const ctx = {
  console, setTimeout, clearTimeout, AbortController, TextDecoder,
  fetch: async (url, opts) => { lastMessages = JSON.parse(opts.body).messages; return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true, value: undefined }) }) } }; },
  chrome: {
    storage: { local: { get: (keys) => Promise.resolve(scenarioData), set: (o, cb) => { cb && cb(); }, remove: (k, cb) => { cb && cb(); } } },
    tabs: { sendMessage: () => {} },
    runtime: { lastError: null, onInstalled: { addListener: () => {} }, onMessage: { addListener: (fn) => { ctx.__handler = fn; } } }
  }
};
vm.createContext(ctx);
vm.runInContext(bgSrc, ctx);

async function runScenario(name, data, assertFn) {
  scenarioData = data; lastMessages = null;
  ctx.__handler(
    Object.assign({ type: 'ASK_AI', requestId: 'r1', provider: 'deepseek', userQuestion: '推导这个平方项', chatHistory: [] }, data),
    { tab: { id: 1 }, frameId: 0 }, () => {}
  );
  await new Promise(r => setTimeout(r, 30));
  const sys = lastMessages && lastMessages[0] ? lastMessages[0].content : '';
  console.log('  [' + name + '] system 前缀: ' + sys.slice(0, 24).replace(/\n/g, '\\n'));
  assertFn(sys);
}

(async () => {
  const sampleCtx = {
    localFragment: '能量 a平方 + b平方 + ⟦平方⟧ + c平方 + d平方 守恒定理',
    absStart: secondIdx, absEnd: secondIdx + 2, rootLabel: 'div#formula'
  };

  // 场景 A：带 selectionContext → system 必须含【用户划选位置】+ ⟦⟧ + 偏移
  await runScenario('A 带定位信息', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek',
    selectedText: '平方', pageContext: '能量 a平方 + b平方 + c平方 + d平方 守恒定理',
    selectionContext: sampleCtx
  }, (sys) => {
    ok(sys.indexOf('【用户划选位置（精确锁定') >= 0, '场景A：出现【用户划选位置（精确锁定）】区块');
    ok(sys.indexOf('⟦平方⟧') >= 0, '场景A：system 内含 ⟦平方⟧ 标记（精确框定实例）');
    ok(sys.indexOf('字符偏移：第 ' + secondIdx + '–' + (secondIdx + 2) + ' 位') >= 0, '场景A：含字符偏移说明');
    ok(sys.indexOf('div#formula') >= 0, '场景A：含根容器位置标签');
    ok(sys.indexOf(EXPECTED_DEFAULT) >= 0, '场景A：仍拼接默认基础提示词');
  });

  // 场景 B：无 selectionContext（旧行为/普通选词）→ 不应出现该区块（回归）
  await runScenario('B 无定位信息', {
    apiKeys: { deepseek: 'sk-x' }, provider: 'deepseek',
    selectedText: '平方', pageContext: '能量 a平方 + b平方 + c平方 + d平方 守恒定理'
  }, (sys) => {
    ok(sys.indexOf('【用户划选位置（精确锁定') < 0, '场景B：无定位信息时不含【用户划选位置】区块（回归旧行为）');
    ok(sys.indexOf('【全局背景资料】') >= 0, '场景B：普通上下文块仍正常');
  });

  console.log('\n========================================');
  console.log('结果：' + pass + ' 通过，' + failCount + ' 失败');
  console.log('========================================');
  process.exit(failCount === 0 ? 0 : 1);
})();
