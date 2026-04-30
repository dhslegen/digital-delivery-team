// W6: design-brief-agent + render-tokens-preview + score-design-output
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { renderTokensHtml } from '../../bin/render-tokens-preview.mjs';
import {
  scoreColors, scoreTypography, scoreSpacing, scoreResponsive,
  scoreDarkMode, scoreMotion, scoreA11y, scoreDensity, scorePolish,
} from '../../bin/score-design-output.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const RENDER = join(ROOT, 'bin', 'render-tokens-preview.mjs');
const SCORE  = join(ROOT, 'bin', 'score-design-output.mjs');
const AGENT  = join(ROOT, 'agents', 'design-brief-agent.md');

const SAMPLE_TOKENS = {
  color: { primary: '#1F6FEB', danger: '#D73A49', 'neutral-50': '#F6F8FA', 'neutral-500': '#6E7781', 'neutral-900': '#1F2328' },
  'color-dark': { primary: '#58A6FF' },
  spacing: [4, 8, 12, 16, 24, 32, 48, 64],
  radius:  { sm: '4px', md: '8px', lg: '16px' },
  typography: {
    'font-sans':  'Geist Sans, sans-serif',
    'font-mono':  'Geist Mono, monospace',
    'font-serif': 'Source Serif Pro, serif',
    scale: [12, 14, 16, 20, 24, 32, 48],
  },
  shadow: { sm: '0 1px 2px rgba(0,0,0,0.05)' },
  motion: { duration: { fast: '150ms', base: '200ms', slow: '300ms' } },
};

// ============================================================================
// design-brief-agent
// ============================================================================

test('design-brief-agent.md 含必备 frontmatter + tools + model', () => {
  assert.ok(existsSync(AGENT));
  const text = readFileSync(AGENT, 'utf8');
  assert.match(text, /^name:\s*design-brief-agent$/m);
  assert.match(text, /^tools:.*Read.*Write.*Edit/m);
  assert.match(text, /^model:\s*sonnet$/m);
});

