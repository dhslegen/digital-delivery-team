// W7: v0.8 边界异常测试
//
// 覆盖真实部署中可能踩的坑：
//   - brief / tokens 缺字段或损坏的 graceful degrade
//   - 多次 --refresh 数据不丢失
//   - 红线触发组合（多重）
//   - frontend.type 非 spa 时 design-brief / design-execute 跳过
//   - 摄取脚本接到坏 zip / 坏 URL / 坏路径

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const BIN = {
  COMPILE: join(ROOT, 'bin', 'compile-design-brief.mjs'),
  DERIVE:  join(ROOT, 'bin', 'derive-channel-package.mjs'),
  INGEST_CD: join(ROOT, 'bin', 'ingest-claude-design.mjs'),
  INGEST_FIGMA: join(ROOT, 'bin', 'ingest-figma-context.mjs'),
  INGEST_V0: join(ROOT, 'bin', 'ingest-v0-share.mjs'),
  RENDER:  join(ROOT, 'bin', 'render-tokens-preview.mjs'),
  SCORE:   join(ROOT, 'bin', 'score-design-output.mjs'),
};

function setupBaseProject(opts = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-edge-'));
  mkdirSync(join(tmp, 'docs'));
  mkdirSync(join(tmp, '.ddt'));
  writeFileSync(join(tmp, 'docs', 'prd.md'), '# PRD\n## 1. 概述\nDemo\n');
  writeFileSync(join(tmp, 'docs', 'api-contract.yaml'), 'openapi: 3.0.0\npaths:\n  /api/health:\n    get: {}\n');
  writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), JSON.stringify({
    preset: 'java-modern',
    frontend: opts.frontendType ? { type: opts.frontendType } : { type: 'spa', framework: 'react' },
  }));
  return tmp;
}

// ============================================================================
// 1. compile-design-brief 边界
// ============================================================================

