// E2: SessionStart 输出 hookSpecificOutput.additionalContext
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const HANDLER = join(ROOT, 'hooks', 'handlers', 'session-start.js');

function runHook(cwd, input, env = {}) {
  return spawnSync(process.execPath, [HANDLER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    cwd,
    env: { ...process.env, DDT_METRICS_DIR: join(cwd, '.metrics'),
      DDT_PLUGIN_ROOT: ROOT, ...env },
    timeout: 10000,
  });
}

test('非 DDT 项目（无 brief / 无 .ddt/project-id）不注入 additionalContext', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-context-empty-'));
  try {
    const r = runHook(tmp, { session_id: 's1', cwd: tmp });
    assert.equal(r.status, 0);
    // 输出应不含 hookSpecificOutput（保留原 raw input echo 行为）
    assert.ok(!r.stdout.includes('hookSpecificOutput'),
      '非 DDT 项目不应注入 context');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('DDT 项目（有 project-brief.md）注入 additionalContext JSON', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-context-brief-'));
  try {
    writeFileSync(join(tmp, 'project-brief.md'), '# Brief\n核心功能：任务管理');
    const r = runHook(tmp, { session_id: 's1', cwd: tmp });
    assert.equal(r.status, 0);

    // stdout 应是合法 JSON 含 hookSpecificOutput.additionalContext
    const payload = JSON.parse(r.stdout);
    assert.equal(payload.continue, true);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('DDT (digital-delivery-team)'),
      'context 应介绍 DDT');
    assert.ok(ctx.includes('/kickoff'), 'context 应列出可用命令');
    assert.ok(ctx.includes('唯一真相源'), 'context 应说明关键约束');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('progress.json 存在时 context 含进度概览', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-context-progress-'));
  try {
    writeFileSync(join(tmp, 'project-brief.md'), '# Brief');
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-test-001');
    writeFileSync(join(tmp, '.ddt', 'progress.json'), JSON.stringify({
      schema_version: 1,
      project_id: 'proj-test-001',
      current_phase: 'design',
      phases: {
        prd: { status: 'completed' },
        wbs: { status: 'completed' },
        design: { status: 'in_progress' },
        'build-web': { status: 'pending' },
        'build-api': { status: 'pending' },
      },
    }));

    const r = runHook(tmp, { session_id: 's2', cwd: tmp });
    assert.equal(r.status, 0);
    const payload = JSON.parse(r.stdout);
    const ctx = payload.hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('proj-test-001'), 'context 应含项目 ID');
    assert.ok(ctx.includes('进度'), 'context 应含进度概览');
    // SessionStart 内部会调用 maybeInferProgress 补齐 10 个 phase，
    // 故完成数 = 2（prd/wbs），总数 = 10。这里用 regex 兼容未来 phase 数量变化。
    assert.match(ctx, /2 \/ \d+/, 'context 应反映完成进度数字（X / Y 形式）');
    assert.ok(ctx.includes('/design'), 'context 应建议下一步命令');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('SessionStart 出错时仍能优雅退出（不阻塞会话）', () => {
  // 输入异常 JSON
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-context-error-'));
  try {
    const result = spawnSync(process.execPath, [HANDLER], {
      input: 'not-a-json',
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics'),
        DDT_PLUGIN_ROOT: ROOT },
      timeout: 5000,
    });
    assert.equal(result.status, 0, 'hook 必须以 0 退出，不阻塞会话');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
