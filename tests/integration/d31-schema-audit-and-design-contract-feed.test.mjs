// v0.9.14 D31：design-execute 上游 contract 摘要 + audit-schema-alignment 字段层对齐
//
// 实战暴露：alv-ops 项目 web mock 字段 vs contract schema 平均一致比例 21%（17/28 命中）
// 严重错位 — 主要来自 claude-design bundle 凭"视觉合理性"生造 x/y/sla/level/progress 等
// contract 没有的字段。v0.9.13 D30 解决"是否调 API"，但 schema 字段层错位未触及。
//
// 用户洞察：上游修复 + 事后兜底 + 设计层冲突警示。
//
// D31 修：
//   1. 新增 bin/extract-contract-summary.mjs：types.ts → 紧凑 schema 字段摘要
//      让 design AI 一眼看到字段名清单，不再被 94KB yaml 注意力稀释
//   2. 新增 bin/audit-schema-alignment.mjs：mock 字段 vs schema 三方差集
//      输出 docs/schema-audit.md 含详细差集 + 反模式 hot-list + 设计层冲突
//   3. derive-channel-package.mjs：派发包加 03b-contract-summary.md（缺失时占位）
//   4. claude-design.template.md：prompt 加"必须先扫 03b 找字段名"硬要求 + 反模式黑名单
//   5. build-web.md Phase 5 + frontend-development SKILL：调 audit-schema-alignment

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
const AUDIT_BIN = join(ROOT, 'bin', 'audit-schema-alignment.mjs');
const DERIVE_BIN = join(ROOT, 'bin', 'derive-channel-package.mjs');
const CD_TEMPLATE = join(ROOT, 'templates', 'prompts', 'claude-design.template.md');
const FE_SKILL = join(ROOT, 'skills', 'frontend-development', 'SKILL.md');
const BUILD_WEB_CMD = join(ROOT, 'commands', 'build-web.md');

function readBin(p) { return readFileSync(p, 'utf8'); }
function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d31-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

// 简化的 types.ts fixture（含一个 RealtimeVehicle schema）
const FAKE_TYPES_TS = `
export interface paths {
    "/realtime/vehicles": {};
}
export interface components {
    schemas: {
        ApiResponseRealtimeVehicleList: {
            success: boolean;
            data?: RealtimeVehicleList;
        };
        RealtimeVehicle: {
            vin: string;
            parkCode: string;
            brand?: string;
            lon: number;
            lat: number;
            speed?: number;
            realBattery?: number;
            powerState: boolean;
            status: "ON_TASK" | "IDLE" | "CHARGING";
        };
        RealtimeVehicleList: {
            lastRefreshAt: string;
            vehicles: components["schemas"]["RealtimeVehicle"][];
        };
        Alert: {
            id: number;
            vin: string;
            alertType: "STUCK" | "LOW_BATTERY";
            status: "ACTIVE" | "ENDED" | "PROCESSED";
            occurAt: string;
        };
    };
}
`;

// ============================================================================
// 1. extract-contract-summary 行为
// ============================================================================

test('D31: extract-contract-summary --dry-run 输出 6 步计划', () => {
  const r = spawnSync(process.execPath, [EXTRACT_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (let i = 1; i <= 6; i++) {
    assert.match(r.stdout, new RegExp('^' + i + '\\.', 'm'), '应有第 ' + i + ' 步');
  }
});

test('D31: extract-contract-summary 在缺 types.ts 时 exit 2 + 引导用户跑 generate-api-client', () => {
  const dir = makeTmpDir();
  try {
    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /types\.ts.*?不存在/);
    assert.match(r.stderr, /generate-api-client/);
  } finally { cleanup(dir); }
});

test('D31: extract-contract-summary 解析 types.ts 输出紧凑 schema 摘要', () => {
  const dir = makeTmpDir();
  try {
    const apiDir = join(dir, 'web', 'src', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'types.ts'), FAKE_TYPES_TS);

    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /## RealtimeVehicle/, '应输出 RealtimeVehicle schema');
    assert.match(r.stdout, /lon: number/, '应含 lon 字段');
    assert.match(r.stdout, /lat: number/, '应含 lat 字段');
    assert.match(r.stdout, /enum\["ON_TASK","IDLE","CHARGING"\]/, '应识别 enum 值');
    assert.match(r.stdout, /反模式黑名单/, '应附反模式黑名单');
  } finally { cleanup(dir); }
});

