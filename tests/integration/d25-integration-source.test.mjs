// v0.9.8 D25：ddt-brief-builder 输入类型 J（第三方 API 文档）+ §11 集成依赖
//
// 实战暴露：alv-ops 项目跑 /prd 时 product-agent 产生 BLK-001（车企接口未确认），
// 但用户已经爬好了新石器开放平台 API 文档（14 Cloud + 4 Video endpoints + OAuth2 鉴权）—
// brief 阶段没识别为"集成依赖"，导致 product-agent 看不到契约。
//
// 用户诉求：逆向优化 brief / prd，让契约文档 brief 阶段就被纳入 SSoT，
// /prd 阶段不再产生"接口未确认"类 BLK。
//
// 本测试用例守门：
//   - dump-api-docs 解析 markdown 目录树正确（alv-ops 真实文档）
//   - dump-api-docs 解析 OpenAPI YAML（零依赖手写解析）正确
//   - dump-api-docs 解析 OpenAPI JSON 正确
//   - dump-api-docs 解析单 markdown 含 endpoint 章节正确
//   - 强制脱敏 client_secret / api_key / Bearer token
//   - check-brief-quality 识别 §11 集成依赖（独立章节 / inline / 子标题三风格）
//   - §11 缺失不阻塞 pass（optional 字段）
//   - SKILL.md 输入类型表含 J 项目（防止回归）
//   - SKILL.md 字段表 11 字段
//   - product-agent.md Inputs 含 §11 契约引用 + Hard Requirements 第 6 条
//   - commands/prd.md Phase 4 含 §11 透传逻辑
//   - examples/from-api-docs-folder.md 双例（markdown 目录 + yaml）
//   - integration-detection.md 信号清单完整

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const SKILL_ROOT = join(ROOT, 'skills', 'ddt-brief-builder');
const DUMP_API = join(SKILL_ROOT, 'scripts', 'dump-api-docs.mjs');
const CHECK_QUALITY = join(SKILL_ROOT, 'scripts', 'check-brief-quality.mjs');
const SKILL_MD = join(SKILL_ROOT, 'SKILL.md');
const FIELD_RULES = join(SKILL_ROOT, 'references', 'field-rules.md');
const INTEGRATION_MD = join(SKILL_ROOT, 'references', 'integration-detection.md');
const EXAMPLE_MD = join(SKILL_ROOT, 'examples', 'from-api-docs-folder.md');
const PRODUCT_AGENT = join(ROOT, 'agents', 'product-agent.md');
const PRD_CMD = join(ROOT, 'commands', 'prd.md');

function runDump(args, cwd) {
  const r = spawnSync(process.execPath, [DUMP_API, ...args], {
    cwd: cwd || ROOT,
    encoding: 'utf8',
  });
  const out = r.stdout || '';
  // 找 --- JSON --- 之后的 JSON 段
  const idx = out.indexOf('--- JSON ---');
  let json = null;
  if (idx >= 0) {
    try { json = JSON.parse(out.slice(idx + '--- JSON ---'.length)); } catch {}
  }
  return { exitCode: r.status, stdout: out, stderr: r.stderr || '', json };
}

function runQuality(briefPath) {
  const r = spawnSync(process.execPath, [CHECK_QUALITY, briefPath, '--json'], {
    encoding: 'utf8',
  });
  const out = r.stdout || '';
  const idx = out.indexOf('{');
  return JSON.parse(out.slice(idx));
}

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'ddt-d25-'));
}

