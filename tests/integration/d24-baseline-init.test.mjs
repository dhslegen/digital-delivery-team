// v0.9.7 D24：ddt-baseline-sync 标准化 / 稳定 / 高可用 / 可重入
//
// 实战暴露：v0.9.6 用户跑 skill 时遇到两个 bug
//   1. 项目类型决策门写了 5 options（B2B/SaaS/API/Mobile/其他），AskUserQuestion 工具上限 4
//   2. ensureBaseline 从插件根复制 historical-projects.csv（含 8 行教学示例 HIST-001~HIST-008），
//      把"插件示例"当用户初始数据 → 用户首次跑 skill 就被污染（HIST-009 是真数据，前 8 行是脏数据）
//
// 本测试用例守门：
//   - 用户项目从空表头起步（assets/historical-projects.template.csv 仅 1 行 = header）
//   - --with-examples 才复制 examples/historical-projects.example.csv（教学示例，9 行）
//   - 同名项目重入触发 skip（exit 4），保证幂等
//   - --on-duplicate overwrite/append 行为正确
//   - SKILL.md options ≤4 静态校验（防止决策门超限回归）
//   - bin/baseline.mjs 容忍仅表头 hist（用户首次 /report 时不被中断）
//   - commands/wbs.md / report.md 的 cp 路径已切到 skill assets template

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SKILL_ROOT = join(ROOT, 'skills', 'ddt-baseline-sync');
const SCRIPT = join(SKILL_ROOT, 'scripts', 'append-historical.mjs');
const TEMPLATE = join(SKILL_ROOT, 'assets', 'historical-projects.template.csv');
const EXAMPLE = join(SKILL_ROOT, 'examples', 'historical-projects.example.csv');
const SKILL_MD = join(SKILL_ROOT, 'SKILL.md');
const EXAMPLE_MD = join(SKILL_ROOT, 'examples', 'from-staffing-xlsx.md');
const BASELINE_MJS = join(ROOT, 'bin', 'baseline.mjs');

const STAFFING_FIXTURE = {
  project_name: '无人物流车运营系统',
  team_size: 7,
  total_person_months: 5.0,
  total_hours: 880,
  complexity: '复杂',
  time_window: '2026-01-04 ~ 2026-03-15',
  phase_hours: {
    prd_hours: 169, wbs_hours: 70, design_hours: 201,
    frontend_hours: 211, backend_hours: 141,
    test_hours: 62, review_hours: 26, docs_hours: 0,
  },
};

function runAppend(cwd, staffing, extraArgs = []) {
  const r = spawnSync(
    process.execPath,
    [SCRIPT, '--json', '-', '--type', 'B2B-后台', ...extraArgs],
    { cwd, input: JSON.stringify(staffing), encoding: 'utf8' }
  );
  const out = r.stdout || '';
  const idx = out.indexOf('--- RESULT ---');
  const json = idx >= 0 ? JSON.parse(out.slice(idx + '--- RESULT ---'.length).split('\n\n')[0]) : null;
  return { exitCode: r.status, json, stdout: out, stderr: r.stderr || '' };
}

function makeTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'ddt-d24-'));
  return dir;
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

test('D24: assets/historical-projects.template.csv 仅含表头一行', () => {
  const text = readFileSync(TEMPLATE, 'utf8');
  const lines = text.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 1, `template 应只有表头，实际 ${lines.length} 行`);
  assert.match(lines[0], /^project_id,name,type,total_hours/, 'template 表头列序应稳定');
});

test('D24: examples/historical-projects.example.csv 含 8 行示例数据', () => {
  const text = readFileSync(EXAMPLE, 'utf8');
  const lines = text.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 9, `example 应 1 行表头 + 8 行示例，实际 ${lines.length} 行`);
  assert.ok(lines.some(l => l.startsWith('HIST-001,')), 'example 应含 HIST-001');
  assert.ok(lines.some(l => l.startsWith('HIST-008,')), 'example 应含 HIST-008');
});

