# Changelog / 更新日志

All notable changes to this project will be documented in this file.

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
