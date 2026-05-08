// v0.9.15 D32：把 contract-summary 锚在 yaml SSoT；让 derive-channel-package 自动生成
//
// 实战暴露：v0.9.14 D31 派发包出现"占位 hint"——extract-contract-summary 依赖 types.ts，
// 但 /design-execute 在 /build-web 之前，types.ts 还不存在，fallback 写占位让用户手动跑。
// 用户洞察："yaml 是唯一真相源，types.ts 本质上也是 yaml 出来的"——拒绝层级派生。
//
// D32 修：
//   1. extract-contract-summary 重写为只读 yaml（删除 types.ts 路径）
//   2. extract-contract-summary 双模式：CLI + module export
//   3. derive-channel-package import generateContractSummary 自动生成
//      （不再 spawn 子进程，避免 hook 误判 + 进程开销）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const EXTRACT_BIN = join(ROOT, 'bin', 'extract-contract-summary.mjs');
const DERIVE_BIN = join(ROOT, 'bin', 'derive-channel-package.mjs');

function readBin(p) { return readFileSync(p, 'utf8'); }
function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d32-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// 简化的 OpenAPI yaml（含 inline + 多行 schema）
const FAKE_YAML = `openapi: 3.0.3
info:
  title: Test API
  version: 1.0.0
paths:
  /vehicles:
    get:
      summary: List
      responses:
        '200':
          description: OK
components:
  schemas:
    ApiResponseVoid:
      type: object
      properties:
        success: { type: boolean }
        message: { type: string }

    LoginRequest:
      type: object
      required: [username, password]
      properties:
        username: { type: string, example: admin }
        password: { type: string, example: pass }

    RealtimeVehicle:
      type: object
      required: [vin, lon, lat, status, powerState]
      properties:
        vin: { type: string, example: ABC123 }
        parkCode: { type: string, example: PARK01 }
        brand: { type: string, nullable: true }
        lon: { type: number, format: double }
        lat: { type: number, format: double }
        speed: { type: number, format: double, nullable: true }
        realBattery: { type: integer, nullable: true }
        powerState: { type: boolean }
        status:
          type: string
          enum: [ON_TASK, IDLE, CHARGING]
          example: ON_TASK
        hasActiveAlert: { type: boolean, nullable: true }
        lastDataAt: { type: string, format: date-time, nullable: true }

    Alert:
      type: object
      required: [id, vin, alertType, status]
      properties:
        id: { type: integer, format: int64 }
        vin: { type: string }
        alertType:
          type: string
          enum: [STUCK, LOW_BATTERY]
        status:
          type: string
          enum: [ACTIVE, ENDED, PROCESSED]
        occurAt: { type: string, format: date-time }
`;

// ============================================================================
// 1. extract-contract-summary 只读 yaml（不依赖 types.ts）
// ============================================================================

test('D32: extract-contract-summary --dry-run 提到 yaml 是 SSoT', () => {
  const r = spawnSync(process.execPath, [EXTRACT_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /api-contract\.yaml.*?SSoT|SSoT.*?api-contract|唯一真相源|OpenAPI 3\.x/, 'dry-run 应说明 yaml 是 SSoT');
});

test('D32: extract-contract-summary 在 yaml 缺失时 exit 2', () => {
  const dir = makeTmpDir();
  try {
    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /api-contract\.yaml/);
    assert.match(r.stderr, /\/design/, '应提示先跑 /design');
  } finally { cleanup(dir); }
});

test('D32: extract-contract-summary 不再依赖 types.ts（yaml-only）', () => {
  const text = readBin(EXTRACT_BIN);
  assert.ok(!/web\/src\/api\/types\.ts/.test(text),
    '源码不应再硬编码 web/src/api/types.ts 路径（v0.9.15 D32 已重写为 yaml-only）');
});

test('D32: extract-contract-summary 解析 yaml 抽出 schemas + enum + nullable', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), FAKE_YAML);

    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'stderr=' + r.stderr);

    assert.match(r.stdout, /## RealtimeVehicle/);
    assert.match(r.stdout, /lon: number/, '应识别 number 类型');
    assert.match(r.stdout, /lat: number/);
    assert.match(r.stdout, /enum\["ON_TASK","IDLE","CHARGING"\]/, '应识别多行 enum');
    assert.match(r.stdout, /enum\["STUCK","LOW_BATTERY"\]/);
    assert.match(r.stdout, /lastDataAt\?/, 'nullable 字段应标 ?');
    assert.match(r.stdout, /vin: string/, '应识别 inline type');
    assert.match(r.stdout, /反模式黑名单/, '应附反模式黑名单');
  } finally { cleanup(dir); }
});

test('D32: extract-contract-summary 过滤 ApiResponseX / PageX 包装', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), FAKE_YAML);

    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(!/## ApiResponseVoid/.test(r.stdout), '应过滤 ApiResponseX');
    assert.match(r.stdout, /## LoginRequest/, '业务 schema 应保留');
  } finally { cleanup(dir); }
});

test('D32: extract-contract-summary 支持 --output 写文件', () => {
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), FAKE_YAML);
    const outPath = join(dir, 'docs', 'contract-summary.md');

    const r = spawnSync(process.execPath, [EXTRACT_BIN, '--output', outPath], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(existsSync(outPath));
    const content = readFileSync(outPath, 'utf8');
    assert.match(content, /## RealtimeVehicle/);
    assert.match(content, /反模式黑名单/);
  } finally { cleanup(dir); }
});

// ============================================================================
// 2. extract-contract-summary 既是 CLI 又是 module
// ============================================================================

