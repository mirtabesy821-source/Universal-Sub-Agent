// 公式选词显示 & 公式渲染 功能验证（使用 jsdom 加载真实 content.js）
// 覆盖：
//   1) extractKatexSource / getSelectionText：选中 KaTeX 公式返回干净 TeX（e² → $e^2$），而非 "e 2"
//   2) captureSelectionInfo：公式选词短路返回 isFormula + ⟦$e^2$⟧，避免 textContent 重复文本错乱
//   3) renderInline：货币 $5 / $10.50 不被误当公式；$e^2$ 正常转 \(e^2\)
//   4) renderMathOnly：* _ ` 不被当作 Markdown；公式正常转 \(e^2\)
//   5) 端到端：mouseup 选中公式 → 发送 → ASK_AI 载荷 selectedText=$e^2$、selectionContext.isFormula=true

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:\\Users\\111\\node_modules\\jsdom');

const CONTENT_JS = path.join(__dirname, 'content.js');
let src = fs.readFileSync(CONTENT_JS, 'utf8');
// 测试专用：在 IIFE 闭合前把内部函数暴露到 window.__test（不修改源码文件）
src = src.replace(/\}\)\(\);\s*$/,
  'window.__test={getSelectionText:getSelectionText,captureSelectionInfo:captureSelectionInfo,renderInline:renderInline,renderMathOnly:renderMathOnly,looksLikeCurrency:looksLikeCurrency,extractMathSource:extractMathSource,closestMathContainer:closestMathContainer,extractTexFromMathContainer:extractTexFromMathContainer};\n})();');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ---- DOM ----
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const { document } = window;
window.katex = undefined;
window.renderMathInElement = undefined;   // 走“无 KaTeX”分支，避免 jsdom 无渲染库报错

// ---- 可控选区 ----
let fakeSel = { _text: '', _range: null, rangeCount: 0, toString() { return this._text; }, getRangeAt(i) { return this._range; } };
window.getSelection = () => fakeSel;

// 构造一个 KaTeX 公式 DOM（MathML 标注 + 可视 span）
function buildKatex(tex, visual) {
  const k = document.createElement('span'); k.className = 'katex';
  const mm = document.createElement('span'); mm.className = 'katex-mathml';
  const anno = document.createElement('annotation'); anno.setAttribute('encoding', 'application/x-tex'); anno.textContent = tex;
  mm.appendChild(anno); k.appendChild(mm);
  const html = document.createElement('span'); html.className = 'katex-html'; html.textContent = visual;
  k.appendChild(html);
  document.body.appendChild(k);
  return { k, visText: html.firstChild };   // visText 是可视文本节点 "e2"
}
// 普通文本节点（无 .katex 祖先）
function buildPlain(text) {
  const d = document.createElement('div'); d.textContent = text; document.body.appendChild(d);
  return d.firstChild;
}
function setKatexSelection(tex, visual) {
  const { visText } = buildKatex(tex, visual);
  setRangeOn(visText, visual.length);
}
// 构造 MathJax v2 公式 DOM（外层 .MathJax，内含 <script type="math/tex"> 源码）
function buildMathjaxV2(tex, visual, display) {
  const outer = document.createElement('span'); outer.className = 'MathJax';
  const inner = document.createElement('span'); inner.className = 'math';
  const script = document.createElement('script');
  script.type = display ? 'math/tex; mode=display' : 'math/tex';
  script.textContent = tex;
  inner.appendChild(script);
  const rendered = document.createElement('span'); rendered.textContent = visual;
  inner.appendChild(rendered);
  outer.appendChild(inner);
  document.body.appendChild(outer);
  return { container: outer, visText: rendered.firstChild };
}
// 构造 MathJax v3 公式 DOM（<mjx-container class="MathJax">，内含 <script type="math/tex"> 源码）
function buildMathjaxV3(tex, visual, display) {
  const c = document.createElement('mjx-container'); c.className = 'MathJax';
  const script = document.createElement('script');
  script.type = display ? 'math/tex; mode=display' : 'math/tex';
  script.textContent = tex;
  c.appendChild(script);
  const rendered = document.createElement('span'); rendered.textContent = visual;
  c.appendChild(rendered);
  document.body.appendChild(c);
  return { container: c, visText: rendered.firstChild };
}
// 在指定可视文本节点上设置整段选区
function setRangeOn(visText, len) {
  fakeSel._text = visText.textContent; fakeSel.rangeCount = 1;
  fakeSel._range = {
    startContainer: visText, endContainer: visText, startOffset: 0, endOffset: len,
    commonAncestorContainer: visText,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
  };
}
function setMathjaxV2Selection(tex, visual) {
  const { visText } = buildMathjaxV2(tex, visual, false);
  setRangeOn(visText, visual.length);
}
function setMathjaxV3Selection(tex, visual) {
  const { visText } = buildMathjaxV3(tex, visual, false);
  setRangeOn(visText, visual.length);
}
function setPlainSelection(text) {
  const node = buildPlain(text);
  fakeSel._text = text; fakeSel.rangeCount = 1;
  fakeSel._range = {
    startContainer: node, endContainer: node, startOffset: 0, endOffset: text.length,
    commonAncestorContainer: node,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
  };
}

