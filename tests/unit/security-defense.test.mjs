// W7.5 Block D：安全防御测试
//
// R5: ingest-figma-context.mjs::parseFigmaUrl 拒绝 nodeId 注入向量
// R6: render-tokens-preview.mjs CSS 注入防御 + spacing 数字校验 + CSP meta
// R10: ingest-claude-design.mjs zip slip 前置 + 后置 + 大文件 OOM 防御
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const { parseFigmaUrl } = await import(join(repoRoot, 'bin/ingest-figma-context.mjs'));
const { renderTokensHtml, isValidCssValue } = await import(join(repoRoot, 'bin/render-tokens-preview.mjs'));
const { findMaliciousZipEntries, verifyNoPathTraversal, detectRedFlags } =
  await import(join(repoRoot, 'bin/ingest-claude-design.mjs'));

// ─── R5: Figma URL nodeId 注入防御 ──────────────────────────

test('R5: parseFigmaUrl 接受合法 node-id', () => {
  const r = parseFigmaUrl('https://www.figma.com/design/ABC123/MyApp?node-id=12-34');
  assert.equal(r.valid, true);
  assert.equal(r.nodeId, '12:34');
});

test('R5: parseFigmaUrl 拒绝 node-id 编码后的注入向量 A%27%29%3B', () => {
  // %27%29%3B → ');  典型 SQL/shell 注入起点
  const r = parseFigmaUrl('https://www.figma.com/design/ABC123/MyApp?node-id=A%27%29%3B');
  assert.equal(r.valid, false, `应拒绝注入向量；实际接受为 ${r.nodeId}`);
  assert.match(r.reason || '', /非法字符/);
});

test('R5: parseFigmaUrl 拒绝 node-id 含 / 或 反引号', () => {
  const cases = [
    'https://www.figma.com/design/ABC123/x?node-id=foo%2Fbar',  // /
    'https://www.figma.com/design/ABC123/x?node-id=foo%60ls%60', // backtick
    'https://www.figma.com/design/ABC123/x?node-id=foo%24%28ls%29', // $(ls)
  ];
  for (const url of cases) {
    const r = parseFigmaUrl(url);
    assert.equal(r.valid, false, `URL ${url} 应被拒，实际接受`);
  }
});

test('R5: parseFigmaUrl 接受 node-id 含 _ 与 :', () => {
  // Figma node ID 可含 _ 与 :（branch ID 等）
  const r = parseFigmaUrl('https://www.figma.com/design/ABC123/x?node-id=foo_bar');
  assert.equal(r.valid, true);
});

// ─── R6: render-tokens-preview CSS 注入 + 数字校验 + CSP ──────────────────

test('R6: isValidCssValue 接受合法 CSS 值', () => {
  assert.equal(isValidCssValue('#aaa'), true);
  assert.equal(isValidCssValue('#aabbcc'), true);
  assert.equal(isValidCssValue('rgba(0, 0, 0, 0.5)'), true);
  assert.equal(isValidCssValue('hsl(120, 50%, 50%)'), true);
  assert.equal(isValidCssValue('12px'), true);
  assert.equal(isValidCssValue('1.5rem'), true);
  assert.equal(isValidCssValue('200ms'), true);
  assert.equal(isValidCssValue('none'), true);
  assert.equal(isValidCssValue('0 4px 12px rgba(0,0,0,0.1)'), true);
});

test('R6: isValidCssValue 拒绝 CSS 注入向量', () => {
  assert.equal(isValidCssValue('red; } body { display: none; /*'), false,
    '禁止 ; } 注入新选择器');
  assert.equal(isValidCssValue('url(http://evil.example/leak)'), false,
    '禁止 url() 加载外部资源');
  assert.equal(isValidCssValue('expression(alert(1))'), false,
    '禁止 IE expression()');
  assert.equal(isValidCssValue('javascript:alert(1)'), false,
    '禁止 javascript: 协议');
  assert.equal(isValidCssValue('@import url(http://evil/)'), false,
    '禁止 @import');
});

test('R6: isValidCssValue 拒绝过长字符串与空值', () => {
  assert.equal(isValidCssValue(''), false);
  assert.equal(isValidCssValue(null), false);
  assert.equal(isValidCssValue('a'.repeat(300)), false);
});

test('R6: renderTokensHtml spacing 含字符串注入时不破坏 CSS', () => {
  const tokens = {
    color: { primary: '#2C3F4C' },
    spacing: [4, 8, '12; } body { display: none; /*', 16],
  };
  const html = renderTokensHtml(tokens);
  // 注入字符串不应直接出现在 width inline style 里
  assert.doesNotMatch(html, /width:\s*12;\s*\}\s*body/);
  // 应显示"非法值"提示
  assert.match(html, /非法值/);
  // 合法的 4 / 8 / 16 仍然渲染
  assert.match(html, /width:\s*4px/);
  assert.match(html, /width:\s*16px/);
});

