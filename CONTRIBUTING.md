# Contributing to Universal Sub-Agent / 贡献指南

Thanks for your interest in contributing! / 感谢你有兴趣参与贡献！

## How to Contribute / 如何贡献

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes and test them in Chrome.
4. Commit with a clear message.
5. Submit a Pull Request.

## Development Setup / 开发环境

1. Clone the repo.
2. Open `chrome://extensions` in Chrome.
3. Enable "Developer mode" (top right).
4. Click "Load unpacked" and select the project folder.
5. Make changes, then click the reload icon on the extension card to test.

## Code Style / 代码风格

- Use `const`/`let`, never `var` (except in options.js/popup.js for MV3 compatibility).
- Add JSDoc comments for public functions.
- Keep Chinese inline comments for domain logic.
- Test on at least 2 websites before submitting.

## Reporting Issues / 报告问题

Use [GitHub Issues](../../issues). Include:
- Chrome version
- Steps to reproduce
- Expected vs actual behavior
- Console logs from both the page and the service worker

## License / 许可证

By contributing, you agree that your contributions will be licensed under the MIT License.
