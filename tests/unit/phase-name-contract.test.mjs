// W7.5 R1：phase 名称契约测试
//
// 背景：v0.8 W3 引入 design-brief / design-execute 两个新 phase 命令，
//   但 bin/emit-phase.mjs 与 bin/emit-decision.mjs 的 VALID_PHASES 白名单
//   仍硬编码 v0.7 的 10 个 phase，导致 commands 内 emit-phase 静默 exit 1，
//   v0.8 度量链事实上断了 W3-W7 整整 5 周（4 个独立 audit agent 在 W7 review 时一致发现）。
//
// 契约：
//   1. bin/emit-phase.mjs VALID_PHASES 必须包含 hook DDT_PHASE_COMMANDS 的全部业务级 phase
//   2. bin/emit-decision.mjs VALID_PHASES 必须包含同样的集合
//   3. 实跑 design-brief / design-execute 应 exit 0（防回归）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const require = createRequire(import.meta.url);
const { DDT_PHASE_COMMANDS } = require(join(repoRoot, 'hooks/handlers/user-prompt-submit.js'));

// 编排级命令在 hook 抓但通常不在 emit-phase 业务级使用；列出来用于过滤
const ORCHESTRATORS = new Set(['kickoff', 'impl', 'verify', 'ship']);

// 从源码 regex 抽取 VALID_PHASES（避免改源码 export 模块面）
function extractValidPhases(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const m = src.match(/const\s+VALID_PHASES\s*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error(`未在 ${filePath} 找到 VALID_PHASES 定义`);
  // 抽出所有引号字符串
  return new Set([...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]));
}

test('R1: emit-phase VALID_PHASES 必须含 v0.8 W3 新阶段', () => {
  const set = extractValidPhases(join(repoRoot, 'bin/emit-phase.mjs'));
  assert.ok(set.has('design-brief'), 'emit-phase 必须接受 design-brief（W3 v0.8）');
  assert.ok(set.has('design-execute'), 'emit-phase 必须接受 design-execute（W3 v0.8）');
});

test('R1: emit-decision VALID_PHASES 必须含 v0.8 W3 新阶段', () => {
  const set = extractValidPhases(join(repoRoot, 'bin/emit-decision.mjs'));
  assert.ok(set.has('design-brief'), 'emit-decision 必须接受 design-brief（W3 v0.8）');
  assert.ok(set.has('design-execute'), 'emit-decision 必须接受 design-execute（W3 v0.8）');
});

test('R1: hook DDT_PHASE_COMMANDS 与 emit-phase VALID_PHASES 对齐（业务级子集）', () => {
  const validPhases = extractValidPhases(join(repoRoot, 'bin/emit-phase.mjs'));
  for (const cmd of DDT_PHASE_COMMANDS) {
    assert.ok(validPhases.has(cmd),
      `hook 识别 /${cmd} 但 emit-phase 不接受——commands/${cmd}.md 内 emit-phase 会静默 exit 1`);
  }
});

test('R1: hook DDT_PHASE_COMMANDS 与 emit-decision VALID_PHASES 对齐（业务级子集）', () => {
  const validPhases = extractValidPhases(join(repoRoot, 'bin/emit-decision.mjs'));
  for (const cmd of DDT_PHASE_COMMANDS) {
    assert.ok(validPhases.has(cmd),
      `hook 识别 /${cmd} 但 emit-decision 不接受——commands/${cmd}.md 决策门会静默失败`);
  }
});

test('R1 回归：spawn emit-phase --phase design-brief --action start 应 exit 0', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r1-phase-'));
  try {
    mkdirSync(join(sandbox, '.ddt'), { recursive: true });
    writeFileSync(join(sandbox, '.ddt', 'project-id'), 'r1-contract');
    const res = spawnSync(process.execPath,
      [join(repoRoot, 'bin/emit-phase.mjs'), '--phase', 'design-brief', '--action', 'start'],
      { encoding: 'utf8', cwd: sandbox, env: { ...process.env, DDT_METRICS_DIR: sandbox } });
    assert.equal(res.status, 0,
      `emit-phase 应 exit 0，实际 ${res.status}；stderr: ${res.stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R1 回归：spawn emit-phase --phase design-execute --action end 应 exit 0', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r1-phase-'));
  try {
    mkdirSync(join(sandbox, '.ddt'), { recursive: true });
    writeFileSync(join(sandbox, '.ddt', 'project-id'), 'r1-contract');
    // 先发 start，再发 end（emit-phase end 需要找到 pending start）
    spawnSync(process.execPath,
      [join(repoRoot, 'bin/emit-phase.mjs'), '--phase', 'design-execute', '--action', 'start'],
      { encoding: 'utf8', cwd: sandbox, env: { ...process.env, DDT_METRICS_DIR: sandbox } });
    const res = spawnSync(process.execPath,
      [join(repoRoot, 'bin/emit-phase.mjs'), '--phase', 'design-execute', '--action', 'end'],
      { encoding: 'utf8', cwd: sandbox, env: { ...process.env, DDT_METRICS_DIR: sandbox } });
    assert.equal(res.status, 0,
      `emit-phase end 应 exit 0，实际 ${res.status}；stderr: ${res.stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R1 回归：spawn emit-decision --phase design-brief --action point 应 exit 0', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r1-decision-'));
  try {
    mkdirSync(join(sandbox, '.ddt'), { recursive: true });
    writeFileSync(join(sandbox, '.ddt', 'project-id'), 'r1-contract');
    const res = spawnSync(process.execPath, [
      join(repoRoot, 'bin/emit-decision.mjs'),
      '--phase', 'design-brief',
      '--action', 'point',
      '--options', 'accept|modify|add|regenerate',
    ], { encoding: 'utf8', cwd: sandbox, env: { ...process.env, DDT_METRICS_DIR: sandbox } });
    assert.equal(res.status, 0,
      `emit-decision 应 exit 0，实际 ${res.status}；stderr: ${res.stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R1 回归：spawn emit-decision --phase design-execute --action resolved --user-action accept 应 exit 0', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'ddt-r1-decision-'));
  try {
    mkdirSync(join(sandbox, '.ddt'), { recursive: true });
    writeFileSync(join(sandbox, '.ddt', 'project-id'), 'r1-contract');
    const res = spawnSync(process.execPath, [
      join(repoRoot, 'bin/emit-decision.mjs'),
      '--phase', 'design-execute',
      '--action', 'resolved',
      '--user-action', 'accept',
    ], { encoding: 'utf8', cwd: sandbox, env: { ...process.env, DDT_METRICS_DIR: sandbox } });
    assert.equal(res.status, 0,
      `emit-decision resolved 应 exit 0，实际 ${res.status}；stderr: ${res.stderr}`);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('R1: emit-phase 对未知 phase 仍 exit 1（保持白名单严格性）', () => {
  const res = spawnSync(process.execPath,
    [join(repoRoot, 'bin/emit-phase.mjs'), '--phase', 'totally-fake-phase', '--action', 'start'],
    { encoding: 'utf8' });
  assert.equal(res.status, 1, '未知 phase 必须 exit 1，否则白名单形同虚设');
  assert.match(res.stderr, /必须是/, '错误信息应列出合法 phase');
});