test('D24: 默认初始化用 template（仅表头），不复制示例', () => {
  const dir = makeTmpProject();
  try {
    const { exitCode, json } = runAppend(dir, STAFFING_FIXTURE);
    assert.equal(exitCode, 0, `应成功追加，stderr 见日志`);
    assert.equal(json.status, 'appended');
    assert.equal(json.project_id, 'HIST-001', '空 baseline 第一条应为 HIST-001（不应叠在 HIST-008 后变 HIST-009）');
    assert.equal(json.initialized, true);

    const csv = readFileSync(json.target, 'utf8');
    const lines = csv.trim().split('\n').filter(Boolean);
    assert.equal(lines.length, 2, `初始化后应只有 1 表头 + 1 用户行，实际 ${lines.length}`);
    assert.match(lines[1], /^HIST-001,无人物流车运营系统,/);
    assert.ok(!csv.includes('HIST-008'), 'baseline 不应含示例 HIST-008（不污染）');
  } finally { cleanup(dir); }
});

test('D24: --with-examples 显式 opt-in 时才复制示例', () => {
  const dir = makeTmpProject();
  try {
    const { exitCode, json } = runAppend(dir, STAFFING_FIXTURE, ['--with-examples']);
    assert.equal(exitCode, 0);
    assert.equal(json.project_id, 'HIST-009', 'with-examples 模式下叠在 HIST-008 后变 HIST-009');

    const csv = readFileSync(json.target, 'utf8');
    assert.ok(csv.includes('HIST-001,用户认证模块'), '应含示例 HIST-001');
    assert.ok(csv.includes('HIST-009,无人物流车运营系统'), '用户行应为 HIST-009');
  } finally { cleanup(dir); }
});

test('D24: 同名项目重入默认 skip（幂等保护，exit 4）', () => {
  const dir = makeTmpProject();
  try {
    const first = runAppend(dir, STAFFING_FIXTURE);
    assert.equal(first.exitCode, 0);
    assert.equal(first.json.project_id, 'HIST-001');

    const second = runAppend(dir, STAFFING_FIXTURE);
    assert.equal(second.exitCode, 4, '同名项目第二次跑应 exit 4（skip）');
    assert.equal(second.json.status, 'skipped_duplicate');
    assert.equal(second.json.existing_project_id, 'HIST-001');

    const csv = readFileSync(first.json.target, 'utf8');
    const userRows = csv.trim().split('\n').filter(l => l.includes('无人物流车运营系统'));
    assert.equal(userRows.length, 1, 'baseline 应仍只有 1 行该项目（幂等）');
  } finally { cleanup(dir); }
});

test('D24: --on-duplicate overwrite 覆盖原行（project_id 不变）', () => {
  const dir = makeTmpProject();
  try {
    runAppend(dir, STAFFING_FIXTURE);
    const updated = { ...STAFFING_FIXTURE, total_hours: 999, complexity: '复杂' };
    const r = runAppend(dir, updated, ['--on-duplicate', 'overwrite']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.json.status, 'overwritten');
    assert.equal(r.json.project_id, 'HIST-001', 'overwrite 时 project_id 不变');

    const csv = readFileSync(r.json.target, 'utf8');
    assert.ok(csv.includes('HIST-001,无人物流车运营系统,B2B-后台,999,'), '工时应被覆盖为 999');
    const userRows = csv.trim().split('\n').filter(l => l.includes('无人物流车运营系统'));
    assert.equal(userRows.length, 1);
  } finally { cleanup(dir); }
});

test('D24: --on-duplicate append 作新行（保留旧 + 新 HIST-NNN）', () => {
  const dir = makeTmpProject();
  try {
    runAppend(dir, STAFFING_FIXTURE);
    const r = runAppend(dir, STAFFING_FIXTURE, ['--on-duplicate', 'append']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.json.status, 'appended_as_new');
    assert.equal(r.json.project_id, 'HIST-002', 'append 模式分配新 HIST-NNN');
    assert.equal(r.json.duplicate_of, 'HIST-001');

    const csv = readFileSync(r.json.target, 'utf8');
    const userRows = csv.trim().split('\n').filter(l => l.includes('无人物流车运营系统'));
    assert.equal(userRows.length, 2, '应有两行同名项目（HIST-001 旧期 + HIST-002 新期）');
  } finally { cleanup(dir); }
});

