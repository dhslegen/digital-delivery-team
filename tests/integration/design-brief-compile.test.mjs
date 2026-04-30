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
