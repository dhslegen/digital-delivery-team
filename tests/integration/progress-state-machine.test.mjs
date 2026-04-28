// M4-7: progress.mjs 状态机端到端
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'progress.mjs');
const RESUME = join(ROOT, 'bin', 'resume.mjs');

function run(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args],
    { cwd, encoding: 'utf8' });
}

test('progress --init 初始化所有 10 个 phase', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-progress-'));
  try {
    const r = run(tmp, ['--init']);
    assert.equal(r.status, 0);
    const path = join(tmp, '.delivery', 'progress.json');
    assert.ok(existsSync(path));
    const progress = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(progress.schema_version, 1);
    const expectedPhases = ['prd', 'wbs', 'design', 'build-web', 'build-api',
      'test', 'review', 'fix', 'package', 'report'];
    for (const phase of expectedPhases) {
      assert.ok(progress.phases[phase], `phase ${phase} 必须存在`);
      assert.equal(progress.phases[phase].status, 'pending');
    }
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('progress --update 推进状态', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-progress-update-'));
  try {
    run(tmp, ['--init']);
    let r = run(tmp, ['--update', 'prd', 'in_progress']);
    assert.equal(r.status, 0);
    let progress = JSON.parse(readFileSync(join(tmp, '.delivery/progress.json'), 'utf8'));
    assert.equal(progress.phases.prd.status, 'in_progress');
    assert.ok(progress.phases.prd.started_at);
    assert.equal(progress.current_phase, 'prd');

    r = run(tmp, ['--update', 'prd', 'completed']);
    assert.equal(r.status, 0);
    progress = JSON.parse(readFileSync(join(tmp, '.delivery/progress.json'), 'utf8'));
    assert.equal(progress.phases.prd.status, 'completed');
    assert.ok(progress.phases.prd.completed_at);
    // current_phase 推进到下一个 pending phase（wbs）
    assert.equal(progress.current_phase, 'wbs');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('progress --infer 根据 docs/* 推断完成状态', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-progress-infer-'));
  try {
    mkdirSync(join(tmp, 'docs'), { recursive: true });
    writeFileSync(join(tmp, 'docs/prd.md'), '# PRD');
    writeFileSync(join(tmp, 'docs/wbs.md'), '# WBS');
    writeFileSync(join(tmp, 'docs/api-contract.yaml'), 'openapi: 3.0.0');

    const r = run(tmp, ['--infer']);
    assert.equal(r.status, 0);
    const progress = JSON.parse(readFileSync(join(tmp, '.delivery/progress.json'), 'utf8'));
    assert.equal(progress.phases.prd.status, 'completed');
    assert.equal(progress.phases.wbs.status, 'completed');
    assert.equal(progress.phases.design.status, 'completed');
    assert.equal(progress.phases['build-web'].status, 'pending');
    assert.equal(progress.current_phase, 'build-web');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('progress --update 拒绝无效 phase 与 status', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-progress-bad-'));
  try {
    run(tmp, ['--init']);
    const r1 = run(tmp, ['--update', 'invalid-phase', 'completed']);
    assert.equal(r1.status, 1);
    const r2 = run(tmp, ['--update', 'prd', 'invalid-status']);
    assert.equal(r2.status, 1);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resume.mjs 在无 progress 时友好退出', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-resume-empty-'));
  try {
    const r = spawnSync(process.execPath, [RESUME], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('progress.json 不存在'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('resume.mjs 输出阶段进度概览', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-resume-progress-'));
  try {
    run(tmp, ['--init']);
    run(tmp, ['--update', 'prd', 'completed']);
    run(tmp, ['--update', 'wbs', 'in_progress']);
    const r = spawnSync(process.execPath, [RESUME], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('已完成: 1'));
    assert.ok(r.stdout.includes('🔄 当前在 wbs'));
    assert.ok(r.stdout.includes('✅'));
    assert.ok(r.stdout.includes('🔄'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