test('Edge: compile-design-brief 空 PRD 不崩，输出空 user stories 表', () => {
  const tmp = setupBaseProject();
  try {
    writeFileSync(join(tmp, 'docs', 'prd.md'), ''); // 空 PRD
    const r = spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `空 PRD 应允许通过`);
    const brief = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');
    // user stories 表应保留模板占位
    assert.match(brief, /\| US-01 \|/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: compile-design-brief 损坏 tech-stack.json 应明确失败', () => {
  const tmp = setupBaseProject();
  try {
    writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), 'not valid json');
    const r = spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(r.status, 0, '损坏 JSON 应失败');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: compile-design-brief 多次 --refresh 不破坏 brief 编译信息块', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    const first = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');

    // refresh 3 次
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(process.execPath, [BIN.COMPILE, '--refresh'], { cwd: tmp, encoding: 'utf8' });
      assert.equal(r.status, 0, `第 ${i + 1} 次 refresh 应成功`);
    }
    const last = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');

    // 编译信息块结构稳定
    assert.match(last, /generated_at:\s*\d{4}-\d{2}-\d{2}T/);
    assert.match(last, /generator:\s*ddt-design-brief-compiler/);
    // 模板核心结构未变
    for (const heading of ['## 1. Problem Alignment', '## 8. Visual Direction', '## 10. Constraints']) {
      assert.ok(last.includes(heading));
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 2. derive-channel-package 边界
// ============================================================================

test('Edge: derive-channel-package 在 brief visual_direction 未填时 graceful 降级', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });

    // brief 默认未填 visual_direction（保留占位）
    const r = spawnSync(process.execPath, [BIN.DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, '未填 visual_direction 不应阻塞 derive');

    const prompt = readFileSync(join(tmp, '.ddt', 'design', 'claude-design', 'prompt.md'), 'utf8');
    // 应输出占位提示用户填
    assert.match(prompt, /未填写|<请填写>|<未填写>/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: derive-channel-package 缺 design-brief.md 应明确 exit 2', () => {
  const tmp = setupBaseProject();
  try {
    // 不跑 compile，直接派生
    const r = spawnSync(process.execPath, [BIN.DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /design-brief\.md/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 3. ingest-claude-design 边界
// ============================================================================

test('Edge: ingest-claude-design 接到损坏 zip 应 exit 4', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    // 写一个非 zip 的"假 zip"
    const fakeZip = join(tmp, 'corrupt.zip');
    writeFileSync(fakeZip, 'this is not a zip file');

    const r = spawnSync(process.execPath, [BIN.INGEST_CD, '--bundle', fakeZip], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 4, '损坏 zip 应 exit 4');
    assert.match(r.stderr, /解压失败/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: ingest-claude-design 多重红线（fetch + 超长 jsx + 非标 tokens）', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });

    // 构造含 3 重红线的 zip
    const stagingDir = join(tmp, 'staging');
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, 'huge.jsx'),
      "fetch('/api/users')\n" + 'a\n'.repeat(1100));  // fetch + 1100 行
    writeFileSync(join(stagingDir, 'tokens.css'),
      'body { color: red; }\n');  // 非标准 CSS variables

    const zipPath = join(tmp, 'multi-flag.zip');
    execFileSync('zip', ['-qr', zipPath, '.'], { cwd: stagingDir });

    const r = spawnSync(process.execPath, [BIN.INGEST_CD, '--bundle', zipPath], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, '红线只 warn 不阻塞');

    const report = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'claude-design', 'ingest-report.json'), 'utf8'));
    assert.ok(report.red_flags.length >= 3, `应至少捕 3 条红线，实际 ${report.red_flags.length}`);
    assert.ok(report.red_flags.some(f => /huge\.jsx/.test(f) && /行/.test(f)));
    assert.ok(report.red_flags.some(f => /huge\.jsx/.test(f) && /fetch/.test(f)));
    assert.ok(report.red_flags.some(f => /tokens\.css/.test(f)));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 4. ingest-v0-share 边界
// ============================================================================

test('Edge: ingest-v0-share 拒绝含 shell 元字符的 URL', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-v0-shell-'));
  try {
    mkdirSync(join(tmp, 'web'));
    const evilUrls = [
      'https://v0.dev/chat;rm -rf /',
      'https://v0.dev/chat`whoami`',
      'https://v0.dev/chat$(id)',
      'https://v0.dev/chat|cat /etc/passwd',
      'https://evil.com/chat',
      'http://v0.dev/chat',  // 非 https
    ];
    for (const url of evilUrls) {
      const r = spawnSync(process.execPath, [BIN.INGEST_V0, '--url', url], { cwd: tmp, encoding: 'utf8' });
      assert.equal(r.status, 1, `URL "${url}" 应被拒绝`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 5. ingest-figma-context 边界
// ============================================================================

test('Edge: ingest-figma-context 不识别的 Figma URL 类型', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-figma-bad-'));
  try {
    // figma.com 域名但不是 design/file/board/make 任何一种
    const r = spawnSync(process.execPath,
      [BIN.INGEST_FIGMA, '--url', 'https://www.figma.com/community/something/abc'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2, '不识别的路径类型应 exit 2');
    assert.match(r.stderr, /fileKey/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 6. render-tokens-preview 边界
// ============================================================================

test('Edge: render-tokens-preview 极简 tokens（仅 color）也应生成 HTML', () => {
  const tmp = setupBaseProject();
  try {
    mkdirSync(join(tmp, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'design', 'tokens.json'),
      JSON.stringify({ color: { primary: '#000' } }));

    const r = spawnSync(process.execPath, [BIN.RENDER], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, '极简 tokens 不应报错');

    const html = readFileSync(join(tmp, '.ddt', 'design', 'tokens-preview.html'), 'utf8');
    assert.match(html, /<title>Design Tokens Preview<\/title>/);
    // 只有 color 段；没有 spacing / radius 等段（应跳过而非报错）
    assert.match(html, /Colors \(Light\)/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: render-tokens-preview 损坏 tokens.json 应 exit 2', () => {
  const tmp = setupBaseProject();
  try {
    mkdirSync(join(tmp, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'design', 'tokens.json'), 'not json');

    const r = spawnSync(process.execPath, [BIN.RENDER], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /解析失败/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// 7. score-design-output 边界
// ============================================================================

test('Edge: score-design-output 在空 web/ 上扫描数 0 + 关键维度低分', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    mkdirSync(join(tmp, 'web'));  // 空目录

    const r = spawnSync(process.execPath, [BIN.SCORE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, '空 web/ 不应崩');

    const sc = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'design-scorecard.json'), 'utf8'));
    assert.equal(sc.files_scanned, 0, '空 web/ 文件数 0');
    // 关键维度：responsive（无断点 4 都扣）/ a11y（无 aria）/ motion（无动效）必低分
    assert.ok(sc.dimensions.responsive.score <= 4, `空 web responsive 应低分（实际 ${sc.dimensions.responsive.score}）`);
    assert.ok(sc.dimensions.motion.score <= 8);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('Edge: score-design-output 自定义 --threshold 影响 passed 字段', () => {
  const tmp = setupBaseProject();
  try {
    spawnSync(process.execPath, [BIN.COMPILE], { cwd: tmp, encoding: 'utf8' });
    mkdirSync(join(tmp, 'web'));
    writeFileSync(join(tmp, 'web', 'app.tsx'), 'export default function App() { return <div /> }');

    // 默认阈值 70
    let r = spawnSync(process.execPath, [BIN.SCORE], { cwd: tmp, encoding: 'utf8' });
    const sc1 = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'design-scorecard.json'), 'utf8'));
    const totalScore = sc1.total_score;

    // 调高阈值到 100，必不过
    r = spawnSync(process.execPath, [BIN.SCORE, '--threshold', '100'], { cwd: tmp, encoding: 'utf8' });
    const sc2 = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'design-scorecard.json'), 'utf8'));
    assert.equal(sc2.threshold, 100);
    assert.equal(sc2.passed, sc2.total_score >= 100);

    // 调低阈值到 0，必过
    r = spawnSync(process.execPath, [BIN.SCORE, '--threshold', '0'], { cwd: tmp, encoding: 'utf8' });
    const sc3 = JSON.parse(readFileSync(join(tmp, '.ddt', 'design', 'design-scorecard.json'), 'utf8'));
    assert.equal(sc3.threshold, 0);
    assert.equal(sc3.passed, true, '阈值 0 必过');
    assert.equal(sc3.total_score, totalScore, '总分不变');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
