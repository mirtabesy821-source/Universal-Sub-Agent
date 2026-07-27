// 验证 Unicode 勾选/叉号（✓、❌）在 KaTeX 渲染时不刷屏控制台警告
// 复现：AI 返回或选区包含 $✓$ / $❌$ 时，KaTeX 会报
//   - "LaTeX-incompatible input ... Unrecognized Unicode character ... [unknownSymbol]"
//   - "No character metrics for '✓' in style 'Main-Regular' and mode 'text'"
// 修复后两类警告均应被屏蔽。
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

// chrome 运行时 mock（content.js 加载需要）
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

// 加载 content.js，并暴露内部 KA_OPTIONS / renderMathInElementSafe
let src = fs.readFileSync(path.join(PROJ, 'content.js'), 'utf8');
src = src.replace(/\}\)\(\);\s*$/,
  'window.__test={KA_OPTIONS:KA_OPTIONS,renderMathInElementSafe:renderMathInElementSafe};\n})();');
window.eval(src);

const T = window.__test;

let warnCount = 0;
let errorCount = 0;
const kaWarnings = [];

const origWarn = console.warn;
const origError = console.error;
console.warn = (...args) => { warnCount++; origWarn.apply(console, args); };
console.error = (...args) => { errorCount++; origError.apply(console, args); };

function renderInto(el) {
  T.renderMathInElementSafe(el, T.KA_OPTIONS);
}

function testCase(name, html) {
  const div = document.createElement('div');
  div.className = 'usa-msg-ai';
  div.innerHTML = html;
  document.body.appendChild(div);
  renderInto(div);
  const hasKaTeX = div.querySelector('.katex') !== null;
  const hasText = div.textContent.includes('✓') || div.textContent.includes('❌');
  console.log(`  ${hasKaTeX && hasText ? '✓' : '✗'} ${name}: 公式元素=${hasKaTeX}, 仍保留字符=${hasText}`);
  return hasKaTeX && hasText;
}

let pass = 0, fail = 0;
console.log('=== Unicode 符号渲染测试 ===');
if (testCase('行内 \\(✓\\) 正常渲染', '<p>勾选：\\(✓\\)</p>')) pass++; else fail++;
if (testCase('行内 \\(❌\\) 正常渲染', '<p>叉号：\\(❌\\)</p>')) pass++; else fail++;
if (testCase('混合 \\(x\\) 与 \\(✓\\)', '<p>\\(x\\) 和 \\(✓\\)</p>')) pass++; else fail++;

console.warn = origWarn;
console.error = origError;

console.log(`\n=== 结果：通过 ${pass} / 失败 ${fail} ===`);
console.log(`  控制台 warn 数：${warnCount}（含 KaTeX metrics 警告应被过滤）`);
console.log(`  控制台 error 数：${errorCount}`);

if (warnCount > 0 || errorCount > 0) {
  console.log('  ⚠ 仍有控制台输出，请检查是否把 KaTeX 警告过滤干净');
  fail++;
}

process.exit(fail ? 1 : 0);
