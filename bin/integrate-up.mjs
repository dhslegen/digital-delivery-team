#!/usr/bin/env node
// DDT v0.9.11 D28 · /integrate 命令的核心起栈 + smoke 编排
//
// 用途：从代码完成（/impl）到栈跑起来（前后端进程 + db + redis）的桥接。
// 输入：项目根 + .ddt/tech-stack.json + 可选 docker-compose.yml
// 输出：docs/integrate-report.md
//
// 8 个阶段：
//   1. 环境侦测：docker / docker-compose / port 8080 5173 占用 / tech-stack.json
//   2. docker-compose 准备：用户项目有就用之；没有从 plugin 模板复制（按 preset）
//   3. 起基础组件：docker compose up -d + 等 healthcheck
//   4. db migration：按 tech-stack 跑（mvn flyway:migrate / npx prisma migrate / ...）
//   5. 起 server 后台：mvn spring-boot:run / npm run dev / ... → 写 .ddt/integrate/server.pid
//   6. 起 web 后台：npm run dev → 写 .ddt/integrate/web.pid
//   7. smoke：GET 后端 health + 1 个 OpenAPI 抽出的 GET endpoint + web 端口监听
//   8. 报告 + 可选拆环境
//
// 用法：
//   node bin/integrate-up.mjs               # 默认：起栈 + smoke + 保留 stack
//   node bin/integrate-up.mjs --dry-run     # 仅输出 checklist 不实际跑
//   node bin/integrate-up.mjs --tear-down   # 起栈 → smoke → 拆栈（CI/演示模式）
//   node bin/integrate-up.mjs --skip-smoke  # 起栈但跳过 smoke（仅环境就绪）
//
// 退出码：
//   0 成功
//   1 参数错误
//   2 docker / docker-compose 不可用
//   3 docker-compose up 失败
//   4 db migration 失败
//   5 server 启动超时（健康检查 60s 未就绪）
//   6 web 启动超时
//   7 smoke 测试失败
//   8 端口冲突（8080 / 5173 已占用）

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = dirname(dirname(__filename));
const COMPOSE_TEMPLATES_DIR = join(PLUGIN_ROOT, 'templates', 'docker-compose');

const PROJECT_ROOT = process.cwd();
const DDT_DIR = join(PROJECT_ROOT, '.ddt', 'integrate');
const REPORT_PATH = join(PROJECT_ROOT, 'docs', 'integrate-report.md');
const COMPOSE_PATH = join(PROJECT_ROOT, 'docker-compose.yml');
const TECH_STACK_PATH = join(PROJECT_ROOT, '.ddt', 'tech-stack.json');

