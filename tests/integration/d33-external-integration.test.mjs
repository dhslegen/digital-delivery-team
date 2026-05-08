// v0.9.16 D33：外部集成审计 + Spring 6 RestClient 骨架生成
//
// 实战暴露：alv-ops/server 与外部平台耦合度 0%（NeolixClient 类不存在 / 18 endpoint 0 调用 /
// VehicleService.triggerSync 返回假 success / app.neolix 配置无 Bean 消费）。专家三方对比
// 证实 server 端就是"假后端"。
//
// D33 修通用问题（项目特定让 LLM）：
//   1. bin/audit-external-integration.mjs：扫 brief §11 vs server client 类
//   2. bin/generate-external-client.mjs：生成 Spring 6 RestClient 6 个核心类骨架
//   3. backend-development SKILL Phase 2 强制"外部 endpoint × server Client" 映射表
//   4. Don't 段加"假 sync 反模式"
//   5. build-api.md Phase 5 调 audit

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const AUDIT_BIN = join(ROOT, 'bin', 'audit-external-integration.mjs');
const GEN_BIN = join(ROOT, 'bin', 'generate-external-client.mjs');
const BE_SKILL = join(ROOT, 'skills', 'backend-development', 'SKILL.md');
const BUILD_API_CMD = join(ROOT, 'commands', 'build-api.md');

function readBin(p) { return readFileSync(p, 'utf8'); }
function makeTmpDir() { return mkdtempSync(join(tmpdir(), 'ddt-d33-')); }
function cleanup(dir) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }

const FAKE_BRIEF = `# Brief

## §11 集成依赖（第三方 API 契约）

### 新石器无人车开放平台

| 项目 | 值 |
|---|---|
| 系统名称 | 新石器无人车开放平台 API 文档 |
| 契约文档 | \`项目资料/无人车开放平台API/\` |
| 鉴权基地址 | \`https://scapi.neolix.net/openapi-platform/api\` |
| Cloud API 基地址 | \`https://scapi.neolix.net/openapi-server/slvapi\` |
| Video API 基地址 | \`https://scapi.neolix.net/openapi-platform/api/video\` |
| 鉴权方式 | OAuth2 client_credentials |
| Endpoint 总数 | 19 个 |
`;

function makeServerProject(dir) {
  const javaSrc = join(dir, 'src', 'main', 'java', 'com', 'example', 'app');
  mkdirSync(javaSrc, { recursive: true });
  writeFileSync(join(javaSrc, 'AppApplication.java'), `package com.example.app;
import org.springframework.boot.autoconfigure.SpringBootApplication;
@SpringBootApplication
public class AppApplication { }
`);
  return javaSrc;
}

// ============================================================================
// 1. audit-external-integration
// ============================================================================

test('D33: audit-external-integration --dry-run 输出 6 步计划', () => {
  const r = spawnSync(process.execPath, [AUDIT_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /§11|集成依赖/);
  assert.match(r.stdout, /client|oauth|properties|signature/i);
  assert.match(r.stdout, /假 sync|triggerSync/);
});

test('D33: audit-external-integration brief 缺失时 exit 2', () => {
  const dir = makeTmpDir();
  try {
    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
  } finally { cleanup(dir); }
});

test('D33: audit-external-integration server 全空时报告耦合度 0% / 0/4 核心类', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    makeServerProject(join(dir, 'server'));

    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'stderr=' + r.stderr);
    const reportPath = join(dir, 'docs', 'external-integration-audit.md');
    assert.ok(existsSync(reportPath));
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /耦合度.*0%|0%.*耦合度/, '应报 0% 耦合度');
    assert.match(report, /🔴/, '应评 🔴 严重错位');
    assert.match(report, /Properties.*?❌/, '应报告 Properties 缺失');
    assert.match(report, /OAuth.*?❌/, '应报告 OAuth 缺失');
    assert.match(report, /HTTP 调用点[\s\S]*?\*\*0 个\*\*/, '应报告 0 HTTP 调用点');
  } finally { cleanup(dir); }
});

test('D33: audit-external-integration 检测假 sync 反模式', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    const javaSrc = makeServerProject(join(dir, 'server'));

    // 写一个含假 sync 的 Service
    mkdirSync(join(javaSrc, 'service'), { recursive: true });
    writeFileSync(join(javaSrc, 'service', 'VehicleService.java'), `package com.example.app.service;
public class VehicleService {
  public Map<String,Object> triggerSync() {
    // 实际同步逻辑由 NeolixApiClient 实现；此处返回占位结果
    return Map.of("inserted", 0, "status", "COMPLETED");
  }
}
`);

    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    const report = readFileSync(join(dir, 'docs', 'external-integration-audit.md'), 'utf8');
    assert.match(report, /假\s*Sync\s*反模式|假.*sync.*hot-list/i, '应识别假 sync 反模式');
    assert.match(report, /VehicleService/, '应定位到 VehicleService');
  } finally { cleanup(dir); }
});

// ============================================================================
// 2. generate-external-client
// ============================================================================

