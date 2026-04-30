import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { DeliveryStore } from '../../bin/lib/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const EVENTS = [
  { type: 'session_start', project_id: 'test-proj', ts: '2026-04-25T00:00:00Z', data: { session_id: 'sess-test-001' } },
  { type: 'pre_tool_use',  project_id: 'test-proj', ts: '2026-04-25T00:01:00Z', data: { session_id: 'sess-test-001', tool_name: 'backend-agent' } },
  { type: 'post_tool_use', project_id: 'test-proj', ts: '2026-04-25T00:02:00Z', data: { session_id: 'sess-test-001', tool_name: 'backend-agent', duration_ms: 60000, success: true } },
  { type: 'pre_tool_use',  project_id: 'test-proj', ts: '2026-04-25T00:03:00Z', data: { tool_name: 'frontend-agent' } },
  { type: 'post_tool_use', project_id: 'test-proj', ts: '2026-04-25T00:04:00Z', data: { tool_name: 'frontend-agent', success: true } },
  { type: 'pre_tool_use',  project_id: 'test-proj', ts: '2026-04-25T00:05:00Z', data: { tool_name: 'test-agent' } },
  { type: 'post_tool_use', project_id: 'test-proj', ts: '2026-04-25T00:06:00Z', data: { tool_name: 'test-agent', success: true } },
  { type: 'pre_tool_use',  project_id: 'test-proj', ts: '2026-04-25T00:07:00Z', data: { tool_name: 'architect-agent' } },
  { type: 'subagent_stop', project_id: 'test-proj', ts: '2026-04-25T00:08:00Z',
    data: { session_id: 'sess-test-001', subagent_name: 'backend-agent', duration_ms: 120000, success: true } },
  { type: 'quality_metrics', project_id: 'test-proj', ts: '2026-04-25T01:00:00Z',
    source: 'test-runner', stage: 'verify',
    metrics: { coverage_pct: 85, tests_total: 50, tests_passed: 47, tests_failed: 3 } },
  { type: 'quality_metrics', project_id: 'test-proj', ts: '2026-04-25T01:01:00Z',
    source: 'review', stage: 'verify',
    metrics: { blocker_count: 0, warning_count: 2, suggestion_count: 5 } },
];

