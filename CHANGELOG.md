# Changelog / 更新日志

All notable changes to this project will be documented in this file.

## [1.2.9] - 2026-07-10

### Fixed / 修复
- **小窗顶部「选中内容」公式无法正确显示（开源兼容性）** — 上一版仅对"保留了源码标注"的公式（KaTeX 默认 `output: htmlAndMathml`、MathJax v2）能正确重绘；但大量网站用 **KaTeX `output: "html"`（无 MathML 标注）** 或 **MathJax v3（排版后移除 source `<script>`）** 渲染公式，此时 `extractMathSource()` 提取不到干净 TeX，选区退化成原始可视文本（`e2`/`x2`），小窗顶部只会显示松散字符而非公式。
  - 新增 `findSelectedMathElement()`：划词时若选区整体落在同一个公式渲染元素（`.katex` / `.MathJax` / `mjx-container`）内，直接捕获该**真实渲染节点**；`openDialog()` 改为**原样克隆**该节点进展示区，不再依赖"提取源码→KaTeX 重绘"这一可能失败的中间环节——任何渲染器/配置都能正确显示公式。
  - 克隆 `mjx-container` 时自动调用 `ensureMathJaxCss()`，把页面里的 MathJax 样式表拷进扩展 Shadow DOM，保证 MathJax 公式布局正确（幂等，仅执行一次）。
  - `closestMathContainer()` 改为显式祖先遍历并按类名 token 精确匹配 `katex`（避免误命中 `katex-html`/`katex-mathml` 内部 span），同时可靠识别 `mjx-container` 自定义元素。
  - 展示区 CSS 增加 `.usa-selected .katex-display` 规则，解除 `-webkit-box` 行截断对块级公式的裁剪。
  - 验证：新增 `test_full_pipeline_render.js`，在 jsdom + 真实 KaTeX 下走完整"划词→打开小窗"链路，覆盖 ① KaTeX 默认（含 annotation）② KaTeX html-only（无 annotation）③ MathJax v3（`mjx-container` 无 source script）三种场景，均正确渲染出公式元素。原有 4 套测试（嵌套上下文/提示词/精确定位/公式选词）共 73 项断言全绿，无回归。

## [1.2.8] - 2026-07-10

### Changed / 改进
- **公式选词兼容层升级（开源兼容性）** — 原 `extractKatexSource()` 仅支持 KaTeX，现重构为统一的 `extractMathSource()`，通过新增 `closestMathContainer()` / `extractTexFromMathContainer()` 同时兼容 **KaTeX、MathJax v2、MathJax v3** 三种渲染器：KaTeX 取 `<annotation encoding="application/x-tex">` 的 TeX；MathJax 取 `<script type="math/tex">` / `type="math/tex; mode=display"` 源码（并兼容 asciimath 原样返回）。无论宿主网页用哪种库渲染公式，划选都能得到干净源码（如 `$e^2$`、`$\frac{a}{b}$`），小窗内正确渲染、且原样传给 AI。`captureSelectionInfo()` 的 `rootLabel` 也会据渲染器区分「KaTeX 公式」/「MathJax 公式」。

## [1.2.7] - 2026-07-10

### Fixed / 修复
- **公式选词显示错乱（e² → "e 2"）** — 选中由 KaTeX 渲染的公式时，浏览器原生 `selection.toString()` 会把 MathML 标注文本与可视 span 混在一起，产生多余空格/重复字符。新增 `extractKatexSource()`：当选区整体落在同一 `.katex` 元素内时，直接取 `<annotation encoding="application/x-tex">` 的干净 TeX 源码（如 `$e^2$`）。小窗「选中文字」区改用 `renderMathOnly()` 渲染并交给 KaTeX 重绘，使 `e²` 正确显示为公式。
- **精确定位在公式上错乱** — `captureSelectionInfo()` 对公式选词短路处理：直接用干净 TeX 作为 `⟦⟧` 局部片段、偏移量置空，避免 `root.textContent` 中 MathML/可视重复文本导致的标记与偏移错乱。
- **货币被误当公式渲染** — 行内 `$...$` 增加 `looksLikeCurrency()` 守卫（如 `$5`/`$10.50` 不再被 KaTeX 渲染）；同时移除 `renderMathInElement` 的单 `$` 分隔符，仅保留 `\( \)`、`$$`、`\[ \]`。有效数学公式仍由 Markdown 渲染器转换为 `\( \)` 后正常渲染。