// ---- chrome 运行时 ----
const sentMessages = [];
const onMessageListeners = [];
const storedData = { apiKeys: { deepseek: 'sk-test' }, provider: 'deepseek' };
window.chrome = {
  runtime: {
    id: 'test-extension-id', lastError: undefined,
    getURL: (p) => 'chrome-extension://test-extension-id/' + p,
    sendMessage: (msg, cb) => { sentMessages.push(msg); if (typeof cb === 'function') cb(undefined); },
    onMessage: { addListener: (fn) => onMessageListeners.push(fn), _dispatch: (m) => onMessageListeners.forEach((f) => f(m)) }
  },
  storage: { local: { get: (k, cb) => cb(Object.assign({}, storedData)), set: (d, cb) => { Object.assign(storedData, d); if (cb) cb(); } } }
};
if (typeof window.requestAnimationFrame !== 'function') window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);

// ---- 加载真实 content.js ----
window.eval(src);
const T = window.__test;

// ============ Part A：单元级（直接调用真实源码函数） ============
console.log('\n=== Part A：公式选词采集 ===');
setKatexSelection('e^2', 'e2');
ok(T.getSelectionText() === '$e^2$', '选中 e²(KaTeX) → "$e^2$" 而非 "e 2"');
setPlainSelection('能量 a平方 b平方 守恒');
ok(T.getSelectionText() === '能量 a平方 b平方 守恒', '普通文本选词 → 原样返回（无 KaTeX 祖先）');

setKatexSelection('e^2', 'e2');
const info = T.captureSelectionInfo();
ok(info && info.isFormula === true, 'captureSelectionInfo：公式选词 isFormula=true');
ok(info && info.localFragment === '⟦$e^2$⟧', 'captureSelectionInfo：局部片段 ⟦$e^2$⟧（无重复文本错乱）');
ok(info && info.absStart === null && info.absEnd === null, 'captureSelectionInfo：公式偏移为 null（交给 ⟦⟧ 锁定）');

// --- MathJax v2 ---
setMathjaxV2Selection('x^2+y^2', 'x2+y2');
ok(T.getSelectionText() === '$x^2+y^2$', 'MathJax v2 选中 x²+y² → "$x^2+y^2$" 而非 "x 2 + y 2"');
const infoMj2 = T.captureSelectionInfo();
ok(infoMj2 && infoMj2.isFormula === true, 'MathJax v2：captureSelectionInfo isFormula=true');
ok(infoMj2 && infoMj2.localFragment === '⟦$x^2+y^2$⟧', 'MathJax v2：局部片段 ⟦$x^2+y^2$⟧');
ok(infoMj2 && /MathJax/.test(infoMj2.rootLabel || ''), 'MathJax v2：rootLabel 含 "MathJax"');

