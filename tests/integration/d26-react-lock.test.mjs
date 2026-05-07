// v0.9.9 D26 + v0.9.10 D27：preset/framework/ai_design 交叉校验 + UI 库场景化推荐
//
// 实战暴露：alv-ops 项目 brief 自动产出时，LLM 把 java-modern preset 的前端框架
// 凭训练数据偏置写成"Vue 3 + Element Plus"——违反 preset default（React 18 + Vite +
// Tailwind + shadcn-ui），同时与 D3=claude-design 通道（bundle 一般 .jsx）冲突。
//
// v0.9.10 D27 收敛：claude-design handoff bundle 摄取下沉回 /design-execute 阶段
// （bin/ingest-claude-design.mjs），brief 阶段不再处理。本测试仅守门：
//   1. check-brief-quality D26 cross-validation：preset/framework/ai_design 一致性
//   2. UI 库场景化推荐文档（B2B → AntD 5 / SaaS → shadcn-ui）
//   3. brief §6 ui_components 子字段
//   4. 静态文档约束（field-rules / decision-gates / ai-design-quick-pick）
//
// 设计哲学：brief 阶段保持宽松 + 软警告，给后续 /design-brief 减少摩擦。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SKILL_ROOT = join(ROOT, 'skills', 'ddt-brief-builder');
const CHECK_QUALITY = join(SKILL_ROOT, 'scripts', 'check-brief-quality.mjs');
const SKILL_MD = join(SKILL_ROOT, 'SKILL.md');
const FIELD_RULES = join(SKILL_ROOT, 'references', 'field-rules.md');
const DECISION_GATES = join(SKILL_ROOT, 'references', 'decision-gates.md');
const AI_DESIGN_PICK = join(SKILL_ROOT, 'references', 'ai-design-quick-pick.md');
const UI_LIBRARY_MD = join(SKILL_ROOT, 'references', 'ui-library-by-scenario.md');

function runQuality(briefPath) {
  const r = spawnSync(process.execPath, [CHECK_QUALITY, briefPath, '--json'], { encoding: 'utf8' });
  const out = r.stdout || '';
  const idx = out.indexOf('{');
  return JSON.parse(out.slice(idx));
}

function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d26-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

function makeBrief(opts) {
  const { preset, framework, channel, withAllFields = true } = opts;
  const lines = [
    '# Test Brief',
    '',
    '## §1 项目背景',
    'B2B 物流车队管理项目对接车企云控提供实时监测能力的运营平台。',
    '',
    '## §2 目标用户',
    '- 主要：物流运营人员高频使用监测大屏与告警处置',
    '- 次要：技术管理员配置基础信息与权限',
    '',
    '## §3 成功标准',
    '- [ ] 上线后日活运营人员 ≥ 80%',
    '- [ ] 告警响应时间 P95 ≤ 30 秒',
    '',
    '## §4 核心功能',
    '1. 实时车辆地图与状态总览',
    '2. 任务下发与取消',
    '3. 告警推送与处置流程',
    '',
    '## §5 关键约束',
    '- 截止：2026-12-31',
    '- 团队：7 人 / 5 人月',
    '',
    '## 技术栈预设',
    preset,
    '',
    '## 前端类型',
    'type: spa',
    `框架: ${framework}`,
    '',
    '## AI-native UI',
    channel,
  ];
  if (withAllFields) {
    lines.push('', '## 非目标', '- 不做多租户', '- 不做移动 App');
    lines.push('', '## 参考资料', '- README.md');
  }
  return lines.join('\n');
}

// ============================================================================
// check-brief-quality D26 cross-validation
// ============================================================================

test('D26: cross-validate java-modern + React + claude-design → 0 issues（一致）', () => {
  const dir = makeTmpDir();
  try {
    const path = join(dir, 'brief.md');
    writeFileSync(path, makeBrief({ preset: 'java-modern', framework: 'React 18', channel: 'claude-design' }));
    const r = runQuality(path);
    assert.equal(r.cross_validation.preset, 'java-modern');
    assert.equal(r.cross_validation.framework, 'react');
    assert.equal(r.cross_validation.ai_design_channel, 'claude-design');
    assert.equal(r.cross_validation.issues.length, 0, '一致组合应无 issues');
  } finally { cleanup(dir); }
});

test('D26: cross-validate java-modern + Vue → 1 警告（preset default mismatch）', () => {
  const dir = makeTmpDir();
  try {
    const path = join(dir, 'brief.md');
    writeFileSync(path, makeBrief({ preset: 'java-modern', framework: 'Vue 3', channel: 'figma' }));
    const r = runQuality(path);
    assert.equal(r.cross_validation.preset, 'java-modern');
    assert.equal(r.cross_validation.framework, 'vue');
    assert.ok(r.cross_validation.issues.length >= 1, 'java-modern + Vue 应触发软警告');
    assert.match(r.cross_validation.issues[0], /preset=java-modern.*?React.*?vue/i);
    assert.equal(r.pass, true, '软警告不阻塞 pass');
  } finally { cleanup(dir); }
});

