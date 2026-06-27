# Security Policy / 安全策略

## Reporting a Vulnerability / 报告漏洞

If you discover a security vulnerability, please **do not** open a public issue.

Please use [GitHub's private vulnerability reporting](../../security/advisories/new) or send a private message via GitHub.

We will respond within 48 hours and credit responsible reporters in the fix.

## API Key Safety / API Key 安全

- Your API Key is stored only in `chrome.storage.local` on your machine.
- It is **never** sent to any server other than the LLM provider you selected.
- It is **never** included in the source code or git history.
- To rotate your key: change it on the provider's dashboard, then update it in the extension settings.

## Permissions Explained / 权限说明

| Permission | Why it's needed |
|---|---|
| `activeTab` | Access the current tab to inject the selection UI |
| `scripting` | Inject content scripts for text selection and dialog |
| `storage` | Store your API Key and preferences locally |
| `<all_urls>` | Work on any webpage you browse |

The extension does **not** collect, store, or transmit any personal data. Page content is sent directly to your chosen LLM provider only when you ask a question.
