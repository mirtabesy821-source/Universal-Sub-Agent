// 嵌套选词上下文透传 —— 功能验证（使用 jsdom 加载真实 content.js）
// 覆盖：
//   两级：窗口一(网页选词) → 窗口二(窗口一内选词)
//   三级：窗口二 → 窗口三(窗口二内选词)
//   回归：窗口三里选的词同时出现在窗口一&窗口二的对话中时，
//        仍必须命中【直接父窗口=窗口二】，绝不能错误跳回窗口一。

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:\\Users\\111\\node_modules\\jsdom');

const CONTENT_JS = path.join(__dirname, 'content.js');
const src = fs.readFileSync(CONTENT_JS, 'utf8');

// ---- 1. 构建 DOM ----
const dom = new JSDOM(
  `<!DOCTYPE html><html><body>
    <article id="art">量子纠缠是一种量子力学现象，描述了两个或多个粒子相互关联的状态，
    即使相距遥远也会保持叠加态关联。这是量子信息科学的重要基础。</article>
  </body></html>`,
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' }
);

const { window } = dom;
const { document } = window;

// ---- 2. 可控的选区（content.js 全程依赖 window.getSelection） ----
let fakeSel = {
  _text: '',
  _range: null,
  rangeCount: 0,
  toString() { return this._text; },
  getRangeAt(i) { return this._range; }
};
window.getSelection = () => fakeSel;

// startContainer：传入对话框的 .usa-chat 元素即可（其 getRootNode 返回宿主 ShadowRoot，
// 命中策略一）；也可传入一个游离节点（getRootNode===document，强制策略一失败→走策略二）。
function setSelection(text, startContainer) {
  fakeSel._text = text;
  fakeSel.rangeCount = 1;
  fakeSel._range = {
    startContainer: startContainer,
    commonAncestorContainer: startContainer,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
  };
}
// 构造一个“游离节点”，强制策略一失败，专门测试策略二（文本兜底）的逆序修复。
function detachedNode() {
  const n = document.createElement('span');
  n.getRootNode = () => document; // 让策略一的 ShadowRoot 判断失效
  return n;
}

// ---- 3. 模拟 chrome 运行时 ----
const sentMessages = [];
const onMessageListeners = [];
const storedData = { apiKeys: { deepseek: 'sk-test' }, provider: 'deepseek' };

window.chrome = {
  runtime: {
    id: 'test-extension-id',
    lastError: undefined,
    getURL: (p) => 'chrome-extension://test-extension-id/' + p,
    sendMessage: (msg, cb) => {
      sentMessages.push(msg);
      if (typeof cb === 'function') cb(undefined);
    },
    onMessage: {
      addListener: (fn) => { onMessageListeners.push(fn); },
      _dispatch: (msg) => { onMessageListeners.forEach((f) => f(msg)); }
    }
  },
  storage: {
    local: {
      get: (keys, cb) => { cb(Object.assign({}, storedData)); },
      set: (data, cb) => { Object.assign(storedData, data); if (cb) cb(); }
    }
  }
};

if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
}

// ---- 4. 加载真实 content.js ----
window.eval(src);

// ---- 5. 工具函数 ----
const host = document.getElementById('universal-sub-agent-host');
const shadow = host.shadowRoot;
const btn = shadow.querySelector('.usa-btn');

