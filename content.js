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
    .usa-chat .katex-display { margin: 8px 0; overflow-x: auto; overflow-y: hidden; padding: 2px 0; }

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

  // ---------- 3. 轻量 Markdown 渲染器（内置、无依赖、XSS 安全） ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    const maths = [];
    const codes = [];
    let raw = text;
    raw = raw.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    raw = raw.replace(/\$\$([^$]+)\$\$/g,    (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g,  (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g,  (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\$([^$\n]+)\$/g,       (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });

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
  function getSelectionText() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return '';
    return sel.toString().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function getPageContext() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return '';
      const anchor = sel.anchorNode;
      if (!anchor) return '';

      const startEl = anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : (anchor.nodeType === Node.ELEMENT_NODE ? anchor : null);
      if (!startEl || typeof startEl.closest !== 'function') return '';

      const container = startEl.closest(
        'article, [data-message], .message, .markdown-body, .prose, [role="article"], main, div'
      );
      if (!container) return '';

      const fullText = container.innerText || container.textContent || '';
      if (!fullText) return '';

      const selText = sel.toString();
      const RADIUS = 1000;
      let start, end;
      const idx = fullText.indexOf(selText);
      if (idx >= 0) {
        start = Math.max(0, idx - RADIUS);
        end = Math.min(fullText.length, idx + selText.length + RADIUS);
      } else {
        start = 0;
        end = Math.min(fullText.length, RADIUS * 2);
      }

      let snippet = fullText.slice(start, end);
      snippet = snippet.replace(/[\r\n]{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
      return snippet;
    } catch (e) {
      return '';
    }
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
    let winNumEl = null;
    let currentRequestId = null;
    let answerRaw = '';
    let renderPending = false;
    let dragState = null;
    let watchdogTimer = null;

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
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '\\[', right: '\\]', display: true },
            { left: '\\(', right: '\\)', display: false },
            { left: '$',  right: '$',  display: false }
          ],
          throwOnError: false,
          ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
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
      if (dialog) { dialog.remove(); dialog = null; }
      selectedArea = chatArea = inputEl = sendBtn = closeBtn = newChatBtn = winNumEl = null;
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
      dialog = selectedArea = chatArea = inputEl = sendBtn = closeBtn = newChatBtn = winNumEl = null;
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
          { type: 'ASK_AI', selectedText: selectedText, userQuestion: userQuestion, pageContext: pageContext, chatHistory: chatHistory, requestId: requestId },
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
      const dragbar = dlg.querySelector('.usa-dragbar');

      closeBtn.addEventListener('mousedown', (e) => e.preventDefault());
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
      newChatBtn.addEventListener('mousedown', (e) => e.preventDefault());
      newChatBtn.addEventListener('click', (e) => { e.stopPropagation(); newChat(); });
      dragbar.addEventListener('mousedown', (e) => {
        if (e.target === closeBtn || e.target === newChatBtn || !dialog) return;
        const rect = dialog.getBoundingClientRect();
        dragState = { offX: e.clientX - rect.left, offY: e.clientY - rect.top };
        globalDragTarget = inst;
        e.preventDefault();
      });
      sendBtn.addEventListener('click', send);
      inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
    }

    function openDialog(openClientX, openClientY) {
      buildDialog();
      chatHistory = [];
      currentAIBubble = null;
      pendingUserQuestion = '';
      selectedArea.textContent = selectedText;
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
    if (text.length === 0) { hideButton(); return; }
    currentText = text;
    currentPageContext = getPageContext();
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
    if (activeDialogs.length >= MAX_WINDOWS) {
      activeDialogs.shift().closeDialog();
    }
    const inst = createDialogInstance(currentText, currentPageContext);
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
