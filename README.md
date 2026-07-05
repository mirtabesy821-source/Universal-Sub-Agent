<div align="center">

# 🔍 Universal Sub-Agent

**在任何网页上划选文字，即可获得 AI 局部解答**

Select text on any webpage to get AI-powered explanations in a floating dialog.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-34A853)](https://developer.chrome.com/docs/extensions/mv3/intro/)

</div>

---

## ✨ 功能特性 / Features

- **划词即问** — 在任意网页选中文本，选区旁自动弹出"🔍 解释"按钮
- **悬浮对话窗** — Notion AI 风格的毛玻璃浮窗，Shadow DOM 完全隔离，不影响页面
- **多窗口支持** — 同时最多打开 3 个独立对话框，各自维护独立上下文（含序号标识）
- **多轮对话** — 针对选中文本连续提问，AI 保持上下文连贯
- **嵌套划词** — 在对话框聊天区内容上再次划选，可弹出新窗口进行多级追问
- **留空发送** — 无需输入，直接点击发送即用默认提示词"详细解释划选部分的文字"
- **流式渲染** — 打字机效果实时显示 AI 回复，窗口停在开头方便阅读
- **Markdown 排版** — 标题、列表、代码块、引用、链接等完整支持
- **LaTeX 数学公式** — 集成 KaTeX，支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]` 语法
- **页面上下文感知** — 自动抓取选区周围的文字作为背景资料发给 AI
- **多厂商支持** — DeepSeek、通义千问、智谱GLM、Kimi、OpenRouter，一键切换
- **安全可靠** — API Key 存储在本地 chrome.storage，CSP 加固，XSS 防护

---

## 📸 截图 / Screenshots

> 截图将在正式发布后补充 / Screenshots will be added after official release.

---

## 🚀 安装 / Installation

### 方式一：开发者模式加载（推荐）/ From Source (Recommended)

1. 下载本项目代码：

   ```bash
   git clone https://github.com/mirtabesy821-source/Universal-Sub-Agent.git
   ```

2. 打开 Chrome，地址栏输入 `chrome://extensions`
3. 打开右上角"开发者模式" / Enable "Developer mode"
4. 点击"加载已解压的扩展程序" / Click "Load unpacked"
5. 选择项目根目录（包含 `manifest.json` 的文件夹）

### 方式二：Chrome 应用商店 / From Chrome Web Store

> 即将上线 / Coming soon.

---

## ⚙️ 配置 / Configuration

安装后需要配置 API Key 才能使用：

1. 点击 Chrome 工具栏中的扩展图标 🔆
2. 点击"⚙ 打开设置"
3. 选择你的 LLM 厂商
4. 填入对应的 API Key
5. （可选）填写自定义模型名称
6. 点击"保存设置"

### 支持的厂商 / Supported Providers

| 厂商 / Provider | 默认模型 / Default Model | 获取 API Key / Get API Key |
|---|---|---|
| DeepSeek | `deepseek-chat` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| 通义千问 (Qwen) | `qwen-turbo` | [bailian.console.aliyun.com](https://bailian.console.aliyun.com/#/api-key) |
| 智谱 GLM | `glm-4-flash` (免费) | [open.bigmodel.cn](https://open.bigmodel.cn/manage/apikey) |
| Kimi (Moonshot) | `moonshot-v1-8k` | [platform.moonshot.cn](https://platform.moonshot.cn/console/api-keys) |
| OpenRouter | `meta-llama/llama-3-8b-instruct` | [openrouter.ai/keys](https://openrouter.ai/keys) |

所有厂商均兼容 OpenAI 协议，切换厂商只需在设置页更改选择并更换对应的 Key。

---

## 📖 使用方法 / Usage

1. 打开任意网页
2. 用鼠标划选一段文字
3. 选区旁会弹出"🔍 解释"按钮，点击它
4. 可直接点击"发送"使用默认提示词，或在输入框中输入你的问题后按 Enter 发送
5. AI 会结合选中文本和页面上下文进行解答
6. 可以继续输入问题进行多轮对话
7. 在回答文字上再次划选可弹出新窗口进行多级追问（最多 3 个窗口）
8. 点击 ⟳ 开始新对话，点击 × 或按 Esc 关闭最早窗口
9. 可以拖拽对话框顶部移动窗口位置

---

## 🔒 隐私 / Privacy

- API Key 仅存储在本地 `chrome.storage.local`，不会上传到任何第三方服务器
- 页面内容仅在用户主动提问时发送给所选的 LLM 厂商
- 扩展不收集、不存储、不传输任何用户个人数据
- 详见 [SECURITY.md](SECURITY.md)

---

## 🛠️ 开发 / Development

### 项目结构 / Project Structure

```
universal-sub-agent/
├── manifest.json       # 扩展清单 (MV3)
├── background.js       # Service Worker: 流式 API 调用
├── content.js          # Content Script: UI + Markdown/KaTeX 渲染
├── popup.html          # 工具栏弹窗
├── popup.js            # 弹窗逻辑
├── options.html        # 设置页
├── options.js          # 设置页逻辑
├── icons/              # 扩展图标 (16/48/128px)
└── katex/              # KaTeX 数学渲染库 (vendored)
    ├── katex.min.js
    ├── katex.min.css
    ├── contrib/
    │   └── auto-render.min.js
    └── fonts/
        └── *.woff2
```

### 本地开发 / Local Development

1. Fork & clone the repo
2. Load as unpacked extension in Chrome
3. Make changes to `background.js` / `content.js` / `popup.js` / `options.js`
4. Click the reload icon on `chrome://extensions` to apply changes
5. For `content.js` changes: reload the target webpage too

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📄 许可证 / License

[MIT License](LICENSE) © 2026 Universal Sub-Agent Contributors

---

## 🙏 鸣谢 / Acknowledgments

- [KaTeX](https://github.com/KaTeX/KaTeX) — Fast math typesetting for the web (MIT)
- All the LLM providers for their API services
