// v0.9 A2-T1：bin/print-dry-run.mjs 单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderDryRun } from '../../bin/print-dry-run.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../..', 'bin', 'print-dry-run.mjs');

test('A2-T1: renderDryRun 输出 4 段固定结构', () => {
  const out = renderDryRun({
    phase: 'prd',
    inputs: ['project-brief.md'],
    outputs: ['docs/prd.md'],
    next: '/wbs',
  });
  assert.match(out, /## \/prd --dry-run/);
  assert.match(out, /📥 读取：/);
  assert.match(out, /📤 写入：/);
  assert.match(out, /📊 emit phase 事件：/);
  assert.match(out, /👉 下一步建议：/);
  assert.match(out, /\/wbs/);
});

test('A2-T1: 空 inputs/outputs 显示"（无）"', () => {
  const out = renderDryRun({ phase: 'doctor', inputs: [], outputs: [], next: null });
  // 必须有两个"（无）"——一个在 📥 一个在 📤
  const matches = out.match(/（无）/g) || [];
  assert.equal(matches.length, 2);
});

test('A2-T1: spawn 缺 --phase 应 exit 1', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /缺 --phase 参数/);
});

test('A2-T1: spawn 含 --phase + --inputs --outputs --next 应 exit 0', () => {
  const r = spawnSync(process.execPath, [SCRIPT,
    '--phase', 'design',
    '--inputs', 'docs/prd.md,docs/wbs.md',
    '--outputs', 'docs/arch.md,docs/api-contract.yaml',
    '--next', '/design-brief',
  ], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /design --dry-run/);
  assert.match(r.stdout, /docs\/prd\.md/);
  assert.match(r.stdout, /docs\/api-contract\.yaml/);
  assert.match(r.stdout, /\/design-brief/);
});

test('A2-T1: notes 字段在输出末尾出现', () => {
  const out = renderDryRun({
    phase: 'design-execute',
    inputs: ['docs/design-brief.md'],
    outputs: ['.ddt/design/claude-design/upload-package'],
    next: '/build-web',
    notes: ['等待用户回贴 bundle 后再 emit-phase end'],
  });
  assert.match(out, /📝 备注：/);
  assert.match(out, /等待用户回贴/);
});

test('A2-T1: 不实际读写文件（dry-run 关键不变量）', () => {
  // 调 helper 时即使 inputs 含不存在的路径也不应抛错或读
  const out = renderDryRun({
    phase: 'prd',
    inputs: ['/tmp/definitely-does-not-exist-' + Date.now() + '.md'],
    outputs: ['/tmp/also-does-not-exist.md'],
    next: '/wbs',
  });
  // 仅验证 helper 返回字符串，不抛错
  assert.ok(typeof out === 'string');
  assert.ok(out.length > 0);
});