## [1.2.6] - 2026-07-10

### Added / 新增
- **选词精确定位（解决重复/相似文本无法区分的问题）** — 当用户在原文中划选文字（如公式中多处"平方"）时，后台此前只能拿到裸的 `selectedText`，AI 无法判断选中了哪一个实例。现新增 `selectionContext`：
  - `content.js` 在 `mouseup` 时通过 `Range` 计算选区在其根容器 `textContent` 中的**绝对字符偏移**（`absStart`/`absEnd`），并取选区前后各约 80 字的小窗口，用 `⟦ ⟧` 把**所选的那一段**精确框定（`localFragment`），同时记录根容器标签（`rootLabel`，如 `div#formula`）。
  - 该信息随 `ASK_AI` 载荷一并传给 `background.js`，后者将其拼为新的 `【用户划选位置（精确锁定，⟦ ⟧ 内为所选确切实例）】` 区块（含 `⟦⟧` 标记片段与字符偏移说明），置于 `【全局背景资料】` 之后、`【用户划选的局部片段】` 之前。
  - 默认提示词（`SYSTEM_PROMPT` / `options.js` 的 `DEFAULT_SYSTEM_PROMPT`）同步增加指引：「当用户划选的文字在资料中出现多处时，请以【用户划选位置】中用 ⟦ ⟧ 标出的确切实例为准」。
  - 效果：即使原文存在多处相同文字，`⟦文字⟧` 也只在用户**真正选中**的那一处出现，且前后上下文 + 字符偏移共同锁定唯一实例；传输量仅多一个 ~160 字片段 + 两个整数，效率高。无 `selectionContext` 时（旧行为/普通选词）不出现该区块，完全兼容。

### Changed / 变更
- `background.js` 的 `contextBlock` 组装增加可选的精确定位区块；默认提示词文案更新（与 `options.js` 保持一致，单一事实源）。

## [1.2.5] - 2026-07-10

### Added / 新增
- **System Prompt 结构可视化（锁定自动块）** — 在设置页 System Prompt 卡片内新增「最终发给 AI 的提示词结构」面板，向用户展示三段拼接顺序：
  - ① 你的提示词（＝上方可编辑文本框）
  - ② 【全局背景资料】：（系统自动填入网页上下文）
  - ③ 【用户划选的局部片段】：（系统自动填入划选文字）
  - ② 与 ③ 两行的括号文字以 `.ps-locked` 静态元素呈现，**不可编辑**（非 textarea/input，且无 `contenteditable`），用户只能改 ①，无需也不能手写系统标签。后台 `contextBlock` 的追加逻辑不变。
  - 验证：test_system_prompt.js 场景7 新增断言——结构面板含两个锁定标签、两个标签元素均非 contenteditable、保存内容不含 ②/③ 序号标记（不会被当作用户输入）。共 23 项断言全绿。

## [1.2.4] - 2026-07-10

