// W2: 3 通道附件包派生器端到端
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import {
  parseBriefMeta,
  renderTokensCss,
  VALID_CHANNELS,
  ANTI_PATTERNS_DETAILS,
} from '../../bin/derive-channel-package.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const COMPILE = join(ROOT, 'bin', 'compile-design-brief.mjs');
const DERIVE  = join(ROOT, 'bin', 'derive-channel-package.mjs');

const SAMPLE_PRD = `# PRD · Demo

## 1. 概述
做一个 Hello World demo。

## 4. 用户故事与验收标准

**用户故事**
As a 访客用户，I want 访问首页看到问候语，so that 确认应用已部署。

**用户故事**
As a 开发者，I want 执行 jar 包，so that 启动可预期。
`;

const SAMPLE_CONTRACT = `openapi: 3.0.3
info:
  title: Demo API
  version: 1.0.0
paths:
  /:
    get:
      summary: Home
      responses:
        '200':
          description: OK
  /api/health:
    get:
      summary: Health
      responses:
        '200':
          description: OK
`;

const SAMPLE_TECH_STACK = JSON.stringify({
  preset: 'java-modern',
  backend: { language: 'java', framework: 'spring-boot' },
  frontend: { type: 'spa', framework: 'react' },
}, null, 2);

function setupSandbox() {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-channel-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  mkdirSync(join(tmp, '.ddt'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'prd.md'), SAMPLE_PRD);
  writeFileSync(join(tmp, 'docs', 'api-contract.yaml'), SAMPLE_CONTRACT);
  writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), SAMPLE_TECH_STACK);
  writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-test-w2');
  // 跑一次 compile-design-brief 准备产物
  const r = spawnSync(process.execPath, [COMPILE], { cwd: tmp, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`compile failed: ${r.stderr}`);
  return tmp;
}

