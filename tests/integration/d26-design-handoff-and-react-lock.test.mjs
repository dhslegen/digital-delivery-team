// v0.9.9 D26：claude-design handoff bundle 输入识别 + preset/framework/ai_design 交叉校验
//
// 实战暴露：alv-ops 项目 brief 自动产出时，LLM 把 java-modern preset 的前端框架
// 凭训练数据偏置写成"Vue 3 + Element Plus"——违反 preset default（React + Vite + Tailwind + shadcn-ui）
// 同时与 D3=claude-design 通道（bundle 全 .jsx）冲突。
//
// 用户诉求：逆向优化 DDT 本身——
//   1. brief 阶段就能识别 claude-design handoff bundle，把设计决策注入 §11
//   2. preset/framework/ai_design 之间增加交叉校验防 LLM 自由发挥
//   3. UI 库按场景推荐（B2B 中后台 → AntD 5；SaaS → shadcn-ui），不锁死 preset default
//
// 本测试用例守门：
//   - dump-design-handoff 解析真实 claude.ai/design bundle（r_McQh94UXBuyrFdW2KynA.tar.gz）
//   - 抽出项目名 / 框架（React .jsx）/ AI 推荐 UI 库（AntD 5）/ tokens 摘要 / chat 决策
//   - check-brief-quality D26 cross-validation：
//     - java-modern + Vue → 软警告（preset default mismatch）
//     - claude-design + Vue → 软警告（30% 改造成本）
//     - java-modern + React + claude-design → 0 警告（一致）
//   - SKILL.md 输入类型表含 K 项（防回归）
//   - field-rules.md / decision-gates.md / ai-design-quick-pick.md / ui-library-by-scenario.md 静态约束

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SKILL_ROOT = join(ROOT, 'skills', 'ddt-brief-builder');
const DUMP_HANDOFF = join(SKILL_ROOT, 'scripts', 'dump-design-handoff.mjs');
const CHECK_QUALITY = join(SKILL_ROOT, 'scripts', 'check-brief-quality.mjs');
const SKILL_MD = join(SKILL_ROOT, 'SKILL.md');
const FIELD_RULES = join(SKILL_ROOT, 'references', 'field-rules.md');
const DECISION_GATES = join(SKILL_ROOT, 'references', 'decision-gates.md');
const AI_DESIGN_PICK = join(SKILL_ROOT, 'references', 'ai-design-quick-pick.md');
const UI_LIBRARY_MD = join(SKILL_ROOT, 'references', 'ui-library-by-scenario.md');
const EXAMPLE_HANDOFF = join(SKILL_ROOT, 'examples', 'from-design-handoff.md');
const FIXTURE_BUNDLE = join(ROOT, 'tests', 'fixtures', 'real-agent-outputs', 'design-handoff', 'r_McQh94UXBuyrFdW2KynA.tar.gz');

function runDump(args) {
  const r = spawnSync(process.execPath, [DUMP_HANDOFF, ...args], { encoding: 'utf8' });
  const out = r.stdout || '';
  const idx = out.indexOf('--- JSON ---');
  let json = null;
  if (idx >= 0) {
    try { json = JSON.parse(out.slice(idx + '--- JSON ---'.length)); } catch {}
  }
  return { exitCode: r.status, stdout: out, stderr: r.stderr || '', json };
}

function runQuality(briefPath) {
  const r = spawnSync(process.execPath, [CHECK_QUALITY, briefPath, '--json'], { encoding: 'utf8' });
  const out = r.stdout || '';
  const idx = out.indexOf('{');
  return JSON.parse(out.slice(idx));
}

function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d26-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// ============================================================================
// dump-design-handoff 解析正确性
// ============================================================================

test('D26: fixture bundle 存在（gzip + tar 格式）', () => {
  assert.ok(existsSync(FIXTURE_BUNDLE), `fixture bundle 应存在：${FIXTURE_BUNDLE}`);
  const stat = statSync(FIXTURE_BUNDLE);
  assert.ok(stat.size > 100 * 1024, 'bundle 应至少 100KB（含完整 prototype）');
  const buf = readFileSync(FIXTURE_BUNDLE);
  assert.equal(buf[0], 0x1f, 'gzip magic byte 0');
  assert.equal(buf[1], 0x8b, 'gzip magic byte 1');
});

test('D26: dump-design-handoff 解析真实 bundle 抽取项目名 + 框架 + UI 库', () => {
  const { exitCode, json } = runDump([FIXTURE_BUNDLE]);
  assert.equal(exitCode, 0);
  assert.ok(json, '应输出 JSON 摘要');
  assert.match(json.projectName, /无人物流车|untitled/, '项目名应抽自 README');
  assert.match(json.framework, /React/, 'bundle 全 .jsx → 框架=React');
  assert.match(json.uiLibrary, /AntD/, 'AI 在 chat 推荐 AntD 5');
});

test('D26: dump-design-handoff 抽 design tokens 摘要（品牌色 + 状态色 + 字体）', () => {
  const { json } = runDump([FIXTURE_BUNDLE]);
  assert.ok(json.tokens, '应有 tokens 段');
  assert.ok(json.tokens.totalVars >= 30, `tokens 应有 30+ CSS variables，实际 ${json.tokens.totalVars}`);
  assert.ok(json.tokens.palette.length >= 4, '应抽至少 4 阶品牌色');
  assert.ok(json.tokens.states.length >= 3, '应抽至少 3 个状态色（ok/warn/err）');
  assert.ok(json.tokens.fontFamilies.length >= 2, '应抽至少 2 个字体族');
});

