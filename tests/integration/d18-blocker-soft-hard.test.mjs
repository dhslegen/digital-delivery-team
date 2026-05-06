// v0.9 D18：check-blockers.sh 区分硬 blocker（阻塞）vs 软 blocker（警告）
//
// 实战 ddt-team-admin-v0.8.1 暴露：design-brief-agent 写的"软 blocker"
// （`- [BLOCK-DESIGN-BRIEF-001] <描述>` 列表）不被 check-blockers.sh 识别。
// 用户感知是"check-blockers 永远 pass，软 blocker 静默"。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'check-blockers.sh');

function runCheckBlockers(cwd, args = []) {
  return spawnSync(SCRIPT, args, { cwd, encoding: 'utf8' });
}

function setup(blockersContent) {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-d18-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  if (blockersContent !== null) {
    writeFileSync(join(tmp, 'docs', 'blockers.md'), blockersContent);
  }
  return tmp;
}

test('D18: 无 docs/blockers.md 时 exit 0', () => {
  const tmp = setup(null);
  try {
    const r = runCheckBlockers(tmp);
    assert.equal(r.status, 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: 仅含硬 blocker（resolved_at: null）时 exit 2', () => {
  const tmp = setup(`# Blockers

## BL-20260506-01

- **id**: BL-20260506-01
- **raised_by**: product-agent
- **issue**: 测试硬 blocker
- **resolved_at**: null
- **resolved_by**: null
`);
  try {
    const r = runCheckBlockers(tmp);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /硬】阻塞/);
    assert.match(r.stdout, /BL-20260506-01/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: 仅含软 blocker（[BLOCK-XXX]）默认模式不阻塞 exit 0', () => {
  const tmp = setup(`# Blockers

## design-brief-agent

- [BLOCK-DESIGN-BRIEF-001] PRD 未明示 FCP/LCP，agent 推断
- [BLOCK-DESIGN-BRIEF-002] api-contract enum 漏 RATE_LIMITED
`);
  try {
    const r = runCheckBlockers(tmp);
    assert.equal(r.status, 0, '默认模式仅检查硬 blocker，软 blocker 不阻塞');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: --soft 模式报告软 blocker（不阻塞 exit 0）', () => {
  const tmp = setup(`# Blockers

## design-brief-agent

- [BLOCK-DESIGN-BRIEF-001] PRD 未明示 FCP/LCP
- [BLOCK-DESIGN-BRIEF-002] api-contract enum 漏 RATE_LIMITED
`);
  try {
    const r = runCheckBlockers(tmp, ['--soft']);
    assert.equal(r.status, 0, '--soft 不阻塞');
    assert.match(r.stdout, /软】blocker/);
    assert.match(r.stdout, /BLOCK-DESIGN-BRIEF-001/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: --strict 模式让软 blocker 也阻塞 exit 2', () => {
  const tmp = setup(`- [BLOCK-XXX-001] 一条软提醒
`);
  try {
    const r = runCheckBlockers(tmp, ['--strict']);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /strict/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: 硬 + 软 同时存在时硬 blocker 优先（exit 2）', () => {
  const tmp = setup(`# Blockers

## BL-001

- **resolved_at**: null

## design-brief-agent

- [BLOCK-DESIGN-BRIEF-001] 软提醒
`);
  try {
    const r = runCheckBlockers(tmp, ['--soft']);
    assert.equal(r.status, 2, '硬 blocker 优先阻塞，软 blocker 检查不到');
    assert.match(r.stdout, /硬】阻塞/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('D18: blockers.template.md 含两类 blocker 格式说明', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(join(ROOT, 'templates', 'blockers.template.md'), 'utf8');
  assert.match(text, /硬 blocker/, '模板必须含"硬 blocker"说明');
  assert.match(text, /软 blocker/, '模板必须含"软 blocker"说明');
  assert.match(text, /\[BLOCK-/, '模板必须含 [BLOCK- 软 blocker 格式示例');
  assert.match(text, /resolved_at.*null/, '模板必须含 resolved_at: null 硬 blocker 格式');
});
