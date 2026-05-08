// v0.9.13 D30：把 tech-stack.json::type_generation 从声明翻译为实际产出
//
// 实战暴露（用户在 alv-ops 项目跑 /build-web 后发现）：
//   - docs/api-contract.yaml 94KB / 41 paths 孤立存在；web 端零消费
//   - tech-stack.json 声明 type_generation: openapi-typescript 但未落地
//   - 14 个页面全部内联 mock const（VEHICLES / ALERT_QUEUE / TASKS / USERS / ...）
//   - claude-design bundle 的 mock 数据被照搬到 web/，"假按钮、假实现"
//
// D30 修通用问题（项目特定问题留给 LLM 临场处理）：
//   1. 新增 bin/generate-api-client.mjs（openapi-typescript + openapi-fetch + hash 守门）
//   2. /build-web Phase 1 EXPLORE 强制跑（声明 type_generation 即生效）
//   3. 扩展 check-contract-alignment.mjs 扫 mock 数组反模式 → warning + 清单
//   4. frontend-development SKILL Phase 2 PLAN 加 endpoint × 组件映射表
//   5. ai-native-design SKILL §7 加"prototype 数据层必须 API 化"硬要求

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const GENERATE_BIN = join(ROOT, 'bin', 'generate-api-client.mjs');
const ALIGN_BIN = join(ROOT, 'bin', 'check-contract-alignment.mjs');
const BUILD_WEB_CMD = join(ROOT, 'commands', 'build-web.md');
const FE_SKILL = join(ROOT, 'skills', 'frontend-development', 'SKILL.md');
const ND_SKILL = join(ROOT, 'skills', 'ai-native-design', 'SKILL.md');

function readBin(p) { return readFileSync(p, 'utf8'); }
function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d30-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// ============================================================================
// 1. generate-api-client.mjs 静态 + dry-run 行为
// ============================================================================