function cleanup(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

// ============================================================================
// dump-api-docs 解析正确性
// ============================================================================

test('D25: dump-api-docs 解析 alv-ops 真实 markdown 目录树', () => {
  const alvOpsApiDir = '/Users/zhaowenhao/Developer/Work/FullStack/alv-ops/项目资料/无人车开放平台API';
  // 仅在用户机器上有这个目录时跑（CI 跳过）
  try {
    require('node:fs').statSync(alvOpsApiDir);
  } catch {
    console.log('  ⏭️  跳过：alv-ops API 目录不存在（仅本机测试）');
    return;
  }
  const { exitCode, json } = runDump([alvOpsApiDir]);
  assert.equal(exitCode, 0);
  assert.equal(json.type, 'directory');
  assert.match(json.systemName, /新石器/, 'system 应识别为新石器');
  assert.match(json.summary.baseUrl, /scapi\.neolix\.net/, '基础 URL 应抽取自 README 表格');
  assert.match(json.summary.authType, /OAuth2/, '鉴权方式应抽取 OAuth2 关键词');
  assert.ok(json.summary.endpointCount >= 18, `endpoint 数应 ≥18（实际 ${json.summary.endpointCount}）`);
  assert.ok(json.summary.errorPath, '应识别错误码文档路径');
  assert.ok(json.summary.flowPath, '应识别接入流程文档路径');
});

test('D25: dump-api-docs 零依赖解析 OpenAPI YAML（含 paths/info/servers/securitySchemes）', () => {
  const dir = makeTmpDir();
  try {
    const yaml = `openapi: 3.0.3
info:
  title: Pet Store API
  version: 1.0.0
servers:
  - url: https://petstore.example.com/v1
paths:
  /pets:
    get:
      summary: List pets
    post:
      summary: Create pet
  /pets/{id}:
    get:
      summary: Get pet by ID
    delete:
      summary: Delete pet
components:
  securitySchemes:
    apiKey:
      type: apiKey
      in: header
      name: X-API-Key
`;
    const yamlPath = join(dir, 'petstore.openapi.yaml');
    writeFileSync(yamlPath, yaml);

    const { exitCode, json } = runDump([yamlPath]);
    assert.equal(exitCode, 0);
    assert.equal(json.type, 'openapi-yaml');
    assert.equal(json.systemName, 'Pet Store API');
    assert.equal(json.summary.baseUrl, 'https://petstore.example.com/v1');
    assert.equal(json.summary.endpointCount, 4, '应识别 4 个 endpoint（GET/POST /pets + GET/DELETE /pets/{id}）');
    assert.match(json.summary.authType, /apiKey/);
    assert.equal(json.summary.redacted, true, 'YAML 解析路径应标记 redacted=true');
  } finally { cleanup(dir); }
});

test('D25: dump-api-docs 解析 OpenAPI JSON', () => {
  const dir = makeTmpDir();
  try {
    const json_input = {
      openapi: '3.0.0',
      info: { title: 'Test API', version: '2.0' },
      servers: [{ url: 'https://api.test.com' }],
      paths: {
        '/users': { get: {}, post: {} },
        '/users/{id}': { put: {}, delete: {} },
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    };
    const path = join(dir, 'spec.openapi.json');
    writeFileSync(path, JSON.stringify(json_input, null, 2));

    const { exitCode, json } = runDump([path]);
    assert.equal(exitCode, 0);
    assert.equal(json.type, 'openapi-json');
    assert.equal(json.systemName, 'Test API');
    assert.equal(json.summary.baseUrl, 'https://api.test.com');
    assert.equal(json.summary.endpointCount, 4);
    assert.match(json.summary.authType, /bearerAuth/);
  } finally { cleanup(dir); }
});

test('D25: dump-api-docs 解析单 markdown 含 endpoint 章节', () => {
  const dir = makeTmpDir();
  try {
    const md = `# Orders API

## GET /orders
Lists all orders.

## POST /orders
Creates an order.

## GET /orders/{id}
Gets one order.
`;
    const path = join(dir, 'orders.md');
    writeFileSync(path, md);

    const { exitCode, json } = runDump([path]);
    assert.equal(exitCode, 0);
    assert.equal(json.type, 'markdown-single');
    assert.equal(json.systemName, 'Orders API');
    assert.equal(json.summary.endpointCount, 3);
  } finally { cleanup(dir); }
});

// ============================================================================
// 敏感字段脱敏
// ============================================================================

test('D25: dump-api-docs 强制脱敏 client_secret / api_key / Bearer token', () => {
  const dir = makeTmpDir();
  try {
    const yaml = `openapi: 3.0.0
info:
  title: Secret API
  version: 1.0
servers:
  - url: https://api.example.com
paths:
  /test:
    get:
      summary: Test
      description: |
        client_secret: super-secret-value-DO-NOT-LEAK
        api_key: AKIAIOSFODNN7EXAMPLE
        Authorization: Bearer eyJhbGc.notLeakedPlaintext
components:
  securitySchemes:
    api_key:
      type: apiKey
      in: header
      name: X-API-Key
`;
    const path = join(dir, 'secrets.openapi.yaml');
    writeFileSync(path, yaml);

    const { exitCode, stdout } = runDump([path]);
    assert.equal(exitCode, 0);
    // 关键断言：明文 secret 不出现在 stdout
    assert.ok(!stdout.includes('super-secret-value-DO-NOT-LEAK'), 'client_secret 明文不应出现');
    assert.ok(!stdout.includes('AKIAIOSFODNN7EXAMPLE'), 'api_key 明文不应出现');
    assert.ok(!stdout.includes('eyJhbGc.notLeakedPlaintext'), 'Bearer token 明文不应出现');
  } finally { cleanup(dir); }
});

// ============================================================================
// check-brief-quality §11 字段识别
// ============================================================================

test('D25: check-brief-quality 识别 §11 独立标题风格', () => {
  const dir = makeTmpDir();
  try {
    const briefPath = join(dir, 'brief.md');
    writeFileSync(briefPath, `# Test

## §1 项目背景
某 B2B 物流项目，对接车企云控平台做实时车辆调度与可视化运营。

## §2 目标用户
- 主要：物流运营经理负责日常调度与告警处置
- 次要：车队司机查看任务详情

## §3 成功标准
- [ ] 上线后日活运营人员 ≥ 80%
- [ ] 告警响应时间 P95 ≤ 30 秒

## §4 核心功能
1. 实时车辆地图与状态总览
2. 任务下发与取消
3. 告警推送与处置流程

## §5 关键约束
- 截止：2026-12-31，团队 7 人 / 5 人月
- 合规：等保二级，审计日志保留 6 个月

## 技术栈预设
java-modern

## 非目标
- 不做多公司多租户隔离
- V1.0 不做移动端原生 App

## 参考资料
- [项目立项会议纪要](./meeting/2026-01-21.md)
- [车企技术对接邮件归档](./mail/2026-01-15.md)

## 集成依赖

### 第三方系统：新石器无人车开放平台
| 项目 | 值 |
|---|---|
| 契约文档 | \`项目资料/无人车开放平台API\` |
| 基础 URL | https://scapi.neolix.net |
| 鉴权方式 | OAuth2 client_credentials |
`);
    const r = runQuality(briefPath);
    const f11 = r.field_details.find(f => f.n === 11);
    assert.equal(f11.filled, true, '§11 独立标题应被识别');
    assert.equal(r.pass, true, `应 pass，实际 pass=${r.pass} fill=${r.fill_rate_pct}% blockers=${JSON.stringify(r.blockers)}`);
  } finally { cleanup(dir); }
});

test('D25: check-brief-quality 识别 §11 inline 风格', () => {
  const dir = makeTmpDir();
  try {
    const briefPath = join(dir, 'brief.md');
    writeFileSync(briefPath, `# Test

## §1 项目背景
某项目。

## §2 目标用户
- 主要：用户

## §3 成功标准
- [ ] 100%

## §4 核心功能
1. A
2. B
3. C

## §5 关键约束
- 截止：2026-12-31

## 技术栈预设
java-modern

**集成依赖**: 项目资料/外部 API/（含 OAuth2 + 14 endpoints）
`);
    const r = runQuality(briefPath);
    const f11 = r.field_details.find(f => f.n === 11);
    assert.equal(f11.filled, true, '§11 inline 形式应被识别');
  } finally { cleanup(dir); }
});

test('D25: check-brief-quality §11 缺失不阻塞 pass（optional 字段）', () => {
  const dir = makeTmpDir();
  try {
    const briefPath = join(dir, 'brief.md');
    writeFileSync(briefPath, `# Test

## §1 项目背景
纯前端工具，无外部集成；面向单机用户使用，无后台服务。

## §2 目标用户
- 主要：独立开发者使用本工具进行日常调试任务
- 次要：技术爱好者偶尔用作脚手架参考

## §3 成功标准
- [ ] 工具能成功安装运行 100% 通过 smoke test
- [ ] 用户启动到首次产出流程 ≤ 60 秒

## §4 核心功能
1. 命令行入口与帮助说明
2. 核心数据处理逻辑
3. 输出报告生成

## §5 关键约束
- 截止：2026-12-31，工期 5 人天
- 团队规模：1 人独立完成

## 技术栈预设
node-modern

## 前端类型
spa

## AI-native UI
claude-design

## 非目标
- 不做多用户协作
- 不做云同步

## 参考资料
- [README.md](./README.md)
`);
    const r = runQuality(briefPath);
    assert.equal(r.pass, true, `无 §11 应仍 pass（optional）实际 pass=${r.pass} fill=${r.fill_rate_pct}%`);
    const f11 = r.field_details.find(f => f.n === 11);
    assert.equal(f11.filled, false);
    assert.equal(f11.required, false, '§11 应是 optional');
  } finally { cleanup(dir); }
});

// ============================================================================
// 静态文档约束（防回归）
// ============================================================================

test('D25: SKILL.md 输入类型表含 J 项（第三方 API 文档）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /\*\*J\*\*\s*第三方\s*API\s*文档/, 'SKILL.md 应含 J 类输入');
  assert.match(text, /dump-api-docs\.mjs/, 'SKILL.md 应引用 dump-api-docs.mjs');
});

test('D25: SKILL.md 字段表 11 字段（含 §11 集成依赖）', () => {
  const text = readFileSync(SKILL_MD, 'utf8');
  assert.match(text, /11\s*字段/, 'SKILL.md 应明确 11 字段');
  assert.match(text, /\|\s*11\s*\|\s*集成依赖/, 'SKILL.md 字段表应含 §11 行');
});

test('D25: field-rules.md 含 §11 集成依赖详细规则', () => {
  const text = readFileSync(FIELD_RULES, 'utf8');
  assert.match(text, /##\s+§11\s+集成依赖/, 'field-rules 应有 §11 段');
  assert.match(text, /脱敏/, '§11 段应说明敏感字段脱敏');
  assert.match(text, /用户后续(要|若想)看明文/, '应说明明文应去原文件读');
});

test('D25: integration-detection.md 含识别信号清单', () => {
  const text = readFileSync(INTEGRATION_MD, 'utf8');
  assert.match(text, /目录名关键词/, '应有目录名识别信号');
  assert.match(text, /OpenAPI|openapi/i, '应有 OpenAPI 识别');
  assert.match(text, /敏感字段/, '应说明脱敏要求');
  // 至少 5 个关键词信号
  const keywordsBlock = text.match(/### 信号 1[\s\S]+?### 信号 2/);
  assert.ok(keywordsBlock, 'integration-detection.md 应含信号 1 段');
  const keywordRows = (keywordsBlock[0].match(/\|.*?\|/g) || []).length;
  assert.ok(keywordRows >= 5, `信号 1 应至少 5 条关键词，实际 ${keywordRows} 行表格行`);
});

test('D25: examples/from-api-docs-folder.md 含 markdown 目录 + yaml 双例', () => {
  const text = readFileSync(EXAMPLE_MD, 'utf8');
  assert.match(text, /示例\s*A.*目录树/, '应含示例 A markdown 目录');
  assert.match(text, /示例\s*B.*OpenAPI\s*YAML/i, '应含示例 B OpenAPI YAML');
  assert.match(text, /alv-ops|新石器/, '示例 A 应使用 alv-ops 实战');
});

test('D25: product-agent.md Inputs 含 §11 契约文档（按需 Read）', () => {
  const text = readFileSync(PRODUCT_AGENT, 'utf8');
  assert.match(text, /§11\s*集成依赖/, 'Inputs 应提及 §11 集成依赖');
  assert.match(text, /按需\s*Read/, '应说明按需 Read 不主动扫盘');
  assert.match(text, /禁止主动扫盘/, '应明确禁止主动扫盘');
});

test('D25: product-agent.md Hard Requirements 第 6 条（§11 引用约束）', () => {
  const text = readFileSync(PRODUCT_AGENT, 'utf8');
  // 找 Hard Requirements 段第 6 条
  const m = text.match(/## Hard Requirements[\s\S]+?(?=##\s)/);
  assert.ok(m, '应找到 Hard Requirements 段');
  assert.match(m[0], /6\.\s+\*\*brief\s*§11/, 'Hard Requirements 应有第 6 条关于 §11');
  assert.match(m[0], /禁止.*未确认.*BLK|禁止编造|禁止.*BLK/, '应禁止用"未确认"作 BLK');
});

test('D25: commands/prd.md Phase 4 含 §11 透传逻辑', () => {
  const text = readFileSync(PRD_CMD, 'utf8');
  // Phase 4 段含 §11 集成依赖
  const m = text.match(/## Phase 4[\s\S]+?(?=## Phase 5|## Phase )/);
  assert.ok(m, '应找到 Phase 4 段');
  assert.match(m[0], /§11\s*集成依赖/, 'Phase 4 应说明 §11 集成依赖透传');
  assert.match(m[0], /契约文档/, '应说明透传契约文档路径');
});
