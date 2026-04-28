// M3-9: 验证 architect/frontend/backend agent 与 import-design 命令、ai-native-design skill 的 M3 改动
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8');
}

test('architect-agent 必读 .delivery/tech-stack.json', () => {
  const text = read('agents/architect-agent.md');
  assert.ok(text.includes('.delivery/tech-stack.json'),
    'architect-agent 必读列表必须包含 tech-stack.json');
  assert.ok(text.includes('M3 技术栈刚性约束'),
    'architect-agent Hard Requirements 必须含 M3 刚性约束条款');
});

test('frontend-agent 必读 tech-stack.json + ai-native-design skill', () => {
  const text = read('agents/frontend-agent.md');
  assert.ok(text.includes('.delivery/tech-stack.json'));
  assert.ok(text.includes('skills/ai-native-design'));
  assert.ok(text.includes('M3 技术栈刚性约束'));
  assert.ok(text.includes('AI-native UI 工作流'));
});

test('backend-agent 必读 tech-stack.json', () => {
  const text = read('agents/backend-agent.md');
  assert.ok(text.includes('.delivery/tech-stack.json'));
  assert.ok(text.includes('M3 技术栈刚性约束'));
});

test('design.md 调用 resolve-tech-stack.mjs --write', () => {
  const text = read('commands/design.md');
  assert.ok(text.includes('resolve-tech-stack.mjs'),
    'design.md 必须调用 resolve-tech-stack.mjs');
  assert.ok(text.includes('--write'),
    'design.md 必须传 --write 参数以持久化结果');
  assert.ok(text.includes('--preset'),
    'design.md argument-hint 应支持 --preset');
});

test('kickoff.md 透传 --preset 给 /design', () => {
  const text = read('commands/kickoff.md');
  assert.ok(text.includes('--preset'),
    'kickoff.md argument-hint 应支持 --preset');
  assert.ok(text.includes('/design $ARGUMENTS'),
    'kickoff.md 必须把 --preset 透传给 /design');
});

test('import-design.md 包含 4 个通道', () => {
  const text = read('commands/import-design.md');
  for (const channel of ['figma', 'v0', 'lovable', 'claude-design']) {
    assert.ok(text.includes(channel), `import-design 必须支持 ${channel} 通道`);
  }
  assert.ok(text.includes('check-contract-alignment.mjs'),
    'import-design 应在 Phase 4 调用契约对齐检查');
});

test('ai-native-design skill 已建立且符合 frontmatter', () => {
  const skillPath = 'skills/ai-native-design/SKILL.md';
  assert.ok(existsSync(join(ROOT, skillPath)), 'ai-native-design SKILL.md 必须存在');
  const text = read(skillPath);
  assert.ok(text.match(/^name:\s*ai-native-design$/m), 'name 字段错误');
  assert.ok(text.match(/^origin:\s*DDT$/m), 'origin 字段错误');
  for (const channel of ['claude-design', 'figma', 'v0', 'lovable']) {
    assert.ok(text.includes(channel), `skill 必须详述 ${channel} 通道`);
  }
});

test('project-brief 模板含技术栈预设字段', () => {
  const text = read('templates/project-brief.template.md');
  assert.ok(text.includes('技术栈预设'),
    '模板必须有"技术栈预设"字段');
  assert.ok(text.includes('java-modern'),
    '模板默认值应为 java-modern');
  assert.ok(text.includes('AI-native UI'),
    '模板必须有 AI-native UI 字段');
});

test('tech-stack-presets.yaml 与 ai_design_options 一致', () => {
  const text = read('templates/tech-stack-presets.yaml');
  // 提取 ai_design_options 下的所有选项
  const aiOptionsSection = text.split('ai_design_options:')[1] || '';
  for (const opt of ['claude-design', 'figma', 'v0', 'lovable']) {
    assert.ok(aiOptionsSection.includes(`${opt}:`),
      `ai_design_options 缺 ${opt}`);
    assert.ok(aiOptionsSection.includes('skill: ai-native-design'),
      `${opt} 必须引用 ai-native-design skill`);
  }
});
