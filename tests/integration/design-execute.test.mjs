// W3: design-brief / design-execute 命令集成测试
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

const BRIEF_CMD   = join(ROOT, 'commands', 'design-brief.md');
const EXEC_CMD    = join(ROOT, 'commands', 'design-execute.md');

test('commands/design-brief.md 存在且 frontmatter 含 description + argument-hint', () => {
  assert.ok(existsSync(BRIEF_CMD), 'design-brief.md 必存在');
  const text = readFileSync(BRIEF_CMD, 'utf8');
  assert.match(text, /^---\ndescription:\s+/m, '必含 description frontmatter');
  assert.match(text, /^argument-hint:\s+/m,    '必含 argument-hint frontmatter');
  assert.match(text, /--refresh/,              'argument-hint 必含 --refresh');
  assert.match(text, /--visual-direction/,     'argument-hint 必含 --visual-direction');
});

test('commands/design-brief.md 集成 emit-phase + 决策门 + frontend.type 三态检查', () => {
  const text = readFileSync(BRIEF_CMD, 'utf8');
  assert.match(text, /emit-phase\.mjs"?\s+--phase design-brief --action start/, 'phase start 度量');
  assert.match(text, /emit-phase\.mjs"?\s+--phase design-brief --action end/,   'phase end 度量');
  assert.match(text, /emit-decision\.mjs"?\s+--phase design-brief/,             '决策门集成');
  assert.match(text, /get-frontend-type\.mjs/,                                  'PR-E frontend.type 三态检查');
  assert.match(text, /compile-design-brief\.mjs/,                               '调编译器');
  // 9 visual directions 全部出现
  for (const vd of ['brutally-minimal', 'editorial', 'industrial', 'luxury', 'playful', 'geometric', 'retro-futurist', 'soft-organic', 'maximalist']) {
    assert.match(text, new RegExp(vd), `argument-hint 必提及 ${vd}`);
  }
});

test('commands/design-execute.md 存在且 frontmatter 含 description + argument-hint', () => {
  assert.ok(existsSync(EXEC_CMD), 'design-execute.md 必存在');
  const text = readFileSync(EXEC_CMD, 'utf8');
  assert.match(text, /^---\ndescription:\s+/m);
  assert.match(text, /^argument-hint:\s+/m);
  assert.match(text, /--channel/,  'argument-hint 必含 --channel');
  assert.match(text, /--bundle/,   'argument-hint 必含 --bundle');
  assert.match(text, /--url/,      'argument-hint 必含 --url');
});

test('commands/design-execute.md 集成 emit-phase + 派生器 + 3 通道分支', () => {
  const text = readFileSync(EXEC_CMD, 'utf8');
  assert.match(text, /emit-phase\.mjs"?\s+--phase design-execute --action start/);
  assert.match(text, /emit-phase\.mjs"?\s+--phase design-execute --action end/);
  assert.match(text, /derive-channel-package\.mjs/);
  // 3 通道分支引导都必须有
  assert.match(text, /claude\.ai\/design/, '必含 Claude Design 引导');
  assert.match(text, /Figma Make|First Draft/, '必含 Figma 引导');
  assert.match(text, /v0\.dev/, '必含 v0 引导');
  // Lovable 已删除（v0.8 决策）
  assert.doesNotMatch(text, /lovable/i, 'design-execute 不应再提 lovable');
});

test('commands/design-execute.md URL 白名单校验（B4 防 shell 注入）', () => {
  const text = readFileSync(EXEC_CMD, 'utf8');
  assert.match(text, /URL.*grep -qE.*\^https\?/, 'URL 必走白名单 regex 校验');
  assert.match(text, /防 shell 注入/, '注释必明示防注入意图');
});

test('commands/import-design.md 已删除（W3 breaking change）', () => {
  const oldCmd = join(ROOT, 'commands', 'import-design.md');
  assert.ok(!existsSync(oldCmd), 'commands/import-design.md 必删除（v0.8 breaking）');
});

test('hooks DDT_PHASE_COMMANDS 含 design-brief / design-execute，不含 import-design', async () => {
  const { DDT_PHASE_COMMANDS } = await import('../../hooks/handlers/user-prompt-submit.js');
  assert.ok(DDT_PHASE_COMMANDS.includes('design-brief'),   'hook 必含 design-brief');
  assert.ok(DDT_PHASE_COMMANDS.includes('design-execute'), 'hook 必含 design-execute');
  assert.ok(!DDT_PHASE_COMMANDS.includes('import-design'), 'hook 不应含 import-design');
});

test('bin/manifest.mjs --check 通过（含新命令分类）', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'manifest.mjs'), '--check'], {
    cwd: ROOT, encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write(`stdout: ${r.stdout}\nstderr: ${r.stderr}\n`);
  }
  assert.equal(r.status, 0, 'manifest --check 必须通过');
});
