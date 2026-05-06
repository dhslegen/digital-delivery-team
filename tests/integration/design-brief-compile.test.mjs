// W1: design-brief 编译器端到端
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { extractUserStories, extractEndpoints, renderBrief, VISUAL_DIRECTIONS } from '../../bin/compile-design-brief.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SCRIPT = join(ROOT, 'bin', 'compile-design-brief.mjs');
const TEMPLATE_BRIEF = join(ROOT, 'templates', 'design-brief.template.md');

const SAMPLE_PRD = `# PRD · Demo

## 1. 概述
做一个 Hello World demo。

## 4. 用户故事与验收标准

### 功能 F1：访问首页

**用户故事**
As a 访客用户（未登录的浏览器用户），I want 访问应用根路径 \`/\` 后看到一句问候语，so that 我能确认应用已成功部署并可正常访问。

### 功能 F2：可执行 JAR

**用户故事**
As a 开发者，I want 执行 \`java -jar app.jar\`，so that 启动等待时间可预期。
`;

const SAMPLE_CONTRACT = `openapi: 3.0.3
info:
  title: Demo API
  version: 1.0.0
paths:
  /api/health:
    get:
      summary: Health check
      responses:
        '200':
          description: OK
  /api/auth/login:
    post:
      summary: Login
      responses:
        '200':
          description: Token
        '401':
          description: Invalid credentials
`;

const SAMPLE_TECH_STACK = JSON.stringify({
  preset: 'java-modern',
  backend: { language: 'java', framework: 'spring-boot' },
  frontend: { type: 'spa', framework: 'react' },
}, null, 2);

function setupSandbox() {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-brief-'));
  mkdirSync(join(tmp, 'docs'), { recursive: true });
  mkdirSync(join(tmp, '.ddt'), { recursive: true });
  writeFileSync(join(tmp, 'docs', 'prd.md'), SAMPLE_PRD);
  writeFileSync(join(tmp, 'docs', 'api-contract.yaml'), SAMPLE_CONTRACT);
  writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), SAMPLE_TECH_STACK);
  writeFileSync(join(tmp, '.ddt', 'project-id'), 'proj-test-w1');
  return tmp;
}

