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

// PR-A · M6.3.4 · components-json schema 校验 + 字符串展开污染防御
test('PR-A: 扁平字符串 backend/frontend 自动映射为嵌套对象', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-flatstr-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: 'java-spring-boot',          // 扁平字符串
      frontend: 'html-css',                 // 扁平字符串
      ai_design: false,                     // 布尔（"不需要"）
      database: 'none',                     // 顶层扁平 → 应 merge 到 backend.database
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    assert.match(r.stderr, /扁平字符串 "java-spring-boot".*已映射/, 'backend 警告');
    assert.match(r.stderr, /扁平字符串 "html-css".*已映射/,         'frontend 警告');

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    // 关键反向断言：禁止数字索引 key（字符串展开污染信号）
    for (const key of Object.keys(stack.backend))  assert.ok(!/^\d+$/.test(key), `backend 不应含数字 key: ${key}`);
    for (const key of Object.keys(stack.frontend)) assert.ok(!/^\d+$/.test(key), `frontend 不应含数字 key: ${key}`);
    assert.equal(stack.backend.framework, 'spring-boot');
    assert.equal(stack.backend.language,  'java');
    assert.equal(stack.backend.database.primary, 'none', '"无数据库"应清空 preset 默认 mysql');
    // PR-E：'html-css' → { type: 'none', static: true }，整段替换不残留 react
    assert.equal(stack.frontend.type, 'none', '"纯 HTML/CSS" 应映射为 type=none');
    assert.equal(stack.frontend.framework, undefined, 'type=none 时不应有 framework 字段（preset.react 残留必须清除）');
    // PR-E：type=none 时 ai_design 字段应被删除（无 UI 设计稿可言）
    assert.equal(stack.ai_design, undefined, 'frontend.type=none 时 ai_design 应被删除');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-A: 未识别的扁平字符串应被拒绝', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-bad-string-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: 'unknown-stack-xyz',
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2, '未识别字符串必须 exit 2');
    assert.match(r.stderr, /未识别字符串.*请改写为嵌套对象/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-A: 嵌套对象格式（官方 schema）保持兼容', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-nested-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend:  { language: 'java', framework: 'spring-boot', database: { primary: 'postgres' } },
      frontend: { framework: 'react', ui: { components: 'shadcn-ui' } },
      ai_design:{ type: 'claude-design' },
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /扁平字符串/, '嵌套对象不应触发字符串警告');
    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.backend.database.primary, 'postgres');
    assert.equal(stack.frontend.ui.components,   'shadcn-ui');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// PR-C P1-2: 临时文件路径迁移 — /tmp/ddt-user-components.json → .ddt/components.json.tmp
test('PR-C: kickoff.md / design.md 不再使用 /tmp 全局路径（多项目并行不冲突）', () => {
  const kickoffPath = join(ROOT, 'commands', 'kickoff.md');
  const designPath  = join(ROOT, 'commands', 'design.md');
  const kickoffText = readFileSync(kickoffPath, 'utf8');
  const designText  = readFileSync(designPath, 'utf8');

  // 不应再出现 /tmp/ddt-user-components 路径
  assert.doesNotMatch(kickoffText, /\/tmp\/ddt-user-components/,
    'kickoff.md 应使用项目本地路径 .ddt/components.json.tmp');
  assert.doesNotMatch(designText, /\/tmp\/ddt-user-components/,
    'design.md 应使用项目本地路径 .ddt/components.json.tmp');

  // 应使用项目本地路径
  assert.match(kickoffText, /\.ddt\/components\.json\.tmp/,
    'kickoff.md 应引导写到 .ddt/components.json.tmp');
  assert.match(designText, /\.ddt\/components\.json\.tmp/,
    'design.md 应使用 .ddt/components.json.tmp');
});

// PR-E: frontend.type 三态语义（spa / server-side / none）
test('PR-E: frontend "thymeleaf" 映射为 server-side，整段替换不残留 React 配套', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-frontend-ssr-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: { language: 'java', framework: 'spring-boot' },
      frontend: 'thymeleaf',
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.frontend.type, 'server-side');
    assert.equal(stack.frontend.template_engine, 'thymeleaf');
    // 关键反向断言：preset 的 React 全家桶字段必须全部消失
    for (const ghost of ['bundler', 'state', 'router', 'data_fetching', 'type_generation', 'scaffold_cmd']) {
      assert.equal(stack.frontend[ghost], undefined,
        `server-side 场景禁止残留 preset.${ghost}（实际 = ${stack.frontend[ghost]}）`);
    }
    // framework 字段不应是 react（应只含 server-side 必要字段）
    assert.notEqual(stack.frontend.framework, 'react', 'framework 不应残留 react');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-E: frontend "none" 映射为 type=none，并删除 ai_design', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-frontend-none-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: { language: 'java', framework: 'spring-boot' },
      frontend: 'none',
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.frontend.type, 'none');
    assert.equal(stack.ai_design, undefined, 'frontend.type=none 时 ai_design 应被删除');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-E: frontend "react-vite" 标记为 type=spa，preset 完整保留', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-frontend-spa-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      frontend: 'react-vite',
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.frontend.type, 'spa', 'SPA 类型应明确标记');
    assert.equal(stack.frontend.framework, 'react');
    assert.equal(stack.frontend.bundler, 'vite');
    // SPA 场景下 preset 配套（state/router/data_fetching）应保留
    assert.ok(stack.frontend.state, 'SPA preset 的 state 字段应保留');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-E: 用户传嵌套对象 { type: "server-side", template_engine: "freemarker" } 也被尊重', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-frontend-explicit-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      frontend: { type: 'server-side', template_engine: 'freemarker' },
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath, '--write'],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);

    const stack = JSON.parse(readFileSync(join(tmp, '.ddt/tech-stack.json'), 'utf8'));
    assert.equal(stack.frontend.type, 'server-side');
    assert.equal(stack.frontend.template_engine, 'freemarker');
    assert.equal(stack.frontend.bundler, undefined, 'preset 残留必须被清除');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('PR-E: build-web.md 含 frontend.type 提前退出逻辑', () => {
  const text = readFileSync(join(ROOT, 'commands', 'build-web.md'), 'utf8');
  assert.match(text, /FRONT_TYPE/,                          'build-web.md 应有 FRONT_TYPE 提取');
  assert.match(text, /server-side.*\|\|.*none/,             'build-web.md 应判 server-side / none 两态');
  assert.match(text, /\/build-web 跳过/,                    'build-web.md 应明确 noop 退出文案');
});

test('PR-A: 写入前 assertCleanStack 拦截数字索引污染', () => {
  // 构造一个 preset 本身不污染、但用户故意把 backend 改成 array 的边界场景
  // array 经过 normalize 应被拒（不是字符串也不是对象）
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-array-'));
  try {
    const componentsPath = join(tmp, 'user-components.json');
    writeFileSync(componentsPath, JSON.stringify({
      preset: 'java-modern',
      backend: ['java', 'spring-boot'],   // 数组而非对象/字符串
    }));
    const r = spawnSync(process.execPath,
      [RESOLVE, '--components-json', componentsPath],
      { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2, '数组类型 backend 必须被拒');
    // normalizeSection 走 typeof object 分支会把数组当对象，最后由 assertCleanStack 拦下数字 key
    // 或在 normalizeSection 数组分支显式拒绝
    assert.ok(/数字索引|类型非法/.test(r.stderr), 'stderr 应说明数字索引或类型非法');
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