// --- MathJax v3 ---
setMathjaxV3Selection('\\frac{a}{b}', 'ab');
ok(T.getSelectionText() === '$\\frac{a}{b}$', 'MathJax v3 选中 a/b → "$\\frac{a}{b}$" 而非 "a b"');
const infoMj3 = T.captureSelectionInfo();
ok(infoMj3 && infoMj3.isFormula === true, 'MathJax v3：captureSelectionInfo isFormula=true');
ok(infoMj3 && infoMj3.localFragment === '⟦$\\frac{a}{b}$⟧', 'MathJax v3：局部片段 ⟦$\\frac{a}{b}$⟧');
ok(infoMj3 && /MathJax/.test(infoMj3.rootLabel || ''), 'MathJax v3：rootLabel 含 "MathJax"');

// --- 跨渲染器单元级确认 extractTexFromMathContainer 直接取值 ---
const kc = buildKatex('E=mc^2', 'Emc2').k;
const mj2c = buildMathjaxV2('\\sum_{i}', 'Σi', false).container;
const mj3c = buildMathjaxV3('\\int x', '∫x', false).container;
ok(T.extractTexFromMathContainer(kc) && T.extractTexFromMathContainer(kc).tex === 'E=mc^2', 'extractTexFromMathContainer：KaTeX 取 annotation TeX');
ok(T.extractTexFromMathContainer(mj2c) && T.extractTexFromMathContainer(mj2c).tex === '\\sum_{i}', 'extractTexFromMathContainer：MathJax v2 取 script 源码');
ok(T.extractTexFromMathContainer(mj3c) && T.extractTexFromMathContainer(mj3c).tex === '\\int x', 'extractTexFromMathContainer：MathJax v3 取 script 源码');

console.log('\n=== Part B：公式 / 货币 渲染守卫 ===');
ok(!T.renderInline('$5$').includes(''), 'renderInline：货币 $5 不被转成公式（无公式占位符）');
ok(!T.renderInline('$10.50$').includes(''), 'renderInline：货币 $10.50 不被转成公式（无公式占位符）');
ok(T.renderInline('$e^2$').includes('\\(e^2\\)'), 'renderInline：公式 $e^2$ 正常转 \\(e^2\\)');
ok(T.renderInline('$$x+y$$').includes('$$x+y$$'), 'renderInline：块公式 $$x+y$$ 保留');
ok(T.renderMathOnly('$e^2$').includes('\\(e^2\\)'), 'renderMathOnly：公式 $e^2$ 转 \\(e^2\\)');
ok(T.renderMathOnly('a*b*c') === 'a*b*c', 'renderMathOnly：* 不被当作 Markdown 斜体');
ok(T.looksLikeCurrency('5') && T.looksLikeCurrency('10.50') && T.looksLikeCurrency('3,000') && !T.looksLikeCurrency('e^2') && !T.looksLikeCurrency('x') , 'looksLikeCurrency：5/10.50/3,000 为货币；e^2/x 为公式');

// ============ Part C：端到端（mouseup 选中公式 → 发送 → 检查 ASK_AI 载荷） ============
console.log('\n=== Part C：端到端载荷 ===');
const host = document.getElementById('universal-sub-agent-host');
const shadow = host.shadowRoot;
const btn = shadow.querySelector('.usa-btn');
function dispatchMouseUp() { document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true })); }
function clickBtn() { btn.dispatchEvent(new window.MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true })); }

setKatexSelection('e^2', 'e2');
dispatchMouseUp();
clickBtn();
const dialogs = Array.from(shadow.querySelectorAll('.usa-dialog'));
ok(dialogs.length === 1, '端到端：点击后打开了一个对话框');
const input = dialogs[0].querySelector('.usa-input');
const send = dialogs[0].querySelector('.usa-send');
input.value = '';                 // 留空 → 自动解释
send.dispatchEvent(new window.MouseEvent('click', { clientX: 1, clientY: 1, bubbles: true }));
const last = sentMessages[sentMessages.length - 1];
ok(last && last.type === 'ASK_AI', '端到端：点击发送产生 ASK_AI 消息');
ok(last && last.selectedText === '$e^2$', '端到端：ASK_AI.selectedText = "$e^2$"');
ok(last && last.selectionContext && last.selectionContext.isFormula === true, '端到端：ASK_AI.selectionContext.isFormula = true');
ok(last && last.selectionContext && last.selectionContext.localFragment === '⟦$e^2$⟧', '端到端：ASK_AI 局部片段 = ⟦$e^2$⟧');

// ---- 汇总 ----
console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
