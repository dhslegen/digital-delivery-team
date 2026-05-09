#!/usr/bin/env node
// DDT v0.9.20 D36 · 部署事实采集器
//
// 用途：在 /package Phase 1 自动跑——采集项目实际部署配置（密码/端口/actuator/...），
// 输出 .ddt/deployment-facts.json 给 docs-agent 必读，禁止 LLM 凭常识填硬编码 root/actuator。
//
// 设计哲学：
//   - 配置 driven：扫 application*.yml / pom.xml / package.json / docker-compose 等真实配置
//   - 失败不阻塞：扫不到就标 unknown 让 docs-agent 提示用户补全，不 fail-fast
//   - 输出双格式：deployment-facts.json（agent 读）+ deployment-facts.md（人读）
//
// 用法：
//   node bin/audit-deployment-config.mjs                # 默认扫当前目录
//   node bin/audit-deployment-config.mjs --dry-run      # 仅输出计划
//   node bin/audit-deployment-config.mjs --server=server --web=web   # 自定义子目录
//
// 退出码：0 成功（含 unknown 标记） / 1 参数错误

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';

const PROJECT_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      args[k] = v ?? true;
    } else args._.push(a);
  }
  return args;
}

function readText(p) {
  try { return readFileSync(p, 'utf8'); } catch { return null; }
}

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// ============================================================================
// Spring Boot 事实采集（application*.yml）
// ============================================================================

// 解析 ${DB_PASS:custompwd} 形式的默认值
function extractYamlDefault(text, key) {
  if (!text) return null;
  // key: ${ENV_VAR:default}
  const re = new RegExp(`${key}:\\s*\\$\\{[A-Z_][A-Z0-9_]*:([^}]*)\\}`);
  const m = text.match(re);
  if (m) return { value: m[1], source: 'env-default' };
  // key: literal （直接字面量）
  const reLit = new RegExp(`^\\s*${key}:\\s*([^\\n#$]+?)\\s*$`, 'm');
  const m2 = text.match(reLit);
  if (m2) return { value: m2[1].trim(), source: 'literal' };
  return null;
}

// 提取 datasource url 中的端口和数据库名
function parseJdbcUrl(url) {
  if (!url) return {};
  // jdbc:mysql://host:port/database?...
  const m = url.match(/jdbc:(\w+):\/\/([^:\/]+)(?::(\d+))?\/([^?\s]+)/);
  if (m) {
    return { driver: m[1], host: m[2], port: m[3] ? parseInt(m[3], 10) : null, database: m[4] };
  }
  return {};
}

