// 公式部分选择 + 嵌套小窗公式显示 回归测试（真实 KaTeX + content.js）
// 覆盖：
//   1) 长公式中只选中一部分时，不会自动扩展成整段公式源码；
//   2) 嵌套小窗（窗口一 → 窗口二）顶部展示区仍能正确渲染公式。

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PROJ = path.resolve(__dirname, '..');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const { document } = window;

window.eval(fs.readFileSync(path.join(PROJ, 'katex', 'katex.min.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(PROJ, 'katex', 'contrib', 'auto-render.min.js'), 'utf8'));

const storedData = { apiKeys: { deepseek: 'sk-test' }, provider: 'deepseek' };
window.chrome = {
  runtime: {
    id: 'test-ext', lastError: undefined,
    getURL: (p) => 'chrome-extension://test-ext/' + p,
    sendMessage: (msg, cb) => { if (typeof cb === 'function') cb(undefined); },
    onMessage: { addListener: () => {} }
  },
  storage: { local: { get: (k, cb) => cb(Object.assign({}, storedData)), set: (d, cb) => { Object.assign(storedData, d); if (cb) cb(); } } }
};
if (typeof window.requestAnimationFrame !== 'function') {
  window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
}

// 加载真实 content.js，并暴露内部函数
let src = fs.readFileSync(path.join(PROJ, 'content.js'), 'utf8');
src = src.replace(/\}\)\(\);\s*$/, 'window.__test={getSelectionText:getSelectionText,findSelectedMathElement:findSelectedMathElement,captureSelectionInfo:captureSelectionInfo,extractMathSource:extractMathSource,extractTexFromMathContainer:extractTexFromMathContainer,isFullMathSelection:isFullMathSelection,getMathVisualText:getMathVisualText};\n})();');
window.eval(src);
const T = window.__test;

const host = document.getElementById('universal-sub-agent-host');
const shadow = host.shadowRoot;
const btn = shadow.querySelector('.usa-btn');

// 构造一个带 annotation 的长公式：x^2 + y^2 + z^2
function buildLongFormula() {
  const k = document.createElement('span'); k.className = 'katex';
  const mm = document.createElement('span'); mm.className = 'katex-mathml';
  const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math');
  const sem = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'semantics');
  const anno = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'annotation');
  anno.setAttribute('encoding', 'application/x-tex');
  anno.textContent = 'x^2 + y^2 + z^2';
  sem.appendChild(anno); math.appendChild(sem); mm.appendChild(math); k.appendChild(mm);
  const html = document.createElement('span'); html.className = 'katex-html';
  html.setAttribute('aria-hidden', 'true');
  html.textContent = 'x2+y2+z2';            // 可视文本
  k.appendChild(html); document.body.appendChild(k);
  return { container: k, visText: html.firstChild };
}

let fakeRange = null;
let fakeSel = {
  _text: '', rangeCount: 0,
  toString() { return this._text; },
  getRangeAt() { return fakeRange; }
};
window.getSelection = () => fakeSel;

function setSelection(node, start, end, text) {
  fakeSel._text = text;
  fakeSel.rangeCount = 1;
  fakeRange = {
    startContainer: node, endContainer: node,
    startOffset: start, endOffset: end,
    commonAncestorContainer: node,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
  };
}

function setSelectionOnElement(el, text) {
  fakeSel._text = text;
  fakeSel.rangeCount = 1;
  fakeRange = {
    startContainer: el, endContainer: el,
    startOffset: 0, endOffset: el.childNodes.length,
    commonAncestorContainer: el,
    getBoundingClientRect: () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 })
  };
}

function dispatchMouseUp(x, y) {
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: x, clientY: y, bubbles: true }));
}
function clickBtn() {
  btn.dispatchEvent(new window.MouseEvent('click', { clientX: 100, clientY: 100, bubbles: true }));
}
function getDialogs() {
  return Array.from(shadow.querySelectorAll('.usa-dialog'));
}

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('\n=== Part 1：长公式部分选中不会自动扩展 ===');
const { container: formula, visText } = buildLongFormula();
setSelection(visText, 0, 2, 'x2');          // 只选中 "x2"
ok(T.getSelectionText() === 'x2', '部分选中 → 返回可见文本 "x2"，而非整段公式源码');
ok(T.findSelectedMathElement(fakeSel) === null, '部分选中 → 不当作完整公式');
const partialInfo = T.captureSelectionInfo();
ok(partialInfo && !partialInfo.isFormula, '部分选中 → captureSelectionInfo 不是公式');
ok(partialInfo && partialInfo.localFragment.indexOf('⟦x2⟧') >= 0, '部分选中 → 局部片段精确标记选中的 x2');

