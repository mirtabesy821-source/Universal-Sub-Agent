// 端到端复刻：jsdom + 真实 KaTeX + 真实 content.js
// 选中公式 → 打开小窗 → 检查 .usa-selected 是否渲染成公式
// 覆盖三种真实场景：
//   A) KaTeX 默认（MathML + annotation）—— 当前代码本应能渲染
//   B) KaTeX html-only（无 annotation）—— 当前代码会退化成原始文本（BUG）
//   C) MathJax v3（mjx-container，无 source script）—— 当前代码会退化成原始文本（BUG）
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('C:\\Users\\111\\node_modules\\jsdom');

const PROJ = path.resolve(__dirname);
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>',
  { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/' });
const { window } = dom;
const { document } = window;

window.eval(fs.readFileSync(path.join(PROJ, 'katex', 'katex.min.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(PROJ, 'katex', 'contrib', 'auto-render.min.js'), 'utf8'));

const storedData = { apiKeys: { deepseek: 'sk-test' }, provider: 'deepseek' };
window.chrome = {
  runtime: { id: 'test-ext', lastError: undefined, getURL: (p) => 'chrome-extension://test-ext/' + p,
    sendMessage: (msg, cb) => { if (typeof cb === 'function') cb(undefined); }, onMessage: { addListener: () => {} } },
  storage: { local: { get: (k, cb) => cb(Object.assign({}, storedData)), set: (d, cb) => { Object.assign(storedData, d); if (cb) cb(); } } }
};
if (typeof window.requestAnimationFrame !== 'function') window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);

// ---- 公式 DOM 构造 ----
function buildKatexDefault(tex, visual) {
  const k = document.createElement('span'); k.className = 'katex';
  const mm = document.createElement('span'); mm.className = 'katex-mathml';
  const math = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'math');
  const sem = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'semantics');
  const anno = document.createElementNS('http://www.w3.org/1998/Math/MathML', 'annotation');
  anno.setAttribute('encoding', 'application/x-tex'); anno.textContent = tex;
  sem.appendChild(anno); math.appendChild(sem); mm.appendChild(math); k.appendChild(mm);
  const html = document.createElement('span'); html.className = 'katex-html'; html.setAttribute('aria-hidden', 'true');
  html.textContent = visual; k.appendChild(html);
  document.body.appendChild(k); return html.firstChild;
}
function buildKatexHtmlOnly(visual) { // 无 annotation / 无 MathML
  const k = document.createElement('span'); k.className = 'katex';
  const html = document.createElement('span'); html.className = 'katex-html';
  const mord = document.createElement('span'); mord.className = 'mord mathnormal'; mord.textContent = 'e';
  const sup = document.createElement('span'); sup.className = 'msupsub'; sup.textContent = '2';
  html.appendChild(mord); html.appendChild(sup); k.appendChild(html);
  document.body.appendChild(k); return mord.firstChild;
}
function buildMathjaxV3(tex, visual) { // 仅 mjx-container，无 source script
  const c = document.createElement('mjx-container'); c.className = 'MathJax';
  const html = document.createElement('span'); html.textContent = visual; c.appendChild(html);
  document.body.appendChild(c);
  // 模拟页面里存在的 MathJax 样式表（克隆时会被 ensureMathJaxCss 拷进 Shadow）
  const st = document.createElement('style');
  st.id = 'MJX-CHTML-styles';
  st.textContent = 'mjx-container{display:inline-block}.mjx-base{margin:0}';
  document.head.appendChild(st);
  return html.firstChild;
}

// ---- 选区 ----
let fakeRange = null, fakeSel = { _text: '', rangeCount: 0, toString() { return this._text; }, getRangeAt() { return fakeRange; } };
window.getSelection = () => fakeSel;
function selectNode(node, text) {
  fakeSel._text = text; fakeSel.rangeCount = 1;
  fakeRange = { startContainer: node, endContainer: node, startOffset: 0, endOffset: text.length,
    commonAncestorContainer: node, getBoundingClientRect: () => ({ width: 10, height: 12, left: 0, top: 0, right: 10, bottom: 12 }) };
}

// ---- 加载真实 content.js（暴露内部函数用于断言） ----
let src = fs.readFileSync(path.join(PROJ, 'content.js'), 'utf8');
src = src.replace(/\}\)\(\);\s*$/, 'window.__test={getSelectionText:getSelectionText,findSelectedMathElement:findSelectedMathElement,closestMathContainer:closestMathContainer};\n})();');
window.eval(src);

const host = document.getElementById('universal-sub-agent-host');
const shadow = host.shadowRoot;
const btn = shadow.querySelector('.usa-btn');
function openOn(visNode, text) {
  selectNode(visNode, text);
  document.dispatchEvent(new window.MouseEvent('mouseup', { clientX: 50, clientY: 50, bubbles: true }));
  btn.dispatchEvent(new window.MouseEvent('click', { clientX: 50, clientY: 50, bubbles: true }));
  const dlg = shadow.querySelector('.usa-dialog');
  const area = dlg ? dlg.querySelector('.usa-selected') : null;
  // 统计展示区内的「公式元素」：.katex 类 或 <mjx-container> 标签。
  // 注意：jsdom 对自定义元素类型选择器（如 mjx-container）支持不佳，故改用遍历 tagName 判断。
  let katexCount = 0;
  if (area) area.querySelectorAll('*').forEach(function (n) {
    const tag = (n.tagName || '').toUpperCase();
    const cls = n.getAttribute('class') || '';
    if (/katex/.test(cls) || tag === 'MJX-CONTAINER') katexCount++;
  });
  // 关闭窗口，便于下一轮
  const close = dlg ? dlg.querySelector('.usa-close') : null;
  if (close) close.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  return { areaText: area ? area.textContent : '', katexCount };
}

function run(name, buildFn, visual, tex) {
  const node = buildFn(tex, visual);
  selectNode(node, visual);
  const sEl = node.parentElement;
  const cm = window.__test.closestMathContainer(sEl);
  console.log(`[debug] ${name} → sEl=${sEl ? sEl.tagName : 'null'} closestMathContainer=${cm ? (cm.tagName + '.' + (cm.getAttribute('class') || '')) : 'null'}, sEl.parentElement=${(sEl && sEl.parentElement) ? sEl.parentElement.tagName : 'null'}`);
  const m = window.__test.findSelectedMathElement(fakeSel);
  console.log(`[debug] ${name} → findSelectedMathElement =`, m ? (m.tagName + '.' + (m.getAttribute('class') || '')) : 'null');
  const r = openOn(node, visual);
  const ok = r.katexCount > 0;
  console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  console.log('   显示区文本 =', JSON.stringify(r.areaText.slice(0, 60)));
  console.log('   公式元素数 =', r.katexCount);
  return ok;
}

let pass = 0, fail = 0;
if (run('A) KaTeX 默认(含annotation)', buildKatexDefault, 'e2', 'e^2')) pass++; else fail++;
if (run('B) KaTeX html-only(无annotation)', buildKatexHtmlOnly, 'e2', null)) pass++; else fail++;
if (run('C) MathJax v3(mjx-container,无script)', buildMathjaxV3, 'x2', null)) pass++; else fail++;

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