function dispatchMouseUp(x, y) {
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
}
// 在指定元素上派发 mouseup（composed:true），使其冒泡到 document 且 e.composedPath()
// 包含该元素——用于验证「基于 composedPath 的来源窗口判定」这条核心修复路径。
function dispatchMouseUpIn(target, x, y) {
  target.dispatchEvent(new window.MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true, composed: true }));
}
function clickBtn() {
  btn.dispatchEvent(new window.MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
}
function getDialogs() {
  return Array.from(shadow.querySelectorAll('.usa-dialog'));
}
// 模拟后台为指定 requestId 流式推送回答，再发 DONE
function simulateAnswer(reqId, fullText) {
  const chunks = fullText.match(/[\s\S]{1,6}/g) || [fullText];
  chunks.forEach((c) => window.chrome.runtime.onMessage._dispatch({ type: 'AI_CHUNK', requestId: reqId, chunk: c }));
  window.chrome.runtime.onMessage._dispatch({ type: 'AI_DONE', requestId: reqId });
}
function sendQuestion(win, q) {
  const input = win.querySelector('.usa-input');
  const send = win.querySelector('.usa-send');
  input.value = q;
  send.dispatchEvent(new window.MouseEvent('click', { clientX: 1, clientY: 1, bubbles: true }));
  return sentMessages[sentMessages.length - 1];
}

let failures = 0;
function assert(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { failures++; console.log('  ❌ ' + label); }
}

const article = document.getElementById('art');

// =====================================================================
console.log('\n=== 步骤 1：在网页上选词，打开窗口一 ===');
setSelection('量子纠缠', article.firstChild);
dispatchMouseUp(50, 50);
clickBtn();
let dialogs = getDialogs();
assert(dialogs.length === 1, '窗口一已创建');
let win1 = dialogs[0];
assert(win1.querySelector('.usa-selected').textContent === '量子纠缠', '窗口一的选词内容 = 量子纠缠');

// =====================================================================
console.log('\n=== 步骤 2：窗口一提问并收到回答（含“叠加态”，不含“退相干”） ===');
let m1 = sendQuestion(win1, '请详细解释量子纠缠');
assert(m1.type === 'ASK_AI', '窗口一已向后台发送 ASK_AI');
assert(m1.selectedText === '量子纠缠', '窗口一携带选词 量子纠缠');
simulateAnswer(m1.requestId, '当两个粒子处于叠加态时，测量其中一个会瞬间决定另一个的状态。');
assert((win1.querySelector('.usa-chat').textContent || '').includes('叠加态'), '窗口一回答含“叠加态”');
assert(!(win1.querySelector('.usa-chat').textContent || '').includes('退相干'), '窗口一回答不含“退相干”(唯一标识词仅属于窗口二)');

// =====================================================================
console.log('\n=== 步骤 3：在窗口一回答内选“叠加态” → 打开窗口二（含空选区 mouseup 回归） ===');
let win1Chat = win1.querySelector('.usa-chat');
setSelection('叠加态', win1Chat);
dispatchMouseUpIn(win1, 60, 60);                          // 在窗口一对话框上派发 → 走 composedPath 来源判定
setSelection('', null); dispatchMouseUp(60, 60);            // 点击按钮时的空选区 mouseup 不应清空来源
setSelection('叠加态', win1Chat);
clickBtn();
dialogs = getDialogs();
assert(dialogs.length === 2, '窗口二已创建（共 2 个对话框）');
let win2 = dialogs[1];
let ctx2 = sendQuestion(win2, '这个叠加态具体指什么？').pageContext || '';
assert(ctx2.includes('【来源窗口的页面上下文】'), '窗口二上下文含 窗口一 的页面上下文标记');
assert(ctx2.includes('量子纠缠'), '窗口二上下文含 窗口一 原始选词 量子纠缠');
assert(ctx2.includes('测量其中一个会瞬间决定另一个的状态'), '窗口二上下文含 窗口一 完整回答');
assert(win2.querySelector('.usa-selected').textContent === '叠加态', '窗口二局部片段=本次高亮的“叠加态”');

// =====================================================================
console.log('\n=== 步骤 4：窗口二提问并收到回答（同时含“叠加态”和唯一词“退相干”） ===');
// 关键：窗口二回答既含“叠加态”(与窗口一重叠)，又含“退相干”(窗口二独有)。
simulateAnswer(sendQuestion(win2, '这个叠加态具体指什么？').requestId,
  '叠加态是一种概率幅的线性组合，与退相干现象密切相关。');
assert((win2.querySelector('.usa-chat').textContent || '').includes('退相干'), '窗口二回答含唯一词“退相干”');
assert((win2.querySelector('.usa-chat').textContent || '').includes('叠加态'), '窗口二回答含“叠加态”');

// =====================================================================
console.log('\n=== 步骤 5（三级·真实路径）：在窗口二回答内选“退相干” → 打开窗口三 ===');
let win2Chat = win2.querySelector('.usa-chat');
setSelection('退相干', win2Chat);   // 选区位于窗口二对话框内
dispatchMouseUpIn(win2, 70, 70);   // 在窗口二对话框上派发 → 走 composedPath 来源判定（核心修复路径）
clickBtn();
dialogs = getDialogs();
assert(dialogs.length === 3, '窗口三已创建（共 3 个对话框）');
let win3 = dialogs[2];
let ctx3 = sendQuestion(win3, '退相干和叠加态有什么关系？').pageContext || '';
console.log('\n---- 窗口三 pageContext 预览(前 300 字) ----\n' + ctx3.slice(0, 300) + '\n------------------------------------------\n');
assert(ctx3.includes('【来源窗口的页面上下文】'), '窗口三上下文含 来源窗口 标记');
assert(ctx3.includes('退相干'), '【关键】窗口三继承了【直接父窗口=窗口二】的独有内容“退相干”(证明没跳回窗口一)');
assert(win3.querySelector('.usa-selected').textContent === '退相干', '窗口三局部片段=“退相干”');

// =====================================================================
console.log('\n=== 步骤 6（三级·回归）：选“叠加态”(窗口一&窗口二都出现) + 强制策略一失败 → 仍须命中窗口二 ===');
// 制造最苛刻条件：所选文本“叠加态”同时出现在窗口一、窗口二对话；且选区节点为游离节点，
// 强制策略一失效，仅剩策略二文本兜底。旧代码(正序)会错误返回窗口一，新代码(逆序)返回窗口二。
setSelection('叠加态', detachedNode());
dispatchMouseUp(70, 70);
setSelection('', null); dispatchMouseUp(70, 70);   // 空选区 mouseup 不污染
setSelection('叠加态', detachedNode());
clickBtn();
dialogs = getDialogs();
assert(dialogs.length === 3, '窗口三(回归用例)已创建，且未超出上限(窗口一被 FIFO 回收)');
let win3b = dialogs[dialogs.length - 1];
let ctx3b = sendQuestion(win3b, '叠加态为什么重要？').pageContext || '';
assert(ctx3b.includes('退相干'), '【关键回归】即使“叠加态”多层重叠 + 策略一失效，窗口三仍继承【窗口二】独有内容“退相干”，未错误跳回窗口一');

// =====================================================================
console.log('\n========================================');
if (failures === 0) {
  console.log('🎉 全部断言通过：多级嵌套(≥3层)均正确继承【直接父窗口】上下文，链条不跳层。');
} else {
  console.log('⚠️  存在 ' + failures + ' 项断言失败，需复查。');
}
console.log('========================================');

try { window.close(); } catch (e) {}
process.exit(failures === 0 ? 0 : 1);