### Added / 新增
- **System Prompt 可视化编辑** — 此前后台默认提示词（`SYSTEM_PROMPT`，写死在 `background.js`）对用户完全不可见，设置框的 System Prompt 默认空着，用户只能"盲配"。
  - 现在设置页的 System Prompt 文本框会**预填系统默认提示词**，用户可在其基础上增、删、改；也可清空后自写。新增「恢复默认提示词」按钮一键还原。
  - 后台据此区分两种情况：`storage` 中**从未设置**（`undefined`）→ 仍用内置 `SYSTEM_PROMPT`；**已设置（含空串）** → 严格按用户所写，空串表示不要基础提示词（仍会自动附上网页上下文与选中片段）。
  - 一致性：`options.js` 的 `DEFAULT_SYSTEM_PROMPT` 与 `background.js` 的 `SYSTEM_PROMPT` 为同一字符串（单一事实源），由测试断言保证不漂移。
  - 验证：新增 `test_system_prompt.js`，真实加载 `options.js`（jsdom）与 `background.js`（vm + 模拟 chrome/fetch），覆盖「未设置/已设置/已清空/恢复默认/保存」与后台「未设置/空/自定义/默认文本」四种场景，共 19 项断言全部通过。

## [1.2.3] - 2026-07-10

### Fixed / 修复
- **窗口三在真实浏览器中仍无上下文（深层根因修复）** — 1.2.2 仅在 jsdom 中通过，真机里窗口三依旧拿不到上下文。
  - 根因：来源窗口判定与上下文获取**过度依赖 `window.getSelection()` 在 Shadow DOM 内的选区状态**。真实 Chrome 中点击「解释」按钮时选区会被折叠、且 Shadow 内选区探测不稳定，导致 `findSourceDialog` 返回 `null`、连带 `getPageContext` 也为空，窗口三彻底丢失上下文。此外监听器挂在 `document` 上，按 Shadow 事件重定向规则 `e.target` 会被重定向到 shadow host（而非内部对话框），此前基于 `e.target` 的思路本身也不成立。
  - 修复：新增 `resolveSourceDialog(e)`，主路径改用 **`e.composedPath()`**（保留原始节点、不受重定向影响）沿真实 DOM 路径向上找最近的 `.usa-dialog`，完全不依赖选区状态；并在 `mouseup` 时直接以来源窗口的聊天区内容作为上下文（嵌套选词最可靠来源），仅网页选词才走原 `getPageContext` 语义容器逻辑。`findSourceDialog`（基于 getSelection）降级为兜底。
  - 验证：测试改为在对话框元素上 `composed:true` 派发 `mouseup`，真正覆盖 `composedPath` 修复路径；三级嵌套 + 重叠文本回归全部通过。

## [1.2.2] - 2026-07-10

### Fixed / 修复
- **多级嵌套跳层（窗口三错误继承窗口一）** — 1.2.1 修正了「窗口二继承窗口一」，但三级嵌套时窗口三仍会错误跳回窗口一。
  - 根因：`findSourceDialog()` 文本兜底（策略二）按 `activeDialogs` 正序遍历，当所选词同时出现在多层窗口对话中时，会命中**最旧**的窗口一而非**直接父窗口**窗口二。
  - 修复：策略一改为沿选区 DOM 祖先向上找最近的 `.usa-dialog`（天然命中直接父窗口，不跳过中间层）；策略二改为**逆序**（从最新窗口向前找），确保重叠文本时命中最近的父窗口。
  - 验证：测试新增三级嵌套（窗口一→窗口二→窗口三）及「重叠文本 + 强制策略一失效」回归用例，断言窗口三继承直接父窗口（窗口二）独有内容，全部通过。

## [1.2.1] - 2026-07-10

### Fixed / 修复
- **嵌套选词上下文透传失效** — 在窗口一 AI 回答内划词打开窗口二时，窗口二无法获取窗口一的选词内容及上下文。现修复：
  - 模块级新增 `currentSourceDialog`，仅在存在真实选区时更新来源窗口引用，空选区（如点击按钮时的折叠 `mouseup`）不再误清空，确保来源窗口引用跨点击存活；
  - 新增 `findSourceDialog()`（ShadowRoot 命中 + 文本匹配兜底双策略）可靠定位来源窗口；
  - 新增 `buildNestedContext()` 将来源窗口的页面上下文、原始选词、完整对话打包为子窗口的背景资料，保证窗口二基于完整信息作答。