test('D31: extract-contract-summary 过滤 ApiResponseX / PageX 包装类', () => {
  const dir = makeTmpDir();
  try {
    const apiDir = join(dir, 'web', 'src', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'types.ts'), FAKE_TYPES_TS);

    const r = spawnSync(process.execPath, [EXTRACT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.ok(!/## ApiResponseRealtimeVehicleList/.test(r.stdout),
      '应过滤 ApiResponseX 包装类');
    assert.match(r.stdout, /## RealtimeVehicleList/, '业务包装类（含 list 字段）应保留');
  } finally { cleanup(dir); }
});

// ============================================================================
// 2. audit-schema-alignment 字段差集行为
// ============================================================================

test('D31: audit-schema-alignment --dry-run 输出 9 步计划', () => {
  const r = spawnSync(process.execPath, [AUDIT_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /反模式 hot-list/, 'dry-run 应说明 hot-list');
  assert.match(r.stdout, /设计层冲突/, 'dry-run 应说明设计层冲突');
});

test('D31: audit-schema-alignment 检测 mock 字段 vs schema 差集 + hot-list', () => {
  const dir = makeTmpDir();
  try {
    const apiDir = join(dir, 'web', 'src', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'types.ts'), FAKE_TYPES_TS);

    // mock 用 x/y/level/sla（虚构字段）
    const pageDir = join(dir, 'web', 'src', 'pages');
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, 'ParkMap.tsx'), `
const VEHICLES = [
  { id: 'V001', x: 32, y: 41, status: 'moving', battery: 78 },
  { id: 'V002', x: 48, y: 35, status: 'idle', battery: 64 },
  { id: 'V003', x: 56, y: 52, status: 'charging', battery: 91 },
];
`);
    writeFileSync(join(pageDir, 'AlertsPage.tsx'), `
const ALERTS = [
  { id: 'A1', level: 'err', t: '10:24', sla: 600, v: 'V001' },
  { id: 'A2', level: 'warn', t: '10:18', sla: 1200, v: 'V002' },
  { id: 'A3', level: 'err', t: '10:14', sla: 80, v: 'V003' },
];
`);

    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'audit 应 0 退出（warning 不阻塞）');

    const reportPath = join(dir, 'docs', 'schema-audit.md');
    assert.ok(existsSync(reportPath), '应输出 schema-audit.md');

    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /VEHICLES.*RealtimeVehicle|RealtimeVehicle.*VEHICLES/, '应匹配 VEHICLES → RealtimeVehicle');
    assert.match(report, /ALERTS.*Alert|Alert.*ALERTS/, '应匹配 ALERTS → Alert');
    assert.match(report, /反模式 hot-list/, '应有 hot-list 段');
    assert.match(report, /`x`.*应改用 lon/, 'hot-list 应指出 x → lon');
    assert.match(report, /`y`.*应改用 lat/, 'hot-list 应指出 y → lat');
    assert.match(report, /`level`/, 'hot-list 应识别 level 虚构字段');
    assert.match(report, /`sla`/, 'hot-list 应识别 sla 虚构字段');
    assert.match(report, /设计层冲突/, '应有设计层冲突段（VEHICLES 含 x/y）');
    assert.match(report, /行动建议/, '应有行动建议段');
  } finally { cleanup(dir); }
});

