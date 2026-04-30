// M6.4: 6-phase 范式重写 build-api/build-web + 去 subagent 黑盒 + skill 替代 agent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function read(rel) { return readFileSync(join(ROOT, rel), 'utf8'); }

test('backend-agent / frontend-agent 已删除（M6.4 转 skill）', () => {
  assert.ok(!existsSync(join(ROOT, 'agents/backend-agent.md')),
    'backend-agent.md 应已删除（v0.7.0 改为 main thread + skill 模式）');
  assert.ok(!existsSync(join(ROOT, 'agents/frontend-agent.md')),
    'frontend-agent.md 应已删除');
});

test('backend-development / frontend-development skill 已建立', () => {
  for (const skill of ['backend-development', 'frontend-development']) {
    assert.ok(existsSync(join(ROOT, 'skills', skill, 'SKILL.md')),
      `${skill} skill 必须存在`);
    const text = read(`skills/${skill}/SKILL.md`);
    assert.match(text, /^name:\s+\w+-development$/m, '必须有 frontmatter name');
    assert.match(text, /^origin:\s+DDT$/m, '必须有 origin');
    assert.ok(text.includes('main thread'),
      `${skill} 必须明确 main thread 模式`);
    assert.ok(text.includes('替代') && text.includes('subagent'),
      `${skill} 必须说明替代旧 subagent`);
  }
});

test('validation-loop skill 含 quick / standard / strict 三模式', () => {
  const text = read('skills/validation-loop/SKILL.md');
  assert.ok(text.includes('Quick Mode'));
  assert.ok(text.includes('Standard Mode'));
  assert.ok(text.includes('Strict Mode'));
  assert.ok(text.includes('包管理器'),
    '必须能检测包管理器');
  assert.ok(text.includes('AskUserQuestion'),
    '失败时必须用 AskUserQuestion 让用户决策');
});

test('checkpoint-commit skill 含 commit message 规范 + checkpoints.log', () => {
  const text = read('skills/checkpoint-commit/SKILL.md');
  assert.ok(text.includes('Checkpoint-Phase'));
  assert.ok(text.includes('Checkpoint-Step'));
  assert.ok(text.includes('Checkpoint-Validation'));
  assert.ok(text.includes('.ddt/checkpoints.log'));
  assert.ok(text.includes('git revert') || text.includes('回滚'));
});

test('build-api.md 含 6-phase 结构 + 不再派发 subagent', () => {
  const text = read('commands/build-api.md');
  for (const phase of [
    'EXPLORE', 'PLAN', 'APPROVE', 'IMPLEMENT', 'VERIFY', 'SUMMARY',
  ]) {
    assert.ok(text.includes(phase), `build-api 必须含 ${phase} phase`);
  }
  // 不再派发 subagent
  assert.ok(!text.includes('使用 Task 工具派发'),
    'build-api 必须不再用 Task 派发 backend-agent');
  // 引用 skills
  assert.ok(text.includes('skills/backend-development'));
  assert.ok(text.includes('skills/validation-loop'));
  assert.ok(text.includes('skills/checkpoint-commit'));
  // --module 支持
  assert.ok(text.includes('--module'),
    'build-api 必须支持 --module 分块');
});

test('build-web.md 含 6-phase 结构 + 不再派发 subagent', () => {
  const text = read('commands/build-web.md');
  for (const phase of ['EXPLORE', 'PLAN', 'APPROVE', 'IMPLEMENT', 'VERIFY', 'SUMMARY']) {
    assert.ok(text.includes(phase));
  }
  assert.ok(!text.includes('使用 Task 工具派发'));
  assert.ok(text.includes('skills/frontend-development'));
  assert.ok(text.includes('skills/ai-native-design'));
  assert.ok(text.includes('--module'));
});

test('impl.md 改串行 + 无并行派发', () => {
  const text = read('commands/impl.md');
  assert.ok(text.includes('串行'),
    'impl.md 必须明确串行执行');
  assert.ok(!text.includes('同一条消息') || text.includes('M6.4 重大变更'),
    'impl.md 不再要求"同一条消息内并行派发"（除非作为 v0.6.x 历史说明）');
  assert.ok(text.includes('/build-api'));
  assert.ok(text.includes('/build-web'));
});

test('manifest --check 仍通过（agent 减少 + skill 增加）', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath,
    [join(ROOT, 'bin/manifest.mjs'), '--check'],
    { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, `manifest --check failed: ${r.stderr}`);
});

test('agents 总数 = 9（v0.7 8 个 + v0.8 design-brief-agent）', () => {
  const fs = require('node:fs');
  const agents = fs.readdirSync(join(ROOT, 'agents')).filter(f => f.endsWith('.md'));
  assert.equal(agents.length, 9,
    `agents 应为 9 个（v0.7 8 个 + v0.8 design-brief-agent），实际 ${agents.length}: ${agents.join(', ')}`);
  assert.ok(agents.includes('design-brief-agent.md'),
    'v0.8 W6 应含 design-brief-agent');
});

test('skills 总数 ≥ 9（含 4 个 M6.4 新 skill）', () => {
  const fs = require('node:fs');
  const skills = fs.readdirSync(join(ROOT, 'skills'))
    .filter(d => fs.statSync(join(ROOT, 'skills', d)).isDirectory());
  assert.ok(skills.length >= 9,
    `skills 应 ≥ 9 个，实际 ${skills.length}`);
  for (const required of ['backend-development', 'frontend-development',
    'validation-loop', 'checkpoint-commit']) {
    assert.ok(skills.includes(required), `必须含 ${required} skill`);
  }
});

// 让 require 可用
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
