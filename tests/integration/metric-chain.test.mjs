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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