test('D30: generate-api-client.mjs 存在 + 是 ESM + node shebang', () => {
  assert.ok(existsSync(GENERATE_BIN));
  const text = readBin(GENERATE_BIN);
  assert.match(text, /^#!\/usr\/bin\/env node/);
  assert.match(text, /^import\s/m);
});

test('D30: generate-api-client.mjs --dry-run 输出 7 步计划', () => {
  const r = spawnSync(process.execPath, [GENERATE_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--dry-run 应成功；stderr=${r.stderr}`);
  for (let i = 1; i <= 7; i++) {
    assert.match(r.stdout, new RegExp(`^${i}\\.`, 'm'), `应有第 ${i} 步`);
  }
  assert.match(r.stdout, /openapi-typescript/, '应说明用 openapi-typescript');
  assert.match(r.stdout, /SHA256|hash/i, '应说明 hash 守门');
});

test('D30: generate-api-client 在 type_generation 未声明时友好跳过', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, '.ddt'), { recursive: true });
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, '.ddt', 'tech-stack.json'),
      JSON.stringify({ preset: 'java-modern', frontend: { framework: 'react' } }));
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), 'openapi: 3.0.0\npaths: {}\n');
    const r = spawnSync(process.execPath, [GENERATE_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, '未声明 type_generation 应 0 退出');
    assert.match(r.stdout, /未声明|为 none|跳过/, '应输出跳过原因');
  } finally { cleanup(dir); }
});

test('D30: generate-api-client 在 contract 缺失时 exit 2 + 清晰错误', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, '.ddt'), { recursive: true });
    writeFileSync(join(dir, '.ddt', 'tech-stack.json'),
      JSON.stringify({ frontend: { type_generation: 'openapi-typescript' } }));
    const r = spawnSync(process.execPath, [GENERATE_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /api-contract\.yaml/, '错误消息应提到 api-contract.yaml');
  } finally { cleanup(dir); }
});

test('D30: generate-api-client 在 web/ 缺失时 exit 2', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, '.ddt'), { recursive: true });
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, '.ddt', 'tech-stack.json'),
      JSON.stringify({ frontend: { type_generation: 'openapi-typescript' } }));
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), 'openapi: 3.0.0\npaths: {}\n');
    const r = spawnSync(process.execPath, [GENERATE_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /web\/.*?不存在|target.*?不存在/);
  } finally { cleanup(dir); }
});

test('D30: generate-api-client 含 client.ts 模板（openapi-fetch + apiClient + unwrap）', () => {
  const text = readBin(GENERATE_BIN);
  assert.match(text, /CLIENT_TEMPLATE/, '应有 CLIENT_TEMPLATE 常量');
  assert.match(text, /openapi-fetch/, '模板应基于 openapi-fetch');
  assert.match(text, /apiClient/, '应导出 apiClient');
  assert.match(text, /unwrap/, '应有 unwrap 工具函数（适配 react-query queryFn）');
});

test('D30: generate-api-client 用 SHA256 哈希守门', () => {
  const text = readBin(GENERATE_BIN);
  assert.match(text, /sha256OfFile|createHash/, '应用 createHash 计算 hash');
  assert.match(text, /shouldRegenerate/, '应有重生策略函数');
  assert.match(text, /contract_sha256/, '应在 state 文件落 contract_sha256');
});

// ============================================================================
// 2. check-contract-alignment.mjs mock 检测
// ============================================================================

test('D30: check-contract-alignment 含 MOCK_ARRAY_RE 与 contract 资源对照', () => {
  const text = readBin(ALIGN_BIN);
  assert.match(text, /MOCK_ARRAY_RE/, '应有 MOCK_ARRAY_RE');
  assert.match(text, /extractContractResources/, '应有 extractContractResources 函数');
  assert.match(text, /contractResources/, '应用 contract resources 对照');
});

test('D30: check-contract-alignment 真实扫描发现 mock 数组（用临时 web fixture）', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, 'web', 'src', 'pages'), { recursive: true });
    // 简化 OpenAPI 含 /vehicles
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'),
      'openapi: 3.0.0\npaths:\n  /vehicles:\n    get:\n      summary: List\n');
    // mock 数组（与 contract endpoint 同名，应触发 warning）
    writeFileSync(join(dir, 'web', 'src', 'pages', 'VehiclePage.tsx'),
      `const VEHICLES = [
  { id: 'V001' },
  { id: 'V002' },
  { id: 'V003' },
  { id: 'V004' },
];
export default function VehiclePage() { return null; }
`);
    const r = spawnSync(process.execPath, [ALIGN_BIN, 'web'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, '应 0 退出（warning 不阻塞）');
    assert.match(r.stdout, /VEHICLES/, '应报告 VEHICLES mock');
    assert.match(r.stdout, /apiClient|api\/client/, '应建议用 apiClient');
  } finally { cleanup(dir); }
});

test('D30: check-contract-alignment 跳过 web/src/api/{types,client}.ts（自身产物）', () => {
  const text = readBin(ALIGN_BIN);
  // 源码里有 `/\/api\/(types|client)\.ts$/.test(rel)` —— 检查关键字符即可
  assert.ok(/types\|client/.test(text) || /api.*types.*client/.test(text),
    '应跳过 api/types.ts 和 api/client.ts（源码应含 types|client 跳过模式）');
});

// ============================================================================
// 3. commands/build-web.md Phase 1 强制跑
// ============================================================================

test('D30: build-web.md Phase 1 EXPLORE 强制跑 generate-api-client', () => {
  const text = readFileSync(BUILD_WEB_CMD, 'utf8');
  assert.match(text, /generate-api-client\.mjs/, 'build-web.md 应引用 generate-api-client.mjs');
  // 必须提及强制 + 失败降级
  assert.match(text, /强制.*API client|API client.*强制/, '应说明强制跑');
  assert.match(text, /GEN_EXIT|exit 0.*?成功|exit 2.*?配置|exit 3/i, '应有退出码降级处理');
});

test('D30: build-web.md 说明强制原因（让 LLM 看到 types.ts 不再抄 prototype mock）', () => {
  const text = readFileSync(BUILD_WEB_CMD, 'utf8');
  assert.match(text, /先看到.*?types\.ts|types\.ts.*?具体|具体 endpoint 类型/,
    '应解释为什么强制（让 LLM 看到具体类型）');
  assert.match(text, /prototype.*?mock|mock.*?prototype|D30 实战教训/,
    '应引用 D30 实战教训');
});

// ============================================================================
// 4. frontend-development SKILL Phase 2 PLAN 强制 endpoint 映射表
// ============================================================================

test('D30: frontend-development SKILL Phase 2 PLAN 含 endpoint × 组件映射表', () => {
  const text = readFileSync(FE_SKILL, 'utf8');
  assert.match(text, /Endpoint\s*×\s*组件映射表|endpoint.*?映射表/i,
    'PLAN 应含 endpoint × 组件映射表');
  assert.match(text, /v0\.9\.13 D30 强制|D30.*?强制/, '应标注 D30 强制');
  // 表格示例应含具体 endpoint
  assert.match(text, /apiClient\.GET|GET \/vehicles|GET \/users/, '示例应含 apiClient.GET 调用');
});

test('D30: frontend-development SKILL Don\'t 段加"prototype mock 复制"反模式', () => {
  const text = readFileSync(FE_SKILL, 'utf8');
  assert.match(text, /prototype.*?mock|mock.*?prototype|claude-design.*?bundle/,
    "Don't 应说明 prototype mock 不可复制");
  assert.match(text, /apiClient\.GET|@\/api\/client/, '应给正确替代示例');
});

// ============================================================================
// 5. ai-native-design SKILL §7 数据层 API 化硬要求
// ============================================================================

test('D30: ai-native-design SKILL claude-design 改写步骤含"数据层 API 化"', () => {
  const text = readFileSync(ND_SKILL, 'utf8');
  // §7 改写步骤
  assert.match(text, /数据层\s*API\s*化|API\s*化.*?强制|prototype.*?mock\s*数组.*?删除/i,
    '改写步骤应明示数据层 API 化');
  assert.match(text, /MON_VEHICLES|ALERT_QUEUE|prototype.*?mock|mock 数组/,
    '应给 prototype mock 实例');
});

test('D30: ai-native-design SKILL 红线/软警告段含 mock 数组检测', () => {
  const text = readFileSync(ND_SKILL, 'utf8');
  assert.match(text, /软警告|warning|check-contract-alignment/i,
    '应有软警告段引用 contract-alignment');
  assert.match(text, /useQuery|apiClient/i, '应给替代方案示例');
});
