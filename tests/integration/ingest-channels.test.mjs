// W4: 3 通道摄取脚本端到端
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { scanBundleContent, detectRedFlags } from '../../bin/ingest-claude-design.mjs';
import { isValidV0Url } from '../../bin/ingest-v0-share.mjs';
import { parseFigmaUrl } from '../../bin/ingest-figma-context.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const INGEST_CLAUDE = join(ROOT, 'bin', 'ingest-claude-design.mjs');
const INGEST_FIGMA  = join(ROOT, 'bin', 'ingest-figma-context.mjs');
const INGEST_V0     = join(ROOT, 'bin', 'ingest-v0-share.mjs');

// ============================================================================
// ingest-claude-design
// ============================================================================

function makeFakeBundle(tmp) {
  const projectDir = join(tmp, 'project');
  mkdirSync(join(projectDir, 'components'), { recursive: true });
  mkdirSync(join(projectDir, 'stylesheets'), { recursive: true });
  writeFileSync(join(projectDir, 'components', 'app.jsx'), 'export default function App() { return <div>Hi</div> }\n');
  writeFileSync(join(projectDir, 'components', 'page-home.jsx'), 'export default function Home() { return <div>Home</div> }\n');
  writeFileSync(join(projectDir, 'stylesheets', 'tokens.css'),
    ':root {\n  --color-primary: #1F6FEB;\n  --spacing-1: 4px;\n}\n');
  writeFileSync(join(projectDir, 'stylesheets', 'page-home.css'), '.home { padding: 16px; }\n');
  writeFileSync(join(projectDir, 'index.html'),
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>\n');
  writeFileSync(join(projectDir, 'spec.md'), '# Design Spec\nThis is a test bundle.\n');
  // 用系统 zip 打包（macOS / Linux 通常都有）
  const zipPath = join(tmp, 'test-bundle.zip');
  execFileSync('zip', ['-qr', zipPath, '.'], { cwd: projectDir });
  return zipPath;
}

test('ingest-claude-design: --bundle 解压 + 扫描 + 写 ingest-report.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-ingest-cd-'));
  try {
    const zipPath = makeFakeBundle(tmp);
    const r = spawnSync(process.execPath, [INGEST_CLAUDE, '--bundle', zipPath], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    const stagingDir = join(tmp, '.ddt', 'design', 'claude-design', 'raw');
    assert.ok(existsSync(stagingDir), 'staging 必存在');

    const report = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'claude-design', 'ingest-report.json'), 'utf8'));
    assert.equal(report.counts.jsx, 2, '应扫到 2 个 jsx');
    assert.equal(report.counts.css, 2, '应扫到 2 个 css');
    assert.equal(report.counts.html, 1);
    assert.equal(report.counts.md, 1);
    assert.match(report.files.tokens_css || '', /tokens\.css$/, '应识别 tokens.css');
    assert.match(report.files.spec_md || '', /spec\.md$/);
    assert.equal(report.unzip_tool && typeof report.unzip_tool, 'string');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('ingest-claude-design: --bundle 不存在 exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-ingest-no-bundle-'));
  try {
    const r = spawnSync(process.execPath, [INGEST_CLAUDE, '--bundle', join(tmp, 'nonexistent.zip')], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /bundle 文件不存在/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('ingest-claude-design: 已有 staging 未传 --refresh 应 exit 5', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-ingest-exists-'));
  try {
    const zipPath = makeFakeBundle(tmp);
    const r1 = spawnSync(process.execPath, [INGEST_CLAUDE, '--bundle', zipPath], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r1.status, 0);
    const r2 = spawnSync(process.execPath, [INGEST_CLAUDE, '--bundle', zipPath], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r2.status, 5);
    const r3 = spawnSync(process.execPath, [INGEST_CLAUDE, '--bundle', zipPath, '--refresh'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r3.status, 0, '--refresh 应通过');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('scanBundleContent 单元：递归扫描分类 6 类文件', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-scan-'));
  try {
    mkdirSync(join(tmp, 'sub'));
    writeFileSync(join(tmp, 'a.jsx'), '');
    writeFileSync(join(tmp, 'b.tsx'), '');
    writeFileSync(join(tmp, 'sub', 'c.css'), '');
    writeFileSync(join(tmp, 'sub', 'd.html'), '');
    writeFileSync(join(tmp, 'spec.md'), '');
    writeFileSync(join(tmp, 'logo.png'), '');
    writeFileSync(join(tmp, 'config.json'), '{}');
    writeFileSync(join(tmp, 'unknown.xyz'), '');

    const scan = scanBundleContent(tmp);
    assert.equal(scan.jsx.length, 2);
    assert.equal(scan.css.length, 1);
    assert.equal(scan.html.length, 1);
    assert.equal(scan.md.length, 1);
    assert.equal(scan.images.length, 1);
    assert.equal(scan.json.length, 1);
    assert.equal(scan.other.length, 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('detectRedFlags 单元：捕获 fetch/axios + 超长 jsx + 非标准 tokens.css', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-flags-'));
  try {
    // 1000+ 行 jsx
    const longJsx = join(tmp, 'huge.jsx');
    writeFileSync(longJsx, 'a\n'.repeat(1100));
    // 含 fetch
    const fetchJsx = join(tmp, 'bad.jsx');
    writeFileSync(fetchJsx, "fetch('/api/users').then(r => r.json())\n");
    // 不合规 tokens.css
    const badTokens = join(tmp, 'tokens.css');
    writeFileSync(badTokens, 'body { color: red; }\n');

    const scan = scanBundleContent(tmp);
    const flags = detectRedFlags(scan);
    assert.ok(flags.some(f => /huge\.jsx.*\d{4} 行/.test(f)), '应捕超 1000 行红线');
    assert.ok(flags.some(f => /bad\.jsx.*fetch\/axios/.test(f)), '应捕 fetch 红线');
    assert.ok(flags.some(f => /tokens\.css.*缺.*--xxx/i.test(f)), '应捕 tokens 不规范');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// ingest-v0-share
// ============================================================================

test('ingest-v0-share: URL 校验放行合法 v0 / vercel 域名', () => {
  assert.equal(isValidV0Url('https://v0.dev/chat/b/abc123'), true);
  assert.equal(isValidV0Url('https://v0.app/chat/b/xyz'), true);
  assert.equal(isValidV0Url('https://vercel.com/v0/chat/b/foo'), true);
  // 子域名也允许
  assert.equal(isValidV0Url('https://www.v0.dev/chat/b/abc'), true);
});

test('ingest-v0-share: URL 校验拒绝非法域名 / 非 https / shell 元字符', () => {
  assert.equal(isValidV0Url('http://v0.dev/chat'), false, '非 https');
  assert.equal(isValidV0Url('https://evil.com/chat'), false, '非白名单域名');
  assert.equal(isValidV0Url('https://v0.dev/chat;rm -rf /'), false, '含 shell 元字符');
  assert.equal(isValidV0Url('https://v0.dev/chat`whoami`'), false, '含反引号');
  assert.equal(isValidV0Url(''), false);
  assert.equal(isValidV0Url(null), false);
});

test('ingest-v0-share: --dry-run 在合法 URL 上输出预览', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-v0-'));
  try {
    mkdirSync(join(tmp, 'web'));
    const r = spawnSync(process.execPath, [INGEST_V0, '--url', 'https://v0.dev/chat/b/abc123', '--dry-run'], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /v0\.dev\/chat\/b\/abc123/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('ingest-v0-share: 非法 URL exit 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-v0-bad-'));
  try {
    const r = spawnSync(process.execPath, [INGEST_V0, '--url', 'https://evil.com/x'], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /URL 不合法/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// ingest-figma-context
// ============================================================================

test('parseFigmaUrl 单元：4 种 URL 类型 + nodeId 转换', () => {
  // design URL
  const a = parseFigmaUrl('https://www.figma.com/design/abc123/My-Project?node-id=1-2');
  assert.equal(a.valid, true);
  assert.equal(a.fileKey, 'abc123');
  assert.equal(a.nodeId, '1:2', '- 应转 :');
  assert.equal(a.kind, 'design');

  // file (legacy)
  const b = parseFigmaUrl('https://www.figma.com/file/xyz/Old');
  assert.equal(b.kind, 'file (legacy)');

  // FigJam board
  const c = parseFigmaUrl('https://www.figma.com/board/board123/Brainstorm');
  assert.equal(c.kind, 'board (FigJam)');

  // Make
  const d = parseFigmaUrl('https://www.figma.com/make/make123/Prototype');
  assert.equal(d.kind, 'make');

  // branch URL：fileKey 应替换为 branchKey
  const e = parseFigmaUrl('https://www.figma.com/design/main123/Project/branch/branch456/Main');
  assert.equal(e.fileKey, 'branch456', 'branch URL 用 branchKey 替代 fileKey');

  // 无 nodeId
  const f = parseFigmaUrl('https://www.figma.com/design/abc/Plain');
  assert.equal(f.nodeId, null);
});

test('parseFigmaUrl 单元：拒绝非 figma 域名 / shell 元字符', () => {
  assert.equal(parseFigmaUrl('https://evil.com/design/abc').valid, false);
  assert.equal(parseFigmaUrl('https://figma.com/design/abc;rm -rf').valid, false);
  assert.equal(parseFigmaUrl('http://figma.com/design/abc').valid, false, '非 https');
  assert.equal(parseFigmaUrl('').valid, false);
});

test('ingest-figma-context: 合法 URL 写 ingest-instructions.md', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-figma-'));
  try {
    const r = spawnSync(process.execPath, [INGEST_FIGMA, '--url', 'https://www.figma.com/design/abc123/Demo?node-id=1-2'], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    const instructionsPath = join(tmp, '.ddt', 'design', 'figma', 'ingest-instructions.md');
    assert.ok(existsSync(instructionsPath));
    const text = readFileSync(instructionsPath, 'utf8');
    assert.match(text, /fileKey.*abc123/);
    assert.match(text, /nodeId.*1:2/);
    assert.match(text, /mcp__figma__get_design_context/);
    // 历史记录
    const historyPath = join(tmp, '.ddt', 'design', 'figma', 'ingest-history.jsonl');
    assert.ok(existsSync(historyPath));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('ingest-figma-context: 非 figma 域名 exit 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-figma-bad-'));
  try {
    const r = spawnSync(process.execPath, [INGEST_FIGMA, '--url', 'https://evil.com/x'], {
      cwd: tmp, encoding: 'utf8',
    });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /figma\.com/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