test('D26: dump-design-handoff 抽 chat 用户决策（视觉/品牌/创新）', () => {
  const { json } = runDump([FIXTURE_BUNDLE]);
  assert.equal(json.chatCount, 1, '应识别 1 个 chat');
  assert.ok(json.userIntent, '应抽用户原始 intent');
  assert.match(json.userIntent, /需求|设计|竞品/, 'intent 应含关键词');
  assert.ok(json.decisions.length >= 3, `应抽至少 3 条决策，实际 ${json.decisions.length}`);
  const keys = json.decisions.map(d => d.key);
  assert.ok(keys.some(k => /视觉|风格/.test(k)), '应有视觉决策');
  assert.ok(keys.some(k => /品牌|字体/.test(k)), '应有品牌决策');
});

test('D26: dump-design-handoff 抽 AI 推荐技术栈（含 React + AntD + Zustand 等）', () => {
  const { json } = runDump([FIXTURE_BUNDLE]);
  const tech = json.aiTech || [];
  assert.ok(tech.includes('React'), 'AI tech 应含 React');
  assert.ok(tech.includes('AntD'), 'AI tech 应含 AntD（关键诉求来源）');
  assert.ok(tech.includes('TanStack Query') || tech.includes('Zustand'), 'AI tech 应含状态/请求库');
});

test('D26: dump-design-handoff 列 prototype 文件清单', () => {
  const { json } = runDump([FIXTURE_BUNDLE]);
  assert.ok(json.project.jsxFiles.length >= 4, 'prototype 应有 ≥4 个 .jsx');
  assert.ok(json.project.cssFiles.length >= 2, 'prototype 应有 ≥2 个 .css');
});

test('D26: dump-design-handoff markdown 输出含设计契约表头 + AI 推荐 UI 库行', () => {
  const { stdout } = runDump([FIXTURE_BUNDLE]);
  assert.match(stdout, /###\s+设计契约/, '应输出 markdown 子标题');
  assert.match(stdout, /AI 推荐 UI 库[\s\S]*?AntD/, '应在表格列 AI 推荐的 AntD');
});

// ============================================================================
// check-brief-quality D26 cross-validation
// ============================================================================

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

test('D26: cross-validate claude-design + Vue → 警告（30% 改造成本）', () => {
  const dir = makeTmpDir();
  try {
    const path = join(dir, 'brief.md');
    writeFileSync(path, makeBrief({ preset: 'interactive', framework: 'Vue 3', channel: 'claude-design' }));
    const r = runQuality(path);
    assert.equal(r.cross_validation.framework, 'vue');
    assert.equal(r.cross_validation.ai_design_channel, 'claude-design');
    const claudeWarning = r.cross_validation.issues.find(w => /claude-design/i.test(w));
    assert.ok(claudeWarning, '应有 claude-design + 非 React 警告');
    assert.match(claudeWarning, /改造成本/);
  } finally { cleanup(dir); }
});

test('D26: cross-validate node-modern + React → 0 issues', () => {
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

test('D26: SKILL.md 输入类型表含 K 项（claude-design handoff bundle）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /\*\*K\*\*\s*claude-design\s*handoff/, 'SKILL.md 应含 K 类输入');
  assert.match(text, /dump-design-handoff\.mjs/, 'SKILL.md 应引用 dump-design-handoff.mjs');
});

test('D26: SKILL.md 字段表含 D26 反模式说明', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /D26 反模式/, 'SKILL.md 字段段应有 D26 反模式');
  assert.match(text, /java-modern.*?Vue.*?Element Plus/, '应明确反模式 java-modern + Vue + Element Plus');
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

test('D26: ai-design-quick-pick.md claude-design 段含框架强相关说明', () => {
  const text = readFileSync(AI_DESIGN_PICK, 'utf8');
  assert.match(text, /框架选择强相关/, 'claude-design 段应含框架强相关副标题');
  assert.match(text, /react.*零迁移|零迁移.*react/i, 'react 应标记零迁移');
  assert.match(text, /vue.*?需重写|需重写.*?vue/i, 'vue 应标记需重写');
  assert.match(text, /UI 库.*?解耦|tokens.*?解耦/, '应说明 UI 库与 tokens 解耦');
});

test('D26: ui-library-by-scenario.md 含决策矩阵 + B2B → AntD 推荐', () => {
  const text = readFileSync(UI_LIBRARY_MD, 'utf8');
  assert.match(text, /B2B 中后台.*?AntD\s*5|AntD\s*5.*?B2B/, 'B2B 中后台应推荐 AntD 5');
  assert.match(text, /SaaS.*shadcn-ui|shadcn-ui.*SaaS/, 'SaaS 应推荐 shadcn-ui');
  assert.match(text, /D5\s*决策门|UI 库.*决策门/, '应说明 D5 决策门触发条件');
});

test('D26: examples/from-design-handoff.md 含 URL + .tar.gz + 解压目录三种形态', () => {
  const text = readFileSync(EXAMPLE_HANDOFF, 'utf8');
  assert.match(text, /示例\s*A.*tar\.gz/, '应含示例 A tar.gz 形态');
  assert.match(text, /示例\s*B.*URL/, '应含示例 B URL 形态');
  assert.match(text, /ingest-claude-design\.mjs/, 'URL 形态应说明先 ingest 再 dump');
});

test('D26: brief 模板 §6 含 ui_components 子字段', () => {
  const text = readFileSync(join(ROOT, 'templates', 'project-brief.template.md'), 'utf8');
  assert.match(text, /ui_components/, '模板应含 ui_components 子字段');
  assert.match(text, /antd-5/, '模板应列 antd-5 候选值');
});
