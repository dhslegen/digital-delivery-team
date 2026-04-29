// H7: bin/build-relay-prompt.mjs 集成测试
//   M6.5 跨会话接力的核心生成器；
//   覆盖：13 段结构 / progress.json 注入 / tech-stack.json 注入 / 关键产物表 /
//   blockers 未解决检测 / --out 自定义路径 / --quiet 静默模式
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin/build-relay-prompt.mjs');

function run(cwd, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args],
    { cwd, encoding: 'utf8' });
}

function findRelay(dir) {
  const ddt = join(dir, '.ddt');
  if (!existsSync(ddt)) return null;
  const files = readdirSync(ddt).filter(f => f.startsWith('relay-') && f.endsWith('.md'));
  return files.length ? join(ddt, files[0]) : null;
}

test('H7.1 无背景文件时仍生成完整结构（exit 0 + 9 段）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-empty-'));
  try {
    const r = run(tmp);
    assert.equal(r.status, 0, '总是 exit 0（不阻塞 LLM）');

    const file = findRelay(tmp);
    assert.ok(file, '应写入 .ddt/relay-<ts>.md');
    const content = readFileSync(file, 'utf8');

    // 9 段必填 + 1 段项目背景（共 10 个 ## 段标题）
    const requiredSections = [
      '## 项目背景',
      '## 1. What We Are Building',
      '## 2. What WORKED',
      '## 3. What Did NOT Work',
      '## 4. What Has NOT Been Tried Yet',
      '## 5. Current State of Files',
      '## 6. Decisions Made',
      '## 7. Blockers & Open Questions',
      '## 8. Exact Next Step',
      '## 9. Environment & Setup Notes',
    ];
    for (const s of requiredSections) {
      assert.ok(content.includes(s), `relay prompt 缺段落：${s}`);
    }
    assert.ok(content.includes('# DDT Relay Prompt'), '应有顶部标题');
    assert.ok(content.includes('DDT Relay v1'), '应有 footer 版本标识');

    // 无 progress 时，"已完成 phase" 应显示"无"，currentPhase 应为 'unknown'
    assert.match(content, /\*\*当前 phase\*\*:\s*`unknown`/);
    assert.match(content, /\*\*已完成 phase\*\*:\s*（无）/);
    assert.match(content, /\*\*技术栈\*\*:\s*（未指定）/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.2 progress.json 注入：已完成 phase 列表 + current_phase', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-progress-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/project-id'), 'proj-h7-progress');
    writeFileSync(join(tmp, '.ddt/progress.json'), JSON.stringify({
      schema_version: 1,
      project_id: 'proj-h7-progress',
      current_phase: 'build-api',
      phases: {
        prd:         { status: 'completed' },
        wbs:         { status: 'completed' },
        design:      { status: 'completed' },
        'build-api': { status: 'in_progress' },
        'build-web': { status: 'pending' },
      },
    }));

    const r = run(tmp);
    assert.equal(r.status, 0);
    const content = readFileSync(findRelay(tmp), 'utf8');

    assert.match(content, /\*\*项目 ID\*\*:\s*`proj-h7-progress`/);
    assert.match(content, /\*\*当前 phase\*\*:\s*`build-api`/);
    assert.ok(content.includes('`prd`'), 'prd 应在已完成列表');
    assert.ok(content.includes('`wbs`'), 'wbs 应在已完成列表');
    assert.ok(content.includes('`design`'), 'design 应在已完成列表');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.3 tech-stack.json 注入：摘要含框架 + DB + UI + AI', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-stack-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/tech-stack.json'), JSON.stringify({
      preset: 'node-modern',
      backend:  { framework: 'NestJS', language: 'TypeScript', database: { primary: 'PostgreSQL' } },
      frontend: { framework: 'Next.js', bundler: 'Turbopack', ui: { css: 'Tailwind' } },
      ai_design: { type: 'v0' },
    }));

    const r = run(tmp);
    const content = readFileSync(findRelay(tmp), 'utf8');

    assert.ok(content.includes('NestJS'), '应含 backend.framework');
    assert.ok(content.includes('TypeScript'), '应含 language');
    assert.ok(content.includes('PostgreSQL'), '应含 database.primary');
    assert.ok(content.includes('Next.js'), '应含 frontend.framework');
    assert.ok(content.includes('Turbopack'), '应含 bundler');
    assert.ok(content.includes('Tailwind'), '应含 ui.css');
    assert.ok(content.includes('AI: v0'), '应含 ai_design.type');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.4 关键产物路径：仅列出真实存在的产物', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-artifacts-'));
  try {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/prd.md'), '# PRD\n');
    writeFileSync(join(tmp, 'docs/api-contract.yaml'), 'openapi: 3.0.3\n');
    // 不写 wbs.md / arch.md：用于验证表里不应出现

    const r = run(tmp);
    const content = readFileSync(findRelay(tmp), 'utf8');

    assert.ok(content.includes('| PRD | `docs/prd.md` |'),
      '存在的 prd.md 应在表里');
    assert.ok(content.includes('| API 契约 | `docs/api-contract.yaml` |'),
      '存在的 api-contract.yaml 应在表里');
    assert.ok(!content.includes('| WBS |'),
      '不存在的 wbs.md 不应出现在表里');
    assert.ok(!content.includes('| 架构 |'),
      '不存在的 arch.md 不应出现在表里');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.5 blockers.md 含未解决条目 → 自动检测提示', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-blockers-'));
  try {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/blockers.md'),
      `## B-001 缺少认证策略
- **resolved_at**: null

## B-002 数据库选型未确认
- **resolved_at**: null

## B-003 已解决的问题
- **resolved_at**: 2026-04-29T10:00:00Z
`);

    const r = run(tmp);
    const content = readFileSync(findRelay(tmp), 'utf8');

    assert.match(content, /自动检测：docs\/blockers\.md 中存在 2 条/,
      '应正确计数 2 条未解决（不含 resolved 那条）');
    assert.match(content, /resolved_at: null/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.6 --out 自定义输出路径', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-out-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    const customPath = join(tmp, '.ddt/custom-relay.md');
    const r = run(tmp, ['--out', customPath]);
    assert.equal(r.status, 0);
    assert.ok(existsSync(customPath), '应写到 --out 指定路径');
    assert.ok(readFileSync(customPath, 'utf8').includes('# DDT Relay Prompt'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H7.7 --quiet 只写文件，stdout 不含 prompt 主体', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h7-quiet-'));
  try {
    const r = run(tmp, ['--quiet']);
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('# DDT Relay Prompt'),
      '--quiet 模式 stdout 不应输出 prompt 主体');
    assert.ok(findRelay(tmp), '文件仍写入');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
