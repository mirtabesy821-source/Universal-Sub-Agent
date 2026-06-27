// ============================================================
// Universal Sub-Agent - 内容脚本 (Content Script)
// 阶段五：多轮对话 + Markdown 渲染 + 流式实时排版 + 销毁式关闭
// ============================================================
// 作用：监听用户在任意网页上的文字划选，在选区附近弹出"🔍 解释"小按钮；
//       点击后原地展开一个用 Shadow DOM 隔离的悬浮对话窗口（Notion AI 风格），
//       用户可针对选中文本连续提问，AI 参考历史对话保持上下文连贯。
// 样式隔离：所有 UI 与 CSS 全部封装在 Shadow DOM 内，宿主网站无法影响。
// 关闭语义：点击 × 或 Esc → 销毁当前对话框（移除 DOM + 中断流式请求）。
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
  // 宿主自身：不占布局、不拦截页面事件、置于最顶层
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
      position: fixed; pointer-events: auto;
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
      position: fixed; pointer-events: auto;
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
        <span class="usa-dragdot"></span>
        <div class="usa-bar-actions">
          <button class="usa-newchat" title="新对话">⟳</button>
          <button class="usa-close" title="关闭 (Esc)">×</button>
        </div>
      </div>
      <div class="usa-selected"></div>
      <div class="usa-chat"></div>
      <div class="usa-input-row">
        <input class="usa-input" type="text" placeholder="针对这段文字提问…" />
        <button class="usa-send">发送</button>
      </div>
    </div>
  `;

  // 对话框内部元素引用（每次 buildDialog 重新赋值，关闭后置 null）
  let dialog = null, selectedArea = null, chatArea = null;
  let input = null, sendBtn = null, closeBtn = null, newChatBtn = null;

  // 当前划选文本（打开对话框时快照保存）
  let currentText = '';
  // 当前选区周围的页面上下文（mouseup 时抓取，send 时发送给后台）
  let currentPageContext = '';
  // 当前请求 id，用于匹配后台流式回包；关闭时置 null 以中断/忽略过期回包
  let currentRequestId = null;
  // 累积的原始 Markdown 文本（每收到 chunk 追加，再整体重渲染到当前 AI 气泡）
  let answerRaw = '';
  // rAF 节流：把同一帧内多个 chunk 合并为一次渲染，避免高频重排
  let renderPending = false;
  // 拖拽状态：{offX, offY} 记录鼠标相对对话框左上角的偏移；null 表示未拖拽
  let dragState = null;
  // 看门狗：发送后若 20 秒内没有任何回包（chunk/done/error），给用户可读提示
  let watchdogTimer = null;

  // ★ 多轮对话状态
  let chatHistory = [];         // [{role:'user'|'assistant', content:string}]
  let currentAIBubble = null;   // 当前正在流式渲染的 AI 气泡 DOM 元素
  let pendingUserQuestion = ''; // 当前轮用户提问（AI_DONE 时提交到 chatHistory）

  // ---------- 上下文失效检测 ----------
  // 扩展重载后，已打开标签页里的旧 content script 上下文会失效，
  // 此时所有 chrome.* 调用都会抛 "Extension context invalidated"。
  // 检测到失效后设置 dead 标志并移除宿主元素，让残留监听器变成空操作，不再报错。
  let dead = false;
  function contextValid() {
    try { return !!chrome.runtime?.id; } catch (_) { return false; }
  }
  function selfDestruct() {
    if (dead) return;
    dead = true;
    clearWatchdog();
    dragState = null;
    currentRequestId = null;
    if (host && host.parentNode) host.remove();
  }
  // 每 2 秒检测一次；失效则自清理并停止检测
  const ctxCheckTimer = setInterval(() => {
    if (!contextValid()) { clearInterval(ctxCheckTimer); selfDestruct(); }
  }, 2000);

  // ---------- 2.5 KaTeX 公式引擎（本地打包，由 manifest content_scripts 注入） ----------
  // katex.min.js + auto-render.min.js 已在 content.js 之前由 Chrome 注入隔离世界，
  // window.katex / window.renderMathInElement 已可直接调用。
  // 此处仅加载 CSS（含 @font-face 字体）到 shadow root。
  // ★ 诊断日志：帮助排查 KaTeX 是否成功加载
  console.log('[Universal Sub-Agent] KaTeX 诊断:',
    'katex=', typeof window.katex,
    'renderMathInElement=', typeof window.renderMathInElement);
  let katexReady = (typeof window.renderMathInElement === 'function');
  if (katexReady) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('katex/katex.min.css');
    shadow.appendChild(link);
    console.log('[Universal Sub-Agent] KaTeX CSS 已加载:', link.href);
  } else {
    console.warn('[Universal Sub-Agent] renderMathInElement 未找到，公式将以原始文本显示。katex=', typeof window.katex);
  }

  // 对当前 AI 气泡调用 renderMathInElement 渲染数学公式
  // ★ 改为动态检查：不依赖 init 时的 katexReady，每次渲染时重新检测
  function renderMath() {
    if (!currentAIBubble) return;
    // 动态检查：防止 init 时 KaTeX 尚未就绪的情况
    if (typeof window.renderMathInElement !== 'function') {
      if (katexReady) { // 曾经就绪但现在不可用（极少见）
        console.warn('[Universal Sub-Agent] renderMathInElement 运行时不可用');
        katexReady = false;
      }
      return;
    }
    if (!katexReady) {
      // init 时未就绪，但现在可用了——补加载 CSS
      katexReady = true;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = chrome.runtime.getURL('katex/katex.min.css');
      shadow.appendChild(link);
      console.log('[Universal Sub-Agent] KaTeX 延迟就绪，CSS 已补加载');
    }
    try {
      renderMathInElement(currentAIBubble, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$',  right: '$',  display: false }
        ],
        throwOnError: false,           // 流式半截公式不报错，显示红色原文
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
      });
    } catch (e) {
      console.error('[Universal Sub-Agent] KaTeX 渲染失败:', e);
    }
  }

  // ---------- 3. 轻量 Markdown 渲染器（内置、无依赖、XSS 安全） ----------
  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
  }

  // 行内格式：`code` / **bold** / *italic* / [text](url) / LaTeX 公式
  // 先用占位符保护行内代码和 LaTeX 公式，避免其内容被 bold/italic 误伤
  function renderInline(text) {
    const maths = [];
    const codes = [];
    let raw = text;
    // ★ 先提取行内代码（在 LaTeX 之前），保护反引号内的 \[ \] $ 等不被误解析为公式
    raw = raw.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
    // 再提取 LaTeX（在 escapeHtml 之前），保护 $..._ ^ 等不被 Markdown 误解析
    raw = raw.replace(/\$\$([^$]+)\$\$/g,    (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g,  (_, m) => { maths.push({ d: true,  t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g,  (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });
    raw = raw.replace(/\$([^$\n]+)\$/g,       (_, m) => { maths.push({ d: false, t: m }); return '\u0002' + (maths.length - 1) + '\u0002'; });

    let t = escapeHtml(raw);
    // 恢复行内代码（在 bold/italic 之前，防止代码内容被误解析）
    t = t.replace(/\u0001(\d+)\u0001/g, (_, n) => '<code class="usa-code-inline">' + escapeHtml(codes[+n]) + '</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    t = t.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
    t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)"<>]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // ★ 恢复 LaTeX：把界定符放回文本节点，让 renderMathInElement 能识别
    t = t.replace(/\u0002(\d+)\u0002/g, (_, n) => {
      const m = maths[+n];
      const esc = escapeHtml(m.t);
      return m.d ? '$$' + esc + '$$' : '\\(' + esc + '\\)';
    });
    return t;
  }

  // 块级渲染：标题 / 引用 / 列表 / 代码块 / 段落；支持流式中"未闭合代码块"
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

      // ★ \[...\] 数学公式块 — 优先处理：块内时任何行（含 ``` 和 $$）都作为公式内容
      // 防止块内的围栏/$$ 行破坏状态。块内内容绕过 renderInline，仅 escapeHtml。
      // 整块放入一个 <div>，保证 \[ 和 \] 在同一文本节点内，renderMathInElement 能正确配对。
      if (inBracketMath) {
        const endIdx = line.indexOf('\\]');
        if (endIdx >= 0) {
          // \] 前的内容加入缓冲
          const before = line.slice(0, endIdx);
          if (before.trim()) bracketMathBuf.push(before);
          flushPara(); closeList();
          out.push('<div class="usa-math-block">\\[' + escapeHtml(bracketMathBuf.join('\n')) + '\\]</div>');
          bracketMathBuf = []; inBracketMath = false;
          // \] 后的内容如果有，作为新段落起点
          const after = line.slice(endIdx + 2);
          if (after.trim()) para.push(after);
        } else {
          bracketMathBuf.push(line);
        }
        continue;
      }

      // $$ 数学公式块（独占一行的 $$ 作为围栏，类似代码块）
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

      // 围栏代码块（``` 开头）。流式中若未闭合，末尾会兜底闭合
      if (/^```/.test(line)) {
        if (inCode) { // 闭合
          out.push('<pre class="usa-code"><code>' + escapeHtml(codeBuf.join('\n')) + '</code></pre>');
          codeBuf = []; inCode = false;
        } else { // 开启
          flushPara(); closeList(); inCode = true;
        }
        continue;
      }
      if (inCode) { codeBuf.push(line); continue; }

      // 检测 \[ 块开始：行中有 \[（代码跨度外）但同行无对应 \]
      // 正则 ^((?:[^`]|`[^`]*`)*?)\\\[ 排除反引号内的 \[，避免误识别代码示例
      const startMatch = line.match(/^((?:[^`]|`[^`]*`)*?)\\\[/);
      if (startMatch) {
        const afterBracket = line.slice(startMatch[0].length);
        // 同行 \[ 之后（代码跨度外）是否有 \]
        const endInRest = afterBracket.match(/^((?:[^`]|`[^`]*`)*?)\\\]/);
        if (!endInRest) {
          // 同行无 \] — 进入块模式
          const before = startMatch[1];
          if (before.trim()) para.push(before);
          flushPara(); closeList();
          inBracketMath = true;
          bracketMathBuf = [];
          if (afterBracket.trim()) bracketMathBuf.push(afterBracket);
          continue;
        }
        // 同行有完整 \[...\] — 走默认路径，由 renderInline 处理
      }

      // 空行：段落分隔
      if (/^\s*$/.test(line)) { closeList(); flushPara(); continue; }

      let m;
      // 标题 # ~ ######
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeList(); flushPara(); const n = m[1].length; out.push('<h' + n + '>' + renderInline(m[2]) + '</h' + n + '>'); continue; }
      // 引用 >
      if ((m = line.match(/^>\s?(.*)$/))) { closeList(); flushPara(); out.push('<blockquote>' + renderInline(m[1]) + '</blockquote>'); continue; }
      // 无序列表 - / *
      if ((m = line.match(/^[-*]\s+(.*)$/))) { flushPara(); if (!listOpen) { out.push('<ul>'); listOpen = true; } out.push('<li>' + renderInline(m[1]) + '</li>'); continue; }
      // 有序列表 1.
      if ((m = line.match(/^\d+\.\s+(.*)$/))) { flushPara(); if (!olOpen) { out.push('<ol>'); olOpen = true; } out.push('<li>' + renderInline(m[1]) + '</li>'); continue; }

      // 普通文本：缓冲进当前段落
      closeList();
      para.push(line);
    }

    // 收尾：未闭合的代码块/数学块直接闭合（流式场景）
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
    // 清理隐藏换行和多余空格：防止公式/表格选区在 .usa-selected 中竖排
    return sel.toString().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  // ---------- 4.5 上下文就近抓取 ----------
  // 从选区锚点向上遍历 DOM，找到合理的父级容器，取其 innerText，
  // 然后截取选区前后各 1000 字符作为 pageContext。
  // 任何异常都返回空串，绝不阻断发送流程。
  function getPageContext() {
    try {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return '';
      const anchor = sel.anchorNode;
      if (!anchor) return '';

      // 锚点通常是文本节点，取其父元素；元素节点则直接用
      const startEl = anchor.nodeType === Node.TEXT_NODE
        ? anchor.parentElement
        : (anchor.nodeType === Node.ELEMENT_NODE ? anchor : null);
      if (!startEl || typeof startEl.closest !== 'function') return '';

      // 向上寻找最近的合理容器（匹配聊天/AI/文章页常见结构）
      const container = startEl.closest(
        'article, [data-message], .message, .markdown-body, .prose, [role="article"], main, div'
      );
      if (!container) return '';

      const fullText = container.innerText || container.textContent || '';
      if (!fullText) return '';

      // 在全文中定位选中文本，截取前后各 1000 字符
      const selText = sel.toString();
      const RADIUS = 1000;
      let start, end;
      const idx = fullText.indexOf(selText);
      if (idx >= 0) {
        start = Math.max(0, idx - RADIUS);
        end = Math.min(fullText.length, idx + selText.length + RADIUS);
      } else {
        // 定位失败时取容器开头 2000 字符作为降级
        start = 0;
        end = Math.min(fullText.length, RADIUS * 2);
      }

      let snippet = fullText.slice(start, end);
      // 压缩过多空白，减少 Token 消耗
      snippet = snippet.replace(/[\r\n]{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
      return snippet;
    } catch (e) {
      return ''; // 任何异常都不阻断发送流程
    }
  }

  // 选区是否位于悬浮窗内部（Shadow DOM 的选区会被 retarget 到 host）
  function selectionInsideHost() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node = sel.anchorNode;
    if (!node) return false;
    if (node === host) return true;
    try { if (shadow.contains(node)) return true; } catch (_) { /* ignore */ }
    while (node) { if (node === host) return true; node = node.parentNode; }
    return false;
  }

  // 把元素定位到选区附近（右下方，越界则回缩）
  function positionNearSelection(el) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;
    const margin = 8;

    // 元素可能处于 display:none，此时 offsetWidth/Height 为 0；
    // 临时以 visibility:hidden 渲染量取真实尺寸，量完恢复原态，避免视觉闪烁。
    const prevDisplay = el.style.display;
    const prevVisibility = el.style.visibility;
    el.style.visibility = 'hidden';
    el.style.display = (el === dialog) ? 'flex' : 'inline-flex';
    const ew = el.offsetWidth || 80;
    const eh = el.offsetHeight || 32;
    el.style.display = prevDisplay;
    el.style.visibility = prevVisibility;

    let x = rect.right;
    let y = rect.bottom + margin;
    if (x + ew > window.innerWidth - margin) x = window.innerWidth - ew - margin;
    if (x < margin) x = margin;
    if (y + eh > window.innerHeight - margin) y = Math.max(margin, rect.top - eh - margin);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  function showButton() { btn.style.display = 'inline-flex'; }
  function hideButton() { btn.style.display = 'none'; }

  // ---------- 5. 对话框生命周期：构建 / 销毁 ----------
  function buildDialog() {
    closeDialog(); // 先清理可能残留的旧对话框
    const wrap = document.createElement('div');
    wrap.innerHTML = dialogTpl;
    const dlg = wrap.firstElementChild;
    shadow.appendChild(dlg);
    dialog = dlg;
    selectedArea = dlg.querySelector('.usa-selected');
    chatArea = dlg.querySelector('.usa-chat');
    input = dlg.querySelector('.usa-input');
    sendBtn = dlg.querySelector('.usa-send');
    closeBtn = dlg.querySelector('.usa-close');
    newChatBtn = dlg.querySelector('.usa-newchat');
    const dragbar = dlg.querySelector('.usa-dragbar');

    // × 按钮：阻止 mousedown 抢焦点，点击即销毁
    closeBtn.addEventListener('mousedown', (e) => e.preventDefault());
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeDialog(); });
    // ⟳ 新对话按钮：清空聊天记录，保持窗口打开
    newChatBtn.addEventListener('mousedown', (e) => e.preventDefault());
    newChatBtn.addEventListener('click', (e) => { e.stopPropagation(); newChat(); });
    // 拖拽条：按下记录偏移，交给文档级 mousemove 处理（点 × / ⟳ 不触发拖拽）
    dragbar.addEventListener('mousedown', (e) => {
      if (e.target === closeBtn || e.target === newChatBtn || !dialog) return;
      const rect = dialog.getBoundingClientRect();
      dragState = { offX: e.clientX - rect.left, offY: e.clientY - rect.top };
      e.preventDefault(); // 防止拖动时选中文本
    });
    // 发送
    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  }

  // 销毁对话框：移除 DOM + 中断流式（置空 requestId 让过期回包被忽略）+ 清状态
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
    selectedArea = chatArea = input = sendBtn = closeBtn = newChatBtn = null;
    hideButton();
  }

  function openDialog() {
    buildDialog();
    chatHistory = [];
    currentAIBubble = null;
    pendingUserQuestion = '';
    selectedArea.textContent = currentText;
    positionNearSelection(dialog);
    dialog.style.display = 'flex';
    setTimeout(() => { if (input) input.focus(); }, 0);
  }

  // ★ 新对话：清空聊天记录，保持窗口打开
  function newChat() {
    chatHistory = [];
    currentAIBubble = null;
    pendingUserQuestion = '';
    currentRequestId = null; // 忽略正在进行的流式回包
    answerRaw = '';
    renderPending = false;
    clearWatchdog();
    if (chatArea) chatArea.innerHTML = '';
    if (input) { input.value = ''; input.focus(); }
    if (sendBtn) sendBtn.disabled = false;
  }

  // rAF 节流渲染：一帧内多次 chunk 只渲染一次（渲染到当前 AI 气泡）
  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      if (!currentAIBubble) return; // 气泡已不存在（新对话/关闭）
      currentAIBubble.innerHTML = renderMarkdown(answerRaw);
      renderMath(); // ★ 渲染数学公式
      if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
    });
  }

  // 看门狗：发送后 20 秒内若没有任何回包，给出排查提示，避免永远停在"思考中…"
  function startWatchdog() {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      if (!dialog || !currentAIBubble) return;
      if (!currentAIBubble.classList.contains('usa-loading')) return; // 已收到回包则不介入
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

  // ---------- 6. 划词监听 ----------
  document.addEventListener('mouseup', (e) => {
    if (dead) return;
    if (host.contains(e.target)) return;
    if (selectionInsideHost()) return;
    const text = getSelectionText();
    if (text.length === 0) { hideButton(); return; }
    currentText = text;
    currentPageContext = getPageContext();
    positionNearSelection(btn);
    showButton();
  });

  document.addEventListener('selectionchange', () => {
    if (dead) return;
    if (getSelectionText().length === 0) hideButton();
  });

  // ---------- 7. 关闭逻辑：仅 × 按钮 / Esc（点击网页不再自动关闭，避免误触丢失窗口） ----------
  document.addEventListener('mousedown', (e) => {
    if (dead) return;
    if (host.contains(e.target)) return;   // 点在 UI 内：忽略
    if (getSelectionText().length === 0) hideButton(); // 仅隐藏划词小按钮，不动对话框
  }, true);

  document.addEventListener('keydown', (e) => {
    if (dead) return;
    if (e.key === 'Escape' && dialog) closeDialog();
  }, true);

  // ---------- 7.5 拖拽：文档级 mousemove / mouseup ----------
  document.addEventListener('mousemove', (e) => {
    if (dead || !dragState || !dialog) return;
    let x = e.clientX - dragState.offX;
    let y = e.clientY - dragState.offY;
    const rect = dialog.getBoundingClientRect();
    const margin = 4; // 至少留 4px 可见，防止拖出屏幕
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    if (x + rect.width > window.innerWidth - margin) x = window.innerWidth - rect.width - margin;
    if (y + rect.height > window.innerHeight - margin) y = window.innerHeight - rect.height - margin;
    dialog.style.left = x + 'px';
    dialog.style.top = y + 'px';
  });
  document.addEventListener('mouseup', () => { if (!dead) dragState = null; });
  // 鼠标移出窗口时终止拖拽，避免松手在窗口外导致状态卡住
  window.addEventListener('blur', () => { if (!dead) dragState = null; });

  // ---------- 8. 展开对话框 ----------
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // 避免破坏已有选区
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    hideButton();
    openDialog();
  });

  // ---------- 9. 接收后台流式回包（实时渲染到当前 AI 气泡） ----------
  chrome.runtime.onMessage.addListener((msg) => {
    if (dead) return;
    // 对话框已销毁或回包不属于当前请求：忽略
    if (!dialog || !msg || msg.requestId !== currentRequestId) return;
    clearWatchdog(); // 收到任意回包即取消看门狗

    if (msg.type === 'AI_CHUNK') {
      // 首个 chunk 到达：清掉"思考中…"占位
      if (currentAIBubble && currentAIBubble.classList.contains('usa-loading')) {
        currentAIBubble.classList.remove('usa-loading');
        currentAIBubble.textContent = '';
        answerRaw = '';
      }
      answerRaw += msg.chunk;
      scheduleRender(); // 节流渲染，打字机效果
    } else if (msg.type === 'AI_DONE') {
      if (sendBtn) sendBtn.disabled = false;
      renderPending = false; // 取消未决的 rAF，立即做最终渲染
      if (!currentAIBubble) return;
      if (!answerRaw) { currentAIBubble.textContent = '（回答为空）'; }
      else { currentAIBubble.innerHTML = renderMarkdown(answerRaw); renderMath(); }
      // ★ 提交本轮对话到历史（AI_DONE 才提交，失败轮次不入历史）
      chatHistory.push({ role: 'user', content: pendingUserQuestion });
      chatHistory.push({ role: 'assistant', content: answerRaw });
      currentAIBubble = null;
      if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
    } else if (msg.type === 'AI_ERROR') {
      if (sendBtn) sendBtn.disabled = false;
      if (!currentAIBubble) return;
      currentAIBubble.classList.remove('usa-loading');
      currentAIBubble.textContent = '出错了：' + (msg.error || '未知错误'); // 错误用纯文本，不渲染
      currentAIBubble = null;
    }
  });

  // ---------- 10. 发送：创建气泡 + 打包历史 + 交给 background.js ----------
  function send() {
    if (dead || !dialog) return;
    const userQuestion = input.value.trim();
    if (!userQuestion) { input.focus(); return; }
    input.value = ''; // 清空输入框

    // ★ 创建用户气泡（纯 textContent，防 XSS）
    const userBubble = document.createElement('div');
    userBubble.className = 'usa-msg-user';
    userBubble.textContent = userQuestion;
    chatArea.appendChild(userBubble);

    // ★ 创建 AI 气泡（loading 状态）
    const aiBubble = document.createElement('div');
    aiBubble.className = 'usa-msg-ai usa-loading';
    aiBubble.textContent = '思考中…';
    chatArea.appendChild(aiBubble);
    currentAIBubble = aiBubble;

    pendingUserQuestion = userQuestion;

    // 滚动到底部
    chatArea.scrollTop = chatArea.scrollHeight;

    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    currentRequestId = requestId;
    answerRaw = '';

    sendBtn.disabled = true;

    // 扩展重载后旧标签页上下文失效，sendMessage 会同步抛异常，用 try/catch 兜底
    try {
      chrome.runtime.sendMessage(
        // ★ 携带 chatHistory，让后台构建多轮 messages 数组
        { type: 'ASK_AI', selectedText: currentText, userQuestion: userQuestion, pageContext: currentPageContext, chatHistory: chatHistory, requestId },
        () => {
          // 这里只是请求受理回执；真正的回答通过 AI_CHUNK/AI_DONE/AI_ERROR 流式到达
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
    startWatchdog(); // 20 秒无回包则提示排查
  }
})();
