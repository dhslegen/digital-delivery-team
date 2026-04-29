// M6.6: aggregate watermark 增量 ingest + emit-phase + relay prompt
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { DeliveryStore } from '../../bin/lib/store.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function buildEvents(eventsPath, lines) {
  writeFileSync(eventsPath, lines.map(e => JSON.stringify(e)).join('\n') + '\n');
}

test('aggregate 多次跑同 events.jsonl 不重复 ingest（watermark 防膨胀）', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-watermark-'));
  try {
    const events = [
      { event: 'session_start', project_id: 'p1', ts: '2026-04-29T00:00:00Z',
        data: { session_id: 's1' } },
      { event: 'phase_start', project_id: 'p1', ts: '2026-04-29T00:01:00Z',
        data: { session_id: 's1', phase: 'prd', args: '' } },
      { event: 'phase_end', project_id: 'p1', ts: '2026-04-29T00:05:00Z',
        data: { session_id: 's1', phase: 'prd', duration_ms: 240000 } },
    ];
    buildEvents(join(tmp, 'events.jsonl'), events);
    const env = { ...process.env, DDT_METRICS_DIR: tmp };

    // 跑 3 次 aggregate（模拟 Stop hook 多次触发）
    for (let i = 0; i < 3; i++) {
      const r = spawnSync(process.execPath,
        [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
        { cwd: ROOT, env, encoding: 'utf8' });
      assert.equal(r.status, 0, `aggregate #${i+1} failed: ${r.stderr}`);
    }

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const phaseRows = store._db.prepare(
      'SELECT * FROM phase_runs WHERE project_id=?').all('p1');
    assert.equal(phaseRows.length, 1,
      `phase_runs 应仅 1 行（实际 ${phaseRows.length}）— watermark 失效会膨胀到 3 行`);
    assert.equal(phaseRows[0].duration_ms, 240000);

    // 第 4 次 aggregate 应 imported=0（全部已 ingest）
    const r4 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p1'],
      { cwd: ROOT, env, encoding: 'utf8' });
    const out = JSON.parse(r4.stdout);
    assert.equal(out.imported, 0, '所有事件已 ingest，第 4 次应 0 imported');
    assert.ok(out.skipped > 0, '应有 skipped 计数');
    store.close();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('aggregate 增量 ingest：新事件追加后只 ingest 新的', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-watermark-incr-'));
  try {
    const events1 = [
      { event: 'phase_start', project_id: 'p2', ts: '2026-04-29T00:01:00Z',
        data: { session_id: 's1', phase: 'prd' } },
      { event: 'phase_end', project_id: 'p2', ts: '2026-04-29T00:05:00Z',
        data: { session_id: 's1', phase: 'prd', duration_ms: 240000 } },
    ];
    buildEvents(join(tmp, 'events.jsonl'), events1);
    const env = { ...process.env, DDT_METRICS_DIR: tmp };

    const r1 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p2'],
      { cwd: ROOT, env, encoding: 'utf8' });
    const out1 = JSON.parse(r1.stdout);
    assert.equal(out1.imported, 2);

    // 追加新事件
    const events2 = [...events1,
      { event: 'phase_start', project_id: 'p2', ts: '2026-04-29T00:10:00Z',
        data: { session_id: 's1', phase: 'wbs' } },
      { event: 'phase_end', project_id: 'p2', ts: '2026-04-29T00:15:00Z',
        data: { session_id: 's1', phase: 'wbs', duration_ms: 300000 } },
    ];
    buildEvents(join(tmp, 'events.jsonl'), events2);

    const r2 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p2'],
      { cwd: ROOT, env, encoding: 'utf8' });
    const out2 = JSON.parse(r2.stdout);
    assert.equal(out2.imported, 2, '只 ingest 2 条新事件');
    assert.equal(out2.skipped, 2, '跳过 2 条旧事件');

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const phaseRows = store._db.prepare(
      'SELECT phase, duration_ms FROM phase_runs WHERE project_id=? ORDER BY started_at').all('p2');
    assert.equal(phaseRows.length, 2);
    assert.equal(phaseRows[0].phase, 'prd');
    assert.equal(phaseRows[1].phase, 'wbs');
    store.close();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('aggregate --rebuild 清空表并强制全量重 ingest', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-rebuild-'));
  try {
    const events = [
      { event: 'phase_start', project_id: 'p3', ts: '2026-04-29T00:01:00Z',
        data: { session_id: 's1', phase: 'prd' } },
      { event: 'phase_end', project_id: 'p3', ts: '2026-04-29T00:05:00Z',
        data: { session_id: 's1', phase: 'prd', duration_ms: 240000 } },
    ];
    buildEvents(join(tmp, 'events.jsonl'), events);
    const env = { ...process.env, DDT_METRICS_DIR: tmp };

    spawnSync(process.execPath, [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p3'],
      { cwd: ROOT, env, encoding: 'utf8' });

    // --rebuild 清空 + 重 ingest
    const r = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'aggregate.mjs'), '--project', 'p3', '--rebuild'],
      { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.imported, 2, 'rebuild 后应重新 ingest 全部');

    const store = new DeliveryStore(join(tmp, 'metrics.db'));
    await store.openOrCreate();
    const rows = store._db.prepare(
      'SELECT * FROM phase_runs WHERE project_id=?').all('p3');
    assert.equal(rows.length, 1, '应只有 1 行（不重复）');
    store.close();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('emit-phase 写入 events.jsonl 且 end 关联 start 计算 duration', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-emit-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/project-id'), 'p4');

    const env = { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') };

    // emit start
    const r1 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'emit-phase.mjs'), '--phase', 'prd', '--action', 'start'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r1.status, 0);

    // 等 100ms
    await new Promise(resolve => setTimeout(resolve, 100));

    // emit end
    const r2 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'emit-phase.mjs'), '--phase', 'prd', '--action', 'end'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r2.status, 0);
    assert.match(r2.stdout, /prd end \([\d.]+s\)/);

    // 检查 events.jsonl
    const events = readFileSync(join(tmp, '.metrics', 'events.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(events.length, 2);
    assert.equal(events[0].event, 'phase_start');
    assert.equal(events[0].data.phase, 'prd');
    assert.equal(events[1].event, 'phase_end');
    assert.ok(events[1].data.duration_ms >= 100,
      `duration ${events[1].data.duration_ms} 应 ≥ 100ms`);
    assert.equal(events[1].data.matched_start, events[0].ts);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('emit-phase 拒绝无效 phase / action', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-emit-bad-'));
  try {
    const env = { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') };
    const r1 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'emit-phase.mjs'), '--phase', 'bad-phase', '--action', 'start'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r1.status, 1);

    const r2 = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'emit-phase.mjs'), '--phase', 'prd', '--action', 'pause'],
      { cwd: tmp, env, encoding: 'utf8' });
    assert.equal(r2.status, 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('build-relay-prompt 输出含 13 段结构 + DDT 自动注入字段', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-relay-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/project-id'), 'proj-relay-001');
    writeFileSync(join(tmp, '.ddt/progress.json'), JSON.stringify({
      schema_version: 1,
      project_id: 'proj-relay-001',
      current_phase: 'design',
      phases: {
        prd: { status: 'completed' },
        wbs: { status: 'completed' },
        design: { status: 'in_progress' },
      },
    }));
    writeFileSync(join(tmp, '.ddt/tech-stack.json'), JSON.stringify({
      preset: 'java-modern',
      backend: { framework: 'spring-boot', language: 'java',
                 database: { primary: 'mysql' } },
      frontend: { framework: 'react', bundler: 'vite',
                  ui: { css: 'tailwindcss' } },
      ai_design: { type: 'claude-design' },
    }));

    const r = spawnSync(process.execPath,
      [join(ROOT, 'bin', 'build-relay-prompt.mjs'), '--quiet',
       '--out', join(tmp, 'relay.md')],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);

    const prompt = readFileSync(join(tmp, 'relay.md'), 'utf8');

    // DDT 自动注入字段
    assert.ok(prompt.includes('proj-relay-001'), '含项目 ID');
    assert.ok(prompt.includes('design'), '含当前 phase');
    assert.ok(prompt.includes('spring-boot'), '含技术栈摘要');
    assert.ok(prompt.includes('react'), '含前端栈');

    // 13 段中 LLM 必填的 9 段标题
    for (const heading of [
      'What We Are Building',
      'What WORKED',
      'What Did NOT Work',
      'What Has NOT Been Tried Yet',
      'Current State of Files',
      'Decisions Made',
      'Blockers & Open Questions',
      'Exact Next Step',
      'Environment & Setup Notes',
    ]) {
      assert.ok(prompt.includes(heading), `必含段落: ${heading}`);
    }

    // 续作指引
    assert.ok(prompt.includes('/digital-delivery-team:doctor'));
    assert.ok(prompt.includes('/digital-delivery-team:resume'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
