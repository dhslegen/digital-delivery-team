#!/usr/bin/env node
// 审计链路冒烟测试 · events.jsonl → SQLite → 报告
//
// 在沙箱（mktemp METRICS_DIR + 临时 project id）中执行 6 个断言：
//   1) 4 个 phase 事件全部落 events.jsonl
//   2) 第一次 aggregate imported=4 / skipped=0
//   3) 重复 aggregate imported=0 / skipped=0（watermark 去重）
//   4) phase_runs 表恰好 2 行（PRD + WBS 配对，不是 4 行）
//   5) 增量 aggregate：追加 design 起止后 imported=2 / skipped=4
//   6) --rebuild 重置：imported=6 / skipped=0，phase_runs 重建为 3 行
//
// 任何断言失败 → exit 1；全部通过 → exit 0。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EMIT  = path.join(ROOT, 'bin', 'emit-phase.mjs');
const AGG   = path.join(ROOT, 'bin', 'aggregate.mjs');

const sandbox  = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-audit-'));
const projectId = `audit-${Date.now().toString(36)}`;
const sessionId = `audit-session-${Date.now().toString(36)}`;
// 固定 session id 让多次 emit-phase 子进程共享 session，phase_start/end 才能在 store 里配对成一行
const env = {
  ...process.env,
  DDT_METRICS_DIR: sandbox,
  DDT_PROJECT_ID:  projectId,
  DDT_SESSION_ID:  sessionId,
  NODE_NO_WARNINGS: '1',          // 屏蔽 node:sqlite 的 ExperimentalWarning
};

let passed = 0, failed = 0;
const results = [];

async function step(label, fn) {
  process.stdout.write(`\x1b[36m▶\x1b[0m ${label} ... `);
  try {
    await fn();
    console.log('\x1b[32mOK\x1b[0m');
    results.push({ label, ok: true });
    passed++;
  } catch (e) {
    console.log(`\x1b[31mFAIL\x1b[0m\n  ${e.message}`);
    results.push({ label, ok: false, err: e.message });
    failed++;
  }
}

function emit(phase, action) {
  execFileSync(process.execPath, [EMIT, '--phase', phase, '--action', action], { env, stdio: 'pipe' });
}

function aggregate(extraArgs = []) {
  const out = execFileSync(
    process.execPath,
    [AGG, '--project', projectId, ...extraArgs],
    { env, encoding: 'utf8' }
  );
  return JSON.parse(out.trim());
}

function bootstrapProject() {
  // aggregate.mjs 不要求 project 在 projects 表里也能 ingest，但会用到 watermark 表（自动按需建行）
  // 这里复用 store.mjs 显式建 project，避免下游 report 报"未知项目"
  execFileSync(process.execPath, ['-e', `
    const { DeliveryStore } = await import('${path.join(ROOT, 'bin', 'lib', 'store.mjs').replace(/\\\\/g, '/')}');
    const s = new DeliveryStore('${path.join(sandbox, 'metrics.db').replace(/\\\\/g, '/')}');
    await s.openOrCreate();
    s.createProject('${projectId}', 'audit-smoke');
    s.close();
  `], { env, stdio: 'pipe' });
}

function countPhaseRuns() {
  const out = execFileSync(process.execPath, ['-e', `
    const { DeliveryStore } = await import('${path.join(ROOT, 'bin', 'lib', 'store.mjs').replace(/\\\\/g, '/')}');
    const s = new DeliveryStore('${path.join(sandbox, 'metrics.db').replace(/\\\\/g, '/')}');
    await s.openOrCreate();
    const row = s._db.prepare('SELECT COUNT(*) AS n FROM phase_runs WHERE project_id = ?').get('${projectId}');
    process.stdout.write(String(row.n));
    s.close();
  `], { env, encoding: 'utf8' });
  return Number(out);
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

console.log(`\n\x1b[1mDDT Audit Smoke Test\x1b[0m`);
console.log(`  sandbox:  ${sandbox}`);
console.log(`  project:  ${projectId}\n`);

try {
  bootstrapProject();

  // Step 1
  await step('1/6 发射 4 个 phase 事件 → events.jsonl', () => {
    emit('prd', 'start');
    emit('prd', 'end');
    emit('wbs', 'start');
    emit('wbs', 'end');
    const lines = fs.readFileSync(path.join(sandbox, 'events.jsonl'), 'utf8').trim().split('\n');
    assertEq(lines.length, 4, 'events.jsonl 行数');
  });

  // Step 2
  await step('2/6 第一次 aggregate (imported=4 / skipped=0)', () => {
    const r = aggregate();
    assertEq(r.imported, 4, 'imported');
    assertEq(r.skipped, 0, 'skipped');
    if (!r.watermark) throw new Error('watermark 应非空');
  });

  // Step 3 — 关键去重契约（v0.5.1 工时膨胀根因修复）
  await step('3/6 重复 aggregate (imported=0 / skipped=4，watermark 去重)', () => {
    const r = aggregate();
    assertEq(r.imported, 0, 'imported（重放绝不应再 ingest）');
    assertEq(r.skipped,  4, 'skipped（4 个旧事件 ts ≤ watermark 被跳过）');
  });

  // Step 4 — phase_runs 真实数字（4 事件 → 2 行 = 2 对 start/end 配对）
  await step('4/6 phase_runs 表恰好 2 行（PRD + WBS 各配对成 1 行）', () => {
    assertEq(countPhaseRuns(), 2, 'phase_runs 行数');
  });

  // Step 5 — 增量 ingest
  await step('5/6 追加 design 起止后增量 ingest (imported=2 / skipped=4)', async () => {
    await sleep(1100);                // 拉开 ts 间距，避免 watermark 边界吞掉
    emit('design', 'start');
    await sleep(50);
    emit('design', 'end');
    const r = aggregate();
    assertEq(r.imported, 2, 'imported');
    assertEq(r.skipped, 4, 'skipped（旧 4 个被水位线跳过）');
    assertEq(countPhaseRuns(), 3, '增量后 phase_runs 行数');
  });

  // Step 6 — rebuild 重置
  await step('6/6 --rebuild 强制全量重置 (imported=6 / skipped=0)', () => {
    const r = aggregate(['--rebuild']);
    assertEq(r.imported, 6, 'imported');
    assertEq(r.skipped, 0, 'skipped');
    assertEq(countPhaseRuns(), 3, 'rebuild 后 phase_runs 行数');
  });
} finally {
  // 清理沙箱
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\n\x1b[1mResult:\x1b[0m \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
process.exit(failed === 0 ? 0 : 1);