test('D33: generate-external-client --dry-run 输出 5 步计划 + 6 个文件', () => {
  const r = spawnSync(process.execPath, [GEN_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  for (const file of ['Properties', 'SignatureUtil', 'OAuthService', 'Client', 'MockClient', 'ClientConfig']) {
    assert.match(r.stdout, new RegExp(file), 'dry-run 应列 ' + file);
  }
});

test('D33: generate-external-client 在 brief 缺失时 exit 2', () => {
  const dir = makeTmpDir();
  try {
    makeServerProject(join(dir, 'server'));
    const r = spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 2);
  } finally { cleanup(dir); }
});

test('D33: generate-external-client 生成 6 个 Java 类', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    const javaSrc = makeServerProject(join(dir, 'server'));

    const r = spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'stderr=' + r.stderr);

    const targetDir = join(javaSrc, 'external', 'neolix');
    assert.ok(existsSync(targetDir), '应创建 external/neolix 目录');

    for (const file of ['NeolixProperties.java', 'NeolixSignatureUtil.java', 'NeolixOAuthService.java',
                        'NeolixClient.java', 'NeolixMockClient.java', 'NeolixClientConfig.java']) {
      assert.ok(existsSync(join(targetDir, file)), file + ' 应生成');
    }
  } finally { cleanup(dir); }
});

test('D33: generated NeolixProperties 含 @ConfigurationProperties + 关键字段', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    const javaSrc = makeServerProject(join(dir, 'server'));
    spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });

    const propsContent = readFileSync(join(javaSrc, 'external', 'neolix', 'NeolixProperties.java'), 'utf8');
    assert.match(propsContent, /@ConfigurationProperties\(prefix\s*=\s*"app\.neolix"\)/);
    assert.match(propsContent, /baseUrlOauth/);
    assert.match(propsContent, /baseUrlCloud/);
    assert.match(propsContent, /baseUrlVideo/);
    assert.match(propsContent, /appId/);
    assert.match(propsContent, /appSecret/);
    assert.match(propsContent, /mockEnabled/);
  } finally { cleanup(dir); }
});

test('D33: generated NeolixMockClient 含 @Profile("!prod") + ConditionalOnProperty', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    const javaSrc = makeServerProject(join(dir, 'server'));
    spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });

    const mockContent = readFileSync(join(javaSrc, 'external', 'neolix', 'NeolixMockClient.java'), 'utf8');
    assert.match(mockContent, /@Profile\("!prod"\)/);
    assert.match(mockContent, /@ConditionalOnProperty.*?mock-enabled/);
    assert.match(mockContent, /implements NeolixClient/);
    assert.match(mockContent, /listVehicles/);
    assert.match(mockContent, /MOCK-V001|fixture/i);
  } finally { cleanup(dir); }
});

test('D33: generate-external-client 已存在文件不覆盖', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    const javaSrc = makeServerProject(join(dir, 'server'));
    const targetDir = join(javaSrc, 'external', 'neolix');
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, 'NeolixClient.java'), '// LLM 自定义实现，不应被覆盖');

    const r = spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);

    const content = readFileSync(join(targetDir, 'NeolixClient.java'), 'utf8');
    assert.match(content, /LLM 自定义实现/, '已存在文件应保留');
    assert.match(r.stdout, /已存在/, '应报告跳过');
  } finally { cleanup(dir); }
});

test('D33: generate-external-client 推断 base package（@SpringBootApplication 包）', () => {
  const dir = makeTmpDir();
  try {
    writeFileSync(join(dir, 'project-brief.md'), FAKE_BRIEF);
    makeServerProject(join(dir, 'server'));

    const r = spawnSync(process.execPath, [GEN_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /com\.example\.app/, '应推断出正确 base package');
  } finally { cleanup(dir); }
});

// ============================================================================
// 3. backend-development SKILL + build-api 集成
// ============================================================================

test('D33: backend-development SKILL Phase 2 强制 External Endpoint × Client 映射表', () => {
  const text = readFileSync(BE_SKILL, 'utf8');
  assert.match(text, /External\s+(?:Endpoint|Integration).*?Client|外部.*?Client.*?映射/i);
  assert.match(text, /v0\.9\.16 D33|D33.*?强制/);
  assert.match(text, /generate-external-client/);
});

test('D33: backend-development SKILL Don\'t 段含"假 sync 反模式"', () => {
  const text = readFileSync(BE_SKILL, 'utf8');
  assert.match(text, /假\s*sync\s*反模式|triggerSync.*?假|假.*?triggerSync/i);
  assert.match(text, /MockClient|RealClient/, '应给替代方案示例');
});

test('D33: build-api.md Phase VERIFY 调 audit-external-integration', () => {
  const text = readFileSync(BUILD_API_CMD, 'utf8');
  assert.match(text, /audit-external-integration\.mjs/, 'build-api 应引用 audit 脚本');
});

test('D33: backend-development SKILL Phase 5 含 audit-external-integration', () => {
  const text = readFileSync(BE_SKILL, 'utf8');
  assert.match(text, /audit-external-integration/, 'SKILL Phase 5 应引用 audit');
  assert.match(text, /external-integration-audit\.md/, '应引用报告路径');
});