// ============================================================================
// 工具函数
// ============================================================================

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function portInUse(port) {
  const r = spawnSync('lsof', ['-i', `:${port}`, '-P', '-sTCP:LISTEN'], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim().length > 0;
}

function readTechStack() {
  if (!existsSync(TECH_STACK_PATH)) return null;
  try { return JSON.parse(readFileSync(TECH_STACK_PATH, 'utf8')); } catch { return null; }
}

function presetOf(techStack) {
  return techStack?.preset || techStack?.id || 'unknown';
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

function timestamp() { return new Date().toISOString(); }

// ============================================================================
// Phase / 报告状态机
// ============================================================================

class Reporter {
  constructor() {
    this.phases = [];
    this.startTime = Date.now();
  }
  begin(name) {
    const phase = { name, start: Date.now(), status: 'running', error: null, notes: [] };
    this.phases.push(phase);
    console.log(`▶ ${name}`);
    return phase;
  }
  ok(phase, note) {
    phase.status = 'ok';
    phase.duration_ms = Date.now() - phase.start;
    if (note) phase.notes.push(note);
    console.log(`  ✅ ${phase.name}（${phase.duration_ms} ms）${note ? ' — ' + note : ''}`);
  }
  fail(phase, error) {
    phase.status = 'fail';
    phase.duration_ms = Date.now() - phase.start;
    phase.error = String(error?.message || error);
    console.error(`  ❌ ${phase.name}：${phase.error}`);
  }
  skip(phase, reason) {
    phase.status = 'skip';
    phase.duration_ms = Date.now() - phase.start;
    phase.notes.push(reason);
    console.log(`  ⏭️  ${phase.name} 跳过：${reason}`);
  }
  writeReport() {
    ensureDir(dirname(REPORT_PATH));
    const overall = this.phases.every(p => p.status !== 'fail') ? 'PASS' : 'FAIL';
    const totalMs = Date.now() - this.startTime;
    const lines = [
      `# /integrate 报告 · ${overall}`,
      '',
      `> 生成时间：${timestamp()}（耗时 ${(totalMs / 1000).toFixed(1)}s）`,
      '',
      '| Phase | 状态 | 耗时 | 备注 |',
      '|---|---|---|---|',
    ];
    for (const p of this.phases) {
      const icon = p.status === 'ok' ? '✅' : p.status === 'fail' ? '❌' : '⏭️';
      const dur = p.duration_ms != null ? `${p.duration_ms}ms` : '—';
      const note = (p.notes.join('; ') + (p.error ? ` ⚠️ ${p.error}` : '')) || '—';
      lines.push(`| ${p.name} | ${icon} ${p.status} | ${dur} | ${note} |`);
    }
    lines.push('', '## 下一步', '');
    if (overall === 'PASS') {
      lines.push('- ✅ 栈已就绪，跑 `/digital-delivery-team:verify` 进入 test + review 阶段');
    } else {
      const failed = this.phases.find(p => p.status === 'fail');
      lines.push(`- ❌ 阻塞在 phase \`${failed?.name}\`：${failed?.error}`);
      lines.push('- 修复后重跑 `/digital-delivery-team:integrate`');
    }
    writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
    console.log(`\n📄 报告已写入：${REPORT_PATH}`);
    return overall;
  }
}

// ============================================================================
// Phase 1: 环境侦测
// ============================================================================

function detectEnv(reporter, args) {
  const phase = reporter.begin('1. 环境侦测');
  const issues = [];
  const docker = which('docker');
  const dockerCompose = docker ? spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0 : false;
  if (!docker) issues.push('docker 未安装');
  else if (!dockerCompose) issues.push('docker compose（v2）不可用');

  if (portInUse(8080) && !args['skip-server']) issues.push('端口 8080 已被占用（可能已有 server 在跑）');
  if (portInUse(5173) && !args['skip-web']) issues.push('端口 5173 已被占用（可能已有 vite 在跑）');

  const techStack = readTechStack();
  if (!techStack) issues.push('.ddt/tech-stack.json 不存在（先跑 /design）');

  if (issues.length) {
    reporter.fail(phase, issues.join('; '));
    return null;
  }
  reporter.ok(phase, `preset=${presetOf(techStack)}`);
  return { techStack, preset: presetOf(techStack) };
}

// ============================================================================
// Phase 2: docker-compose 准备
// ============================================================================

function prepareCompose(reporter, preset) {
  const phase = reporter.begin('2. docker-compose 准备');
  if (existsSync(COMPOSE_PATH)) {
    reporter.ok(phase, `用户已有 docker-compose.yml（保留不动）`);
    return COMPOSE_PATH;
  }
  // 按 preset 复制模板
  const template = join(COMPOSE_TEMPLATES_DIR, `${preset}.yml`);
  if (!existsSync(template)) {
    reporter.skip(phase, `preset=${preset} 无 docker-compose 模板（go-modern / python-fastapi 等暂未自动支持，请手动起 db）`);
    return null;
  }
  copyFileSync(template, COMPOSE_PATH);
  reporter.ok(phase, `从 plugin 模板复制 → ${COMPOSE_PATH}`);
  return COMPOSE_PATH;
}

// ============================================================================
// Phase 3: 起基础组件 + healthcheck
// ============================================================================

async function dockerComposeUp(reporter, composePath) {
  const phase = reporter.begin('3. 起基础组件（docker compose up）');
  if (!composePath) {
    reporter.skip(phase, '无 docker-compose 配置');
    return false;
  }
  const r = spawnSync('docker', ['compose', '-f', composePath, 'up', '-d', '--wait'], {
    cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status !== 0) {
    reporter.fail(phase, `docker compose up 失败: ${r.stderr || r.stdout}`);
    return false;
  }
  reporter.ok(phase, '基础组件已启动并通过 healthcheck');
  return true;
}

// ============================================================================
// Phase 4: db migration
// ============================================================================

const MIGRATION_BY_PRESET = {
  'java-modern': { dir: 'server', cmd: 'mvn', args: ['flyway:migrate'], skipIf: (root) => !existsSync(join(root, 'server', 'src', 'main', 'resources', 'db', 'migration')) },
  'node-modern': { dir: 'server', cmd: 'npx', args: ['prisma', 'migrate', 'deploy'], skipIf: (root) => !existsSync(join(root, 'server', 'prisma', 'schema.prisma')) },
  'python-fastapi': { dir: 'server', cmd: 'poetry', args: ['run', 'alembic', 'upgrade', 'head'], skipIf: (root) => !existsSync(join(root, 'server', 'alembic.ini')) },
};

function runMigration(reporter, preset) {
  const phase = reporter.begin('4. db migration');
  const cfg = MIGRATION_BY_PRESET[preset];
  if (!cfg) { reporter.skip(phase, `preset=${preset} 不支持自动迁移，请手动跑`); return true; }
  if (cfg.skipIf && cfg.skipIf(PROJECT_ROOT)) {
    reporter.skip(phase, `${preset}: 未发现迁移目录/配置文件，假设无 schema 变更`);
    return true;
  }
  const cwd = join(PROJECT_ROOT, cfg.dir);
  if (!existsSync(cwd)) { reporter.skip(phase, `${cfg.dir}/ 目录不存在`); return true; }
  const r = spawnSync(cfg.cmd, cfg.args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) {
    reporter.fail(phase, `${cfg.cmd} ${cfg.args.join(' ')} 失败: ${r.stderr || r.stdout}`);
    return false;
  }
  reporter.ok(phase, `${cfg.cmd} ${cfg.args.join(' ')} 成功`);
  return true;
}

// ============================================================================
// Phase 5/6: 起 server / web 后台
// ============================================================================

const START_BY_PRESET = {
  'java-modern': {
    server: { dir: 'server', cmd: 'mvn', args: ['spring-boot:run'], healthUrl: 'http://localhost:8080/actuator/health', fallbackHealthUrl: 'http://localhost:8080/' },
    web: { dir: 'web', cmd: 'npm', args: ['run', 'dev'], readyPort: 5173 },
  },
  'node-modern': {
    server: { dir: 'server', cmd: 'npm', args: ['run', 'start:dev'], healthUrl: 'http://localhost:8080/health', fallbackHealthUrl: 'http://localhost:8080/' },
    web: { dir: 'web', cmd: 'npm', args: ['run', 'dev'], readyPort: 5173 },
  },
};

async function pollHealth(url, timeoutMs = 60000, intervalMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (r.status >= 200 && r.status < 500) return true;  // 任何非 5xx 都算 server 起来了
    } catch {}
    await sleep(intervalMs);
  }
  return false;
}

async function pollPort(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (portInUse(port)) return true;
    await sleep(1000);
  }
  return false;
}

