import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Exact gate logic extracted from commands/wbs.md Phase 1
const GATE = String.raw`
if [ -f docs/blockers.md ]; then
  unresolved=$(awk '/^- \*\*resolved_at\*\*: null$/' docs/blockers.md | wc -l)
  if [ "$unresolved" -gt 0 ]; then
    exit 2
  fi
fi
exit 0
`;

const BLOCKERS_UNRESOLVED = `## B-001 测试阻塞项\n\n- **title**: 单元测试门禁验证\n- **resolved_at**: null\n`;
const BLOCKERS_RESOLVED   = `## B-001 测试阻塞项\n\n- **title**: 单元测试门禁验证\n- **resolved_at**: 2026-04-24T00:00:00Z\n`;

test('blocker gate exits 2 when unresolved blockers exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddt-gate-'));
  try {
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'blockers.md'), BLOCKERS_UNRESOLVED);
    const result = spawnSync('bash', ['-c', GATE], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 2, 'gate must exit 2 when unresolved blockers exist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blocker gate exits 0 when all blockers are resolved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddt-gate-'));
  try {
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'blockers.md'), BLOCKERS_RESOLVED);
    const result = spawnSync('bash', ['-c', GATE], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, 'gate must exit 0 when all blockers are resolved');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('blocker gate exits 0 when docs/blockers.md does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ddt-gate-'));
  try {
    const result = spawnSync('bash', ['-c', GATE], { cwd: dir, encoding: 'utf8' });
    assert.equal(result.status, 0, 'gate must exit 0 when blockers.md is absent');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
