// M1-8: 测试 SubagentStop lookback join 与 phase_runs 端到端可计算工时
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { DeliveryStore } from '../../bin/lib/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

test('subagent_start + subagent_stop lookback join 能算出 duration', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lookback-'));
  try {
    // 构造 PreToolUse(Task) → SubagentStop 的事件序列
    const events = [
      { event: 'session_start', project_id: 'p1', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's1' } },
      // 子代理 1：architect-agent 启动
      { event: 'subagent_start', project_id: 'p1', ts: '2026-04-25T00:01:00Z',
        data: { session_id: 's1', subagent_name: 'architect-agent' } },
      // 子代理 1 结束（payload 没有 subagent_name / duration_ms — 模拟真实 Claude Code 行为）
      { event: 'subagent_stop', project_id: 'p1', ts: '2026-04-25T00:03:30Z',
        data: { session_id: 's1', subagent_name: 'architect-agent', duration_ms: 150000 } },
      // 子代理 2：frontend-agent
      { event: 'subagent_start', project_id: 'p1', ts: '2026-04-25T00:04:00Z',
        data: { session_id: 's1', subagent_name: 'frontend-agent' } },
      { event: 'subagent_stop', project_id: 'p1', ts: '2026-04-25T00:06:00Z',
        data: { session_id: 's1', subagent_name: 'frontend-agent', duration_ms: 120000 } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    const agg = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(agg.status, 0, `aggregate failed:\n${agg.stderr}`);

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();

    const archRow = store._db.prepare(
      'SELECT subagent_name, started_at, ended_at, duration_ms FROM subagent_runs WHERE subagent_name=? AND project_id=?'
    ).get('architect-agent', 'p1');
    assert.ok(archRow, 'architect-agent 必须入库');
    assert.equal(archRow.duration_ms, 150000, '应取 stop 事件携带的 duration');
    assert.ok(archRow.started_at, 'started_at 必须由 subagent_start 写入');
    assert.ok(archRow.ended_at, 'ended_at 必须由 subagent_stop 写入');

    const feRow = store._db.prepare(
      'SELECT subagent_name, duration_ms FROM subagent_runs WHERE subagent_name=? AND project_id=?'
    ).get('frontend-agent', 'p1');
    assert.equal(feRow.duration_ms, 120000);

    // aggregateStageHours 输出小时
    const hours = store.aggregateStageHours('p1');
    assert.equal(hours['architect-agent'], 150000 / 3_600_000);
    assert.equal(hours['frontend-agent'], 120000 / 3_600_000);

    store.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('phase_start + phase_end 端到端写入 phase_runs', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-phase-'));
  try {
    const events = [
      { event: 'session_start', project_id: 'p2', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's2' } },
      { event: 'phase_start', project_id: 'p2', ts: '2026-04-25T00:00:10Z',
        data: { session_id: 's2', phase: 'prd', args: '' } },
      { event: 'phase_end', project_id: 'p2', ts: '2026-04-25T00:05:10Z',
        data: { session_id: 's2', phase: 'prd', duration_ms: 300000 } },
      { event: 'phase_start', project_id: 'p2', ts: '2026-04-25T00:05:30Z',
        data: { session_id: 's2', phase: 'design', args: '--refresh' } },
      { event: 'phase_end', project_id: 'p2', ts: '2026-04-25T00:15:30Z',
        data: { session_id: 's2', phase: 'design', duration_ms: 600000 } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    const agg = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p2'],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(agg.status, 0, `aggregate failed:\n${agg.stderr}`);

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();

    const phases = store.aggregatePhaseHours('p2');
    assert.ok(Math.abs(phases['prd'] - 300000 / 3_600_000) < 1e-9, 'prd 工时');
    assert.ok(Math.abs(phases['design'] - 600000 / 3_600_000) < 1e-9, 'design 工时');

    store.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('post_tool_use FIFO 关联在并行同 tool 调用时不错配', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-fifo-'));
  try {
    // 模拟 /impl 同 session 内并行两次 Task：先开始的应该先关联
    const events = [
      { event: 'session_start', project_id: 'p3', ts: '2026-04-25T00:00:00Z',
        data: { session_id: 's3' } },
      // pre #1
      { event: 'pre_tool_use', project_id: 'p3', ts: '2026-04-25T00:01:00Z',
        data: { session_id: 's3', tool_name: 'Task', file_path: 'A' } },
      // pre #2
      { event: 'pre_tool_use', project_id: 'p3', ts: '2026-04-25T00:01:01Z',
        data: { session_id: 's3', tool_name: 'Task', file_path: 'B' } },
      // post #1（更早开始的先关闭）
      { event: 'post_tool_use', project_id: 'p3', ts: '2026-04-25T00:02:00Z',
        data: { session_id: 's3', tool_name: 'Task', duration_ms: 60000, success: true } },
      // post #2
      { event: 'post_tool_use', project_id: 'p3', ts: '2026-04-25T00:03:00Z',
        data: { session_id: 's3', tool_name: 'Task', duration_ms: 119000, success: true } },
    ];
    writeFileSync(join(tmp, 'events.jsonl'),
      events.map(e => JSON.stringify(e)).join('\n') + '\n');

    const env = { ...process.env, DDT_METRICS_DIR: tmp };
    const agg = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p3'],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(agg.status, 0, `aggregate failed:\n${agg.stderr}`);

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const rows = store._db.prepare(
      'SELECT file_path, duration_ms FROM tool_calls WHERE project_id=? ORDER BY id'
    ).all('p3');
    assert.equal(rows.length, 2);
    // FIFO：先 pre 的 file_path=A 应得到第一个 post 的 duration=60000
    assert.equal(rows[0].file_path, 'A');
    assert.equal(rows[0].duration_ms, 60000);
    assert.equal(rows[1].file_path, 'B');
    assert.equal(rows[1].duration_ms, 119000);

    store.close();
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