test('derive-channel-package: claude-design 通道生成 7 文件附件包 + prompt.md', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const upload = join(tmp, '.ddt', 'design', 'claude-design', 'upload-package');
    assert.ok(existsSync(upload));
    for (const f of ['01-design-brief.md', '02-prd.md', '03-api-contract.yaml', '04-tech-stack.json', '05-design-tokens.json', '06-components-inventory.md']) {
      assert.ok(existsSync(join(upload, f)), `必含 ${f}`);
    }
    assert.ok(existsSync(join(upload, '07-references')), '必含 07-references/ 目录');

    const prompt = readFileSync(join(tmp, '.ddt', 'design', 'claude-design', 'prompt.md'), 'utf8');
    assert.match(prompt, /Claude Design 项目设计任务/, 'prompt 含标题');
    assert.match(prompt, /java-modern/, 'PROJECT_NAME 注入');
    // 11 条 anti-patterns 全部注入（用 ❌ 计数）
    const negCount = (prompt.match(/^\d+\.\s*❌/gm) || []).length;
    assert.equal(negCount, 11, 'anti-patterns 必须 11 条逐字注入');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: figma 通道生成 7 文件 + TC-EBC prompt', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'figma'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const prompt = readFileSync(join(tmp, '.ddt', 'design', 'figma', 'prompt.md'), 'utf8');
    // TC-EBC 5 段都必须存在
    for (const heading of ['## Task', '## Context', '## Elements', '## Behavior', '## Constraints']) {
      assert.match(prompt, new RegExp(heading.replace(/\./g, '\\.')), `figma prompt 必含 ${heading}`);
    }
    assert.match(prompt, /java-modern/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: v0 通道生成 sources + project-instructions + 每屏 stub', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'v0'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const sources = join(tmp, '.ddt', 'design', 'v0', 'v0-sources');
    for (const f of ['openapi.yaml', 'design-brief.md', 'components-inventory.md', 'tokens.css']) {
      assert.ok(existsSync(join(sources, f)), `v0-sources 必含 ${f}`);
    }
    // tokens.css 是 CSS variables 格式
    const css = readFileSync(join(sources, 'tokens.css'), 'utf8');
    assert.match(css, /--color-primary:/, 'tokens.css 含 --color-* 变量');
    assert.match(css, /:root \{/, 'tokens.css 含 :root');

    const instructions = readFileSync(join(tmp, '.ddt', 'design', 'v0', 'project-instructions.md'), 'utf8');
    assert.match(instructions, /Stack \(locked\)/, '含 Stack locked');
    assert.match(instructions, /Anti-Patterns/, '含 Anti-Patterns 段');
    // 11 条英文 anti-patterns
    const enLines = (instructions.match(/^\d+\.\s+\w/gm) || []).length;
    assert.ok(enLines >= 11, `anti-patterns 英文 11 条必含（实际 ${enLines}）`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: --channel all 一次派生 3 通道', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'all'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    for (const c of VALID_CHANNELS) {
      assert.ok(existsSync(join(tmp, '.ddt', 'design', c)), `${c} 目录必存在`);
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: 已存在未传 --refresh 应 exit 3', () => {
  const tmp = setupSandbox();
  try {
    const r1 = spawnSync(process.execPath, [DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r1.status, 0);

    const r2 = spawnSync(process.execPath, [DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r2.status, 3, '已存在应 exit 3');
    assert.match(r2.stderr, /已存在.*--refresh/);

    const r3 = spawnSync(process.execPath, [DERIVE, '--channel', 'claude-design', '--refresh'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r3.status, 0, '--refresh 应通过');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: 缺 brief 应 exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-no-brief-'));
  try {
    mkdirSync(join(tmp, 'docs'));
    mkdirSync(join(tmp, '.ddt'));
    writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), SAMPLE_TECH_STACK);

    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'claude-design'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2, '缺 brief 应 exit 2');
    assert.match(r.stderr, /design-brief\.md/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: --channel <unknown> 应 exit 1', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'lovable'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 1, '已删除的 lovable 通道应 exit 1');
    assert.match(r.stderr, /未知 channel/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('derive-channel-package: --dry-run 不落盘', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [DERIVE, '--channel', 'all', '--dry-run'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.ok(!existsSync(join(tmp, '.ddt', 'design', 'claude-design', 'prompt.md')), 'dry-run 不应写文件');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('parseBriefMeta 单元：visual_direction / endpoints / IA tree 提取', () => {
  const sampleBrief = `# Design Brief · test

## 1. Problem Alignment
**用户**：测试用户
**痛点**：流程断裂

## 2. User Stories

| ID | 角色 | 我想 | 以便 | Given/When/Then |
|----|------|------|------|----------------|
| US-01 | A | B | C | ... |

## 3. Information Architecture

\`\`\`text
/                       首页
/login                  登录
\`\`\`

## 6. Data & API Contract

- \`GET /api/health\` → 见 api-contract.yaml#L5
- \`POST /api/auth/login\` → 见 api-contract.yaml#L10

## 8. Visual Direction

visual_direction:
  selected: industrial
  rationale: 内部物流监控

## 9. References

- \`.ddt/design/assets/ref-01-foo.png\`

**风格关键词**：minimal / dense
`;
  const meta = parseBriefMeta(sampleBrief);
  assert.equal(meta.visualDirection, 'industrial');
  assert.match(meta.visualRationale, /内部物流监控/);
  assert.equal(meta.persona, '测试用户');
  assert.equal(meta.painPoint, '流程断裂');
  assert.match(meta.iaTree, /\/login/);
  assert.deepEqual(meta.endpointsSummary, ['GET /api/health', 'POST /api/auth/login']);
  assert.deepEqual(meta.references, ['.ddt/design/assets/ref-01-foo.png']);
  assert.equal(meta.styleKeywords, 'minimal / dense');
});

test('renderTokensCss 单元：tokens.json 转标准 CSS variables + 暗色模式', () => {
  const tokens = {
    color: { primary: '#1F6FEB', danger: '#D73A49' },
    'color-dark': { primary: '#58A6FF' },
    spacing: [4, 8, 16],
    radius: { sm: '4px', md: '8px' },
    typography: { 'font-sans': 'Geist', scale: [12, 14, 16] },
  };
  const css = renderTokensCss(tokens);
  assert.match(css, /--color-primary: #1F6FEB;/);
  assert.match(css, /--color-danger: #D73A49;/);
  assert.match(css, /--spacing-0: 4px;/);
  assert.match(css, /--radius-sm: 4px;/);
  assert.match(css, /--text-1: 14px;/);
  assert.match(css, /--font-sans: Geist;/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.match(css, /--color-primary: #58A6FF;/);
});

test('ANTI_PATTERNS_DETAILS: 11 条含中英双语 + id', () => {
  assert.equal(ANTI_PATTERNS_DETAILS.length, 11);
  for (const p of ANTI_PATTERNS_DETAILS) {
    assert.ok(p.id, `anti-pattern 必含 id`);
    assert.ok(p.zh, `anti-pattern ${p.id} 必含中文描述`);
    assert.ok(p.en, `anti-pattern ${p.id} 必含英文描述`);
  }
});