test('compile-design-brief: 编译产出 docs/design-brief.md + tokens.json + components-inventory.md', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0, `failed: ${r.stderr}`);
    assert.ok(existsSync(join(tmp, 'docs', 'design-brief.md')), 'docs/design-brief.md 必生成');
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'tokens.json')), 'tokens.json 必复制');
    assert.ok(existsSync(join(tmp, '.ddt', 'design', 'components-inventory.md')), 'components-inventory.md 必生成');

    const brief = readFileSync(join(tmp, 'docs', 'design-brief.md'), 'utf8');
    // 项目名替换
    assert.match(brief, /Design Brief · java-modern/, '标题应含 preset 名');
    // 项目 ID 替换
    assert.match(brief, /proj-test-w1/, '项目 ID 应注入');
    // §2 user stories 表填充
    assert.match(brief, /US-01.*访客用户/, 'US-01 应含访客用户');
    assert.match(brief, /US-02.*开发者/, 'US-02 应含开发者');
    // §6 endpoint 列表填充
    assert.match(brief, /GET \/api\/health/, 'endpoints 应含 GET /api/health');
    assert.match(brief, /POST \/api\/auth\/login/, 'endpoints 应含 POST /api/auth/login');
    // 编译信息块
    assert.match(brief, /generator:\s*ddt-design-brief-compiler v0\.8\.0/, '编译信息含版本');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('compile-design-brief: 缺少必需输入应 exit 2', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'ddt-brief-missing-'));
  try {
    // 故意不写 PRD
    mkdirSync(join(tmp, 'docs'));
    mkdirSync(join(tmp, '.ddt'));
    writeFileSync(join(tmp, '.ddt', 'tech-stack.json'), SAMPLE_TECH_STACK);

    const r = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 2, '必需输入缺失应 exit 2');
    assert.match(r.stderr, /必需输入缺失/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('compile-design-brief: brief 已存在且未传 --refresh 应 exit 3', () => {
  const tmp = setupSandbox();
  try {
    // 第一次跑成功
    const r1 = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r1.status, 0);

    // 第二次跑（不带 --refresh）
    const r2 = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r2.status, 3, 'brief 已存在应 exit 3');
    assert.match(r2.stderr, /已存在.*--refresh/);

    // 第三次跑（带 --refresh）— 应成功
    const r3 = spawnSync(process.execPath, [SCRIPT, '--refresh'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r3.status, 0, '--refresh 应允许重新编译');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('compile-design-brief: --visual-direction 校验合法值', () => {
  const tmp = setupSandbox();
  try {
    // 非法值应 exit 1
    const r1 = spawnSync(process.execPath, [SCRIPT, '--visual-direction', 'sloppy-mess'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r1.status, 1, '非法 visual-direction 应 exit 1');
    assert.match(r1.stderr, /必须是/);

    // 合法值应通过
    const r2 = spawnSync(process.execPath, [SCRIPT, '--visual-direction', 'industrial'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r2.status, 0);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

test('compile-design-brief: --dry-run 不落盘', () => {
  const tmp = setupSandbox();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { cwd: tmp, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /DRY RUN/);
    assert.ok(!existsSync(join(tmp, 'docs', 'design-brief.md')), 'dry-run 不应写 brief');
    assert.ok(!existsSync(join(tmp, '.ddt', 'design', 'tokens.json')), 'dry-run 不应写 tokens');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// v0.8.2 D15：实战回归 fixture——product-agent 按英语 vowel-aware 写 `As an`
// （ddt-team-admin-v0.8.1 实战 PRD 让 v0.8.1 D5 修复仍然 0 抽取）
test('v0.8.2 D15: extractUserStories 兼容 As an（vowel 前的英语正确语法）', () => {
  const prd = `# PRD

## 用户故事

**用户故事**：As an \`运营经理\`，I want \`在分页列表中筛选成员\`，so that \`不需要在多工具间跳转\`。

**用户故事**：As an \`运营经理\`，I want \`通过 4 步表单创建新成员\`，so that \`入职从 30 分钟降至 5 分钟\`。

**用户故事**：As a \`HR\`，I want \`批量导入员工\`，so that \`月度入职处理\`。
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 3, 'As an + As a 混用应全部抽出');
  assert.match(stories[0].role, /运营经理/);
  assert.match(stories[0].want, /分页列表中筛选成员/);
  assert.match(stories[1].want, /4 步表单创建/);
  assert.match(stories[2].role, /HR/, '保留 As a 兼容性');
});

test('v0.8.2 D15: extractUserStories 反引号包裹 + 中文逗号 + As an 完整组合', () => {
  // 直接用 ddt-team-admin-v0.8.1::docs/prd.md 实战格式
  const prd = String.raw`**用户故事**：As an \`运营经理\`，I want \`在一个分页列表中快速定位成员并执行批量操作\`，so that \`我不需要在多个工具间跳转就能完成日常团队管理\`。`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 1, '实战 PRD 格式应抽出 1 条（v0.8.1 D5 BUG 复现案）');
  assert.match(stories[0].role, /运营经理/);
});

// v0.8.1 D5：多策略匹配链——中文 EARS / markdown 表格
test('v0.8.1 D5: extractUserStories 支持中文 EARS（"作为 X，我想 Y，以便 Z"）', () => {
  const prd = `# PRD

## 用户故事

作为 运营经理，我想 管理团队成员，以便 提高效率。

作为 HR，我想 查看入职流水，以便 合规审查。
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 2, '中文 EARS 应抽出 2 条');
  assert.match(stories[0].role, /运营经理/);
  assert.match(stories[0].want, /管理团队成员/);
  assert.match(stories[0].value, /提高效率/);
  assert.equal(stories[0].id, 'US-01');
  assert.equal(stories[1].id, 'US-02');
});

test('v0.8.1 D5: extractUserStories 支持 markdown 表格（实战 ddt-team-admin-v0.8 格式）', () => {
  const prd = `# PRD

## 用户故事

| ID | 角色 | 我想 | 以便 | 优先级 |
|----|------|------|------|-------|
| US-01 | 运营经理 | 在分页列表中按角色筛选成员并执行批量操作 | 不需要在多个工具间跳转完成日常团队管理 | P0 |
| US-02 | 运营经理 | 通过 4 步分步表单创建新成员 | 入职从 30 分钟降至 5 分钟 | P0 |
| US-03 | 运营经理 | 在审计日志页检索操作记录 | 合规审查时可提供完整证据链 | P1 |

无关行
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 3, '表格应抽出 3 条');
  assert.equal(stories[0].id, 'US-01', '应保留表格中的 ID 列');
  assert.match(stories[0].role, /运营经理/);
  assert.match(stories[0].want, /分页列表/);
  assert.match(stories[2].id, /US-03/);
});

test('v0.8.1 D5: extractUserStories markdown 表格列顺序变化时仍能识别', () => {
  const prd = `# PRD

| 角色 | ID | 我想 | 以便 |
|------|----|------|------|
| dev | US-A | 测试 | 验证 |
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 1, '列顺序变化时应通过表头识别仍能抽出');
  assert.equal(stories[0].role, 'dev');
  assert.equal(stories[0].id, 'US-A');
});

test('v0.8.1 D5: extractUserStories 跳过表头与 placeholder 行', () => {
  const prd = `| ID | 角色 | 我想 | 以便 |
|----|------|------|------|
| US-01 | <role> | <goal> | <value> |
| US-02 | 用户 | 实际目标 | 实际价值 |
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 1, '应跳过 placeholder 行 US-01，仅留 US-02');
  assert.equal(stories[0].role, '用户');
});

test('v0.8.1 D5: extractUserStories 三策略不重复——EARS 英文存在时不再触发表格策略', () => {
  const prd = `**用户故事**：As a admin, I want full access, so that I can manage everything.

| ID | 角色 | 我想 | 以便 |
|----|------|------|------|
| US-01 | dev | 测试 | 验证 |
`;
  const stories = extractUserStories(prd);
  assert.equal(stories.length, 1, '首策略产出后不应再触发后续策略（避免重复）');
  assert.match(stories[0].role, /admin/);
});

test('extractUserStories 单元：支持中文逗号 + 跨行 + backtick', () => {
  const stories = extractUserStories(SAMPLE_PRD);
  assert.equal(stories.length, 2);
  assert.equal(stories[0].id, 'US-01');
  assert.match(stories[0].role, /访客用户/);
  assert.match(stories[0].want, /访问应用根路径/);
  assert.equal(stories[1].role, '开发者');
});

test('extractEndpoints 单元：从 OpenAPI 抽 method + path', () => {
  const eps = extractEndpoints(SAMPLE_CONTRACT);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].method, 'GET');
  assert.equal(eps[0].path, '/api/health');
  assert.ok(eps[0].line > 0, 'line 应为正数');
  assert.equal(eps[1].method, 'POST');
  assert.equal(eps[1].path, '/api/auth/login');
  assert.ok(eps[1].line > eps[0].line, 'POST line 应在 GET 之后');
});

test('renderBrief 单元：空 stories / 空 endpoints 不破坏模板', () => {
  const template = readFileSync(TEMPLATE_BRIEF, 'utf8');
  const out = renderBrief(template, {
    projectName: 'empty',
    projectId: 'p1',
    date: '2026-04-30',
    stories: [],
    endpoints: [],
    assets: [],
    generatedAt: '2026-04-30T00:00:00Z',
    gitSha: { prd: 'abc', contract: 'def' },
  });
  // 空 stories 时模板原占位仍存在
  assert.match(out, /US-01 \| <role>/);
  // 编译信息块仍正确填充
  assert.match(out, /generated_at:\s*2026-04-30T00:00:00Z/);
  assert.match(out, /\(无\)/, '空 assets 应显示 (无)');
});
