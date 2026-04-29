// M6.3: tech-stack-options.yaml + components-json + PreToolUse hard gate
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const RESOLVE = join(ROOT, 'bin', 'resolve-tech-stack.mjs');
const PRE_TOOL_USE = join(ROOT, 'hooks', 'handlers', 'pre-tool-use.js');

test('tech-stack-options.yaml 含 4 步问卷 + 22 分组核心组件', () => {
  const path = join(ROOT, 'templates', 'tech-stack-options.yaml');
  assert.ok(existsSync(path), 'options.yaml 必须存在');
  const text = readFileSync(path, 'utf8');

  // 4 步问卷
  for (const step of ['step_1_language', 'step_2_database', 'step_3_frontend_framework', 'step_4_ui_library']) {
    assert.ok(text.includes(step), `必含问卷步骤 ${step}`);
  }

  // 推荐选项
  assert.ok(text.includes('Java + Spring Boot 3 (Recommended)'));
  assert.ok(text.includes('PostgreSQL 16 + Redis 7 (Recommended)'));
  assert.ok(text.includes('React 18 + Vite (Recommended)'));
  assert.ok(text.includes('Tailwind + shadcn/ui (Recommended)'));

  // Spring Initializr 22 分组（核心 8 类）
  for (const cat of ['developer_tools', 'web', 'security', 'sql', 'nosql', 'messaging', 'observability', 'cloud']) {
    assert.ok(text.includes(`${cat}:`), `必含 Spring Initializr 分组 ${cat}`);
  }

  // 多语言后端
  for (const lang of ['java:', 'node:', 'python:', 'go:']) {
    assert.ok(text.includes(lang), `必含语言 ${lang}`);
  }
});

test('--components-json 与 preset 合并写入 tech-stack.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-components-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: { custom_field: 'override-value' },
      frontend: { ui: { components: 'antd-5' } },
      ai_design: { type: 'figma' },
      components: ['lombok', 'data-jpa', 'mybatis', 'postgresql'],
    }));

    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.preset, 'java-modern', '保留 preset 名');
    assert.equal(stack.source, 'askuserquestion', 'source 标记 askuserquestion');
    assert.equal(stack.user_customized, true, '标记用户自定义');
    assert.equal(stack.backend.custom_field, 'override-value', '用户覆盖应生效');
    assert.equal(stack.frontend.ui.components, 'antd-5');
    assert.equal(stack.ai_design.type, 'figma');
    assert.deepEqual(stack.components, ['lombok', 'data-jpa', 'mybatis', 'postgresql']);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('brief 写 interactive 时不取 brief.preset，等待 components-json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-interactive-'));
  try {
    writeFileSync(join(tmp, 'project-brief.md'),
      '## 关键约束\n- **技术栈预设**: interactive\n');

    const r = spawnSync(process.execPath, [RESOLVE], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    const stack = JSON.parse(r.stdout);
    // 因 brief = interactive 跳过；应 fallback（无 cache/manifest 时走 default）
    assert.notEqual(stack.source, 'project-brief',
      'brief 写 interactive 时不应直接采用 brief.preset');
    // 默认应 fallback 到 java-modern
    assert.equal(stack.preset, 'java-modern');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PreToolUse hook 硬拦截 Write .ddt/tech-stack.json', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-techstack-block-'));
  try {
    const input = {
      session_id: 's1',
      cwd: tmp,
      tool_name: 'Write',
      tool_input: { file_path: '.ddt/tech-stack.json', content: '{}' },
    };

    const r = spawnSync(process.execPath, [PRE_TOOL_USE], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') },
      timeout: 5000,
    });
    assert.equal(r.status, 0, 'hook 必须 exit 0（用 stdout JSON 决策）');
    // stdout 应是 JSON 含 permissionDecision: deny
    let payload = null;
    try { payload = JSON.parse(r.stdout); } catch { /* ignore */ }
    assert.ok(payload, `stdout 必须是 JSON：${r.stdout}`);
    assert.equal(payload.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(payload.hookSpecificOutput.permissionDecision, 'deny',
      '必须返回 deny 决策');
    assert.ok(payload.hookSpecificOutput.permissionDecisionReason.includes('SSoT'));
    assert.ok(r.stderr.includes('BLOCKED'));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PreToolUse hook 不拦截普通文件 Write', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-normal-write-'));
  try {
    const input = {
      session_id: 's1',
      cwd: tmp,
      tool_name: 'Write',
      tool_input: { file_path: 'docs/prd.md', content: '# PRD' },
    };

    const r = spawnSync(process.execPath, [PRE_TOOL_USE], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, DDT_METRICS_DIR: join(tmp, '.metrics') },
      timeout: 5000,
    });
    assert.equal(r.status, 0);
    // 普通 Write 不应输出 deny JSON
    assert.ok(!r.stdout.includes('"permissionDecision":"deny"'),
      '普通文件 Write 不应被拦截');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// M6.4：frontend-agent / backend-agent 已转 skill。SSoT 锁死现在
// 在 architect-agent.md 上由 invariant 强制 + PreToolUse hook 硬拦截覆盖前后端实现。
test('architect-agent invariant 含 M6.3 SSoT 锁死条款', () => {
  const text = readFileSync(join(ROOT, 'agents', 'architect-agent.md'), 'utf8');
  assert.ok(text.includes('M6.3 SSoT 锁死'),
    'architect-agent 必须含 M6.3 SSoT 锁死条款');
  assert.ok(text.includes('严禁 Write/Edit/MultiEdit'),
    'architect-agent 必须明确"严禁 Write/Edit/MultiEdit"');
});

test('frontend-development / backend-development skill 含 SSoT 锁死提醒', () => {
  for (const skill of ['frontend-development', 'backend-development']) {
    const text = readFileSync(join(ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(text.includes('SSoT 锁死') || text.includes('严禁 Write/Edit/MultiEdit'),
      `${skill} skill 必须提醒 main thread tech-stack.json 锁死规则`);
  }
});

test('design.md 含 AskUserQuestion 4 步问卷引导', () => {
  const text = readFileSync(join(ROOT, 'commands/design.md'), 'utf8');
  assert.ok(text.includes('AskUserQuestion'),
    'design.md 必须引用 AskUserQuestion 工具');
  assert.ok(text.includes('Step 1：主语言栈'));
  assert.ok(text.includes('Step 2：数据库'));
  assert.ok(text.includes('Step 3：前端框架'));
  assert.ok(text.includes('Step 4：UI'));
  assert.ok(text.includes('--components-json'),
    'design.md 必须演示 --components-json 用法');
});

test('kickoff.md 含 Step 0 技术栈预选引导', () => {
  const text = readFileSync(join(ROOT, 'commands/kickoff.md'), 'utf8');
  assert.ok(text.includes('Step 0'),
    'kickoff.md 必须含 Step 0 技术栈预选');
  assert.ok(text.includes('AskUserQuestion'));
  assert.ok(text.includes('interactive'),
    '必须说明 interactive 字段触发问卷');
});

test('project-brief 模板含结构化字段', () => {
  const text = readFileSync(join(ROOT, 'templates/project-brief.template.md'), 'utf8');
  for (const field of [
    '后端语言', '后端框架', '数据库', 'ORM',
    '前端框架', 'UI 组件库', '状态管理',
  ]) {
    assert.ok(text.includes(field), `brief 必须含字段：${field}`);
  }
  assert.ok(text.includes('interactive'),
    'brief 必须说明 interactive 选项');
});