function spawnDetached(cmd, args, cwd, logPath) {
  ensureDir(dirname(logPath));
  const out = require('node:fs').openSync(logPath, 'a');
  const child = spawn(cmd, args, {
    cwd, detached: true, stdio: ['ignore', out, out], env: { ...process.env },
  });
  child.unref();
  return child.pid;
}

async function startServer(reporter, preset, args) {
  const phase = reporter.begin('5. 启 server 后台');
  if (args['skip-server']) { reporter.skip(phase, '--skip-server'); return true; }
  const cfg = START_BY_PRESET[preset]?.server;
  if (!cfg) { reporter.skip(phase, `preset=${preset} 无 server 启动配置`); return true; }
  const cwd = join(PROJECT_ROOT, cfg.dir);
  if (!existsSync(cwd)) { reporter.skip(phase, `${cfg.dir}/ 目录不存在`); return true; }

  ensureDir(DDT_DIR);
  const logPath = join(DDT_DIR, 'server.log');
  const pid = spawnDetached(cfg.cmd, cfg.args, cwd, logPath);
  writeFileSync(join(DDT_DIR, 'server.pid'), String(pid));

  // 等 server 起来：先试 healthUrl 再 fallback
  let ok = await pollHealth(cfg.healthUrl, 60000);
  if (!ok && cfg.fallbackHealthUrl) ok = await pollHealth(cfg.fallbackHealthUrl, 15000);

  if (!ok) {
    reporter.fail(phase, `server 60s 内未就绪（PID ${pid}）；查看 ${logPath}`);
    return false;
  }
  reporter.ok(phase, `server 已就绪（PID ${pid}）`);
  return true;
}