console.log('\n=== Part 2：整段公式选中仍返回干净源码 ===');
setSelection(visText, 0, 9, 'x2+y2+z2');   // 选中全部可见文本
ok(T.getSelectionText() === '$x^2 + y^2 + z^2$', '整段选中 → 返回干净源码 $x^2 + y^2 + z^2$');
ok(T.findSelectedMathElement(fakeSel) === formula, '整段选中 → 命中原公式元素');
const fullInfo = T.captureSelectionInfo();
ok(fullInfo && fullInfo.isFormula === true, '整段选中 → captureSelectionInfo isFormula=true');
ok(fullInfo && fullInfo.localFragment === '⟦$x^2 + y^2 + z^2$⟧', '整段选中 → 局部片段为 ⟦$x^2 + y^2 + z^2$⟧');

console.log('\n=== Part 3：窗口一顶部展示区正确渲染公式 ===');
setSelection(visText, 0, 9, 'x2+y2+z2');
dispatchMouseUp(50, 50);
clickBtn();
const dialogs = getDialogs();
ok(dialogs.length === 1, '点击后打开窗口一');
const win1 = dialogs[0];
const sel1 = win1.querySelector('.usa-selected');
ok(sel1 && sel1.classList.contains('usa-has-math'), '窗口一 usa-selected 带 usa-has-math 类');
ok(sel1 && sel1.querySelectorAll('.katex').length > 0, '窗口一展示区包含 .katex 公式元素');

console.log('\n=== Part 4：窗口二（嵌套）顶部展示区仍能正确渲染公式 ===');
// 在窗口一的展示区里再次选中完整公式
const win1KaTeX = sel1.querySelector('.katex');
ok(!!win1KaTeX, '窗口一展示区里存在可二次选中的 .katex');
// 取窗口一内公式的可视层（.katex-html），以元素级选区选中全部可见内容
const win1Html = win1KaTeX.querySelector('.katex-html');
const win1VisText = win1Html ? win1Html.textContent : '';
ok(!!win1Html && win1VisText.length > 0, '窗口一公式的可视文本可获取');
setSelectionOnElement(win1Html, win1VisText);
const mEl = T.findSelectedMathElement(fakeSel);
ok(!!mEl && /katex/.test(mEl.getAttribute('class') || ''), '嵌套选词仍能识别窗口一内的公式');
dispatchMouseUp(60, 60);
clickBtn();
const dialogs2 = getDialogs();
ok(dialogs2.length === 2, '嵌套点击后打开窗口二');
const win2 = dialogs2[1];
const sel2 = win2.querySelector('.usa-selected');
ok(sel2 && sel2.classList.contains('usa-has-math'), '窗口二 usa-selected 带 usa-has-math 类');
ok(sel2 && sel2.querySelectorAll('.katex').length > 0, '窗口二展示区仍包含 .katex 公式元素');

