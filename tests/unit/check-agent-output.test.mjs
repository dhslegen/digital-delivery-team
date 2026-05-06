// v0.8.1 D12：agent 产出校验单元测试
//
// 背景：v0.8.0 main thread 在 product-agent 网络错误后静默 fallback 自写。
// check-agent-output.mjs 用于阻止此类降级——产出异常时返回非 0 退出码，
// 让 commands/*.md 写 blocker 让用户决策。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { checkAgentOutput } from '../../bin/check-agent-output.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'check-agent-output.mjs');

test('v0.8.1 D12: checkAgentOutput 文件不存在时 exit code 1', () => {
  const result = checkAgentOutput('/tmp/nonexistent-' + Date.now() + '.md');
  assert.equal(result.ok, false);
  assert.equal(result.code, 1);
  assert.match(result.reason, /不存在/);
});

test('v0.8.1 D12: checkAgentOutput 空文件 exit code 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-empty-'));
  try {
    const file = join(tmp, 'empty.md');
    writeFileSync(file, '');
    const result = checkAgentOutput(file);
    assert.equal(result.ok, false);
    assert.equal(result.code, 1);
    assert.match(result.reason, /空文件/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D12: checkAgentOutput 行数不足时 exit code 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-short-'));
  try {
    const file = join(tmp, 'short.md');
    writeFileSync(file, '# 只有 3 行\n\n标题没什么内容\n');
    const result = checkAgentOutput(file, { minLines: 50, name: 'test-agent' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 2);
    assert.match(result.reason, /< 期望 50/);
    assert.match(result.reason, /test-agent/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D12: checkAgentOutput 含字面占位 <persona> 时 exit code 3', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-placeholder-'));
  try {
    const file = join(tmp, 'with-placeholder.md');
    // 足够长（>50 行）但含字面占位
    const lines = Array(60).fill('正常文字').join('\n') + '\n用户：<persona>\n';
    writeFileSync(file, lines);
    const result = checkAgentOutput(file);
    assert.equal(result.ok, false);
    assert.equal(result.code, 3);
    assert.match(result.reason, /<persona>/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D12: checkAgentOutput 含 {{TOKEN}} 模板未替换时 exit code 3', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-token-'));
  try {
    const file = join(tmp, 'with-token.md');
    const lines = Array(60).fill('正常').join('\n') + '\n项目名：{{PROJECT_NAME}}\n';
    writeFileSync(file, lines);
    const result = checkAgentOutput(file);
    assert.equal(result.ok, false);
    assert.equal(result.code, 3);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D12: checkAgentOutput 真实充实产物 exit code 0', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-good-'));
  try {
    const file = join(tmp, 'good.md');
    // 真实样式：60 行实际内容，无占位
    const content = Array(60).fill(0).map((_, i) => `## 第 ${i + 1} 行实际内容描述`).join('\n');
    writeFileSync(file, content);
    const result = checkAgentOutput(file, { minLines: 50 });
    assert.equal(result.ok, true);
    assert.equal(result.code, 0);
    assert.equal(result.lineCount, 60);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('v0.8.1 D12: spawn check-agent-output.mjs 与 exit code 对应', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'd12-spawn-'));
  try {
    // 校验缺参数
    let r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
    assert.equal(r.status, 4, '缺 --file 应 exit 4');
    // 校验文件不存在
    r = spawnSync(process.execPath, [SCRIPT, '--file', '/tmp/missing-' + Date.now()], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    // 校验通过
    const file = join(tmp, 'good.md');
    writeFileSync(file, Array(80).fill('# 真实标题').join('\n'));
    r = spawnSync(process.execPath, [SCRIPT, '--file', file, '--min-lines', '50'], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /校验通过/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// 契约：commands/{prd,wbs,design}.md 必须调用 check-agent-output.mjs
test('v0.8.1 D12: commands/prd.md 必须含 check-agent-output 调用', async () => {
  const { readFileSync: rfs } = await import('node:fs');
  const text = rfs(join(ROOT, 'commands', 'prd.md'), 'utf8');
  assert.ok(text.includes('check-agent-output.mjs'),
    'prd.md 必须调用 check-agent-output.mjs（D12 — 防止 main thread 静默 fallback）');
  assert.ok(text.includes('blockers.md'),
    'prd.md 校验失败时必须写 docs/blockers.md（D12）');
});

test('v0.8.1 D12: commands/wbs.md 必须含 check-agent-output 调用', async () => {
  const { readFileSync: rfs } = await import('node:fs');
  const text = rfs(join(ROOT, 'commands', 'wbs.md'), 'utf8');
  assert.ok(text.includes('check-agent-output.mjs'), 'wbs.md 必须调用 check-agent-output.mjs');
});

test('v0.8.1 D12: commands/design.md 必须含 check-agent-output 调用', async () => {
  const { readFileSync: rfs } = await import('node:fs');
  const text = rfs(join(ROOT, 'commands', 'design.md'), 'utf8');
  assert.ok(text.includes('check-agent-output.mjs'), 'design.md 必须调用 check-agent-output.mjs');
});
