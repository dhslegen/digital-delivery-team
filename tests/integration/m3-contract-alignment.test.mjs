// H6: bin/check-contract-alignment.mjs 集成测试
//   契约对齐检查是 /import-design Phase 4 与 /build-* VERIFY phase 的硬门禁，
//   缺测试保护时脚本逻辑漂移会让违规绕过。本测试覆盖 5 种典型场景。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin/check-contract-alignment.mjs');

function run(cwd, target) {
  return spawnSync(process.execPath, [SCRIPT, target || 'web/'],
    { cwd, encoding: 'utf8' });
}

test('H6.1 目标目录不存在时 exit 0（首次 import 前的容错）', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-empty-'));
  try {
    const r = run(tmp, 'web/');
    assert.equal(r.status, 0, '不存在的目录应视为"无可检查内容"');
    assert.match(r.stderr || '', /⚠️ 目标目录不存在/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.2 干净目录（无禁用模式）exit 0', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-clean-'));
  try {
    mkdirSync(join(tmp, 'web/src/components'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/components/Button.tsx'),
      `import { useState } from 'react';\nexport function Button() { return <button>OK</button>; }\n`);
    const r = run(tmp);
    assert.equal(r.status, 0, `干净代码应通过：\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /✅ 未发现禁用模式/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.3 含 supabase mock client（lovable 残留）→ exit 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-supabase-'));
  try {
    mkdirSync(join(tmp, 'web/src'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/api.ts'),
      `const supabase = createClient('https://abc-123.supabase.co', 'key');\n`);
    const r = run(tmp);
    assert.equal(r.status, 1, '应阻断 supabase mock');
    assert.match(r.stdout, /❌ 发现违规/);
    assert.match(r.stdout, /lovable 残留/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.4 含 @supabase/supabase-js import → exit 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-supabase-pkg-'));
  try {
    mkdirSync(join(tmp, 'web/src'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/db.ts'),
      `import { createClient } from '@supabase/supabase-js';\n`);
    const r = run(tmp);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /Supabase JS SDK/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.5 含 @v0/sdk import → exit 1', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-v0-sdk-'));
  try {
    mkdirSync(join(tmp, 'web/src'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/v0.ts'),
      `import { v0Client } from '@v0/sdk';\n`);
    const r = run(tmp);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /v0 SDK/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.6 加载 tech-stack.json 时输出 preset 名', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-stack-'));
  try {
    mkdirSync(join(tmp, '.ddt'), { recursive: true });
    writeFileSync(join(tmp, '.ddt/tech-stack.json'),
      JSON.stringify({ preset: 'node-modern', schema_version: 1 }));
    mkdirSync(join(tmp, 'web/src'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/x.ts'), `export const x = 1;\n`);
    const r = run(tmp);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /tech-stack\.json 已加载.*preset: node-modern/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('H6.7 跳过 node_modules / dist / 隐藏目录', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-h6-skip-'));
  try {
    // 在 node_modules 里塞 supabase 残留 — 不应被扫到
    mkdirSync(join(tmp, 'web/node_modules/some-pkg'), { recursive: true });
    writeFileSync(join(tmp, 'web/node_modules/some-pkg/i.ts'),
      `import x from '@supabase/supabase-js';\n`);
    // 同样在 dist
    mkdirSync(join(tmp, 'web/dist'), { recursive: true });
    writeFileSync(join(tmp, 'web/dist/bundle.js'),
      `createClient('https://bad.supabase.co', 'k');\n`);
    // 主代码干净
    mkdirSync(join(tmp, 'web/src'), { recursive: true });
    writeFileSync(join(tmp, 'web/src/clean.ts'), `export const ok = true;\n`);

    const r = run(tmp);
    assert.equal(r.status, 0,
      `node_modules / dist 内的违规不应被扫到：\n${r.stdout}\n${r.stderr}`);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
