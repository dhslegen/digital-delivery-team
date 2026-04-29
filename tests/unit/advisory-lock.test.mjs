// M4-7: advisory lock 单测
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const require = createRequire(import.meta.url);
const lockMod = require(join(ROOT, 'hooks/handlers/lib/advisory-lock.js'));

test('isProtected 仅对白名单文件返回 true', () => {
  assert.equal(lockMod.isProtected('docs/api-contract.yaml'), true);
  assert.equal(lockMod.isProtected('docs/prd.md'), true);
  assert.equal(lockMod.isProtected('.ddt/tech-stack.json'), true);
  assert.equal(lockMod.isProtected('web/components/Foo.tsx'), false);
  assert.equal(lockMod.isProtected('server/src/app.js'), false);
  assert.equal(lockMod.isProtected(''), false);
  assert.equal(lockMod.isProtected(null), false);
});

test('tryAcquire 同 session 重复抢锁不冲突', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lock-same-'));
  try {
    const r1 = lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-A');
    assert.equal(r1.conflict, false);
    const r2 = lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-A');
    assert.equal(r2.conflict, false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('tryAcquire 不同 session 同 artifact 冲突 warn', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lock-conflict-'));
  try {
    lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-A');
    const r2 = lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-B');
    assert.equal(r2.conflict, true);
    assert.ok(r2.warning.includes('正被另一会话编辑'));
    assert.ok(r2.warning.includes('sess-A'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('tryAcquire 非白名单文件直接返回不冲突', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lock-skip-'));
  try {
    const r = lockMod.tryAcquire(tmp, 'web/components/Random.tsx', 'sess-X');
    assert.equal(r.conflict, false);
    assert.equal(r.warning, '');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('isStale 检测过期 lock', () => {
  const fresh = { acquired_at: new Date().toISOString() };
  const old = { acquired_at: new Date(Date.now() - 31 * 60 * 1000).toISOString() };
  assert.equal(lockMod.isStale(fresh), false);
  assert.equal(lockMod.isStale(old), true);
  assert.equal(lockMod.isStale(null), true);
  assert.equal(lockMod.isStale({ acquired_at: 'bogus' }), true);
});

test('releaseSessionLocks 清理本会话锁', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-lock-release-'));
  try {
    lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-A');
    lockMod.tryAcquire(tmp, 'docs/prd.md', 'sess-A');
    lockMod.releaseSessionLocks(tmp, 'sess-A');
    // 释放后另一 session 应能直接抢锁
    const r = lockMod.tryAcquire(tmp, 'docs/api-contract.yaml', 'sess-B');
    assert.equal(r.conflict, false);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('mapToProgressPhase 编排命令返回 null', () => {
  const { mapToProgressPhase } = require(join(ROOT, 'hooks/handlers/user-prompt-submit.js'));
  assert.equal(mapToProgressPhase('kickoff'), null);
  assert.equal(mapToProgressPhase('impl'), null);
  assert.equal(mapToProgressPhase('verify'), null);
  assert.equal(mapToProgressPhase('ship'), null);
  assert.equal(mapToProgressPhase('prd'), 'prd');
  assert.equal(mapToProgressPhase('design'), 'design');
  assert.equal(mapToProgressPhase('fix'), 'fix');
});
