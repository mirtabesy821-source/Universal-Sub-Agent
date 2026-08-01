// ============================================================
// Universal Sub-Agent - 打包脚本 (npm run build)
// 生成 Chrome Web Store / GitHub Releases 使用的扩展 zip。
// 只打包运行时必需文件 + 文档，排除 tests / node_modules / .git 等。
// 输出到 dist/universal-sub-agent-v<version>.zip（dist/ 已被 gitignore）
// ============================================================
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const version = manifest.version;
const outDir = path.join(ROOT, 'dist');
const outFile = path.join(outDir, `universal-sub-agent-v${version}.zip`);

// 与 Chrome Web Store 提交要求保持一致：清单、代码、资源与文档
const includeEntries = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js',
  'privacy.html',
  'shared',
  'icons',
  'katex',
  'vendor',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md'
];

fs.mkdirSync(outDir, { recursive: true });

const output = fs.createWriteStream(outFile);
const archive = archiver('zip', { zlib: { level: 9 } });

output.on('close', () => {
  const sizeKb = (archive.pointer() / 1024).toFixed(1);
  console.log(`[build] 打包完成: ${path.relative(ROOT, outFile)} (${sizeKb} KB)`);
});
archive.on('warning', (err) => { if (err.code !== 'ENOENT') throw err; });
archive.on('error', (err) => { throw err; });

archive.pipe(output);

for (const entry of includeEntries) {
  const abs = path.join(ROOT, entry);
  if (!fs.existsSync(abs)) {
    console.warn(`[build] 跳过不存在的文件: ${entry}`);
    continue;
  }
  if (fs.statSync(abs).isDirectory()) {
    archive.directory(abs, entry);
  } else {
    archive.file(abs, { name: entry });
  }
}

archive.finalize();
