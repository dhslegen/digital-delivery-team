// v0.9 D16+D17：emit-phase 同步更新 progress.json
//
// 实战 ddt-team-admin-v0.8.1 暴露：design-brief / design-execute 都被标
// duration_estimated: true，因为 emit-phase 写 events.jsonl 但不更新
// progress.json，progress.json 靠 infer 兜底回填 started_at。
//
// D16/D17 修复：emit-phase 在写完事件后同步调 progress.mjs --update，
// 让 progress.json::started_at / completed_at 与真实时间一致，消除
// duration_estimated 兜底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const EMIT_PHASE = join(ROOT, 'bin', 'emit-phase.mjs');
const PROGRESS = join(ROOT, 'bin', 'progress.mjs');

function setupSandbox() {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-d16-'));
  mkdirSync(join(tmp, '.ddt'), { recursive: true });
  writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-test-d16');
  // 初始化 progress.json
  spawnSync(process.execPath, [PROGRESS, '--init'], { cwd: tmp });
  return tmp;
}

function emitPhase(cwd, phase, action) {
  return spawnSync(process.execPath, [EMIT_PHASE, '--phase', phase, '--action', action], {
    cwd, encoding: 'utf8', env: { ...process.env, DDT_METRICS_DIR: cwd },
  });
}

test('D16: emit-phase --action start 应同步更新 progress.json::status=in_progress + started_at', () => {
  const tmp = setupSandbox();
  try {
    const r = emitPhase(tmp, 'prd', 'start');
    assert.equal(r.status, 0, `emit-phase failed: ${r.stderr}`);
    const progress = JSON.parse(readFileSync(join(tmp, '.ddt', 'progress.json'), 'utf8'));
    assert.equal(progress.phases.prd.status, 'in_progress',
      'emit-phase start 后 progress.json::prd.status 必须为 in_progress');
    assert.ok(progress.phases.prd.started_at,
      'started_at 必须被回填（v0.9 D16 核心）');
    assert.ok(!progress.phases.prd.duration_estimated,
      '直接 update 时不应触发 D8 fallback（duration_estimated 不应为 true）');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D17: emit-phase --action end 应同步更新 progress.json::status=completed + completed_at', () => {
  const tmp = setupSandbox();
  try {
    emitPhase(tmp, 'prd', 'start');
    // 至少差 1ms 让时间戳不同
    spawnSync('sleep', ['0.05']);
    const r = emitPhase(tmp, 'prd', 'end');
    assert.equal(r.status, 0);
    const progress = JSON.parse(readFileSync(join(tmp, '.ddt', 'progress.json'), 'utf8'));
    assert.equal(progress.phases.prd.status, 'completed');
    assert.ok(progress.phases.prd.completed_at);
    assert.ok(progress.phases.prd.started_at);
    assert.notEqual(progress.phases.prd.started_at, progress.phases.prd.completed_at,
      'start/end 各发一次，started_at 与 completed_at 应不同（验证非 D8 fallback）');
    assert.ok(!progress.phases.prd.duration_estimated,
      '完整 start→end 流程不应标 duration_estimated');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D16/D17: 编排命令（kickoff/impl/verify/ship）不进 progress.json 状态机（不报错）', () => {
  const tmp = setupSandbox();
  try {
    // emit-phase 允许这些 phase（VALID_PHASES 含），但不应让 progress.mjs 报错
    const r = emitPhase(tmp, 'kickoff', 'start');
    assert.equal(r.status, 0, `emit-phase kickoff start 应 exit 0: ${r.stderr}`);
    // progress.json 中不应有 kickoff 字段（PROGRESS_TRACKED_PHASES 不含）
    const progress = JSON.parse(readFileSync(join(tmp, '.ddt', 'progress.json'), 'utf8'));
    assert.ok(!progress.phases.kickoff,
      '编排命令不应进 progress.json 状态机');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D16: 项目无 .ddt/progress.json 时 emit-phase 仍正常（v0.7 兼容）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-d16-noprog-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-no-progress');
    // 不跑 progress --init
    const r = emitPhase(tmp, 'prd', 'start');
    assert.equal(r.status, 0, `emit-phase 在无 progress.json 时仍应 exit 0: ${r.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D16: design-brief / design-execute 也能同步更新（v0.8.1 D9 + v0.9 D16 联动）', () => {
  const tmp = setupSandbox();
  try {
    // 标 spa（让 design-brief / design-execute 不被 skipped）
    writeFileSync(join(tmp, '.ddt', 'tech-stack.json'),
      JSON.stringify({ frontend: { type: 'spa' } }));
    spawnSync(process.execPath, [PROGRESS, '--infer'], { cwd: tmp });

    emitPhase(tmp, 'design-brief', 'start');
    let progress = JSON.parse(readFileSync(join(tmp, '.ddt', 'progress.json'), 'utf8'));
    assert.equal(progress.phases['design-brief'].status, 'in_progress',
      'v0.8.1 D9 加入的 design-brief phase 必须能被 emit-phase 同步');
    assert.ok(progress.phases['design-brief'].started_at);
    assert.ok(!progress.phases['design-brief'].duration_estimated,
      '不应触发 D8 兜底（v0.8.1 实战暴露的核心问题）');

    emitPhase(tmp, 'design-brief', 'end');
    progress = JSON.parse(readFileSync(join(tmp, '.ddt', 'progress.json'), 'utf8'));
    assert.equal(progress.phases['design-brief'].status, 'completed');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
