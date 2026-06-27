# Changelog / 更新日志

All notable changes to this project will be documented in this file.

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