function auditSpringBoot(serverDir) {
  const facts = { kind: 'spring-boot', detected: false };
  const resourcesDir = join(serverDir, 'src', 'main', 'resources');
  if (!existsSync(resourcesDir)) return facts;

  // 找所有 application*.yml / .properties
  const files = readdirSync(resourcesDir).filter(f =>
    /^application(-[\w]+)?\.(yml|yaml|properties)$/.test(f)
  );
  if (files.length === 0) return facts;

  facts.detected = true;
  facts.config_files = files;

  // 合并所有 yml 文本（dev profile 优先，profile-default 次之）
  const devFile = files.find(f => f.includes('-dev.')) || files[0];
  const baseFile = files.find(f => /^application\.(yml|yaml|properties)$/.test(f));
  const devText = devFile ? readText(join(resourcesDir, devFile)) : '';
  const baseText = baseFile ? readText(join(resourcesDir, baseFile)) : '';
  const merged = (devText || '') + '\n' + (baseText || '');

  // 提取 datasource
  const dbUser = extractYamlDefault(merged, 'username');
  const dbPass = extractYamlDefault(merged, 'password');
  // 找 url 字段——只在 datasource 段下找，避免误匹配 redis url
  const datasourceBlock = merged.match(/datasource:[\s\S]{0,500}?url:\s*([^\s\n]+)/);
  const jdbcUrl = datasourceBlock ? datasourceBlock[1] : null;
  const parsedUrl = parseJdbcUrl(jdbcUrl);

  facts.datasource = {
    url: jdbcUrl || null,
    driver: parsedUrl.driver || null,
    host: parsedUrl.host || null,
    port: parsedUrl.port || null,
    database: parsedUrl.database || null,
    username_default: dbUser?.value || null,
    password_default: dbPass?.value || null,
    password_source: dbPass?.source || 'unknown',
  };

  // server.port + servlet.context-path
  const portMatch = merged.match(/server:\s*[\s\S]{0,200}?port:\s*(\d+)/);
  const ctxMatch = merged.match(/servlet:\s*[\s\S]{0,200}?context-path:\s*(\S+)/);
  facts.server = {
    port: portMatch ? parseInt(portMatch[1], 10) : 8080,
    context_path: ctxMatch ? ctxMatch[1].replace(/['"]/g, '') : '',
  };

  // 检测 actuator 依赖（pom.xml / build.gradle）
  const pomText = readText(join(serverDir, 'pom.xml'));
  const gradleText = readText(join(serverDir, 'build.gradle')) || readText(join(serverDir, 'build.gradle.kts'));
  const hasActuator =
    (pomText && /spring-boot-starter-actuator/.test(pomText)) ||
    (gradleText && /spring-boot-starter-actuator/.test(gradleText));
  facts.actuator = {
    dependency_present: !!hasActuator,
    // 即使有依赖，也要看是否暴露 health endpoint
    exposure_configured: /management:[\s\S]{0,500}?exposure:[\s\S]{0,200}?include:\s*[^\n]*health/.test(merged),
  };
  facts.actuator.health_available = facts.actuator.dependency_present && facts.actuator.exposure_configured;

  return facts;
}

// ============================================================================
// 前端事实采集（package.json / vite.config / next.config）
// ============================================================================

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function auditFrontend(webDir) {
  const facts = { detected: false };
  const pkgPath = join(webDir, 'package.json');
  if (!existsSync(pkgPath)) return facts;
  facts.detected = true;
  const pkg = readJson(pkgPath) || {};
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

  // 推断 framework + dev port
  if (deps.next) {
    facts.framework = 'next';
    facts.dev_port = 3000; // Next.js 默认
  } else if (deps.vite) {
    facts.framework = 'vite';
    facts.dev_port = 5173; // Vite 默认
    // 看 vite.config.* 是否覆写 port
    const cfgFiles = ['vite.config.ts', 'vite.config.js', 'vite.config.mts'];
    for (const f of cfgFiles) {
      const text = readText(join(webDir, f));
      if (text) {
        const portMatch = text.match(/server:\s*\{[\s\S]{0,300}?port:\s*(\d+)/);
        if (portMatch) facts.dev_port = parseInt(portMatch[1], 10);
        break;
      }
    }
  } else if (deps['react-scripts']) {
    facts.framework = 'cra';
    facts.dev_port = 3000;
  } else {
    facts.framework = 'unknown';
    facts.dev_port = null;
  }

  facts.scripts = {
    dev: pkg.scripts?.dev || pkg.scripts?.start || null,
    build: pkg.scripts?.build || null,
  };

  return facts;
}

// ============================================================================
// docker-compose 事实采集
// ============================================================================

function auditDockerCompose(projectRoot) {
  const facts = { detected: false, files: [] };
  const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  for (const f of candidates) {
    const p = join(projectRoot, f);
    if (existsSync(p)) {
      facts.files.push(f);
      facts.detected = true;
      const text = readText(p);
      // 提取 MYSQL_ROOT_PASSWORD（环境变量或字面量）
      const pwdMatch = text.match(/MYSQL_ROOT_PASSWORD:\s*([^\s\n]+)/);
      if (pwdMatch) {
        const v = pwdMatch[1].replace(/['"]/g, '');
        // ${PWD:-default} 形式
        const envM = v.match(/\$\{[A-Z_][A-Z0-9_]*:?-?([^}]*)\}/);
        facts.mysql_root_password = envM ? envM[1] : v;
      }
      const dbMatch = text.match(/MYSQL_DATABASE:\s*([^\s\n]+)/);
      if (dbMatch) facts.mysql_database = dbMatch[1].replace(/['"]/g, '');
    }
  }
  return facts;
}

// ============================================================================
// smoke endpoint 推断
// ============================================================================

function inferSmokeEndpoint(serverFacts, projectRoot) {
  // 优先 1：actuator/health 真实可用
  if (serverFacts?.actuator?.health_available) {
    const ctx = serverFacts.server?.context_path || '';
    return {
      method: 'GET',
      path: `${ctx}/actuator/health`,
      auth_required: false,
      reason: 'Spring Boot actuator endpoint detected',
    };
  }
  // 优先 2：扫 api-contract.yaml 找第一个无认证 GET endpoint
  const contractPath = join(projectRoot, 'docs', 'api-contract.yaml');
  const contract = readText(contractPath);
  if (contract) {
    // 简易匹配：找第一个 GET 路径
    const getMatches = [...contract.matchAll(/^\s+(\/[a-z\/\{\}_-]+):\s*\n\s+get:/gm)];
    if (getMatches.length > 0) {
      const ctx = serverFacts?.server?.context_path || '';
      return {
        method: 'GET',
        path: `${ctx}${getMatches[0][1]}`,
        auth_required: true,  // 大部分业务 endpoint 需要 token，提醒用户
        reason: 'Fallback: first GET endpoint in api-contract.yaml (likely needs auth token)',
      };
    }
  }
  // 优先 3：约定俗成的 /auth/login（POST）
  return {
    method: 'POST',
    path: `${serverFacts?.server?.context_path || ''}/auth/login`,
    auth_required: false,
    reason: 'Convention: assume /auth/login exists; verify in api-contract.yaml',
    body_hint: '{"username":"<admin>","password":"<password>"}',
  };
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serverDir = join(PROJECT_ROOT, args.server || 'server');
  const webDir = join(PROJECT_ROOT, args.web || 'web');
  const outJson = join(PROJECT_ROOT, '.ddt', 'deployment-facts.json');
  const outMd = join(PROJECT_ROOT, 'docs', 'deployment-facts.md');

  if (args['dry-run']) {
    console.log('# audit-deployment-config.mjs --dry-run');
    console.log('1. 扫 ' + serverDir + '/src/main/resources/application*.yml + pom.xml/build.gradle');
    console.log('2. 扫 ' + webDir + '/package.json + vite.config.* / next.config.*');
    console.log('3. 扫 ' + PROJECT_ROOT + '/docker-compose*.yml');
    console.log('4. 扫 ' + PROJECT_ROOT + '/docs/api-contract.yaml 推断 smoke endpoint');
    console.log('5. 输出 ' + outJson + '（agent 读）');
    console.log('6. 输出 ' + outMd + '（人读，含派生命令示例）');
    process.exit(0);
  }

  const facts = {
    schema_version: 1,
    audited_at: new Date().toISOString(),
    project_root: PROJECT_ROOT,
    server: auditSpringBoot(serverDir),
    web: auditFrontend(webDir),
    docker_compose: auditDockerCompose(PROJECT_ROOT),
  };
  facts.smoke_endpoint = inferSmokeEndpoint(facts.server, PROJECT_ROOT);

  // 派生：docker run mysql 的实际密码（容器密码 ≠ 应用配置密码会很常见）
  // 推断顺序：docker-compose 实际值 > server datasource 默认值 > 占位 'CHANGEME'
  const mysqlPwd =
    facts.docker_compose?.mysql_root_password ||
    facts.server?.datasource?.password_default ||
    'CHANGEME';
  facts.derived = {
    mysql_root_password: mysqlPwd,
    mysql_password_source:
      facts.docker_compose?.mysql_root_password ? 'docker-compose' :
      facts.server?.datasource?.password_default ? 'application.yml-default' :
      'placeholder',
    mysql_database: facts.docker_compose?.mysql_database || facts.server?.datasource?.database || 'app',
    full_health_url: `http://localhost:${facts.server?.server?.port || 8080}${facts.smoke_endpoint?.path}`,
  };

  // 写 JSON（agent 读）
  ensureDir(dirname(outJson));
  writeFileSync(outJson, JSON.stringify(facts, null, 2));

  // 写 Markdown（人读）
  ensureDir(dirname(outMd));
  writeFileSync(outMd, renderMarkdown(facts));

  // stdout 摘要
  console.log('✅ 部署事实采集完成');
  console.log(`   server: ${facts.server.detected ? facts.server.kind : '未检测到'}`);
  if (facts.server.detected) {
    console.log(`   db.password: ${facts.derived.mysql_password_source} = "${facts.derived.mysql_root_password}"`);
    console.log(`   actuator: ${facts.server.actuator?.health_available ? '✅ /actuator/health 可用' : '❌ 未装或未暴露'}`);
  }
  console.log(`   web: ${facts.web.detected ? facts.web.framework + ' (port ' + facts.web.dev_port + ')' : '未检测到'}`);
  console.log(`   smoke: ${facts.smoke_endpoint.method} ${facts.smoke_endpoint.path} (${facts.smoke_endpoint.reason})`);
  console.log(`   产物：${outJson}`);
  console.log(`   产物：${outMd}`);
}

function renderMarkdown(facts) {
  const lines = [];
  lines.push('# 部署事实采集报告');
  lines.push('');
  lines.push(`> 由 DDT v0.9.20 D36 \`bin/audit-deployment-config.mjs\` 采集 · ${facts.audited_at}`);
  lines.push('> docs-agent 在生成 deploy.md 时**必读本文件**，禁止凭常识填硬编码值。');
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push('| 维度 | 事实 | 来源 |');
  lines.push('|---|---|---|');
  if (facts.server.detected) {
    lines.push(`| MySQL root 密码 | \`${facts.derived.mysql_root_password}\` | ${facts.derived.mysql_password_source} |`);
    lines.push(`| MySQL 数据库名 | \`${facts.derived.mysql_database}\` | ${facts.docker_compose.detected ? 'docker-compose' : 'application.yml'} |`);
    lines.push(`| 后端端口 | \`${facts.server.server.port}\` | application.yml |`);
    lines.push(`| 后端 context-path | \`${facts.server.server.context_path || '(none)'}\` | application.yml |`);
    const actuatorOk = facts.server.actuator.health_available;
    const depTxt = facts.server.actuator.dependency_present ? '已装' : '未装';
    const expoTxt = facts.server.actuator.exposure_configured ? '已配' : '未配';
    const actuatorCell = actuatorOk ? '✅ 是' : `❌ **否**（依赖${depTxt}，暴露${expoTxt}）`;
    lines.push(`| Actuator health 可用 | ${actuatorCell} | pom.xml + application.yml |`);
  }
  if (facts.web.detected) {
    lines.push(`| 前端框架 | \`${facts.web.framework}\` | package.json |`);
    lines.push(`| 前端 dev 端口 | \`${facts.web.dev_port || 'unknown'}\` | ${facts.web.framework} 默认 / vite.config |`);
  }
  lines.push(`| Smoke endpoint | \`${facts.smoke_endpoint.method} ${facts.smoke_endpoint.path}\` | ${facts.smoke_endpoint.reason} |`);
  lines.push('');

  lines.push('## docs-agent 必填规则');
  lines.push('');
  lines.push('生成 deploy.md 时：');
  lines.push('');
  lines.push(`1. **MySQL 启动命令**必须用 \`MYSQL_ROOT_PASSWORD=${facts.derived.mysql_root_password}\` —— 与应用配置一致，避免演示时 \`Access denied\``);
  lines.push(`2. **smoke 测试第一步**必须用 \`${facts.smoke_endpoint.method} ${facts.smoke_endpoint.path}\` —— ${facts.smoke_endpoint.reason}`);
  if (!facts.server.actuator?.health_available) {
    lines.push(`3. **不得使用 \`/actuator/health\`** —— actuator ${facts.server.actuator?.dependency_present ? '已依赖但未配 exposure' : '依赖未装'}，调用会返回 404 \`No static resource\``);
  }
  if (facts.smoke_endpoint.auth_required) {
    lines.push(`4. **smoke 第一步需要先获取 token** —— 该 endpoint 需鉴权，建议先 POST /auth/login 拿 token`);
  }

  lines.push('');
  lines.push('## 完整事实（JSON）');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(facts, null, 2));
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

main().catch(e => {
  console.error('❌ 未捕获异常:', e);
  process.exit(1);
});
