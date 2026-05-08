// v0.9.12 D29：/integrate 实战调优 — 框架性问题修复（不动 known issues 数据库）
//
// 实战暴露：用户跑 /integrate 时 v0.9.11 在 Phase 1 直接 fail（docker compose v2 不可用），
// 但用户系统其实有 docker-compose v5 standalone + 已运行的 Colima 容器。
// 同时报告也没生成（fail-fast 提前 exit），让用户失去观察整体阻塞模式的能力。
//
// 用户洞察："每个项目的具体问题都不一样，让 LLM 自己处理；脚本只修通用问题"。
// 因此 D29 只修 6 个框架性问题，不硬编码 known issues：
//   1. docker compose 多路径检测（v2 plugin → v1 standalone）
//   2. 已运行栈兜底（端口 listen 视为已就绪，自动 --reuse-stack）
//   3. 端口 8080/5173 已占用 issue → warning
//   4. db migration 加 Spring Boot schema.sql 识别（多路径）
//   5. smoke 自动 NO_PROXY 绕代理
//   6. try/finally 保证报告必落
//
// 不测：实际 docker compose up（CI 没 docker） / 实际起 server-web

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const INTEGRATE_BIN = join(ROOT, 'bin', 'integrate-up.mjs');
const INTEGRATE_CMD = join(ROOT, 'commands', 'integrate.md');

function readBin() { return readFileSync(INTEGRATE_BIN, 'utf8'); }

// ============================================================================
// 1. docker compose 多路径检测
// ============================================================================

test('D29: detectComposeRunner 函数支持 v2 plugin + v1 standalone fallback', () => {
  const text = readBin();
  assert.match(text, /function\s+detectComposeRunner/, '应有 detectComposeRunner');
  assert.match(text, /compose-v2.*?docker.*?compose/s, '应试 docker compose（v2 plugin）');
  assert.match(text, /compose-v1.*?docker-compose/s, '应 fallback docker-compose（v1 standalone）');
});

test('D29: detectRunningInfra 检测 :3306 :5432 :6379 已运行的基础组件', () => {
  const text = readBin();
  assert.match(text, /function\s+detectRunningInfra/, '应有 detectRunningInfra');
  // 必须含三个常见 db 端口
  assert.match(text, /3306[\s\S]*?MySQL/);
  assert.match(text, /5432[\s\S]*?PostgreSQL/);
  assert.match(text, /6379[\s\S]*?Redis/);
});

// ============================================================================
// 2. detectEnv 行为：端口已占用降级 + 已运行栈兜底
// ============================================================================

test('D29: detectEnv 端口 8080/5173 已占用从 issue 改 warning', () => {
  const text = readBin();
  // 关键：portInUse(8080) 应紧跟 warnings.push 而非 issues.push
  // 用更精确的正则：portInUse(8080) 后 ~200 字符内出现 warnings.push
  const port8080Block = text.match(/portInUse\(8080\)[\s\S]{0,300}/);
  assert.ok(port8080Block, '应有 portInUse(8080) 检测');
  assert.match(port8080Block[0], /warnings\.push/, '8080 已占用应进 warnings');
  assert.ok(!/issues\.push/.test(port8080Block[0].split('\n').slice(0, 3).join('\n')),
    '8080 已占用不应进 issues（v0.9.11 BUG）');

  const port5173Block = text.match(/portInUse\(5173\)[\s\S]{0,300}/);
  assert.ok(port5173Block, '应有 portInUse(5173) 检测');
  assert.match(port5173Block[0], /warnings\.push/, '5173 已占用应进 warnings');
});

test('D29: detectEnv 在 docker compose 不可用但已运行栈存在时自动启用 --reuse-stack', () => {
  const text = readBin();
  const m = text.match(/function\s+detectEnv[\s\S]+?\n\}/);
  const body = m[0];
  // 应有"compose 不可用 + 已运行栈" 路径
  assert.match(body, /!composeRunner/, '应判断 composeRunner 不可用');
  assert.match(body, /runningInfra\.length\s*>\s*0/, '应判断已运行栈');
  assert.match(body, /reuse-stack.*=\s*true/, '应自动启用 reuse-stack');
});

test('D29: detectEnv 检测 HTTP_PROXY 给 warning（不是 issue）', () => {
  const text = readBin();
  const m = text.match(/function\s+detectEnv[\s\S]+?\n\}/);
  const body = m[0];
  assert.match(body, /HTTP_PROXY|http_proxy/, '应读环境变量 HTTP_PROXY');
  assert.match(body, /NO_PROXY/, '应说明 NO_PROXY 绕过');
});

// ============================================================================
// 3. db migration 多路径
// ============================================================================