test('D32: extract-contract-summary 导出 generateContractSummary 函数（module 模式）', async () => {
  const mod = await import('file://' + EXTRACT_BIN);
  assert.equal(typeof mod.generateContractSummary, 'function',
    '应导出 generateContractSummary 函数供 derive-channel-package 直接调用');
});

test('D32: generateContractSummary module 函数正确返回结果', async () => {
  const mod = await import('file://' + EXTRACT_BIN);
  const dir = makeTmpDir();
  try {
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), FAKE_YAML);

    const result = mod.generateContractSummary({ projectRoot: dir });
    assert.equal(result.ok, true);
    assert.ok(result.businessSchemas >= 3, '应解析出 ≥3 个业务 schema');
    assert.match(result.markdown, /RealtimeVehicle/);
  } finally { cleanup(dir); }
});

test('D32: generateContractSummary module yaml 缺失时返回 ok:false', async () => {
  const mod = await import('file://' + EXTRACT_BIN);
  const dir = makeTmpDir();
  try {
    const result = mod.generateContractSummary({ projectRoot: dir });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'YAML_NOT_FOUND');
  } finally { cleanup(dir); }
});

// ============================================================================
// 3. derive-channel-package 自动 import 调用（无 spawn）
// ============================================================================

test('D32: derive-channel-package import generateContractSummary（不 spawn）', () => {
  const text = readBin(DERIVE_BIN);
  assert.match(text, /import\s*\{[^}]*generateContractSummary[^}]*\}\s*from\s*['"]\.\/extract-contract-summary\.mjs['"]/,
    'derive 应 import generateContractSummary 函数');
  // 不应该 spawn extract-contract-summary 子进程
  const lines = text.split('\n').filter(l => /extract-contract-summary/.test(l));
  for (const l of lines) {
    assert.ok(!/spawn|spawnSync/.test(l),
      'derive 不应 spawn extract-contract-summary 子进程：' + l);
  }
});

test('D32: derive-channel-package contract-summary 缺失时自动生成（yaml 存在前提）', () => {
  const text = readBin(DERIVE_BIN);
  assert.match(text, /generateContractSummary\s*\(/, '应调用 generateContractSummary');
  assert.match(text, /v0\.9\.15 D32|D32/, '应注释 D32 版本');
});

// ============================================================================
// 4. 端到端：整个派发包流程
// ============================================================================

test('D32: 派发包 03b 文件含真实 schema 摘要（非占位 hint）', () => {
  const dir = makeTmpDir();
  try {
    // 准备最小化 design-execute 输入
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'api-contract.yaml'), FAKE_YAML);
    writeFileSync(join(dir, 'docs', 'design-brief.md'), '# Brief\n## §1 项目背景\n测试\n');
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD\n');
    writeFileSync(join(dir, '.ddt', 'tech-stack.json'), JSON.stringify({ preset: 'java-modern', ai_design: { type: 'claude-design' } }));
    writeFileSync(join(dir, '.ddt', 'design', 'tokens.json'), '{}');
    writeFileSync(join(dir, '.ddt', 'design', 'components-inventory.md'), '# Components\n');

    // 运行 derive-channel-package
    const r = spawnSync(process.execPath, [DERIVE_BIN, '--channel', 'claude-design'], {
      cwd: dir, encoding: 'utf8',
    });
    assert.equal(r.status, 0, 'stderr=' + r.stderr);

    // 验证派发包 03b 是真实摘要
    const summaryPath = join(dir, '.ddt', 'design', 'claude-design', 'upload-package', '03b-contract-summary.md');
    assert.ok(existsSync(summaryPath), '03b-contract-summary.md 应存在');
    const content = readFileSync(summaryPath, 'utf8');
    assert.match(content, /## RealtimeVehicle/, '应是真实 schema 摘要');
    assert.match(content, /enum\["ON_TASK"/, '应含 enum 值');
    assert.ok(!/自动生成失败|占位/.test(content), '不应是占位 hint');
  } finally { cleanup(dir); }
});

test('D32: yaml 缺失时派发包 03b 为占位 hint（罕见 fallback）', () => {
  const dir = makeTmpDir();
  try {
    // 不创建 api-contract.yaml
    mkdirSync(join(dir, 'docs'), { recursive: true });
    mkdirSync(join(dir, '.ddt', 'design'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'design-brief.md'), '# Brief\n');
    writeFileSync(join(dir, 'docs', 'prd.md'), '# PRD\n');
    writeFileSync(join(dir, '.ddt', 'tech-stack.json'), JSON.stringify({ preset: 'java-modern', ai_design: { type: 'claude-design' } }));
    writeFileSync(join(dir, '.ddt', 'design', 'tokens.json'), '{}');
    writeFileSync(join(dir, '.ddt', 'design', 'components-inventory.md'), '# Components\n');

    // derive 仍应可以跑（其他文件齐全）
    const r = spawnSync(process.execPath, [DERIVE_BIN, '--channel', 'claude-design'], {
      cwd: dir, encoding: 'utf8',
    });
    // 此场景下 03-api-contract.yaml 也缺，派发会失败 OR 部分成功
    // 我们只验证：如果 03b 文件被创建了，应该是占位 hint（fallback 路径）
    const summaryPath = join(dir, '.ddt', 'design', 'claude-design', 'upload-package', '03b-contract-summary.md');
    if (existsSync(summaryPath)) {
      const content = readFileSync(summaryPath, 'utf8');
      assert.match(content, /自动生成失败|api-contract\.yaml.*?不存在/i,
        'yaml 缺失时应输出占位 hint（含错误说明）');
    }
  } finally { cleanup(dir); }
});
