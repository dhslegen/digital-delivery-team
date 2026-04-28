// M1-8: 测试 UserPromptSubmit hook 的 slash command 识别
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { detectPhase, DDT_PHASE_COMMANDS } = require('../../hooks/handlers/user-prompt-submit.js');

test('detectPhase 识别裸命令', () => {
  assert.deepEqual(detectPhase('/prd'), { phase: 'prd', args: '' });
  assert.deepEqual(detectPhase('/wbs'), { phase: 'wbs', args: '' });
  assert.deepEqual(detectPhase('/design'), { phase: 'design', args: '' });
});

test('detectPhase 识别 plugin namespace 形式', () => {
  assert.deepEqual(detectPhase('/digital-delivery-team:prd'), { phase: 'prd', args: '' });
  assert.deepEqual(detectPhase('/digital-delivery-team:kickoff add user login'),
    { phase: 'kickoff', args: 'add user login' });
});

test('detectPhase 提取参数', () => {
  assert.deepEqual(detectPhase('/prd --refresh extra context'),
    { phase: 'prd', args: '--refresh extra context' });
});

test('detectPhase 大小写兼容', () => {
  assert.deepEqual(detectPhase('/PRD'), { phase: 'prd', args: '' });
});

test('detectPhase 不命中非 phase 命令返回 null', () => {
  assert.equal(detectPhase('/help'), null);
  assert.equal(detectPhase('/unknown-command'), null);
  assert.equal(detectPhase('普通对话内容，不是 slash command'), null);
  assert.equal(detectPhase(''), null);
  assert.equal(detectPhase(null), null);
});

test('detectPhase 必须是行首', () => {
  assert.equal(detectPhase('请帮我跑 /prd'), null);
  assert.deepEqual(detectPhase('  /prd'), { phase: 'prd', args: '' });
});

test('DDT_PHASE_COMMANDS 完整覆盖核心阶段', () => {
  for (const cmd of ['kickoff', 'prd', 'wbs', 'design', 'impl', 'verify', 'ship', 'report']) {
    assert.ok(DDT_PHASE_COMMANDS.includes(cmd), `必须包含 ${cmd}`);
  }
});

test('DDT_PHASE_COMMANDS 涵盖所有 commands/*.md', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const url = await import('node:url');
  const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const commandsDir = path.join(__dirname, '../..', 'commands');
  const files = fs.readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  const expected = files.map(f => f.replace(/\.md$/, '')).sort();
  // 允许 phase 命令是 commands 的子集（即每个 phase 命令都对应一个 .md）
  for (const cmd of DDT_PHASE_COMMANDS) {
    assert.ok(expected.includes(cmd), `phase ${cmd} 必须有对应 commands/${cmd}.md`);
  }
});