test('D29: detectMigrationPaths 识别 Spring Boot schema.sql / data.sql', () => {
  const text = readBin();
  assert.match(text, /function\s+detectMigrationPaths/, '应有 detectMigrationPaths');
  assert.match(text, /schema\.sql/, '应识别 schema.sql');
  assert.match(text, /data\.sql/, '应识别 data.sql');
  assert.match(text, /spring-sql-init/, '应有 spring-sql-init kind');
});

test('D29: runMigration spring-sql-init 仅 hint 不强跑', () => {
  const text = readBin();
  const m = text.match(/function\s+runMigration[\s\S]+?\n\}/);
  assert.ok(m, '应找到 runMigration');
  const body = m[0];
  // spring-sql-init 应走 reporter.skip（不强跑）
  assert.match(body, /spring-sql-init[\s\S]*?reporter\.skip/, 'spring-sql-init 应 skip 而非 fail');
  // hint 应说明 spring.sql.init.mode 或手动用 mysql client
  assert.match(body, /spring\.sql\.init\.mode|mysql client/i, '应给 hint 让用户自处理');
});

// ============================================================================
// 4. smoke 自动 NO_PROXY 绕代理
// ============================================================================

test('D29: runSmoke 检测 HTTP_PROXY 后注入 NO_PROXY=localhost,127.0.0.1', () => {
  const text = readBin();
  const m = text.match(/async\s+function\s+runSmoke[\s\S]+?\n\}/);
  assert.ok(m, '应找到 runSmoke');
  const body = m[0];
  assert.match(body, /HTTP_PROXY|http_proxy/, '应检测代理环境变量');
  assert.match(body, /NO_PROXY/, '应注入 NO_PROXY');
  assert.match(body, /localhost.*127\.0\.0\.1|127\.0\.0\.1.*localhost/, '应含 localhost + 127.0.0.1');
});

// ============================================================================
// 5. 失败时 dump log 尾
// ============================================================================

test('D29: tailFile 函数 + server/web 启动失败时输出日志尾到 stderr', () => {
  const text = readBin();
  assert.match(text, /function\s+tailFile/, '应有 tailFile 工具');
  // server.log / web.log 尾输出
  assert.match(text, /server\.log.*?最后\s*30\s*行|tail.*?server\.log/i,
    '应在 server 启动失败时 dump server.log 尾');
  assert.match(text, /web\.log.*?最后\s*30\s*行|tail.*?web\.log/i,
    '应在 web 启动失败时 dump web.log 尾');
});

// ============================================================================
// 6. try/finally 保证报告必落
// ============================================================================

test('D29: main 用 try/finally 保证 reporter.writeReport() 必执行', () => {
  const text = readBin();
  const m = text.match(/async\s+function\s+main[\s\S]+?\n\}\s*\n/);
  assert.ok(m, '应找到 main');
  const body = m[0];
  // 应有 try { ... } finally { reporter.writeReport(); ... }
  assert.match(body, /try\s*\{[\s\S]*?\}\s*finally\s*\{[\s\S]*?writeReport/,
    'main 应有 try/finally 包裹保证 writeReport 必执行');
  // 不应在 phase 失败时直接 process.exit（应通过 exitCode + return）
  const phase5Match = body.match(/Phase 5[\s\S]*?Phase 6/);
  if (phase5Match) {
    assert.ok(!/process\.exit\(5\)/.test(phase5Match[0]),
      'Phase 5 失败不应直接 process.exit(5)（应用 return + exitCode）');
  }
});

// ============================================================================
// 7. dry-run 输出反映 D29 改动
// ============================================================================

test('D29: --dry-run 输出反映新行为（compose 多路径 + reuse-stack + try/finally）', () => {
  const r = spawnSync(process.execPath, [INTEGRATE_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const out = r.stdout;
  assert.match(out, /多路径|fallback|v2.*v1/i, 'dry-run 应说明 docker compose 多路径');
  assert.match(out, /reuse-stack/, 'dry-run 应提及 --reuse-stack');
  assert.match(out, /try\/finally|必落/, 'dry-run 应说明报告必落');
  assert.match(out, /NO_PROXY|代理/, 'dry-run 应说明代理绕过');
});

// ============================================================================
// 8. 命令文档对齐
// ============================================================================

test('D29: commands/integrate.md 加 --reuse-stack 参数说明', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /argument-hint:\s*"[^"\n]*--reuse-stack/, 'argument-hint 应含 --reuse-stack');
  assert.match(text, /##\s*--reuse-stack/, '正文应有 --reuse-stack 段');
  assert.match(text, /Colima/i, '应提到 Colima 等典型场景');
});

test('D29: commands/integrate.md 含设计哲学说明（项目特定问题留 LLM 处理）', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /项目特定|known issues.*LLM|LLM.*智能/,
    '应说明项目特定问题留给 LLM 处理（不硬编码 known issues）');
});