test('design-brief-agent 含字段范围 / Self-Check / Hard Requirements', () => {
  const text = readFileSync(AGENT, 'utf8');
  // 字段范围严格
  assert.match(text, /字段范围严格/);
  // Visual Direction 9 选 1
  for (const vd of ['brutally-minimal', 'industrial', 'editorial', 'maximalist']) {
    assert.ok(text.includes(vd), `agent 必含 visual direction ${vd}`);
  }
  // 不重写编译器填的字段
  assert.match(text, /禁止覆盖|禁止.*重写|保持编译器原样/);
  // Self-Check 9 项
  assert.match(text, /## Self-Check/);
  assert.match(text, /Problem Alignment.*齐全/);
});

// ============================================================================
// render-tokens-preview
// ============================================================================

test('renderTokensHtml 单元：含 Colors / Spacing / Radius / Typography / Shadow / Motion 6 段', () => {
  const html = renderTokensHtml(SAMPLE_TOKENS);
  assert.match(html, /<h2>Colors \(Light\)<\/h2>/);
  assert.match(html, /<h2>Colors \(Dark\)<\/h2>/, '有 color-dark 段时必含 Dark 标题');
  assert.match(html, /<h2>Spacing<\/h2>/);
  assert.match(html, /<h2>Radius<\/h2>/);
  assert.match(html, /<h2>Typography<\/h2>/);
  assert.match(html, /<h2>Shadows<\/h2>/);
  assert.match(html, /<h2>Motion<\/h2>/);
});

test('renderTokensHtml 单元：每个 token 都生成可视化样张', () => {
  const html = renderTokensHtml(SAMPLE_TOKENS);
  // 5 个颜色 × 2（light + dark - 但 dark 只有 primary）= 6 个色卡
  assert.equal((html.match(/class="swatch"/g) || []).length, 6);
  // 8 档 spacing
  assert.equal((html.match(/--spacing-\d+/g) || []).length, 8);
  // 3 档 radius
  assert.equal((html.match(/class="radius-sample"/g) || []).length, 3);
  // 7 档 type-scale
  assert.equal((html.match(/--text-\d+/g) || []).length, 7);
});

test('renderTokensHtml 单元：HTML 转义防 XSS（< > 字符）', () => {
  const evilTokens = {
    color: { 'pri<script>': '#000', mary: '<img onerror=alert(1)>' },
  };
  const html = renderTokensHtml(evilTokens);
  // 原始 < > 字符必须被转义为 entity（防止 token 名/值含 < script > 注入新标签）
  assert.ok(!html.includes('<script>'), '<script> 标签必须被转义为 entity');
  assert.ok(!html.includes('<img onerror'), '<img 必须被转义为 entity');
  assert.ok(html.includes('&lt;script&gt;') || html.includes('&lt;img'),
    '必须含转义后的 entity');
  // 注：在 quoted attribute (style="...") 中 = 无需特殊处理；< > 已转义即安全
});

test('render-tokens-preview --dry-run 输出预览', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-preview-'));
  try {
    mkdirSync(join(tmp, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'design', 'tokens.json'), JSON.stringify(SAMPLE_TOKENS));

    const r = spawnSync(process.execPath, [RENDER, '--dry-run'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.match(r.stdout, /tokens-preview\.html/);
    // dry-run 不应写文件
    assert.ok(!existsSync(join(tmp, '.ddt', 'design', 'tokens-preview.html')));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('render-tokens-preview 无 tokens.json 应 exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-preview-no-'));
  try {
    const r = spawnSync(process.execPath, [RENDER], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /tokens 文件不存在/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// ============================================================================
// score-design-output
// ============================================================================

test('scoreColors 单元：缺 primary / inline hex 扣分', () => {
  const noPrimary = scoreColors({ color: { danger: '#f00' } }, []);
  assert.ok(noPrimary.score < 10, '缺 primary 应扣分');
  assert.ok(noPrimary.issues.some(i => /缺 primary/.test(i)));

  const inlineHex = scoreColors({ color: { primary: '#1F6FEB', danger: '#D73A49', 'neutral-50': '#fff', 'neutral-500': '#777', 'neutral-900': '#000' } }, [
    { path: 'a.tsx', content: 'style={{color: "#FF0000", background: "#00FF00"}}' },
  ]);
  assert.ok(inlineHex.score < 10);
  assert.ok(inlineHex.issues.some(i => /inline hex/.test(i)));
});

test('scoreTypography 单元：Inter / Arial 扣分；通用 sans-serif 扣分', () => {
  const interFont = scoreTypography({ typography: { 'font-sans': 'Inter, sans-serif', 'font-mono': 'Geist Mono', scale: [12,14,16,20] } }, []);
  assert.ok(interFont.score < 10);
  assert.ok(interFont.issues.some(i => /font-sans.*inter/i.test(i)));

  const inFile = scoreTypography({ typography: { 'font-sans': 'Geist Sans', 'font-mono': 'Geist Mono', scale: [12,14,16,20] } }, [
    { path: 'a.tsx', content: 'style={{fontFamily: "Inter, sans-serif"}}' },
  ]);
  assert.ok(inFile.score < 10, '直接使用 Inter 应扣分');
});

test('scoreResponsive 单元：缺 lg/xl 断点扣分', () => {
  const onlySm = scoreResponsive([
    { path: 'a.tsx', content: '<div className="sm:p-4 md:p-6">' },
  ]);
  assert.ok(onlySm.score < 10);
  assert.ok(onlySm.issues.some(i => /lg/.test(i)));
  assert.ok(onlySm.issues.some(i => /xl/.test(i)));
});

test('scoreDarkMode 单元：tokens 无 color-dark 扣 4 分', () => {
  const noDark = scoreDarkMode({ color: {} }, []);
  assert.equal(noDark.score, 6, '无 color-dark 段应 -4');
});

test('scoreA11y 单元：<img> 缺 alt 扣分', () => {
  const noAlt = scoreA11y([
    { path: 'a.tsx', content: '<img src="x.png" /> <img src="y.png" />' },
  ]);
  assert.ok(noAlt.score < 10);
  assert.ok(noAlt.issues.some(i => /缺 alt/.test(i)));
});

test('scoreDensity 单元：visual_direction 与实际密度不匹配扣分', () => {
  // industrial 期望 high density，实际是 low（avg padding > 24）
  const lowDense = scoreDensity(
    'visual_direction:\n  selected: industrial\n  rationale: ...',
    [
      { path: 'a.tsx', content: 'p-12 m-12 gap-12 p-12 m-12 gap-12' },  // padding 48px
    ],
  );
  assert.ok(lowDense.score < 10);
  assert.equal(lowDense.direction, 'industrial');
  assert.equal(lowDense.expectedDensity, 'high');
});

test('scoreDensity 单元：brief 缺 visual_direction 扣 5 分', () => {
  const noVd = scoreDensity('# Brief\n No direction here', []);
  assert.equal(noVd.score, 5);
});

test('scorePolish 单元：紫蓝渐变命中扣 1 分', () => {
  const purpleHit = scorePolish([
    { path: 'a.tsx', content: '<div className="bg-gradient-to-r from-purple-500 to-blue-500">' },
  ]);
  assert.equal(purpleHit.score, 9, '命中 1 条 anti-pattern 扣 1 分');
  assert.ok(purpleHit.tripped.includes('purple-gradient-default'));
});

test('score-design-output 端到端：无 brief 应 exit 3', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-score-no-brief-'));
  try {
    mkdirSync(join(tmp, 'web'));
    const r = spawnSync(process.execPath, [SCORE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 3);
    assert.match(r.stderr, /design-brief\.md/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('score-design-output 端到端：完整跑 + 写 design-scorecard.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-score-full-'));
  try {
    mkdirSync(join(tmp, 'docs'));
    mkdirSync(join(tmp, 'web'));
    mkdirSync(join(tmp, '.ddt', 'design'), { recursive: true });

    writeFileSync(join(tmp, 'docs', 'design-brief.md'),
      '# Brief\n## 8.1\nvisual_direction:\n  selected: industrial\n  rationale: monitoring system\n');
    writeFileSync(join(tmp, '.ddt', 'design', 'tokens.json'), JSON.stringify(SAMPLE_TOKENS));
    writeFileSync(join(tmp, '.ddt', 'design', 'components-inventory.md'),
      '# Inventory\n| Button | web/components/ui/button.tsx | ✅ |\n');
    writeFileSync(join(tmp, 'web', 'app.tsx'),
      'export default function App() { return <div className="sm:p-4 md:p-4 lg:p-4 xl:p-4 dark:bg-gray-900"><img src="x.png" alt="x" /></div> }');

    const r = spawnSync(process.execPath, [SCORE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const scorecardPath = join(tmp, '.ddt', 'design', 'design-scorecard.json');
    assert.ok(existsSync(scorecardPath));
    const sc = JSON.parse(readFileSync(scorecardPath, 'utf8'));
    assert.equal(typeof sc.total_score, 'number');
    assert.ok(sc.total_score >= 0 && sc.total_score <= 100);
    assert.ok(typeof sc.passed === 'boolean');
    assert.ok(sc.dimensions.colors);
    assert.ok(sc.dimensions.density);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('score-design-output --json 输出到 stdout', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-score-json-'));
  try {
    mkdirSync(join(tmp, 'docs'));
    mkdirSync(join(tmp, 'web'));
    writeFileSync(join(tmp, 'docs', 'design-brief.md'), '# Brief');

    const r = spawnSync(process.execPath, [SCORE, '--json'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.ok(typeof parsed.total_score === 'number');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