test('D24: SKILL.md 项目类型决策门 options ≤4（AskUserQuestion 工具约束）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  // 抓"项目类型"决策门 options 数组
  const m = text.match(/header: "项目类型"[\s\S]+?options: \[([\s\S]+?)\]\s*\}/);
  assert.ok(m, 'SKILL.md 应含项目类型决策门定义');
  const optionsBlock = m[1];
  const labelCount = (optionsBlock.match(/{ label: /g) || []).length;
  assert.ok(labelCount <= 4, `项目类型 options 应 ≤4，实际 ${labelCount}`);
  assert.ok(labelCount >= 2, `options 至少 2 项`);
});

test('D24: examples/from-staffing-xlsx.md options ≤4（防止教学示例回归）', () => {
  const text = readFileSync(EXAMPLE_MD, 'utf8');
  const m = text.match(/header: "项目类型"[\s\S]+?options: \[([\s\S]+?)\]\s*\}/);
  assert.ok(m, 'examples 应含项目类型决策门示例');
  const optionsBlock = m[1];
  const labelCount = (optionsBlock.match(/{ label: /g) || []).length;
  assert.ok(labelCount <= 4, `examples 项目类型 options 应 ≤4，实际 ${labelCount}`);
});

test('D24: bin/baseline.mjs 容忍仅表头 hist（用户首次 /report 不被中断）', () => {
  const dir = makeTmpProject();
  try {
    const baselineDir = join(dir, 'baseline');
    const histPath = join(baselineDir, 'historical-projects.csv');
    const expertPath = join(baselineDir, 'estimation-rules.md');
    const outPath = join(baselineDir, 'baseline.locked.json');
    mkdirSync(baselineDir, { recursive: true });
    // 仅表头
    writeFileSync(histPath, readFileSync(TEMPLATE, 'utf8'));
    // 拷贝插件 expert 文件
    writeFileSync(expertPath, readFileSync(join(ROOT, 'baseline', 'estimation-rules.md'), 'utf8'));

    const r = spawnSync(
      process.execPath,
      [BASELINE_MJS, '--lock', '--hist', histPath, '--expert', expertPath, '--out', outPath],
      { encoding: 'utf8' }
    );
    assert.equal(r.status, 0, `仅表头时不应抛错；stderr=${r.stderr}`);
    assert.ok(existsSync(outPath), '应写出 baseline.locked.json');

    const locked = JSON.parse(readFileSync(outPath, 'utf8'));
    assert.equal(locked.source.hist_rows, 0, 'hist_rows 应记录 0');
    assert.deepEqual(locked.merged, locked.expert,
      'hist 为空时 merged 应直接等于 expert（专家兜底）');
  } finally { cleanup(dir); }
});

test('D24: commands/wbs.md 的 cp 已切到 skill assets template', () => {
  const text = readFileSync(join(ROOT, 'commands', 'wbs.md'), 'utf8');
  assert.ok(
    text.includes('skills/ddt-baseline-sync/assets/historical-projects.template.csv'),
    'commands/wbs.md 应使用 skill assets template 初始化（避免污染）'
  );
  assert.ok(
    !/cp\s+"?\$DDT_PLUGIN_ROOT\/baseline\/historical-projects\.csv"?\s+baseline/.test(text),
    'commands/wbs.md 不应再直接 cp 插件根 historical-projects.csv'
  );
});

test('D24: commands/report.md 的 cp 已切到 skill assets template', () => {
  const text = readFileSync(join(ROOT, 'commands', 'report.md'), 'utf8');
  assert.ok(
    text.includes('skills/ddt-baseline-sync/assets/historical-projects.template.csv'),
    'commands/report.md 应使用 skill assets template 初始化'
  );
});

