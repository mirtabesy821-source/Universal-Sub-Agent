// ============================================================
// Universal Sub-Agent - 内容脚本 (Content Script)
// 阶段六：多窗口支持（最多3个独立对话框）+ 多轮对话 + Markdown + 流式
// ============================================================
// 作用：监听用户在任意网页上的文字划选，在选区附近弹出"🔍 解释"小按钮；
//       点击后原地展开一个用 Shadow DOM 隔离的悬浮对话窗口（Notion AI 风格），
//       用户可针对选中文本连续提问，AI 参考历史对话保持上下文连贯。
//       支持同时打开最多 3 个独立对话框，各自维护独立的上下文和对话历史。
// 样式隔离：所有 UI 与 CSS 全部封装在 Shadow DOM 内，宿主网站无法影响。
// 关闭语义：点击 × 或 Esc → 销毁最早对话框（FIFO）；超过3个时新建自动关最早。
// 新对话：点击 ⟳ → 清空聊天记录，保持窗口打开。
// ============================================================

(function () {
  'use strict';

  // 防止重复注入（scripting/多框架等场景）
  if (window.__universalSubAgentInjected) return;
  window.__universalSubAgentInjected = true;

  // ---------- 1. 创建 Shadow DOM 宿主（页面生命周期内持久存在） ----------
  const host = document.createElement('div');
  host.id = 'universal-sub-agent-host';
  host.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;' +
    'border:0;pointer-events:none;z-index:2147483647;';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ---------- 2. 隔离的样式（仅在 Shadow DOM 内生效） ----------
  const styleCSS = `
    :host { all: initial; }
    * { box-sizing: border-box; margin: 0; padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
                     "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif; }

    /* —— 划词后的小按钮 —— */
    .usa-btn {
      position: fixed; pointer-events: auto; z-index: 10;
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 11px; font-size: 13px; line-height: 1; color: #1f2329;
      background: rgba(255,255,255,0.72);
      backdrop-filter: blur(12px) saturate(160%);
      -webkit-backdrop-filter: blur(12px) saturate(160%);
      border: 1px solid rgba(0,0,0,0.08); border-radius: 999px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.14);
      cursor: pointer; user-select: none; white-space: nowrap;
      transition: transform .12s ease, box-shadow .12s ease;
    }
    .usa-btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,0.18); }

    /* —— 悬浮对话框 —— */
    .usa-dialog {
      position: fixed; pointer-events: auto; z-index: 1;
      width: 360px; max-width: calc(100vw - 24px); max-height: 480px;
      display: flex; flex-direction: column; overflow: hidden;
      background: rgba(255,255,255,0.82);
      backdrop-filter: blur(18px) saturate(180%);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      border: 1px solid rgba(0,0,0,0.08); border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.22);
    }

    .usa-selected {
      padding: 10px 12px; font-size: 13px; line-height: 1.5; color: #424247;
      background: rgba(0,0,0,0.03);
      border-bottom: 1px solid rgba(0,0,0,0.06);
      border-left: 3px solid #4f8cf0;
      display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3;
      overflow: hidden; white-space: normal; word-break: break-word;
    }

    /* —— 聊天区：气泡容器 —— */
    .usa-chat {
      flex: 1 1 auto; min-height: 56px; padding: 12px;
      overflow-y: auto; word-break: break-word; white-space: normal;
      display: flex; flex-direction: column; gap: 10px;
    }
    .usa-chat:empty::before { content: "针对选中的文字提出你的问题…"; color: #9aa0a6; font-size: 13px; }

    /* —— 用户气泡 —— */
    .usa-msg-user {
      align-self: flex-end; max-width: 85%;
      padding: 7px 11px; font-size: 13px; line-height: 1.5; color: #1f2329;
      background: #e8f0fe; border-radius: 12px 12px 4px 12px;
      white-space: pre-wrap; word-break: break-word;
    }

    /* —— AI 气泡 —— */
    .usa-msg-ai {
      align-self: flex-start; width: 100%;
      font-size: 13.5px; line-height: 1.6; color: #1f2329;
    }
    .usa-msg-ai.usa-loading { color: #9aa0a6; }

    /* Markdown 元素排版（在 .usa-msg-ai 作用域内） */
    .usa-msg-ai > *:last-child { margin-bottom: 0 !important; }
    .usa-msg-ai p { margin: 0 0 8px; }
    .usa-msg-ai h1, .usa-msg-ai h2, .usa-msg-ai h3,
    .usa-msg-ai h4, .usa-msg-ai h5, .usa-msg-ai h6 {
      margin: 10px 0 6px; line-height: 1.35; font-weight: 600; color: #1f2329;
    }
    .usa-msg-ai h1 { font-size: 17px; }
    .usa-msg-ai h2 { font-size: 15.5px; }
    .usa-msg-ai h3 { font-size: 14.5px; }
    .usa-msg-ai ul, .usa-msg-ai ol { margin: 0 0 8px; padding-left: 22px; }
    .usa-msg-ai li { margin: 2px 0; }
    .usa-msg-ai a { color: #4f8cf0; text-decoration: none; }
    .usa-msg-ai a:hover { text-decoration: underline; }
    .usa-msg-ai blockquote {
      margin: 0 0 8px; padding: 2px 0 2px 10px;
      border-left: 3px solid rgba(0,0,0,0.15); color: #5f6368;
    }
    .usa-msg-ai code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace;
    }
    .usa-code-inline {
      background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px;
      font-size: 12.5px; color: #b3360b;
    }
    .usa-code {
      background: #1f2329; color: #e6e6e6; padding: 10px 12px; border-radius: 8px;
      overflow-x: auto; margin: 0 0 8px; font-size: 12.5px; line-height: 1.5; white-space: pre;
    }
    .usa-code code { background: none; color: inherit; padding: 0; }

    /* —— KaTeX 数学公式 —— */
    .usa-math-block { margin: 8px 0; text-align: center; overflow-x: auto; }
    .usa-chat .katex { font-size: 1.05em; }
    .usa-selected .katex { font-size: 1.05em; }
    .usa-chat .katex-display { margin: 8px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }
    /* 小窗顶部克隆进来的公式：解除 -webkit-box 行截断对块级公式的裁剪 */
    .usa-selected .katex-display { display: block; -webkit-line-clamp: initial; margin: 4px 0; }

    .usa-input-row {
      display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid rgba(0,0,0,0.06); background: rgba(255,255,255,0.55);
    }
    .usa-input {
      flex: 1 1 auto; min-width: 0; padding: 8px 10px;
      font-size: 13px; color: #1f2329; background: rgba(255,255,255,0.9);
      border: 1px solid rgba(0,0,0,0.12); border-radius: 8px; outline: none;
      transition: border-color .12s ease;
    }
    .usa-input:focus { border-color: #4f8cf0; }
    .usa-input::placeholder { color: #9aa0a6; }

    .usa-send {
      flex: 0 0 auto; padding: 8px 14px; font-size: 13px; font-weight: 600;
      color: #fff; background: #4f8cf0; border: none; border-radius: 8px;
      cursor: pointer; transition: background .12s ease;
    }
    .usa-send:hover { background: #3b7be0; }
    .usa-send:disabled { background: #b9c6d8; cursor: not-allowed; }

    /* —— 顶部拖拽条（可拖动整个悬浮窗）—— */
    .usa-dragbar {
      flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
      height: 26px; padding: 0 6px 0 12px;
      background: rgba(0,0,0,0.035);
      border-bottom: 1px solid rgba(0,0,0,0.06);
      cursor: grab; user-select: none;
    }
    .usa-dragbar:active { cursor: grabbing; }
    .usa-dragleft { display: flex; align-items: center; gap: 8px; }
    .usa-win-num {
      width: 20px; height: 20px; display: flex; align-items: center; justify-content: center;
      font-size: 11px; font-weight: 700; color: #fff; background: #4f8cf0;
      border-radius: 50%; flex: 0 0 auto; opacity: 0.9;
    }
    .usa-dragdot { width: 30px; height: 4px; border-radius: 2px; background: rgba(0,0,0,0.18); }

    .usa-bar-actions { display: flex; align-items: center; gap: 2px; }
    .usa-newchat {
      width: 22px; height: 22px; display: flex; align-items: center; justify-content: center;
      font-size: 14px; line-height: 1; color: #9aa0a6;
      background: transparent; border: none; cursor: pointer; border-radius: 4px;
      transition: color .12s ease, background .12s ease;
    }
    .usa-newchat:hover { color: #1f2329; background: rgba(0,0,0,0.06); }

    .usa-close {
      position: static; width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; line-height: 1; color: #9aa0a6;
      background: transparent; border: none; cursor: pointer; border-radius: 4px;
      transition: color .12s ease, background .12s ease;
    }
    .usa-close:hover { color: #1f2329; background: rgba(0,0,0,0.06); }

    /* —— 厂商切换下拉 —— */
    .usa-provider-sel {
      max-width: 90px; padding: 1px 2px 1px 4px; font-size: 11px; color: #5f6368;
      background: transparent; border: 1px solid transparent; border-radius: 4px;
      outline: none; cursor: pointer; margin-right: 4px;
    }
    .usa-provider-sel:hover { border-color: rgba(0,0,0,0.12); }
    .usa-provider-sel:focus { border-color: #4f8cf0; }

    .usa-set-default {
      width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;
      font-size: 11px; line-height: 1; color: #d0d4d9;
      background: transparent; border: none; cursor: pointer; border-radius: 3px;
      padding: 0; transition: color .12s ease;
    }
    .usa-set-default:hover { color: #f0b400; }
    .usa-set-default.is-default { color: #f0b400; }
  `;

  // 持久层：style + 划词小按钮（对话框不在此层，按需创建/销毁）
  shadow.innerHTML = `<style>${styleCSS}</style><div class="usa-btn">🔍 解释</div>`;
  const btn = shadow.querySelector('.usa-btn');

  // 对话框模板（每次展开时新建节点，关闭时整体移除）
  const dialogTpl = `
    <div class="usa-dialog" style="display:none;">
      <div class="usa-dragbar">
        <div class="usa-dragleft">
          <span class="usa-dragdot"></span>
          <span class="usa-win-num">1</span>
          <select class="usa-provider-sel"></select>
          <button class="usa-set-default" title="设为默认模型">★</button>
        </div>
        <div class="usa-bar-actions">
          <button class="usa-newchat" title="新对话">⟳</button>
          <button class="usa-close" title="关闭 (Esc)">×</button>
        </div>
      </div>
      <div class="usa-selected"></div>
      <div class="usa-chat"></div>
      <div class="usa-input-row">
        <input class="usa-input" type="text" placeholder="针对这段文字提问（留空=自动解释）…" />
        <button class="usa-send">发送</button>
      </div>
    </div>
  `;

  // ===== 模块级状态 =====
  // 当前划选文本（mouseup 时写入，按钮点击时消费）
  let currentText = '';
  let currentPageContext = '';
  // 当前选区所属的对话框实例（嵌套选词时指向来源窗口，普通网页选词时为 null）
  let currentSourceDialog = null;
  // 当前选区的「精确选词定位信息」（字符偏移 + 局部片段标记 + 根容器标签），供后台传递给 AI 以区分重复文本
  let currentSelectionCtx = null;
  // 当前选区所属的「真实公式渲染元素」（.katex / .MathJax / mjx-container）。
  // 划词时捕获，打开小窗时原样克隆进展示区——任何渲染器（KaTeX html-only、
  // MathJax v3 去脚本等）都能正确显示，而不依赖源码提取/重绘。
  let currentMathElement = null;

  // 厂商显示名（需与 background.js / options.js / popup.js 保持同步）
  const DISPLAY_NAMES = { deepseek: 'DeepSeek', qwen: '通义千问', glm: '智谱GLM', kimi: 'Kimi', openrouter: 'OpenRouter', mimo: 'MiMo' };

  // KaTeX 分隔符（AI 气泡与小窗展示区共用，避免两处配置漂移）
  const KA_DELIMS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '\\(', right: '\\)', display: false }
  ];
  const KA_IGNORED = ['script', 'noscript', 'style', 'textarea', 'pre', 'code'];

  // 上下文失效检测
  let dead = false;
  function contextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }
  function selfDestruct() {
    if (dead) return;
    dead = true;
    while (activeDialogs.length > 0) {
      activeDialogs.pop().destroy();
    }
    globalDragTarget = null;
    if (host && host.parentNode) host.remove();
  }
  const ctxCheckTimer = setInterval(() => {
    if (!contextValid()) { clearInterval(ctxCheckTimer); selfDestruct(); }
  }, 2000);

  // ---------- 2.5 KaTeX 公式引擎（本地打包，由 manifest content_scripts 注入） ----------
  let katexReady = false;
  function ensureKaTeX() {
    if (katexReady) return;
    if (typeof window.renderMathInElement !== 'function') return;
    katexReady = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('katex/katex.min.css');
    shadow.appendChild(link);
    console.log('[Universal Sub-Agent] KaTeX CSS 已加载');
  }
  ensureKaTeX();
  console.log('[Universal Sub-Agent] KaTeX 诊断:',
    'katex=', typeof window.katex,
    'renderMathInElement=', typeof window.renderMathInElement);

  // ---------- 2.6 MathJax 样式注入（按需） ----------
  // 克隆 mjx-container 进 Shadow DOM 后，若不把页面里的 MathJax 样式表一并拷进来，
  // 公式会因缺少布局 CSS 而错乱。这里在首次遇到 MathJax 公式时，把页面中的
  // MathJax 相关 <style> 复制进本扩展的 Shadow DOM（幂等，仅执行一次）。
  let mathjaxCssReady = false;
  function ensureMathJaxCss() {
    if (mathjaxCssReady) return;
    mathjaxCssReady = true;
    try {
      document.querySelectorAll('style').forEach(function (st) {
        const txt = st.textContent || '';
        if (/mjx-container|\.mjx-|\.MathJax|MathJax_CHTML|MathJax_SVG/.test(txt)) {
          const clone = st.cloneNode(true);
          clone.setAttribute('data-mathjax-css', '1');
          shadow.appendChild(clone);
        }
      });
      // MathJax v3 把样式挂在带固定 id 的元素上，单独再兜底一次
      ['MJX-CHTML-styles', 'MJX-SVG-styles', 'MathJax_CHTML', 'MathJax_SVG'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el && !shadow.getElementById(id)) shadow.appendChild(el.cloneNode(true));
      });
      console.log('[Universal Sub-Agent] 已注入 MathJax 样式');
    } catch (_) { /* 注入失败不影响其他渲染器 */ }
  }

  // ---------- 3. 轻量 Markdown 渲染器（内置、无依赖、XSS 安全） ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
  }

  // 粗略判断 $...$ 内是否像货币/纯数字，避免把价格误当成数学公式渲染。
  // 以数字开头、且整体只含 数字/逗号/点/空格/货币符号/百分号 → 视为货币。
  function looksLikeCurrency(inner) {
    const s = (inner || '').trim();
    if (!s) return true;
    return /^[\d][\d.,\s%$]*$/.test(s);
  }

  function renderInline(text) {
    const maths = [];
    const codes = [];
    let raw = text;
    raw = raw.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    raw = raw.replace(/\$\$([^$]+)\$\$/g,    (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g,  (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g,  (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\$([^$\n]+)\$/g,       (_, m) => {
      if (looksLikeCurrency(m)) return '$' + m + '$';   // 货币等纯数字 → 不当作公式
      maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002';
    });

    let t = escapeHtml(raw);
    t = t.replace(/\u0001(\d+)\u0001/g, (_, n) => '<code class="usa-code-inline">' + escapeHtml(codes[+n]) + '</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    t = t.replace(/\u0002(\d+)\u0002/g, (_, n) => {
      const m = maths[+n];
      const esc = escapeHtml(m.t);
      return m.d ? '$$' + esc + '$$' : '\\(' + esc + '\\)';
    });
    return t;
  }

  // 仅渲染公式（不解释 * _ ` 等 Markdown），用于「选中文字」展示区，
  // 避免把用户选中的普通文本里的 * _ 当成格式符号。公式用 KaTeX 重绘。
  function renderMathOnly(text) {
    if (!text) return '';
    const maths = [];
    let raw = text
      .replace(/\$\$([^$]+)\$\$/g,    (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; })
      .replace(/\\\[([\s\S]+?)\\\]/g,  (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; })
      .replace(/\\\(([\s\S]+?)\\\)/g,  (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; })
      .replace(/\$([^$\n]+)\$/g,       (_, m) => {
        if (looksLikeCurrency(m)) return '$' + m + '$';
        maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002';
      });
    let t = escapeHtml(raw);
    t = t.replace(/\u0002(\d+)\u0002/g, (_, n) => {
      const m = maths[+n];
      const esc = escapeHtml(m.t);
      return m.d ? '$$' + esc + '$$' : '\\(' + esc + '\\)';
    });
    return t;
  }

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let listOpen = false, olOpen = false;
    let para = [];
    let inCode = false, codeBuf = [];
    let inMath = false, mathBuf = [];
    let inBracketMath = false, bracketMathBuf = [];

    const closeList = () => { if (listOpen) { out.push('</ul>'); listOpen = false; } if (olOpen) { out.push('</ol>'); olOpen = false; } };
    const flushPara = () => { if (para.length) { out.push('<p>' + para.map(renderInline).join('<br>') + '</p>'); para = []; } };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (inBracketMath) {
        const endIdx = line.indexOf('\\]');
        if (endIdx >= 0) {
          const before = line.slice(0, endIdx);
          if (before.trim()) bracketMathBuf.push(before);
          flushPara(); closeList();
          out.push('<div class="usa-math-block">\\[' + escapeHtml(bracketMathBuf.join('\n')) + '\\]</div>');
          bracketMathBuf = []; inBracketMath = false;
          const after = line.slice(endIdx + 2);
          if (after.trim()) para.push(after);
        } else {
          bracketMathBuf.push(line);
        }
        continue;
      }

      if (/^\s*\$\$\s*$/.test(line)) {
        if (inMath) {
          flushPara(); closeList();
          out.push('<div class="usa-math-block">$$' + escapeHtml(mathBuf.join('\n')) + '$$</div>');
          mathBuf = []; inMath = false;
        } else {
          flushPara(); closeList(); inMath = true;
        }
        continue;
      }
      if (inMath) { mathBuf.push(line); continue; }

      if (/^```/.test(line)) {
        if (inCode) {
          out.push('<pre class="usa-code"><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = []; inCode = false;
        } else {
          flushPara(); closeList(); inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      const startMatch = line.match(/^((?:[^`]|`[^`]*`)*?)\\\[/);
      if (startMatch) {
        const afterBracket = line.slice(startMatch[0].length);
        const endInRest = afterBracket.match(/^((?:[^`]|`[^`]*`)*?)\\\]/);
        if (!endInRest) {
          const before = startMatch[1];
          if (before.trim()) para.push(before);
          flushPara(); closeList();
          inBracketMath = true;
          bracketMathBuf = [];
          if (afterBracket.trim()) bracketMathBuf.push(afterBracket);
          continue;
        }
      }

      if (/^\s*$/.test(line)) { closeList(); flushPara(); continue; }

      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeList(); flushPara(); const n = m[1].length; out.push('<h' + n + '>' + renderInline(m[2]) + '</h' + n + '>'); continue; }
      if ((m = line.match(/^>\s?(.*)$/))) { closeList(); flushPara(); out.push('<blockquote>' + renderInline(m[1]) + '</blockquote>'); continue; }
      if ((m = line.match(/^[-*]\s+(.*)$/))) { flushPara(); if (!listOpen) { out.push('<ul>'); listOpen = true; } out.push('<li>' + renderInline(m[1]) + '</li>'); continue; }
      if ((m = line.match(/^\d+\.\s+(.*)$/))) { flushPara(); if (!olOpen) { out.push('<ol>'); olOpen = true; } out.push('<li>' + renderInline(m[1]) + '</li>'); continue; }

      closeList();
      para.push(line);
    }

    if (inMath) out.push('<div class="usa-math-block">$$' + escapeHtml(mathBuf.join('\n')) + '$$</div>');
    if (inBracketMath) out.push('<div class="usa-math-block">\\[' + escapeHtml(bracketMathBuf.join('\n')) + '\\]</div>');
    if (inCode) out.push('<pre class="usa-code"><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
    closeList();
    flushPara();
    return out.join('\n');
  }

  // ---------- 4. 选区工具 ----------
  // 公式选词兼容层：KaTeX / MathJax v2 / MathJax v3 统一提取「干净源码」。
  // 避免浏览器原生的 selection.toString() 把标注文本（MathML annotation / MathJax
  // 的辅助文本）与可视 span 混在一起，产生多余空格或重复字符（如选中 e² 却得到 "e 2"）。
  // 仅当整段选区都落在「同一个」公式渲染容器内才处理；否则回退普通文本。
  //
  // 各渲染器的源码位置：
  //   • KaTeX        → <annotation encoding="application/x-tex"> 内的 TeX
  //   • MathJax v2/3 → <script type="math/tex"> / type="math/tex; mode=display"> 内的源码
  //                    （也兼容 asciimath: type="math/asciimath"，原样返回不包装）
  // 顶层容器选择器：.katex（KaTeX）、.MathJax（MathJax v2）、mjx-container（MathJax v3）。

  // 向上找到选区起止所在的「数学渲染容器」（KaTeX / MathJax 均可）。
  // 用显式祖先遍历，而非依赖 el.closest() 对自定义元素标签（如 mjx-container）
  // 的选择器匹配——后者在部分浏览器/jsdom 中不可靠。注意按「类名 token」精确匹配，
  // 避免误命中 katex-html / katex-mathml 等内部 span。
  function closestMathContainer(el) {
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE) {
      const n = (cur.nodeName || '').toLowerCase();
      const c = (typeof cur.getAttribute === 'function' ? (cur.getAttribute('class') || '') : '');
      const tokens = c.split(/\s+/);
      if (tokens.indexOf('katex') >= 0 || tokens.some(function (t) { return /mathjax/i.test(t); }) || n === 'mjx-container') {
        return cur;
      }
      cur = cur.parentElement;
    }
    return null;
  }

  // 从公式容器中提取源码：{ tex, display, raw }
  //   tex     —— 源码文本
  //   display —— 是否块级公式（用于决定 $$...$$ / $...$）
  //   raw     —— true 表示非 TeX（如 asciimath），原样返回、不包 $ 以免被当 TeX 渲染
  function extractTexFromMathContainer(container) {
    if (!container) return null;
    // 1) KaTeX：<annotation encoding="application/x-tex">
    try {
      const anno = container.querySelector('annotation[encoding="application/x-tex"]');
      if (anno && anno.textContent && anno.textContent.trim()) {
        const tex = anno.textContent.trim();
        return { tex: tex, display: tex.indexOf('\n') >= 0, raw: false };
      }
    } catch (_) {}
    // 2) MathJax v2/v3：<script type="math/tex"> / type="math/tex; mode=display">
    //    以及 asciimath：<script type="math/asciimath">
    try {
      const scripts = container.querySelectorAll('script[type^="math/"]');
      for (let i = 0; i < scripts.length; i++) {
        const type = (scripts[i].getAttribute('type') || '').toLowerCase();
        const t = (scripts[i].textContent || '').trim();
        if (!t) continue;
        if (type === 'math/asciimath') {
          return { tex: t, display: false, raw: true };   // 非 TeX，原样返回
        }
        const display = /mode=display/.test(type) || t.indexOf('\n') >= 0;
        return { tex: t, display: display, raw: false };
      }
    } catch (_) {}
    return null;
  }

  // 若选区落在某个公式渲染容器内，返回用 $...$ / $$...$$ 包裹的干净源码；否则 null。
  function extractMathSource(sel) {
    try {
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const sEl = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement : range.startContainer;
      const eEl = range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement : range.endContainer;
      if (!sEl || !eEl || typeof sEl.closest !== 'function' || typeof eEl.closest !== 'function') return null;
      const mStart = closestMathContainer(sEl);
      const mEnd = closestMathContainer(eEl);
      if (!mStart || !mEnd || mStart !== mEnd) return null;   // 必须同一个公式
      const info = extractTexFromMathContainer(mStart);
      if (!info || !info.tex) return null;
      if (info.raw) return info.tex;                          // asciimath 等：原样返回
      return info.display ? ('$$' + info.tex + '$$') : ('$' + info.tex + '$');
    } catch (_) {
      return null;
    }
  }

  function getSelectionText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    const tex = extractMathSource(sel);   // 公式内选词 → 干净的源码（如 $e^2$）
    if (tex !== null) return tex;
    return sel.toString().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  // 找到选区所在的「真实公式渲染元素」（页面或本扩展 Shadow 内均可）。
  // 用于在小窗顶部「原样克隆」展示——即便渲染器去掉了源码标注（KaTeX html-only /
  // MathJax v3 去脚本），依然能正确显示公式。仅当整段选区落在「同一个」公式内才返回。
  function findSelectedMathElement(sel) {
    try {
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const sEl = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement : range.startContainer;
      const eEl = range.endContainer.nodeType === Node.TEXT_NODE
        ? range.endContainer.parentElement : range.endContainer;
      if (!sEl || !eEl) return null;
      const mStart = closestMathContainer(sEl);
      const mEnd = closestMathContainer(eEl);
      if (!mStart || !mEnd || mStart !== mEnd) return null;  // 必须同一个公式
      return mStart;
    } catch (_) {
      return null;
    }
  }

  function cleanTextForMatch(s) {
    return s.replace(/[\u00A0\r\n\t]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function extractSnippet(fullText, selText, radius) {
    const normText = cleanTextForMatch(fullText);
    const normSel = cleanTextForMatch(selText);
    const idx = normText.indexOf(normSel);
    if (idx < 0) return '';
    const snip = fullText.slice(
      Math.max(0, idx - radius),
      Math.min(fullText.length, idx + normSel.length + radius)
    );
    return snip.replace(/[\r\n]{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  }

  function getPageContext() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return '';

      const range = sel.getRangeAt(0);
      const anchor = range.startContainer;
      const selText = sel.toString().trim();
      if (!selText) return '';

      const startEl = anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : (anchor.nodeType === Node.ELEMENT_NODE ? anchor : null);

      // 选区在扩展自身的 Shadow DOM 内：提取所在对话框的聊天区内容作为上下文
      const root = anchor.getRootNode();
      if (root instanceof ShadowRoot && root.host && root.host.id === 'universal-sub-agent-host') {
        if (startEl && typeof startEl.closest === 'function') {
          const dialogEl = startEl.closest('.usa-dialog');
          if (dialogEl) {
            const chatArea = dialogEl.querySelector('.usa-chat');
            if (chatArea) {
              const chatText = chatArea.textContent || '';
              if (chatText.length > selText.length + 5) {
                const result = extractSnippet(chatText, selText, 1000);
                if (result) return result;
              }
              return chatText.slice(0, 2000).replace(/[\r\n]{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
            }
          }
        }
        return '';
      }

      // 尝试语义容器（不含 div 兜底，避免拿到整页噪音）
      if (startEl && typeof startEl.closest === 'function') {
        const container = startEl.closest(
          'article, [data-message], .message, .markdown-body, .prose, [role="article"], main'
        );
        if (container) {
          const fullText = container.innerText || container.textContent || '';
          if (fullText) {
            const result = extractSnippet(fullText, selText, 1000);
            if (result) return result;
          }
        }
      }

      // 语义容器匹配失败：用选区所在块级父元素精确提取
      let parent = range.commonAncestorContainer;
      if (parent.nodeType === Node.TEXT_NODE) parent = parent.parentElement;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
        // 找到一个有足够内容的块级容器
        if (/^(p|li|td|th|dd|dt|figcaption|blockquote|pre|h[1-6]|section|aside|div)$/.test(tag)) {
          const fullText = parent.innerText || parent.textContent || '';
          if (fullText.length > selText.length + 5) {
            const result = extractSnippet(fullText, selText, 1000);
            if (result) return result;
          }
          // 即使 indexOf 匹配失败，也取该元素前 2000 字（比取整页靠谱）
          const limited = fullText.slice(0, 2000);
          return limited.replace(/[\r\n]{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
        }
        parent = parent.parentElement;
      }

      return '';
    } catch (e) {
      return '';
    }
  }

  // ---------- 4.1 选词精确定位 ----------
  // 计算 (container, offset) 在 root.textContent 中的绝对字符偏移。
  // 用 Range 从 root 起点量到 (container, offset)，其文本长度即偏移量；
  // 对文本节点与元素节点边界均适用，且天然兼容 Shadow DOM 内的选区。
  function charOffsetInRoot(root, container, offset) {
    try {
      const r = document.createRange();
      r.setStart(root, 0);
      r.setEnd(container, offset);
      return r.toString().length;
    } catch (_) {
      return -1;
    }
  }

  // 找到选区所属的根容器：优先对话框聊天区（嵌套选词），否则语义容器 / 块级父元素，
  // 与 getPageContext 的根判定保持一致，使偏移量与「全局背景资料」同源。
  function findSelectionRoot(range) {
    try {
      const node = range.startContainer;
      const startEl = node.nodeType === Node.TEXT_NODE
        ? node.parentElement
        : (node.nodeType === Node.ELEMENT_NODE ? node : null);
      if (!startEl) return null;
      if (typeof startEl.closest === 'function') {
        const dlg = startEl.closest('.usa-dialog');
        if (dlg) {
          const chat = dlg.querySelector('.usa-chat');
          if (chat) return chat;
        }
        const container = startEl.closest(
          'article, [data-message], .message, .markdown-body, .prose, [role="article"], main'
        );
        if (container) return container;
      }
      let parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
      while (parent && parent !== document.body && parent !== document.documentElement) {
        const tag = parent.tagName ? parent.tagName.toLowerCase() : '';
        if (/^(p|li|td|th|dd|dt|figcaption|blockquote|pre|h[1-6]|section|aside|div)$/.test(tag)) {
          return parent;
        }
        parent = parent.parentElement;
      }
      return document.body;
    } catch (_) {
      return null;
    }
  }

  // 描述根容器，便于 AI 进一步定位（如 div#formula.tex）
  function describeRoot(root) {
    try {
      const tag = root.tagName ? root.tagName.toLowerCase() : 'document';
      const id = root.id ? '#' + root.id : '';
      let cls = '';
      if (root.className && typeof root.className === 'string') {
        const c = root.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (c) cls = '.' + c;
      }
      return (tag + id + cls) || '当前上下文';
    } catch (_) {
      return '当前上下文';
    }
  }

  // 采集当前选区的精确定位信息：字符偏移 + 带 ⟦⟧ 标记的局部片段 + 根容器标签。
  // 即使页面存在多处相同文字，局部片段也会展示该实例独有的前后文，并用 ⟦⟧ 精确框定，
  // 使 AI 能唯一锁定用户所选的具体实例。
  function captureSelectionInfo() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const selText = sel.toString();
      if (!selText.trim()) return null;

      // 公式内选词：直接用干净源码作为局部片段，避免 root.textContent 中
      // MathML 标注与可视文本重复导致的偏移/标记错乱（偏移量对公式无意义）。
      const texSrc = extractMathSource(sel);
      if (texSrc !== null) {
        // 识别渲染器，给出更准确的标签，便于 AI 理解来源
        let label = '公式（以 ⟦⟧ 内源码为准）';
        try {
          const sEl = range.startContainer.nodeType === Node.TEXT_NODE
            ? range.startContainer.parentElement : range.startContainer;
          const m = closestMathContainer(sEl);
          if (m) {
            const cls = m.getAttribute('class') || '';
            const tag = m.tagName || '';
            if (/katex/.test(cls)) label = 'KaTeX 公式（以 ⟦⟧ 内 TeX 为准）';
            else if (/MathJax/.test(cls) || /mjx-container/i.test(tag)) label = 'MathJax 公式（以 ⟦⟧ 内源码为准）';
          }
        } catch (_) {}
        return {
          localFragment: '⟦' + texSrc + '⟧',
          absStart: null,
          absEnd: null,
          rootLabel: label,
          isFormula: true
        };
      }

      const root = findSelectionRoot(range);
      if (!root) return null;
      const full = root.textContent || '';
      if (!full) return null;

      const start = charOffsetInRoot(root, range.startContainer, range.startOffset);
      const end = charOffsetInRoot(root, range.endContainer, range.endOffset);
      if (start < 0 || end < 0 || start > end || end > full.length) return null;

      // 局部窗口：选区前后各约 80 字，传输量极小
      const W = 80;
      const fragStart = Math.max(0, start - W);
      const fragEnd = Math.min(full.length, end + W);
      const before = full.slice(fragStart, start);
      const selected = full.slice(start, end);
      const after = full.slice(end, fragEnd);
      const localFragment = before + '⟦' + selected + '⟧' + after;

      return {
        localFragment: localFragment,
        absStart: start,
        absEnd: end,
        rootLabel: describeRoot(root)
      };
    } catch (_) {
      return null;
    }
  }

  // 判断当前选区所在的「直接父窗口」（即本次选词是从哪个对话框里选出来的）。
  // 嵌套选词时，新建的窗口应当继承【直接父窗口】的选词内容与上下文，
  // 而不是更上层的窗口——这样才能保证多级嵌套（窗口一→窗口二→窗口三…）链条不断。
  function findSourceDialog() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      const range = sel.getRangeAt(0);
      const startContainer = range.startContainer;

      // 策略一（主路径）：沿选区锚点的 DOM 祖先向上找最近的 .usa-dialog。
      // 所有对话框都挂在同一个 host 的 ShadowRoot 内，因此一段普通的
      // parentElement 向上回溯即可命中「直接父窗口」，不会跳过中间层。
      let el = startContainer && startContainer.nodeType === Node.TEXT_NODE
        ? startContainer.parentElement
        : (startContainer && startContainer.nodeType === Node.ELEMENT_NODE ? startContainer : null);
      while (el) {
        if (typeof el.closest === 'function') {
          const dlgEl = el.closest('.usa-dialog');
          if (dlgEl) {
            const found = activeDialogs.find(function (d) { return d.dialog === dlgEl; });
            if (found) return found;
          }
        }
        // 若当前节点处于某个 ShadowRoot 内，则跨过边界继续向上（保险措施）
        const root = (el.getRootNode && el.getRootNode()) || null;
        if (root && root !== document && root.host) {
          el = root.host;
        } else {
          el = el.parentElement;
        }
      }

      // 策略二（兜底，仅当策略一因故未命中时）：按选区文本做子串匹配。
      // 关键点：从【最新】的对话框开始向前找（逆序），因为嵌套链中
      // 「直接父窗口」永远是最新打开的那个；若文本同时出现在多层窗口里，
      // 逆序能命中最近的父窗口，而不会错误地跳回更上层的窗口一。
      const text = sel.toString().trim();
      if (text) {
        for (let i = activeDialogs.length - 1; i >= 0; i--) {
          const d = activeDialogs[i];
          const chat = d.dialog ? d.dialog.querySelector('.usa-chat') : null;
          if (chat && (chat.textContent || '').indexOf(text) >= 0) return d;
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // 判定「当前选词所属的直接父窗口」。
  // 主路径用 mouseup 事件的 composedPath() 沿真实 DOM 路径向上找最近的 .usa-dialog。
  // 关键点：监听器挂在 document 上，而选区位于扩展自身的 Shadow DOM 内；按 Shadow
  // 事件重定向规则，document 层看到的 e.target 会被重定向到 shadow host（而非内部
  // 对话框），因此必须用 composedPath()（它保留原始节点、不受重定向影响）才能跨边界
  // 命中来源窗口。这条路径只依赖 DOM 树结构，不依赖 getSelection 在 Shadow 内的选区
  // 状态——真实浏览器中点击按钮时选区常被折叠、Shadow 选区探测也时好时坏，旧实现因此
  // 在窗口三这种深层嵌套场景误判。仅当拿不到路径时才退回 findSourceDialog() 兜底。
  function resolveSourceDialog(e) {
    try {
      if (e && typeof e.composedPath === 'function') {
        const path = e.composedPath();
        for (let i = 0; i < path.length; i++) {
          const node = path[i];
          if (node && node.nodeType === Node.ELEMENT_NODE && typeof node.closest === 'function') {
            const dlgEl = node.closest('.usa-dialog');
            if (dlgEl) {
              const found = activeDialogs.find(function (d) { return d.dialog === dlgEl; });
              if (found) return found;
            }
          }
        }
      }
    } catch (_) {}
    return findSourceDialog();
  }

  // 把元素定位到选区附近
  // 按钮：优先放在选区右侧（垂直居中），空间不足则放左侧
  // 对话框：放在选区右下方（支持 staggerY 偏移）
  // fallbackX/Y: 当 getBoundingClientRect 无效时（如 Shadow DOM 内选区），用鼠标坐标代替
  function positionNearSelection(el, staggerY, fallbackX, fallbackY) {
    staggerY = staggerY || 0;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      if (fallbackX === undefined || fallbackY === undefined) return;
    }
    const margin = 8;
    const isButton = el.classList.contains('usa-btn');

    const prevDisplay = el.style.display;
    const prevVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
    el.style.display = el.classList.contains('usa-dialog') ? 'flex' : 'inline-flex';
    const ew = el.offsetWidth || 80;
    const eh = el.offsetHeight || 32;
    el.style.display = prevDisplay;
    el.style.visibility = prevVisibility;

    const hasRect = rect.width !== 0 || rect.height !== 0;

    if (isButton) {
      // 按钮：优先放选区右侧（垂直居中），右方不够放左侧
      const br = hasRect ? rect.right : fallbackX;
      const bl = hasRect ? rect.left : (fallbackX - 20);
      const btop = hasRect ? rect.top : fallbackY;
      const bh = hasRect ? rect.height : 16;
      let x = br + margin;
      let y = btop + (bh - eh) / 2;
      if (x + ew > window.innerWidth - margin) {
        // 右侧放不下，改放左侧
        x = bl - ew - margin;
      }
      if (x < margin) x = margin;
      if (y < margin) y = margin;
      if (y + eh > window.innerHeight - margin) y = window.innerHeight - eh - margin;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    } else {
      // 对话框：放在选区右下方
      let x = hasRect ? rect.right : (fallbackX + 4);
      let y = (hasRect ? rect.bottom : (fallbackY + 4)) + margin + staggerY;
      if (x + ew > window.innerWidth - margin) x = window.innerWidth - ew - margin;
      if (x < margin) x = margin;
      if (y + eh > window.innerHeight - margin) y = Math.max(margin, (hasRect ? rect.top : (fallbackY - 16)) - eh - margin);
      el.style.left = x + 'px';
      el.style.top = y + 'px';
    }
  }

  function showButton() { btn.style.display = 'inline-flex'; }
  function hideButton() { btn.style.display = 'none'; }

  // ===== 窗口管理器 =====
  const MAX_WINDOWS = 3;
  const activeDialogs = [];
  let globalDragTarget = null; // 当前正在拖拽的实例引用

  // 全部窗口序号刷新（每有窗口增删均调用）
  function updateAllDialogNumbers() {
    for (let i = 0; i < activeDialogs.length; i++) {
      activeDialogs[i].setNumber(i + 1);
    }
  }

  // ===== DialogInstance 工厂函数 =====
  // 每个实例拥有独立的 DOM引用、对话历史、请求状态、渲染状态、拖拽状态等
  function createDialogInstance(selectedText, pageContext) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

    // ---- 实例私有状态 ----
    let dialog = null, selectedArea = null, chatArea = null;
    let inputEl = null, sendBtn = null, closeBtn = null, newChatBtn = null;
    let winNumEl = null, providerSel = null;
    let currentRequestId = null;
    let answerRaw = '';
    let renderPending = false;
    let dragState = null;
    let watchdogTimer = null;
    let currentProvider = 'deepseek';
    let savedDefaultProvider = 'deepseek';

    // 多轮对话状态
    let chatHistory = [];
    let currentAIBubble = null;
    let pendingUserQuestion = '';

    function setNumber(n) {
      if (winNumEl) winNumEl.textContent = String(n);
    }

    // ---- 实例方法 ----

    function renderMath() {
      if (!currentAIBubble) return;
      if (typeof window.renderMathInElement !== 'function') {
        katexReady = false;
        return;
      }
      ensureKaTeX();
      try {
        renderMathInElement(currentAIBubble, {
          delimiters: KA_DELIMS,
          throwOnError: false,
          ignoredTags: KA_IGNORED
        });
      } catch (e) {
        console.error('[Universal Sub-Agent] KaTeX 渲染失败:', e);
      }
    }

    function scheduleRender() {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        renderPending = false;
        if (!currentAIBubble) return;
        currentAIBubble.innerHTML = renderMarkdown(answerRaw);
        renderMath();
      });
    }

    function startWatchdog() {
      clearWatchdog();
      watchdogTimer = setTimeout(() => {
        if (!dialog || !currentAIBubble) return;
        if (!currentAIBubble.classList.contains('usa-loading')) return;
        if (sendBtn) sendBtn.disabled = false;
        currentAIBubble.classList.remove('usa-loading');
        currentAIBubble.textContent =
          '未收到响应。请按顺序排查：\n' +
          '1) 点击扩展图标 → 设置，确认已填写正确的 API Key 并选择对应厂商；\n' +
          '2) 在 chrome://extensions 找到本扩展，点击刷新图标重新加载；\n' +
          '3) 点击扩展卡片上的"service worker"链接，查看后台控制台的报错日志。';
      }, 20000);
    }

    function clearWatchdog() {
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    }

    function removeFromManager() {
      const idx = activeDialogs.indexOf(inst);
      if (idx >= 0) activeDialogs.splice(idx, 1);
      if (globalDragTarget === inst) globalDragTarget = null;
      updateAllDialogNumbers();
    }

    function closeDialog() {
      currentRequestId = null;
      answerRaw = '';
      renderPending = false;
      dragState = null;
      clearWatchdog();
      chatHistory = [];
      currentAIBubble = null;
      pendingUserQuestion = '';
      savedDefaultProvider = 'deepseek';
      if (dialog) { dialog.remove(); dialog = null; }
      selectedArea = chatArea = inputEl = sendBtn = closeBtn = newChatBtn = winNumEl = providerSel = null;
      removeFromManager();
    }

    // 销毁（仅清理 JS 状态，不移除 DOM — 供 selfDestruct 使用）
    function destroy() {
      currentRequestId = null;
      answerRaw = '';
      renderPending = false;
      dragState = null;
      clearWatchdog();
      chatHistory = [];
      currentAIBubble = null;
      pendingUserQuestion = '';
      savedDefaultProvider = 'deepseek';
      dialog = selectedArea = chatArea = inputEl = sendBtn = closeBtn = newChatBtn = winNumEl = providerSel = null;
    }

    function newChat() {
      chatHistory = [];
      currentAIBubble = null;
      pendingUserQuestion = '';
      currentRequestId = null;
      answerRaw = '';
      renderPending = false;
      clearWatchdog();
      if (chatArea) chatArea.innerHTML = '';
      if (inputEl) { inputEl.value = ''; inputEl.focus(); }
      if (sendBtn) sendBtn.disabled = false;
    }

    function send() {
      if (dead || !dialog) return;
      const userQuestion = inputEl.value.trim() || '详细解释划选部分的文字';
      inputEl.value = '';

      const userBubble = document.createElement('div');
      userBubble.className = 'usa-msg-user';
      userBubble.textContent = userQuestion;
      chatArea.appendChild(userBubble);

      const aiBubble = document.createElement('div');
      aiBubble.className = 'usa-msg-ai usa-loading';
      aiBubble.textContent = '思考中…';
      chatArea.appendChild(aiBubble);
      currentAIBubble = aiBubble;

      pendingUserQuestion = userQuestion;
      chatArea.scrollTop = chatArea.scrollHeight;

      const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      currentRequestId = requestId;
      answerRaw = '';
      sendBtn.disabled = true;

      try {
        chrome.runtime.sendMessage(
          { type: 'ASK_AI', provider: currentProvider, selectedText: selectedText, userQuestion: userQuestion, pageContext: pageContext, chatHistory: chatHistory, requestId: requestId, selectionContext: currentSelectionCtx },
          () => {
            if (chrome.runtime.lastError) {
              if (!sendBtn || !currentAIBubble) return;
              clearWatchdog();
              sendBtn.disabled = false;
              currentAIBubble.classList.remove('usa-loading');
              currentAIBubble.textContent = '通信失败：' + chrome.runtime.lastError.message;
            }
          }
        );
      } catch (err) {
        clearWatchdog();
        if (sendBtn) sendBtn.disabled = false;
        if (currentAIBubble) {
          currentAIBubble.classList.remove('usa-loading');
          currentAIBubble.textContent = '扩展通信失败，请刷新本页后重试。';
        }
      }
      startWatchdog();
    }

    function handleChunk(msg) {
      clearWatchdog();
      if (currentAIBubble && currentAIBubble.classList.contains('usa-loading')) {
        currentAIBubble.classList.remove('usa-loading');
        currentAIBubble.textContent = '';
        answerRaw = '';
      }
      answerRaw += msg.chunk;
      scheduleRender();
    }

    function handleDone() {
      if (sendBtn) sendBtn.disabled = false;
      renderPending = false;
      if (!currentAIBubble) return;
      if (!answerRaw) { currentAIBubble.textContent = '（回答为空）'; }
      else { currentAIBubble.innerHTML = renderMarkdown(answerRaw); renderMath(); }
      chatHistory.push({ role: 'user', content: pendingUserQuestion });
      chatHistory.push({ role: 'assistant', content: answerRaw });
      currentAIBubble = null;
    }

    function handleError(msg) {
      if (sendBtn) sendBtn.disabled = false;
      if (!currentAIBubble) return;
      currentAIBubble.classList.remove('usa-loading');
      currentAIBubble.textContent = '出错了：' + (msg.error || '未知错误');
      currentAIBubble = null;
    }

    // 嵌套选词上下文透传：把本窗口（来源窗口）的原始选词、页面上下文与
    // 完整对话一并打包成背景资料，作为新建窗口（子窗口）的 pageContext，
    // 确保子窗口的回答基于完整信息而非孤立片段。
    function buildNestedContext(nestedSelectedText, nestedPageContext) {
      const parts = [];
      if (pageContext) parts.push('【来源窗口的页面上下文】\n' + pageContext);
      if (selectedText) parts.push('【来源窗口的原始选词】\n' + selectedText);
      let chatText = chatArea ? (chatArea.textContent || '').trim() : '';
      if (!chatText && nestedPageContext) chatText = nestedPageContext.trim();
      if (chatText) parts.push('【来源窗口的对话内容】\n' + chatText);
      if (nestedSelectedText) parts.push('【本次在窗口中高亮选中的文字】\n' + nestedSelectedText);
      const enrichedContext = parts.join('\n\n');
      // 局部片段仍为本次高亮文字，便于 AI 精确定位提问点
      return { selectedText: nestedSelectedText, pageContext: enrichedContext };
    }

    function buildDialog() {
      const wrap = document.createElement('div');
      wrap.innerHTML = dialogTpl;
      const dlg = wrap.firstElementChild;
      shadow.appendChild(dlg);
      dialog = dlg;
      selectedArea = dlg.querySelector('.usa-selected');
      chatArea = dlg.querySelector('.usa-chat');
      inputEl = dlg.querySelector('.usa-input');
      sendBtn = dlg.querySelector('.usa-send');
      closeBtn = dlg.querySelector('.usa-close');
      newChatBtn = dlg.querySelector('.usa-newchat');
      winNumEl = dlg.querySelector('.usa-win-num');
      providerSel = dlg.querySelector('.usa-provider-sel');
      const setDefaultBtn = dlg.querySelector('.usa-set-default');
      const dragbar = dlg.querySelector('.usa-dragbar');

      // 加载厂商列表
      loadProviders(setDefaultBtn);

      closeBtn.addEventListener('mousedown', (e) => e.preventDefault());
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
      newChatBtn.addEventListener('mousedown', (e) => e.preventDefault());
      newChatBtn.addEventListener('click', (e) => { e.stopPropagation(); newChat(); });
      providerSel.addEventListener('mousedown', (e) => { e.stopPropagation(); });
      providerSel.addEventListener('change', function () {
        currentProvider = providerSel.value;
        if (setDefaultBtn) {
          if (currentProvider === savedDefaultProvider) {
            setDefaultBtn.classList.add('is-default');
            setDefaultBtn.title = '当前为默认模型';
          } else {
            setDefaultBtn.classList.remove('is-default');
            setDefaultBtn.title = '设为默认模型';
          }
        }
      });
      setDefaultBtn.addEventListener('mousedown', (e) => e.preventDefault());
      setDefaultBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        savedDefaultProvider = currentProvider;
        chrome.storage.local.set({ provider: currentProvider }, function () {
          if (setDefaultBtn) {
            setDefaultBtn.classList.add('is-default');
            setDefaultBtn.title = '当前为默认模型';
          }
        });
      });
      dragbar.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || e.target === newChatBtn || e.target === providerSel || e.target === setDefaultBtn || !dialog) return;
        const rect = dialog.getBoundingClientRect();
        dragState = { offX: e.clientX - rect.left, offY: e.clientY - rect.top };
        globalDragTarget = inst;
        e.preventDefault();
      });
      sendBtn.addEventListener('click', send);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }

    function loadProviders(setDefaultBtn) {
      chrome.storage.local.get(['apiKeys', 'apiKey', 'provider'], function (data) {
        var apiKeys = data.apiKeys || {};
        if (!data.apiKeys && data.apiKey) {
          apiKeys[data.provider || 'deepseek'] = data.apiKey;
        }
        var active = data.provider || 'deepseek';
        currentProvider = active;
        savedDefaultProvider = active;

        // 填充厂商下拉框
        if (!providerSel) return;
        providerSel.innerHTML = '';
        var hasAny = false;
        Object.keys(DISPLAY_NAMES).forEach(function (p) {
          if (apiKeys[p]) {
            hasAny = true;
            var opt = document.createElement('option');
            opt.value = p;
            opt.textContent = DISPLAY_NAMES[p];
            if (p === active) opt.selected = true;
            providerSel.appendChild(opt);
          }
        });
        if (!hasAny) {
          var opt = document.createElement('option');
          opt.value = active;
          opt.textContent = DISPLAY_NAMES[active] || active;
          providerSel.appendChild(opt);
        }

        // 同步更新星号按钮（复用同一份 provider 数据，无需再读存储）
        if (setDefaultBtn) {
          if (currentProvider === savedDefaultProvider) {
            setDefaultBtn.classList.add('is-default');
            setDefaultBtn.title = '当前为默认模型';
          } else {
            setDefaultBtn.classList.remove('is-default');
            setDefaultBtn.title = '设为默认模型';
          }
        }
      });
    }

    function openDialog(openClientX, openClientY) {
      buildDialog();
      chatHistory = [];
      currentAIBubble = null;
      pendingUserQuestion = '';
      // 小窗顶部展示「选中内容」：
      // 1) 若选区落在某个真实公式渲染元素内（currentMathElement），直接克隆该元素——
      //    无论渲染器是否保留了源码标注（KaTeX html-only / MathJax v3 去脚本 等），
      //    都能原样、正确地显示公式，无需重新提取/重绘源码。
      // 2) 兜底：用 renderMathOnly 处理纯文本里的 $...$ / $$...$$，再交给 KaTeX 重绘。
      try {
        if (currentMathElement && typeof currentMathElement.cloneNode === 'function') {
          const tag = (currentMathElement.tagName || '').toLowerCase();
          const cls = currentMathElement.getAttribute('class') || '';
          const isMathJax = /mathjax|mjx-container/i.test(tag + ' ' + cls);
          const clone = currentMathElement.cloneNode(true);
          clone.removeAttribute('id');            // 避免与页面 id 冲突
          clone.removeAttribute('style');         // 重置页面可能加的内联尺寸/边距
          selectedArea.innerHTML = '';
          selectedArea.appendChild(clone);
          if (isMathJax) ensureMathJaxCss();       // 克隆 mjx-container 需要 MathJax 布局样式
          ensureKaTeX();                           // KaTeX 样式（若尚未加载）
        } else {
          selectedArea.innerHTML = renderMathOnly(selectedText || '');
          if (typeof window.renderMathInElement === 'function') {
            try {
              ensureKaTeX();
              renderMathInElement(selectedArea, { delimiters: KA_DELIMS, throwOnError: false, ignoredTags: KA_IGNORED });
            } catch (e) { /* 渲染失败则保留纯文本 $e^2$ */ }
          }
        }
      } catch (e) {
        // 克隆异常 → 回退到公式重绘
        selectedArea.innerHTML = renderMathOnly(selectedText || '');
        if (typeof window.renderMathInElement === 'function') {
          try { ensureKaTeX(); renderMathInElement(selectedArea, { delimiters: KA_DELIMS, throwOnError: false, ignoredTags: KA_IGNORED }); } catch (_) {}
        }
      }
      const stagger = (activeDialogs.length - 1) * 25;
      positionNearSelection(dialog, stagger, openClientX, openClientY);
      dialog.style.display = 'flex';
      setTimeout(() => { if (inputEl) inputEl.focus(); }, 0);
    }

    // 实例公开接口
    const inst = {
      id: id,
      destroy: destroy,
      openDialog: openDialog,
      closeDialog: closeDialog,
      handleChunk: handleChunk,
      handleDone: handleDone,
      handleError: handleError,
      setNumber: setNumber,
      buildNestedContext: buildNestedContext,
      get currentRequestId() { return currentRequestId; },
      get dragState() { return dragState; },
      get dialog() { return dialog; }
    };

    return inst;
  }

  // ===== 模块级事件监听 =====

  // 划词显示按钮
  document.addEventListener('mouseup', (e) => {
    if (dead) return;
    const text = getSelectionText();
    if (text.length === 0) { hideButton(); currentMathElement = null; return; }
    currentText = text;
    // 捕获选区所在的真实公式渲染元素（页面或本扩展 Shadow 内），供小窗顶部原样克隆展示；
    // 选区为空/非公式时清空，避免复用上一次的残留节点。
    currentMathElement = findSelectedMathElement(window.getSelection());
    // 用事件路径稳健判定来源窗口（不依赖 getSelection 在 Shadow DOM 内的选区状态），
    // 并据此取得上下文——避免真实浏览器中选区折叠/Shadow 选区探测异常导致来源窗口丢失。
    currentSourceDialog = resolveSourceDialog(e);
    if (currentSourceDialog && currentSourceDialog.dialog) {
      // 嵌套选词：上下文直接取来源窗口的聊天区内容（最可靠，不依赖选区探测）
      const chat = currentSourceDialog.dialog.querySelector('.usa-chat');
      currentPageContext = chat ? (chat.textContent || '').trim().slice(0, 2000) : '';
    } else {
      // 网页选词：走原有的语义容器逻辑
      currentPageContext = getPageContext();
    }
    // 采集选词精确定位信息（字符偏移 + ⟦⟧ 标记局部片段），供后台传递给 AI 区分重复文本
    currentSelectionCtx = captureSelectionInfo();
    positionNearSelection(btn, 0, e.clientX, e.clientY);
    showButton();
  });

  document.addEventListener('selectionchange', () => {
    if (dead) return;
    if (getSelectionText().length === 0) hideButton();
  });

  // 点击网页其他地方：仅隐藏按钮，不动对话框
  document.addEventListener('mousedown', (e) => {
    if (dead) return;
    if (host.contains(e.target)) return;
    if (getSelectionText().length === 0) hideButton();
  }, true);

  // Esc：关闭最早窗口（FIFO）
  document.addEventListener('keydown', (e) => {
    if (dead) return;
    if (e.key === 'Escape' && activeDialogs.length > 0) {
      activeDialogs.shift().closeDialog();
    }
  }, true);

  // 拖拽：文档级 mousemove / mouseup
  document.addEventListener('mousemove', (e) => {
    if (dead || !globalDragTarget) return;
    const inst = globalDragTarget;
    const ds = inst.dragState;
    const dlg = inst.dialog;
    if (!ds || !dlg) return;
    let x = e.clientX - ds.offX;
    let y = e.clientY - ds.offY;
    const rect = dlg.getBoundingClientRect();
    const margin = 4;
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin;
    if (y + rect.height > window.innerHeight - margin) y = window.innerHeight - rect.height - margin;
    dlg.style.left = x + 'px';
    dlg.style.top = y + 'px';
  });
  document.addEventListener('mouseup', () => { if (!dead) globalDragTarget = null; });
  window.addEventListener('blur', () => { if (!dead) globalDragTarget = null; });

  // 按钮点击：展开新对话框（超过 3 个时先关最早的）
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideButton();
    let selectedText = currentText;
    let pageContext = currentPageContext;
    // 嵌套选词：把来源窗口（窗口一）的选词内容与上下文一并带到新窗口（窗口二），
    // 保证子窗口基于完整信息生成回答。非嵌套选词时 currentSourceDialog 为 null，行为不变。
    if (currentSourceDialog && typeof currentSourceDialog.buildNestedContext === 'function') {
      const enriched = currentSourceDialog.buildNestedContext(selectedText, pageContext);
      selectedText = enriched.selectedText;
      pageContext = enriched.pageContext;
    }
    if (activeDialogs.length >= MAX_WINDOWS) {
      activeDialogs.shift().closeDialog();
    }
    const inst = createDialogInstance(selectedText, pageContext);
    activeDialogs.push(inst);
    inst.openDialog(e.clientX, e.clientY);
    updateAllDialogNumbers();
  });

  // 接收后台流式回包：按 requestId 路由到对应实例
  chrome.runtime.onMessage.addListener((msg) => {
    if (dead) return;
    if (!msg || !msg.requestId) return;
    const inst = activeDialogs.find(function (d) { return d.currentRequestId === msg.requestId; });
    if (!inst) return;

    if (msg.type === 'AI_CHUNK') {
      inst.handleChunk(msg);
    } else if (msg.type === 'AI_DONE') {
      inst.handleDone();
    } else if (msg.type === 'AI_ERROR') {
      inst.handleError(msg);
    }
  });

})();
