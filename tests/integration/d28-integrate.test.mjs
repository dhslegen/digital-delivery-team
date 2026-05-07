// v0.9.11 D28：/integrate 命令 + bin/integrate-up.mjs 静态约束 + dry-run 行为
//
// 实战暴露：用户跑 /build-web 和 /build-api 后，DDT 推荐 /test，但
// 数据库 / Redis / server / web 进程都没起，前后端从未真实联调过——
// /test 跑的是 mock + 单元，不是真实集成。/impl → /verify 之间缺"栈跑起来"环节。
//
// v0.9.11 D28 新增 /integrate 命令填补这一环。本测试用例守门：
//   1. commands/integrate.md 存在 + 8 phase 结构
//   2. bin/integrate-up.mjs --dry-run 输出 8 步计划
//   3. templates/docker-compose/{java-modern,node-modern}.yml 存在 + 含必需 service
//   4. commands/impl.md 推荐下一步已切到 /integrate
//   5. commands/verify.md 加软提醒（不强制）
//   6. integrate.md 含 8 phase exit code 表 + 自助 troubleshooting
//
// 不测：实际 docker compose up（CI 没 docker）/ 实际起 server-web（需真实项目）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const INTEGRATE_CMD = join(ROOT, 'commands', 'integrate.md');
const INTEGRATE_BIN = join(ROOT, 'bin', 'integrate-up.mjs');
const COMPOSE_DIR = join(ROOT, 'templates', 'docker-compose');
const IMPL_CMD = join(ROOT, 'commands', 'impl.md');
const VERIFY_CMD = join(ROOT, 'commands', 'verify.md');

// ============================================================================
// commands/integrate.md 静态结构
// ============================================================================

test('D28: commands/integrate.md 存在且含 frontmatter description', () => {
  assert.ok(existsSync(INTEGRATE_CMD));
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /^---\ndescription:\s*集成验证/m, '应有 description frontmatter');
  assert.match(text, /argument-hint:/, '应有 argument-hint frontmatter');
});

test('D28: integrate.md 含 8 phase exit code 表（让用户自助 troubleshooting）', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /Phase\s*\|\s*动作\s*\|\s*失败退出码/, '应有 phase 表头');
  for (const exitCode of ['2', '3', '4', '5', '6', '7']) {
    assert.match(text, new RegExp(`exit ${exitCode}:`), `应有 exit ${exitCode} 自助描述`);
  }
});

test('D28: integrate.md 含 8 个核心 phase 关键词', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  for (const kw of ['环境侦测', 'docker-compose', 'docker compose up', 'db migration', '启 server', '启 web', 'smoke', '报告']) {
    assert.match(text, new RegExp(kw), `应含关键词 "${kw}"`);
  }
});

test('D28: integrate.md 推荐下一步 = /verify（建议链路）', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /建议下一步.*?\/verify/, '应推荐 /verify 作下一步');
});

// ============================================================================
// bin/integrate-up.mjs --dry-run 行为
// ============================================================================

test('D28: bin/integrate-up.mjs --dry-run 输出 8 步计划', () => {
  const r = spawnSync(process.execPath, [INTEGRATE_BIN, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `--dry-run 应成功；stderr=${r.stderr}`);
  const out = r.stdout;
  for (let i = 1; i <= 8; i++) {
    assert.match(out, new RegExp(`^${i}\\.`, 'm'), `应有第 ${i} 步`);
  }
  assert.match(out, /docker compose up -d --wait/, 'Phase 3 应说明 healthcheck');
  assert.match(out, /OpenAPI.*GET endpoint|GET endpoint.*OpenAPI/i, 'Phase 7 应说明从 OpenAPI 抽 endpoint');
});

test('D28: bin/integrate-up.mjs 是 ESM + node shebang', () => {
  const text = readFileSync(INTEGRATE_BIN, 'utf8');
  assert.match(text, /^#!\/usr\/bin\/env node/, '应有 node shebang');
  assert.match(text, /^import\s/m, '应使用 ESM import');
});

// ============================================================================
// docker-compose 模板
// ============================================================================

test('D28: templates/docker-compose/java-modern.yml 含 mysql + redis services', () => {
  const path = join(COMPOSE_DIR, 'java-modern.yml');
  assert.ok(existsSync(path), 'java-modern compose 模板应存在');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^\s*mysql\s*:/m, '应含 mysql service');
  assert.match(text, /^\s*redis\s*:/m, '应含 redis service');
  assert.match(text, /healthcheck/m, '应有 healthcheck（让 docker compose up --wait 可用）');
  assert.match(text, /3306:3306/, '应映射 3306');
  assert.match(text, /6379:6379/, '应映射 6379');
});

test('D28: templates/docker-compose/node-modern.yml 含 postgres + redis services', () => {
  const path = join(COMPOSE_DIR, 'node-modern.yml');
  assert.ok(existsSync(path), 'node-modern compose 模板应存在');
  const text = readFileSync(path, 'utf8');
  assert.match(text, /^\s*postgres\s*:/m, '应含 postgres service');
  assert.match(text, /^\s*redis\s*:/m, '应含 redis service');
  assert.match(text, /healthcheck/m);
  assert.match(text, /5432:5432/, '应映射 5432');
});

// ============================================================================
// 上下游链路对齐
// ============================================================================

test('D28: commands/impl.md 推荐下一步已切到 /integrate（不再直接 /verify）', () => {
  const text = readFileSync(IMPL_CMD, 'utf8');
  assert.match(text, /\/integrate/, 'impl.md 应引用 /integrate');
  // 决策门 description 应说"进入 /integrate"
  assert.match(text, /进入\s*\/integrate/, '决策门 accept 选项应说进入 /integrate');
});

test('D28: commands/verify.md 加 /integrate 软提醒（不阻塞）', () => {
  const text = readFileSync(VERIFY_CMD, 'utf8');
  assert.match(text, /docs\/integrate-report\.md/, 'verify.md 应检测 integrate-report');
  assert.match(text, /建议先.*\/integrate|\/integrate.*建议/, '应有建议性提示');
  // 不应有 exit 1（强制阻塞）
  const verifyChecks = text.match(/test -f docs\/integrate-report.md[\s\S]*?fi/);
  if (verifyChecks) {
    assert.ok(!/exit\s*[1-9]/.test(verifyChecks[0]),
      '/integrate 缺失检测不应包含 exit 退出码（仅软提醒）');
  }
});

// ============================================================================
// 一致性
// ============================================================================

test('D28: commands/integrate.md 引用 bin/integrate-up.mjs 绝对路径', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /\$DDT_PLUGIN_ROOT\/bin\/integrate-up\.mjs/, '应用 $DDT_PLUGIN_ROOT 绝对路径');
});

test('D28: integrate.md 设计原则段含 stage-appropriate / preset 渐进', () => {
  const text = readFileSync(INTEGRATE_CMD, 'utf8');
  assert.match(text, /stage-appropriate/, '应含 stage-appropriate 原则');
  assert.match(text, /preset 渐进|渐进支持/, '应说明 preset 渐进支持（go / python 暂未自动）');
  assert.match(text, /soft over hard|软提醒/, '应说明 /verify 软依赖');
});