test('D31: audit-schema-alignment 严重错位时评级 🔴', () => {
  const dir = makeTmpDir();
  try {
    const apiDir = join(dir, 'web', 'src', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'types.ts'), FAKE_TYPES_TS);
    const pageDir = join(dir, 'web', 'src', 'pages');
    mkdirSync(pageDir, { recursive: true });
    writeFileSync(join(pageDir, 'p.tsx'), `
const VEHICLES = [
  { x: 1, y: 2, level: 'err', sla: 100, t: '10:00' },
  { x: 3, y: 4, level: 'warn', sla: 200, t: '11:00' },
  { x: 5, y: 6, level: 'err', sla: 300, t: '12:00' },
];
`);
    spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    const report = readFileSync(join(dir, 'docs', 'schema-audit.md'), 'utf8');
    assert.match(report, /🔴.*严重错位|严重错位.*🔴/, '应评 🔴 严重错位');
  } finally { cleanup(dir); }
});

test('D31: audit-schema-alignment 跳过自动生成产物（types.ts / client.ts / tests）', () => {
  const dir = makeTmpDir();
  try {
    const apiDir = join(dir, 'web', 'src', 'api');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'types.ts'), FAKE_TYPES_TS);
    // client.ts 含 const 数组 → 应被忽略
    writeFileSync(join(apiDir, 'client.ts'), `
const HEADERS = [
  { name: 'a', val: 1 },
  { name: 'b', val: 2 },
  { name: 'c', val: 3 },
];
`);

    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    const report = readFileSync(join(dir, 'docs', 'schema-audit.md'), 'utf8');
    assert.ok(!/HEADERS/.test(report), '应跳过 api/client.ts 中的 mock');
  } finally { cleanup(dir); }
});

// ============================================================================
// 3. derive-channel-package 派发包加 03b-contract-summary
// ============================================================================

test('D31: derive-channel-package.mjs 派发包加 03b-contract-summary.md', () => {
  const text = readBin(DERIVE_BIN);
  assert.match(text, /03b-contract-summary\.md/, 'derive 应写入 03b-contract-summary.md');
  assert.match(text, /docs\/contract-summary\.md/, '应引用 docs/contract-summary.md 作源');
});

// ============================================================================
// 4. claude-design.template.md prompt 加硬约束
// ============================================================================

test('D31: claude-design.template.md 上下文段含 03b-contract-summary.md 引用', () => {
  const text = readBin(CD_TEMPLATE);
  assert.match(text, /03b-contract-summary\.md/, 'prompt 应引用 03b 文件');
  assert.match(text, /v0\.9\.14 D31/, '应标记 D31 版本');
  assert.match(text, /94KB|注意力稀释/, '应说明完整 yaml 注意力稀释问题');
});

test('D31: claude-design.template.md 禁止段含 D31 实战黑名单（x/y/sla/level/progress）', () => {
  const text = readBin(CD_TEMPLATE);
  assert.match(text, /生造视觉用虚构字段/, '禁止段应明示反模式');
  assert.match(text, /`x`.*`y`|`x`.*`y`.*`sla`/, '应列出 x/y/sla 反例');
  assert.match(text, /`level`.*`progress`|`progress`.*`level`/, '应列出 level/progress 反例');
});

// ============================================================================
// 5. build-web Phase 5 + frontend-development SKILL 集成 audit
// ============================================================================

test('D31: build-web.md Phase 5 调 audit-schema-alignment', () => {
  const text = readFileSync(BUILD_WEB_CMD, 'utf8');
  assert.match(text, /audit-schema-alignment\.mjs/, 'build-web 应引用 audit 脚本');
});

test('D31: frontend-development SKILL Phase 5 含 audit-schema-alignment', () => {
  const text = readFileSync(FE_SKILL, 'utf8');
  assert.match(text, /audit-schema-alignment/, 'SKILL Phase 5 应引用 audit');
  assert.match(text, /schema-audit\.md/, 'SKILL 应引用 docs/schema-audit.md 报告');
});
