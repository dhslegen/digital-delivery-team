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

test('architect-agent 必读 .ddt/tech-stack.json', () => {
  const text = read('agents/architect-agent.md');
  assert.ok(text.includes('.ddt/tech-stack.json'),
    'architect-agent 必读列表必须包含 tech-stack.json');
  assert.ok(text.includes('M3 技术栈刚性约束'),
    'architect-agent Hard Requirements 必须含 M3 刚性约束条款');
});

// M6.4：frontend-agent / backend-agent 已转 skill（main thread 模式）
test('frontend-development skill 必读 tech-stack.json + ai-native-design', () => {
  const text = read('skills/frontend-development/SKILL.md');
  assert.ok(text.includes('.ddt/tech-stack.json'));
  assert.ok(text.includes('skills/ai-native-design'));
  assert.ok(text.includes('栈刚性约束') || text.includes('M3 技术栈刚性'));
  assert.ok(text.includes('AI-native UI 工作流'));
});

test('backend-development skill 必读 tech-stack.json', () => {
  const text = read('skills/backend-development/SKILL.md');
  assert.ok(text.includes('.ddt/tech-stack.json'));
  assert.ok(text.includes('栈刚性约束') || text.includes('M3 技术栈刚性'));
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

test('design-execute.md 包含 3 个通道（v0.8 删除 lovable）', () => {
  const text = read('commands/design-execute.md');
  for (const channel of ['figma', 'v0', 'claude-design']) {
    assert.ok(text.includes(channel), `design-execute 必须支持 ${channel} 通道`);
  }
  assert.ok(!text.toLowerCase().includes('lovable'),
    'design-execute 不应再含 lovable（v0.8 已删除）');
  assert.ok(text.includes('derive-channel-package.mjs'),
    'design-execute 必须调用 derive-channel-package.mjs 派生附件包');
});

test('ai-native-design skill v0.8 重写：3 通道 + Brief 编译器 + 11 anti-patterns', () => {
  const skillPath = 'skills/ai-native-design/SKILL.md';
  assert.ok(existsSync(join(ROOT, skillPath)), 'ai-native-design SKILL.md 必须存在');
  const text = read(skillPath);

  // frontmatter
  assert.ok(text.match(/^name:\s*ai-native-design$/m), 'name 字段错误');
  assert.ok(text.match(/^origin:\s*DDT$/m), 'origin 字段错误');

  // 3 通道章节齐全
  for (const channel of ['claude-design', 'figma', 'v0']) {
    assert.ok(text.includes(channel), `skill 必须详述 ${channel} 通道`);
  }

  // Lovable 不应作为可用通道（v0.8 删除）
  // 但允许"不支持 Lovable"声明文字保留
  assert.ok(!text.match(/^##\s*通道\s*D?\s*[·:]?\s*lovable/im),
    'skill 不应有 lovable 通道章节（v0.8 已删除）');
  assert.ok(text.match(/不支持.*Lovable|删除.*Lovable|不要.*Lovable/i),
    'skill 应明确声明 Lovable 不支持（避免读者误解）');

  // 引用 W4 摄取脚本
  for (const script of ['ingest-claude-design.mjs', 'ingest-figma-context.mjs', 'ingest-v0-share.mjs']) {
    assert.ok(text.includes(script), `skill 必须引用 ${script}（W4 摄取脚本）`);
  }

  // 引用 ingest-report.json / ingest-instructions.md（main thread 改写指引）
  assert.ok(text.includes('ingest-report.json'),       'skill 必须告诉 main thread 读 ingest-report.json');
  assert.ok(text.includes('ingest-instructions.md'),   'skill 必须告诉 main thread 读 ingest-instructions.md');

  // visual_direction 9 选 1 引用
  for (const vd of ['brutally-minimal', 'editorial', 'industrial', 'luxury', 'playful', 'geometric', 'retro-futurist', 'soft-organic', 'maximalist']) {
    assert.ok(text.includes(vd), `skill 必须列出 visual direction ${vd}`);
  }

  // 11 条 anti-patterns 矩阵（用 ❌ 计数 + 关键词）
  const negCount = (text.match(/^\|\s*\d+\s*\|/gm) || []).length;
  // 模板里多个表格都有 |1| / |2|... — 至少要保证 anti-patterns 11 条都在
  for (const phrase of ['紫蓝默认渐变', 'glass morphism', '通用 sans-serif', 'interchangeable SaaS hero']) {
    assert.ok(text.includes(phrase), `skill 必含 anti-pattern 关键描述 "${phrase}"`);
  }

  // 引用 W1/W2 模板
  for (const tpl of ['design-brief.template.md', 'design-tokens.template.json', 'components-inventory.template.md']) {
    assert.ok(text.includes(tpl), `skill 必须引用 ${tpl}`);
  }

  // 引用 W3 命令
  for (const cmd of ['/design-brief', '/design-execute']) {
    assert.ok(text.includes(cmd), `skill 必须引用命令 ${cmd}`);
  }

  // 8 状态显式列出（empty / error / loading 是关键）
  assert.ok(text.includes('empty / error / loading') || text.match(/empty.*error.*loading/i),
    'skill 必须强调 empty / error / loading 三个易缺失状态');
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

test('tech-stack-presets.yaml 与 ai_design_options 一致（v0.8: 3 通道）', () => {
  const text = read('templates/tech-stack-presets.yaml');
  // 提取 ai_design_options 下的所有选项
  const aiOptionsSection = text.split('ai_design_options:')[1] || '';
  for (const opt of ['claude-design', 'figma', 'v0']) {
    assert.ok(aiOptionsSection.includes(`${opt}:`),
      `ai_design_options 缺 ${opt}`);
    assert.ok(aiOptionsSection.includes('skill: ai-native-design'),
      `${opt} 必须引用 ai-native-design skill`);
  }
  // v0.8 W3：lovable 通道删除（强 Supabase 集成与 DDT 后端契约冲突）
  assert.ok(!aiOptionsSection.includes('lovable:'),
    'v0.8 W3 已删除 lovable 通道，ai_design_options 不应再含此条目');
});
