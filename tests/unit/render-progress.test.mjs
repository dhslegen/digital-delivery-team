// v0.9 A3：bin/render-progress.mjs 单元测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { renderProgress } from '../../bin/render-progress.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '../..', 'bin', 'render-progress.mjs');

function fakeProgress(overrides = {}) {
  return {
    schema_version: 1,
    project_id: 'proj-test-A3',
    last_activity_at: new Date().toISOString(),
    phases: {
      prd: { status: 'completed', completed_at: '2026-05-06T01:00:00Z' },
      wbs: { status: 'completed', completed_at: '2026-05-06T01:30:00Z' },
      design: { status: 'in_progress', started_at: new Date().toISOString() },
      'design-brief': { status: 'pending' },
      'design-execute': { status: 'pending' },
      'build-web': { status: 'pending' },
      'build-api': { status: 'pending' },
      test: { status: 'pending' },
      review: { status: 'pending' },
      fix: { status: 'pending' },
      package: { status: 'pending' },
      report: { status: 'pending' },
    },
    ...overrides,
  };
}

test('A3: renderProgress 含 ASCII 进度条 + 完成数 + 百分比', () => {
  const out = renderProgress(fakeProgress());
  assert.match(out, /\[█+/);                  // 进度条以 █ 开头（已完成 2 个）
  assert.match(out, /2\/12/);                 // 2 个完成 / 12 个 phase
  assert.match(out, /\d+%\)/);                // 百分比
});

test('A3: renderProgress 含短名行（design-brief → brief）', () => {
  const out = renderProgress(fakeProgress());
  assert.match(out, /brief/);
  assert.match(out, /b-web/);
  assert.match(out, /pkg/);
});

test('A3: renderProgress 含状态图标行（✅ / 🔄 / ⏸）', () => {
  const out = renderProgress(fakeProgress());
  assert.match(out, /✅/);  // completed
  assert.match(out, /🔄/);  // in_progress
  assert.match(out, /⏸/);   // pending
});

test('A3: renderProgress 当前 phase 高亮（↑ 当前: /name）', () => {
  const out = renderProgress(fakeProgress());
  assert.match(out, /↑/);
  assert.match(out, /当前: \/design/);
});

test('A3: renderProgress 全部完成时显示 🎉', () => {
  const allDone = fakeProgress({
    phases: Object.fromEntries(
      Object.keys(fakeProgress().phases).map(k => [k, { status: 'completed', completed_at: '2026-05-06T01:00:00Z' }])
    ),
  });
  const out = renderProgress(allDone);
  assert.match(out, /🎉/);
});

test('A3: renderProgress skipped 状态显示 ⤷ + "按规则跳过"', () => {
  const withSkipped = fakeProgress({
    phases: {
      ...fakeProgress().phases,
      'design-brief': { status: 'skipped', completed_at: '2026-05-06T02:00:00Z' },
    },
  });
  const out = renderProgress(withSkipped);
  assert.match(out, /⤷/);
  assert.match(out, /按规则跳过/);
});

test('A3: renderProgress duration_estimated 时加 ⚠️估算 标记', () => {
  const withEstimated = fakeProgress({
    phases: {
      ...fakeProgress().phases,
      prd: { status: 'completed', completed_at: '2026-05-06T01:00:00Z', duration_estimated: true },
    },
  });
  const out = renderProgress(withEstimated);
  assert.match(out, /⚠️估算/);
});

test('A3: renderProgress --no-bar 仅输出文本详细', () => {
  const out = renderProgress(fakeProgress(), { showBar: false });
  // 不含 ASCII 进度条
  assert.ok(!out.includes('[█'));
  assert.ok(!out.includes('当前: /'));
  // 仍含详细列表
  assert.match(out, /详细：/);
  assert.match(out, /✅ prd/);
});

test('A3: spawn render-progress.mjs --path 自定义文件', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-prog-'));
  try {
    const path = join(tmp, 'p.json');
    writeFileSync(path, JSON.stringify(fakeProgress()));
    const r = spawnSync(process.execPath, [SCRIPT, '--path', path], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /\[█+/);
    assert.match(r.stdout, /当前: \/design/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('A3: spawn render-progress.mjs 缺文件应 exit 1', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--path', '/tmp/no-such-file-' + Date.now() + '.json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /不存在/);
});