async function startWeb(reporter, preset, args) {
  const phase = reporter.begin('6. 启 web 后台');
  if (args['skip-web']) { reporter.skip(phase, '--skip-web'); return true; }
  const cfg = START_BY_PRESET[preset]?.web;
  if (!cfg) { reporter.skip(phase, `preset=${preset} 无 web 启动配置`); return true; }
  const cwd = join(PROJECT_ROOT, cfg.dir);
  if (!existsSync(cwd)) { reporter.skip(phase, `${cfg.dir}/ 目录不存在`); return true; }

  const logPath = join(DDT_DIR, 'web.log');
  const pid = spawnDetached(cfg.cmd, cfg.args, cwd, logPath);
  writeFileSync(join(DDT_DIR, 'web.pid'), String(pid));

  const ok = await pollPort(cfg.readyPort, 30000);
  if (!ok) {
    reporter.fail(phase, `web 30s 内端口 ${cfg.readyPort} 未监听（PID ${pid}）；查看 ${logPath}`);
    return false;
  }
  reporter.ok(phase, `web dev server 监听 :${cfg.readyPort}（PID ${pid}）`);
  return true;
}

// ============================================================================
// Phase 7: smoke
// ============================================================================

function extractFirstGetEndpoint(yamlPath) {
  if (!existsSync(yamlPath)) return null;
  const text = readFileSync(yamlPath, 'utf8');
  // 简化 YAML 解析：找 paths: 后第一个 /xxx + 下一行的 get:
  const lines = text.split(/\r?\n/);
  let inPaths = false, currentPath = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^paths\s*:/.test(line)) { inPaths = true; continue; }
    if (inPaths) {
      const indent = line.match(/^(\s*)/)[1].length;
      if (indent === 0 && line.trim() && !line.startsWith('#')) { inPaths = false; break; }
      const m = line.match(/^\s{2}(\/[^\s:]+)\s*:/);
      if (m) currentPath = m[1];
      if (currentPath && /^\s{4}get\s*:/.test(line)) return currentPath;
    }
  }
  return null;
}

async function runSmoke(reporter, preset, args) {
  const phase = reporter.begin('7. smoke 测试');
  if (args['skip-smoke']) { reporter.skip(phase, '--skip-smoke'); return true; }
  if (args['skip-server'] && args['skip-web']) {
    reporter.skip(phase, '--skip-server + --skip-web');
    return true;
  }

  const checks = [];
  // 后端 health
  if (!args['skip-server']) {
    const cfg = START_BY_PRESET[preset]?.server;
    if (cfg) {
      try {
        const r = await fetch(cfg.healthUrl, { signal: AbortSignal.timeout(5000) });
        checks.push({ name: `GET ${cfg.healthUrl}`, status: r.status, ok: r.status < 500 });
      } catch (e) {
        checks.push({ name: `GET ${cfg.healthUrl}`, status: 'error', ok: false, error: e.message });
      }
    }

    // OpenAPI 抽 1 个核心 endpoint
    const apiContract = join(PROJECT_ROOT, 'docs', 'api-contract.yaml');
    const endpoint = extractFirstGetEndpoint(apiContract);
    if (endpoint) {
      const url = `http://localhost:8080${endpoint}`;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        checks.push({ name: `GET ${endpoint}`, status: r.status, ok: r.status < 500 });
      } catch (e) {
        checks.push({ name: `GET ${endpoint}`, status: 'error', ok: false, error: e.message });
      }
    }
  }

  // 前端端口监听已在 Phase 6 验证
  if (!args['skip-web']) {
    checks.push({ name: 'web :5173 监听', status: portInUse(5173) ? 'listening' : 'not-listening', ok: portInUse(5173) });
  }

  const failed = checks.filter(c => !c.ok);
  if (failed.length > 0) {
    reporter.fail(phase, `${failed.length}/${checks.length} smoke 失败：${failed.map(f => `${f.name}=${f.status}`).join(', ')}`);
    return false;
  }
  reporter.ok(phase, `${checks.length}/${checks.length} smoke 通过：${checks.map(c => `${c.name}=${c.status}`).join(', ')}`);
  return true;
}