## [1.2.0] - 2026-07-09

### Added / 新增
- **小米 MiMo 厂商** — 新增 Xiaomi MiMo API 支持，默认模型 `mimo-v2.5-pro`
- **多 Key 独立存储** — 每个厂商的 API Key 各自保存到 `apiKeys[provider]`，切换无需重填
- **多模型独立存储** — 每个厂商的自定义模型名各自保存到 `models[provider]`，不再互相覆盖
- **网页内厂商切换** — 对话框标题栏新增厂商下拉框，随时切换当前窗口使用的模型
- **弹窗快速切换** — 插件弹窗新增"切换厂商"下拉框，一键切换全局默认模型
- **一键默认模型** — 对话框 ★ 按钮，点击将当前厂商设为新建窗口的默认模型
- **自定义回复风格** — 设置页新增 `System Prompt` 输入框，自定义 AI 角色和回复指令
- **旧数据自动迁移** — 单 Key/Model 格式自动迁移到多厂商存储格式，用户无感

### Changed / 改进
- 设置页切换厂商时自动加载该厂商已保存的 Key 和模型名
- 设置页 Key 输入框旁显示"已配置/未配置"状态标识

### Fixed / 修复
- `getPageContext()` 上下文抓取不再匹配全页面顶层的 `div` 容器，避免 AI 收到无关噪音
- 选区文本与容器文本空白符不匹配时不再返回垃圾上下文，改用精确匹配算法
- 嵌套提问时正确抓取所在对话框的聊天区内容作为上下文

## [1.1.0] - 2026-07-05

### Added / 新增
- **多窗口支持** — 同时最多打开 3 个独立对话框，各自维护独立的上下文和对话历史
- **窗口序号** — 拖拽条上显示 ① ② ③ 圆形序号标签，按 FIFO 排列
- **默认提示词** — 输入框留空时自动使用"详细解释划选部分的文字"发送
- **嵌套划词** — 在对话框聊天区内容上划选也可弹出解释按钮，实现多级追问
- **按钮侧方定位** — 解释按钮定位到选区右侧（垂直居中），避免被对话框遮挡
- **Shadow DOM 坐标后备** — 当选区坐标在 Shadow DOM 内失效时，自动用鼠标坐标定位

### Changed / 改进
- 流式回答期间窗口不再跟随滚动，用户可从回答开头阅读
- 对话框新建时自动偏移定位，避免完全重叠
- 超过 3 窗口上限时自动关闭最早的
- Esc 键关闭最早的窗口（FIFO）

### Fixed / 修复
- 按钮 z-index 调整确保不被对话框遮挡
- 对话框 z-index 显式设置

## [1.0.0] - 2026-06-27

### Added / 新增
- Text selection triggers an "🔍 Explain" button on any webpage.
- Floating dialog with Shadow DOM isolation (Notion AI style).
- Multi-turn conversation support with chat history.
- Streaming AI responses with typewriter effect.
- Built-in Markdown renderer (headings, lists, code blocks, blockquotes, links).
- KaTeX math formula rendering (inline and display).
- Page context awareness: sends surrounding text to the AI for better answers.
- Support for 5 LLM providers: DeepSeek, Qwen, GLM, Kimi, OpenRouter.
- Settings page (options.html) for configuring API Key, provider, and model.
- Toolbar popup showing configuration status.
- 90-second timeout with user-friendly error messages.
- 20-second watchdog for unresponsive streams.
- Extension context invalidation detection and self-cleanup.
- Draggable dialog window.
- CSP-hardened extension pages.

### Security / 安全
- API Key stored in `chrome.storage.local`, never hardcoded in source.
- XSS-safe Markdown rendering (all user/AI content is HTML-escaped).
- `content_security_policy` restricts script sources to `'self'`.