test('R6: renderTokensHtml color 含注入时降级为灰色 fallback', () => {
  const tokens = {
    color: {
      primary: '#2C3F4C',          // 合法
      evil:    'red; } body { display: none; /*',  // 注入
    },
  };
  const html = renderTokensHtml(tokens);
  // primary 仍渲染
  assert.match(html, /background-color:\s*#2C3F4C/);
  // evil 不应原样落 inline style
  assert.doesNotMatch(html, /background-color:\s*red;\s*\}/);
  // 应被替换为 fallback
  assert.match(html, /background-color:\s*#cccccc/);
});

test('R6: renderTokensHtml 输出含 CSP meta', () => {
  const html = renderTokensHtml({ color: { primary: '#fff' } });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /default-src\s+'none'/);
  assert.match(html, /style-src\s+'unsafe-inline'/);
  // CSP 必须禁 frame-ancestors（防点击劫持）
  assert.match(html, /frame-ancestors\s+'none'/);
});

test('R6: renderTokensHtml typography font-family 含 url() 时降级', () => {
  const tokens = {
    typography: {
      'font-sans': 'evil-font, url(http://evil/)',
    },
  };
  const html = renderTokensHtml(tokens);
  assert.doesNotMatch(html, /url\(http:/);
});

// ─── R10: ingest-claude-design zip slip + 大文件 OOM ────────────────────

test('R10: findMaliciousZipEntries 拒绝 .. 段', () => {
  const entries = ['legit.txt', '../etc/passwd', 'subdir/file.txt', 'a/../b/c'];
  const bad = findMaliciousZipEntries(entries);
  assert.equal(bad.length, 2);
  assert.ok(bad.includes('../etc/passwd'));
  assert.ok(bad.includes('a/../b/c'));
});

test('R10: findMaliciousZipEntries 拒绝绝对路径（POSIX 与 Windows）', () => {
  const entries = ['ok.txt', '/etc/passwd', 'C:\\Windows\\System32\\notepad.exe', 'D:/foo'];
  const bad = findMaliciousZipEntries(entries);
  assert.equal(bad.length, 3);
  assert.ok(bad.includes('/etc/passwd'));
  assert.ok(bad.some(e => e.startsWith('C:')));
  assert.ok(bad.includes('D:/foo'));
});

test('R10: findMaliciousZipEntries 拒绝 null byte', () => {
  const entries = ['ok.txt', 'evil\0name.txt'];
  const bad = findMaliciousZipEntries(entries);
  assert.equal(bad.length, 1);
});

test('R10: findMaliciousZipEntries 接受合法相对路径', () => {
  const entries = [
    'design.html',
    'tokens.css',
    'components/Button.tsx',
    'screenshots/01-home.png',
  ];
  assert.equal(findMaliciousZipEntries(entries).length, 0);
});

test('R10: verifyNoPathTraversal 检出符号链接逃逸', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r10-symlink-'));
  const staging = join(sandbox, 'staging');
  const outside = join(sandbox, 'outside');
  try {
    mkdirSync(staging);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'pwned');
    // 在 staging 内造一个指向 outside 的 symlink
    symlinkSync(join(outside, 'secret.txt'), join(staging, 'pwn-link'));

    const offenders = verifyNoPathTraversal(staging);
    assert.ok(offenders.length >= 1,
      `应检出 1 个 symlink 逃逸；实际 ${offenders.length}`);
    assert.ok(offenders.some(o => o.includes('secret.txt')));
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R10: verifyNoPathTraversal 合法 staging 内容应通过', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r10-ok-'));
  try {
    // mkdtempSync 已创建目录，直接用
    mkdirSync(join(sandbox, 'subdir'));
    writeFileSync(join(sandbox, 'a.txt'), 'a');
    writeFileSync(join(sandbox, 'subdir/b.txt'), 'b');
    assert.deepEqual(verifyNoPathTraversal(sandbox), []);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R10: detectRedFlags 跳过 > 5MB 文件并记 skipped flag（防 OOM）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r10-largefile-'));
  try {
    const huge = join(sandbox, 'huge.tsx');
    writeFileSync(huge, '// dummy\n');
    // 模拟 scan.jsx 项含 size 字段超阈值（不真生成 5MB 文件，避免测试慢）
    const scan = {
      jsx: [{ rel: 'huge.tsx', abs: huge, size: 6_000_000 }],
      css: [],
    };
    const flags = detectRedFlags(scan);
    assert.ok(flags.some(f => /huge\.tsx/.test(f) && /6000000|超.*阈值/.test(f)),
      `应记录大文件跳过 flag，实际：${JSON.stringify(flags)}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R10: detectRedFlags 正常处理 < 5MB jsx 文件（行数检测仍生效）', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r10-normalfile-'));
  try {
    const f = join(sandbox, 'big.tsx');
    // 1500 行代码（超 1000 但远小于 5MB）
    const lines = Array.from({ length: 1500 }, (_, i) => `const x${i} = ${i};`);
    writeFileSync(f, lines.join('\n'));
    const scan = {
      jsx: [{ rel: 'big.tsx', abs: f, size: lines.join('\n').length }],
      css: [],
    };
    const flags = detectRedFlags(scan);
    assert.ok(flags.some(f => /1500\s*行/.test(f)),
      `应触发"超 1000 行"红线，实际：${JSON.stringify(flags)}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