// ============================================================================
// Phase 8: 拆环境（可选）
// ============================================================================

function killPid(pidFile) {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (Number.isFinite(pid) && pid > 0) {
    try { process.kill(pid, 'SIGTERM'); } catch {}
  }
}

async function tearDown(reporter, composePath) {
  const phase = reporter.begin('8. 拆环境');
  killPid(join(DDT_DIR, 'server.pid'));
  killPid(join(DDT_DIR, 'web.pid'));
  if (composePath) {
    spawnSync('docker', ['compose', '-f', composePath, 'down'], { cwd: PROJECT_ROOT, encoding: 'utf8' });
  }
  reporter.ok(phase, '后台进程已 SIGTERM；docker compose down');
}

// ============================================================================
// 主入口
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) args[a.slice(2)] = true;
    else args._.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args['dry-run']) {
    console.log('# /integrate 计划（--dry-run）');
    console.log('1. 环境侦测：docker / docker-compose / port 占用 / .ddt/tech-stack.json');
    console.log('2. docker-compose 准备：项目根 docker-compose.yml 或 plugin 模板复制');
    console.log('3. docker compose up -d --wait（等 healthcheck）');
    console.log('4. db migration（按 preset：mvn flyway / npx prisma migrate / alembic upgrade）');
    console.log('5. 启 server 后台（mvn spring-boot:run / npm run start:dev）+ 等 health 60s');
    console.log('6. 启 web 后台（npm run dev）+ 等端口 :5173 30s');
    console.log('7. smoke：health endpoint + OpenAPI 第一个 GET endpoint + web 端口');
    console.log('8. 报告 docs/integrate-report.md');
    console.log('   --tear-down 时拆环境；默认保留供 /verify 使用');
    process.exit(0);
  }

  const reporter = new Reporter();

  // Phase 1
  const env = detectEnv(reporter, args);
  if (!env) { reporter.writeReport(); process.exit(2); }

  // Phase 2
  const composePath = prepareCompose(reporter, env.preset);

  // Phase 3
  if (composePath) {
    const ok = await dockerComposeUp(reporter, composePath);
    if (!ok) { reporter.writeReport(); process.exit(3); }
  }

  // Phase 4
  if (!runMigration(reporter, env.preset)) {
    reporter.writeReport();
    process.exit(4);
  }

  // Phase 5
  const serverOk = await startServer(reporter, env.preset, args);
  if (!serverOk) { reporter.writeReport(); process.exit(5); }

  // Phase 6
  const webOk = await startWeb(reporter, env.preset, args);
  if (!webOk) { reporter.writeReport(); process.exit(6); }

  // Phase 7
  const smokeOk = await runSmoke(reporter, env.preset, args);
  if (!smokeOk) {
    if (args['tear-down']) await tearDown(reporter, composePath);
    reporter.writeReport();
    process.exit(7);
  }

  // Phase 8
  if (args['tear-down']) {
    await tearDown(reporter, composePath);
  } else {
    reporter.begin('8. 拆环境').status = 'skip';
    const last = reporter.phases[reporter.phases.length - 1];
    last.status = 'skip';
    last.duration_ms = 0;
    last.notes.push('--keep-stack（默认）：栈保留供 /verify 使用；手动 `docker compose down` 清理');
    console.log('  ⏭️  保留栈供 /verify 使用（加 --tear-down 自动拆）');
  }

  reporter.writeReport();
  process.exit(0);
}

// require for spawnDetached writeStream
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

main().catch(e => {
  console.error('❌ 未捕获异常:', e);
  process.exit(1);
});
