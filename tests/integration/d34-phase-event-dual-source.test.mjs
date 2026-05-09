// D34 (v0.9.18)：phase_start 双源采集 + store.mjs ingest 去重
//   背景：commands/X.md::Phase 1 把 emit-phase 与前置检查合并在同一 bash 块；实战发现 LLM 会改写 bash
//         砍掉 emit-phase 行，导致 phase 事件永久丢失。
//   修复：UserPromptSubmit hook 也为业务级命令写 phase_start (source=hook) 兜底，
//         ingest 时按 (project_id, phase, ±60s) 去重，emit-phase 优先（精确 ts），hook 兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DeliveryStore } from '../../bin/lib/store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-d34-'));
  const dbPath = path.join(dir, 'metrics.db');
  const store = new DeliveryStore(dbPath);
  await store.openOrCreate();
  return { store, dir };
}

function ev(phase, ts, sessionId, source) {
  return {
    ts,
    event: 'phase_start',
    project_id: 'p1',
    data: { session_id: sessionId, phase, args: '', source },
  };
}

test('D34: 单源 hook → 一行入库，source=hook', async () => {
  const { store, dir } = await freshStore();
  try {
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 's-claude', 'hook'));
    const rows = store._db.prepare(
      'SELECT phase, source FROM phase_runs WHERE project_id=?'
    ).all('p1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'hook');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: 单源 emit-phase → 一行入库，source=emit-phase', async () => {
  const { store, dir } = await freshStore();
  try {
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 'cli-001', 'emit-phase'));
    const rows = store._db.prepare(
      'SELECT phase, source FROM phase_runs WHERE project_id=?'
    ).all('p1');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'emit-phase');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: hook 先 → emit-phase 后到（10s 内）→ 删除 hook 行，最终保留 emit-phase', async () => {
  const { store, dir } = await freshStore();
  try {
    // 用户输入 /build-api 瞬间 hook 触发
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 's-claude', 'hook'));
    // 10 秒后 commands Phase 1 bash 跑到 emit-phase
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:10.000Z', 'cli-001', 'emit-phase'));

    const rows = store._db.prepare(
      'SELECT source FROM phase_runs WHERE project_id=? ORDER BY id'
    ).all('p1');
    assert.equal(rows.length, 1, 'hook 行应被 emit-phase 替换，最终只剩 1 条');
    assert.equal(rows[0].source, 'emit-phase', 'emit-phase 优先（精确 ts）');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: emit-phase 先 → hook 后到（10s 内）→ hook 跳过', async () => {
  const { store, dir } = await freshStore();
  try {
    // emit-phase 先到（理论上不会发生，但要确保幂等）
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 'cli-001', 'emit-phase'));
    // hook 后到
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:10.000Z', 's-claude', 'hook'));

    const rows = store._db.prepare(
      'SELECT source FROM phase_runs WHERE project_id=? ORDER BY id'
    ).all('p1');
    assert.equal(rows.length, 1, 'hook 应跳过，仅保留 emit-phase');
    assert.equal(rows[0].source, 'emit-phase');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: 两次合法独立的 phase 启动（>60s）应正常入库为两条', async () => {
  const { store, dir } = await freshStore();
  try {
    // 第一次跑
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 'cli-001', 'emit-phase'));
    // 模拟 phase_end 闭合第一次（让它脱离"未闭合"集合）
    store.ingestEvent({
      ts: '2026-05-09T10:30:00.000Z', event: 'phase_end', project_id: 'p1',
      data: { session_id: 'cli-001', phase: 'build-api', duration_ms: 1800000 }
    });
    // 5 分钟后用户跑 /build-api --refresh（合法的第二次）
    store.ingestEvent(ev('build-api', '2026-05-09T10:35:00.000Z', 's-claude', 'hook'));

    const rows = store._db.prepare(
      'SELECT source, started_at FROM phase_runs WHERE project_id=? ORDER BY started_at'
    ).all('p1');
    assert.equal(rows.length, 2, '两次独立启动应保留两条');
    assert.equal(rows[0].source, 'emit-phase');
    assert.equal(rows[1].source, 'hook');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: 模拟 alv-ops 真实场景 — LLM 跳过 emit-phase 时 hook 兜底', async () => {
  // 还原 alv-ops build-api 的真实情况：用户跑 /build-api，hook 立即写 phase_start (source=hook)，
  // 但 commands/build-api.md::Phase 1 的 bash 被 LLM 改写、emit-phase 行被砍掉。
  // 期望：phase_runs 有一条 source=hook 兜底，phase 工时可被部分恢复（虽然 ts 略飘）。
  const { store, dir } = await freshStore();
  try {
    // 用户输入 /build-api → hook 写 phase_start
    store.ingestEvent(ev('build-api', '2026-05-09T10:00:00.000Z', 's-claude', 'hook'));
    // emit-phase 永远没跑（被 LLM 跳过）
    // 30 分钟后 main thread 写完 server 代码，跑 Phase 6 SUMMARY，emit-phase --action end
    store.ingestEvent({
      ts: '2026-05-09T10:30:00.000Z', event: 'phase_end', project_id: 'p1',
      data: { session_id: 'cli-end', phase: 'build-api', duration_ms: 1800000 }
    });

    const phaseHours = store.aggregatePhaseHours('p1');
    assert.ok(phaseHours['build-api'] > 0,
      'D34 兜底后，build-api 工时应被记录而非永久丢失');
    assert.ok(phaseHours['build-api'] <= 0.5 + 0.001,
      'phase_end 三级匹配应正确闭合（duration ≈ 30min = 0.5h）');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D34: PRAGMA 检查 phase_runs 含 source 列', async () => {
  const { store, dir } = await freshStore();
  try {
    const cols = store._db.prepare('PRAGMA table_info(phase_runs)').all();
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('source'),
      'phase_runs 表必须含 source 列（D34 双源去重依赖）');
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