test('D26: cross-validate claude-design + Vue → 警告（提醒由 /design-brief 阶段细化）', () => {
  const dir = makeTmpDir();
  try {
    const path = join(dir, 'brief.md');
    writeFileSync(path, makeBrief({ preset: 'interactive', framework: 'Vue 3', channel: 'claude-design' }));
    const r = runQuality(path);
    assert.equal(r.cross_validation.framework, 'vue');
    assert.equal(r.cross_validation.ai_design_channel, 'claude-design');
    const claudeWarning = r.cross_validation.issues.find(w => /claude-design/i.test(w));
    assert.ok(claudeWarning, '应有 claude-design + 非 React 软警告');
  } finally { cleanup(dir); }
});

test('D26: cross-validate node-modern + Next.js → 0 issues', () => {
  const dir = makeTmpDir();
  try {
    const path = join(dir, 'brief.md');
    writeFileSync(path, makeBrief({ preset: 'node-modern', framework: 'Next.js 14', channel: 'claude-design' }));
    const r = runQuality(path);
    assert.equal(r.cross_validation.preset, 'node-modern');
    assert.equal(r.cross_validation.framework, 'react', 'Next.js 应识别为 react');
    assert.equal(r.cross_validation.issues.length, 0);
  } finally { cleanup(dir); }
});

// ============================================================================
// 静态文档约束（防回归）
// ============================================================================

test('D26: SKILL.md 字段表含 D26 反模式说明（含 D27 收敛说明）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /D26 反模式/, 'SKILL.md 字段段应有 D26 反模式');
  assert.match(text, /java-modern.*?Vue.*?Element Plus/, '应明确反模式 java-modern + Vue + Element Plus');
});

test('D27 收敛: SKILL.md 不再含输入类型 K（claude-design handoff bundle 已下沉到 /design-execute）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.ok(!/\*\*K\*\*\s*claude-design\s*handoff/.test(text),
    'SKILL.md 不应再含 K 类输入（v0.9.10 D27 已删除，handoff 由 bin/ingest-claude-design.mjs 在 /design-execute 阶段处理）');
  assert.ok(!/dump-design-handoff/.test(text),
    'SKILL.md 不应再引用 dump-design-handoff.mjs');
});

test('D26: field-rules.md §6 §7 含 D26 反模式（java-modern + Vue / claude-design + 非 React）', () => {
  const text = readFileSync(FIELD_RULES, 'utf8');
  assert.match(text, /java-modern.*Vue.*Element Plus/, '§6 应禁 java-modern + Vue + Element Plus');
  assert.match(text, /claude-design.*非\s*React|claude-design.*?React/, '应说明 claude-design + 非 React');
});

test('D26: decision-gates.md D1 速查表含"前端框架"列 + 显式标 React/Thymeleaf', () => {
  const text = readFileSync(DECISION_GATES, 'utf8');
  assert.match(text, /前端框架/, 'D1 速查应含前端框架列');
  assert.match(text, /React 18 \+ Vite \+ TS|\*\*React 18[^*]*\*\*/, '应显式标 React 18 + Vite + TS');
  assert.match(text, /Thymeleaf SSR/, 'java-traditional 应标 Thymeleaf SSR');
});

test('D27 收敛: ai-design-quick-pick.md claude-design 段含框架推荐（宽松，由 /design-brief 精细化）', () => {
  const text = readFileSync(AI_DESIGN_PICK, 'utf8');
  assert.match(text, /框架推荐|框架.*宽松/, 'claude-design 段应含框架推荐说明');
  assert.match(text, /react.*零迁移|零迁移.*react/i, 'react 应标记零迁移');
  assert.match(text, /design-brief.*?(精细化|决定)|(精细化|决定).*?design-brief/, '应说明精细化交给 /design-brief 阶段');
  assert.match(text, /UI 库.*?解耦|tokens.*?解耦/, '应说明 UI 库与 tokens 解耦');
});

test('D26: ui-library-by-scenario.md 含决策矩阵 + B2B → AntD 推荐', () => {
  const text = readFileSync(UI_LIBRARY_MD, 'utf8');
  assert.match(text, /B2B 中后台.*?AntD\s*5|AntD\s*5.*?B2B/, 'B2B 中后台应推荐 AntD 5');
  assert.match(text, /SaaS.*shadcn-ui|shadcn-ui.*SaaS/, 'SaaS 应推荐 shadcn-ui');
});

test('D26: brief 模板 §6 含 ui_components 子字段', () => {
  const text = readFileSync(join(ROOT, 'templates', 'project-brief.template.md'), 'utf8');
  assert.match(text, /ui_components/, '模板应含 ui_components 子字段');
  assert.match(text, /antd-5/, '模板应列 antd-5 候选值');
});

test('D27 收敛: brief 模板 §11 不再含设计契约示例', () => {
  const text = readFileSync(join(ROOT, 'templates', 'project-brief.template.md'), 'utf8');
  assert.ok(!/Bundle 路径|Prototype 框架|AI 推荐 UI 库/.test(text),
    'brief 模板不应再含 design handoff 示例（已在 v0.9.10 D27 收敛）');
});