test('metric-chain: aggregate → baseline → report all pass', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-chain-'));
  try {
    writeFileSync(join(tmp, 'events.jsonl'), EVENTS.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };

    // Step 1: aggregate
    const agg = spawnSync(process.execPath, [join(ROOT, 'bin', 'aggregate.mjs')], {
      cwd: ROOT, env, encoding: 'utf8',
    });
    assert.equal(agg.status, 0, `aggregate failed:\n${agg.stderr}`);
    assert.ok(existsSync(join(tmp, 'metrics.db')), 'metrics.db must exist after aggregate');
    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const toolCall = store._db.prepare('SELECT session_id, duration_ms FROM tool_calls WHERE tool_name=?').get('backend-agent');
    const subagentRun = store._db.prepare('SELECT session_id FROM subagent_runs WHERE subagent_name=?').get('backend-agent');
    assert.equal(toolCall.session_id, 'sess-test-001');
    assert.equal(toolCall.duration_ms, 60000);
    assert.equal(subagentRun.session_id, 'sess-test-001');
    store.close();

    // Step 2: baseline (reads baseline/historical-projects.csv + estimation-rules.md from ROOT)
    const baselineOut = join(tmp, 'baseline.locked.json');
    const base = spawnSync(
      process.execPath,
      [join(ROOT, 'bin', 'baseline.mjs'), '--out', baselineOut],
      { cwd: ROOT, env, encoding: 'utf8' }
    );
    assert.equal(base.status, 0, `baseline failed:\n${base.stderr}`);
    assert.ok(existsSync(baselineOut), 'baseline.locked.json must exist after baseline');

    const locked = JSON.parse(readFileSync(baselineOut, 'utf8'));
    for (const field of ['lockedAt', 'hist', 'expert', 'merged', 'component_hist']) {
      assert.ok(locked[field] !== undefined, `baseline.locked.json missing field '${field}'`);
    }
    for (const stage of ['requirements', 'architecture', 'frontend', 'backend', 'testing', 'docs']) {
      assert.ok(locked.merged[stage] !== undefined, `baseline.merged missing stage '${stage}'`);
    }

    // Step 3: report
    const reportOut = join(tmp, 'efficiency-report.raw.md');
    const rep = spawnSync(
      process.execPath,
      [join(ROOT, 'bin', 'report.mjs'), '--baseline', baselineOut, '--out', reportOut],
      { cwd: ROOT, env, encoding: 'utf8' }
    );
    assert.equal(rep.status, 0, `report failed:\n${rep.stderr}`);
    assert.ok(existsSync(reportOut), 'efficiency-report.raw.md must exist after report');

    const content = readFileSync(reportOut, 'utf8');
    for (const heading of ['阶段级对比', '质量守门', '原始数据链接']) {
      assert.ok(content.includes(heading), `report missing section containing '${heading}'`);
    }
    // P2-1: 数据快照声明必须出现，避免 raw / final 时点不一致引发歧义
    assert.match(content, /数据快照说明/, 'P2-1: 必须含数据快照说明段');
    assert.match(content, /本次 \/report 自身工时.{0,40}尚未计入/, 'P2-1: 必须明确说明本次 /report 工时尚未计入');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// PR-F: AI 执行 vs 用户审查时间拆分
test('PR-F: splitAiVsReviewByPhase 按时间窗 overlap 拆分 AI / 用户工时', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-aireview-'));
  try {
    // 构造场景：prd phase 跑 600s（10min），其中 product-agent 子代理跑 60s（1min），
    //   AI 占比 = 60/600 = 10%（典型用户审查为主场景）
    const events = [
      { event: 'phase_start',     project_id: 'p1', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's1', phase: 'prd' } },
      { event: 'subagent_start',  project_id: 'p1', ts: '2026-04-25T00:01:00Z',
        data: { session_id: 's1', subagent_name: 'product-agent' } },
      { event: 'subagent_stop',   project_id: 'p1', ts: '2026-04-25T00:02:00Z',
        data: { session_id: 's1', subagent_name: 'product-agent', duration_ms: 60000, success: true } },
      { event: 'phase_end',       project_id: 'p1', ts: '2026-04-25T00:10:00Z',
        data: { session_id: 's1', phase: 'prd', duration_ms: 600000 } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    spawnSync(process.execPath, [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const split = store.splitAiVsReviewByPhase('p1');
    store.close();

    assert.ok(split.prd, 'split.prd 必存在');
    assert.equal(split.prd.totalH.toFixed(4),  '0.1667', 'prd 总工时 600000ms = 0.1667h');
    assert.equal(split.prd.aiH.toFixed(4),     '0.0167', 'AI 执行 60000ms = 0.0167h');
    assert.equal(split.prd.userH.toFixed(4),   '0.1500', '用户/间隙 = 540000ms = 0.15h');
    assert.equal((split.prd.ratio * 100).toFixed(1), '10.0', 'AI 占比 = 10%');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-F: report.mjs 输出"AI 执行 vs 用户审查时间拆分"段', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-airaw-'));
  try {
    const events = [
      { event: 'phase_start',     project_id: 'p1', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's1', phase: 'design' } },
      { event: 'subagent_start',  project_id: 'p1', ts: '2026-04-25T00:01:00Z',
        data: { session_id: 's1', subagent_name: 'architect-agent' } },
      { event: 'subagent_stop',   project_id: 'p1', ts: '2026-04-25T00:06:00Z',
        data: { session_id: 's1', subagent_name: 'architect-agent', duration_ms: 300000, success: true } },
      { event: 'phase_end',       project_id: 'p1', ts: '2026-04-25T00:10:00Z',
        data: { session_id: 's1', phase: 'design', duration_ms: 600000 } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');
    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    spawnSync(process.execPath, [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });
    const baselineOut = join(tmp, 'baseline.locked.json');
    spawnSync(process.execPath, [join(ROOT, 'bin', 'baseline.mjs'), '--out', baselineOut],
      { cwd: ROOT, env, encoding: 'utf8' });
    const reportOut = join(tmp, 'efficiency-report.raw.md');
    spawnSync(process.execPath,
      [join(ROOT, 'bin', 'report.mjs'), '--project', 'p1', '--baseline', baselineOut, '--out', reportOut],
      { cwd: ROOT, env, encoding: 'utf8' });

    const content = readFileSync(reportOut, 'utf8');
    assert.match(content, /AI 执行 vs 用户审查时间拆分/, 'PR-F 段标题');
    // design phase: 总 600s, AI 300s → 50%
    assert.match(content, /design.*0\.167.*0\.083.*0\.083.*50\.0%/,
      'design 行应显示 总=0.167h / AI=0.083h / 用户=0.083h / 比率=50%');
    assert.match(content, /AI 占比 < 30%/, '解读段必须含"AI 占比 < 30%"提示');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// P2-2 编排开销专项测试 — 用真实 phase_runs 验证 kickoff_total - SUM(子 phase) 公式
test('P2-2: 编排开销 = kickoff 总工时 - 子 phase 合计', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-overhead-'));
  try {
    // 模拟 phase_runs：kickoff 1200000ms，prd 300000ms，wbs 400000ms，design 400000ms
    // 编排开销 = 1200 - (300+400+400) = 100s = 0.0278h
    const events = [
      { event: 'phase_start', project_id: 'p1', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's1', phase: 'kickoff' } },
      { event: 'phase_start', project_id: 'p1', ts: '2026-04-25T00:01:00Z',
        data: { session_id: 's1', phase: 'prd' } },
      { event: 'phase_end',   project_id: 'p1', ts: '2026-04-25T00:06:00Z',
        data: { session_id: 's1', phase: 'prd', duration_ms: 300000 } },
      { event: 'phase_start', project_id: 'p1', ts: '2026-04-25T00:06:00Z',
        data: { session_id: 's1', phase: 'wbs' } },
      { event: 'phase_end',   project_id: 'p1', ts: '2026-04-25T00:13:00Z',
        data: { session_id: 's1', phase: 'wbs', duration_ms: 400000 } },
      { event: 'phase_start', project_id: 'p1', ts: '2026-04-25T00:13:00Z',
        data: { session_id: 's1', phase: 'design' } },
      { event: 'phase_end',   project_id: 'p1', ts: '2026-04-25T00:20:00Z',
        data: { session_id: 's1', phase: 'design', duration_ms: 400000 } },
      { event: 'phase_end',   project_id: 'p1', ts: '2026-04-25T00:20:00Z',
        data: { session_id: 's1', phase: 'kickoff', duration_ms: 1200000 } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    spawnSync(process.execPath, [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });
    const baselineOut = join(tmp, 'baseline.locked.json');
    spawnSync(process.execPath, [join(ROOT, 'bin', 'baseline.mjs'), '--out', baselineOut],
      { cwd: ROOT, env, encoding: 'utf8' });
    const reportOut = join(tmp, 'efficiency-report.raw.md');
    spawnSync(process.execPath,
      [join(ROOT, 'bin', 'report.mjs'), '--project', 'p1', '--baseline', baselineOut, '--out', reportOut],
      { cwd: ROOT, env, encoding: 'utf8' });

    const content = readFileSync(reportOut, 'utf8');
    assert.match(content, /编排开销拆解/, '必须含编排开销拆解段');
    assert.match(content, /kickoff.*0\.333.*0\.306.*0\.028/,
      'kickoff 行应展示 总工时 / 子合计 / 编排开销三列');
    assert.match(content, /编排开销合计：0\.028 h/,
      '编排开销合计应为 1200ms - (300+400+400)ms = 100s = 0.028h');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