console.log('\n=== Part 5：块级公式（$$...$$）display 判断 + 嵌套渲染 ===');
// 用真实 KaTeX 渲染一个单行块级公式 $$\frac{a}{b}$$。
// 旧代码用 tex.indexOf("\\n") 判断 display，单行块公式 TeX 不含换行 → display=false
// → 嵌套窗口里块公式被包装成 $...$（行内）重绘，分式变小、格式错乱。
// 修复后应检查 .katex-display 祖先，display=true，以 $$...$$ 块级模式重绘。
const blkDiv = document.createElement('div');
blkDiv.innerHTML = '$$\\frac{a}{b}$$';
document.body.appendChild(blkDiv);
window.renderMathInElement(blkDiv, { delimiters: [{ left: '$$', right: '$$', display: true }], throwOnError: false });
const blkKatex = blkDiv.querySelector('.katex');
const blkDisplayAncestor = blkDiv.querySelector('.katex-display');
ok(!!blkKatex && !!blkDisplayAncestor, '真实 KaTeX 渲染出 .katex-display > .katex 结构');
const blkInfo = T.extractTexFromMathContainer(blkKatex);
ok(blkInfo && blkInfo.tex === '\\frac{a}{b}', '块级公式 TeX 提取正确');
ok(blkInfo && blkInfo.display === true, '【修复1】单行块级公式 display=true（旧代码因无换行误判为 false）');
// 选中整个块级公式 → 打开窗口，展示区应以块级模式渲染
const blkHtml = blkKatex.querySelector('.katex-html');
const blkVisText = T.getMathVisualText(blkKatex);
ok(blkVisText.length > 0, '块级公式可视文本可获取');
setSelectionOnElement(blkHtml, blkVisText);
dispatchMouseUp(70, 70);
clickBtn();
const blkDialogs = getDialogs();
const blkWin = blkDialogs[blkDialogs.length - 1];
const blkSel = blkWin.querySelector('.usa-selected');
ok(blkSel && blkSel.classList.contains('usa-has-math'), '块级公式窗口 usa-selected 带 usa-has-math 类');
ok(blkSel && blkSel.querySelectorAll('.katex-display').length > 0, '【修复1】窗口一展示区以块级模式渲染（含 .katex-display，而非行内 .katex）');
// 嵌套：在窗口一展示区选中块级公式 → 打开窗口二，仍应以块级模式渲染
const win1BlkKatex = blkSel.querySelector('.katex');
const win1BlkHtml = blkSel.querySelector('.katex-html');
ok(!!win1BlkKatex && !!win1BlkHtml, '窗口一展示区存在可二次选中的块级公式');
const win1BlkVis = T.getMathVisualText(win1BlkKatex);
setSelectionOnElement(win1BlkHtml, win1BlkVis);
dispatchMouseUp(80, 80);
clickBtn();
const blkDialogs2 = getDialogs();
const blkWin2 = blkDialogs2[blkDialogs2.length - 1];
const blkSel2 = blkWin2.querySelector('.usa-selected');
ok(blkSel2 && blkSel2.querySelectorAll('.katex-display').length > 0, '【修复1】嵌套窗口二展示区仍以块级模式渲染（含 .katex-display）');

console.log('\n=== Part 6：部分选中面积接近但文本不匹配 → 不误判为全选 ===');
// 真实浏览器里 container 有非零包围盒。旧代码优先用面积比例（≥0.95）判断，
// 单行公式高度恒匹配，选中 96% 宽度就被误判为全选 → 提取整段公式源码发给 AI，
// 用户无法针对某一部分提问。修复后文本判断优先，面积仅兜底。
const longDiv = document.createElement('div');
longDiv.innerHTML = '$$x^2 + y^2 + z^2 + a^2 + b^2$$';
document.body.appendChild(longDiv);
window.renderMathInElement(longDiv, { delimiters: [{ left: '$$', right: '$$', display: true }], throwOnError: false });
const longKatex = longDiv.querySelector('.katex');
// ★ 关键：mock container 包围盒为非零（模拟真实浏览器），否则 jsdom 返回 0 会跳过面积判断
longKatex.getBoundingClientRect = function () {
  return { width: 200, height: 30, left: 0, top: 0, right: 200, bottom: 30 };
};
const longVis = T.getMathVisualText(longKatex);
ok(longVis.length > 4, '长公式可视文本可获取：' + JSON.stringify(longVis));
// 模拟"选中前 ~80%，漏掉末尾"：文本是部分的，但面积给 96%（接近全选）
const partialVis = longVis.slice(0, Math.max(1, longVis.length - 3));
ok(partialVis !== longVis && partialVis.length > 0, '构造的部分选中文本与完整文本不同');
fakeSel._text = partialVis;
fakeSel.rangeCount = 1;
fakeRange = {
  startContainer: longKatex, endContainer: longKatex,
  startOffset: 0, endOffset: 0,
  commonAncestorContainer: longKatex,
  // 选区面积 = 96% 宽度，高度全匹配 → 旧代码会误判为全选
  getBoundingClientRect: function () { return { width: 192, height: 30, left: 0, top: 0, right: 192, bottom: 30 }; }
};
ok(T.isFullMathSelection(fakeSel, longKatex) === false, '【修复2】选中 96% 宽度但文本不匹配 → 不误判为全选');
ok(T.extractMathSource(fakeSel) === null, '【修复2】部分选中 → extractMathSource 返回 null（不取整段源码）');
ok(T.getSelectionText() === partialVis, '【修复2】部分选中 → getSelectionText 返回选中部分文本，而非整段公式源码');
// 对照：全选（文本=完整）→ 仍正确识别为全选
fakeSel._text = longVis;
fakeRange.getBoundingClientRect = function () { return { width: 200, height: 30, left: 0, top: 0, right: 200, bottom: 30 }; };
ok(T.isFullMathSelection(fakeSel, longKatex) === true, '对照：全选（文本=完整）→ 正确识别为全选');

console.log('\n=== 结果 ===');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
