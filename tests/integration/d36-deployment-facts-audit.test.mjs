// D36 (v0.9.20)：部署事实采集器
//   源自 alv-ops 演示前实战：docs-agent 凭常识填 MYSQL_ROOT_PASSWORD=root +
//   /api/actuator/health 导致演示翻车。
//   修复策略：脚本做事实采集（application.yml + pom.xml + package.json + docker-compose），
//   docs-agent 强制必读 facts.json 禁止凭常识填硬编码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_BIN = path.resolve(__dirname, '../../bin/audit-deployment-config.mjs');

function makeProject(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ddt-d36-'));
  if (opts.springApp) {
    const resDir = path.join(dir, 'server', 'src', 'main', 'resources');
    fs.mkdirSync(resDir, { recursive: true });
    fs.writeFileSync(path.join(resDir, 'application.yml'), opts.springApp.applicationYml || '');
    if (opts.springApp.applicationDevYml) {
      fs.writeFileSync(path.join(resDir, 'application-dev.yml'), opts.springApp.applicationDevYml);
    }
    if (opts.springApp.pomXml !== undefined) {
      fs.mkdirSync(path.join(dir, 'server'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'server', 'pom.xml'), opts.springApp.pomXml);
    }
  }
  if (opts.web) {
    const webDir = path.join(dir, 'web');
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, 'package.json'),
      JSON.stringify(opts.web.packageJson || {}, null, 2));
    if (opts.web.viteConfig !== undefined) {
      fs.writeFileSync(path.join(webDir, 'vite.config.ts'), opts.web.viteConfig);
    }
  }
  if (opts.dockerCompose !== undefined) {
    fs.writeFileSync(path.join(dir, 'docker-compose.yml'), opts.dockerCompose);
  }
  if (opts.apiContract !== undefined) {
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'docs', 'api-contract.yaml'), opts.apiContract);
  }
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

function runAudit(cwd) {
  const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`audit failed: ${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(cwd, '.ddt', 'deployment-facts.json'), 'utf8'));
}

test('D36-A: application-dev.yml 含 ${DB_PASS:custompwd} → facts 提取 custompwd', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      applicationDevYml: `spring:
  datasource:
    url: jdbc:mysql://localhost:3306/myapp
    username: \${DB_USER:admin}
    password: \${DB_PASS:s3cret-pwd}
`,
      pomXml: '<project><dependencies></dependencies></project>',
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.server.detected, true);
    assert.equal(facts.server.datasource.password_default, 's3cret-pwd',
      '应从 ${DB_PASS:s3cret-pwd} 提取默认值，不能填 root 默认');
    assert.equal(facts.server.datasource.username_default, 'admin');
    assert.equal(facts.server.datasource.database, 'myapp');
    assert.equal(facts.derived.mysql_root_password, 's3cret-pwd',
      'derived 字段应优先用 application.yml 默认（无 docker-compose）');
    assert.equal(facts.derived.mysql_password_source, 'application.yml-default');
  } finally { cleanup(dir); }
});

test('D36-B: pom.xml 无 actuator → facts.actuator.health_available=false', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      pomXml: `<project>
  <dependencies>
    <dependency>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>
</project>`,
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.server.actuator.dependency_present, false);
    assert.equal(facts.server.actuator.health_available, false);
    assert.notEqual(facts.smoke_endpoint.path, '/actuator/health',
      'actuator 未装时 smoke endpoint 必须 fallback，不能用 /actuator/health');
  } finally { cleanup(dir); }
});

test('D36-B: pom.xml 有 actuator + yml 含 exposure include health → health_available=true', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: `server:
  port: 8080
management:
  endpoints:
    web:
      exposure:
        include: health,info
`,
      pomXml: `<project>
  <dependencies>
    <dependency>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
  </dependencies>
</project>`,
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.server.actuator.dependency_present, true);
    assert.equal(facts.server.actuator.exposure_configured, true);
    assert.equal(facts.server.actuator.health_available, true);
    assert.match(facts.smoke_endpoint.path, /\/actuator\/health$/,
      'actuator 装好时 smoke 应直接用 /actuator/health');
  } finally { cleanup(dir); }
});

test('D36-B: actuator 依赖装了但 yml 未配 exposure → health_available=false', () => {
  // 微妙场景：依赖装了但 exposure 没配，actuator 也不可用（默认只暴露 health 端点是 spring boot 2.x 行为，3.x 起仍 default-disabled，需要 include）
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      pomXml: `<project>
  <dependencies>
    <dependency>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
  </dependencies>
</project>`,
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.server.actuator.dependency_present, true);
    assert.equal(facts.server.actuator.exposure_configured, false);
    assert.equal(facts.server.actuator.health_available, false,
      '依赖装了但未配 exposure，health endpoint 仍不可用');
  } finally { cleanup(dir); }
});

test('D36-C: vite + vite.config 覆写 port → facts.web.dev_port 用覆写值', () => {
  const dir = makeProject({
    web: {
      packageJson: { name: 'app', dependencies: { vite: '^5.0.0', react: '^18.0.0' } },
      viteConfig: `export default { server: { port: 5174 } }`,
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.web.framework, 'vite');
    assert.equal(facts.web.dev_port, 5174, 'vite.config 覆写优先于默认 5173');
  } finally { cleanup(dir); }
});

test('D36-C: next.js 项目 → dev_port=3000', () => {
  const dir = makeProject({
    web: {
      packageJson: { name: 'app', dependencies: { next: '^14.0.0', react: '^18.0.0' } },
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.web.framework, 'next');
    assert.equal(facts.web.dev_port, 3000);
  } finally { cleanup(dir); }
});

test('D36-D: docker-compose 含 MYSQL_ROOT_PASSWORD → derived 优先用容器值', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: `spring:
  datasource:
    url: jdbc:mysql://localhost:3306/myapp
    password: \${DB_PASS:fallback-pwd}
`,
    },
    dockerCompose: `services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: real-container-pwd
      MYSQL_DATABASE: myapp
`,
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.docker_compose.detected, true);
    assert.equal(facts.docker_compose.mysql_root_password, 'real-container-pwd');
    assert.equal(facts.derived.mysql_root_password, 'real-container-pwd',
      'docker-compose 实际值应优先于 application.yml 默认');
    assert.equal(facts.derived.mysql_password_source, 'docker-compose');
  } finally { cleanup(dir); }
});

test('D36-E: 无 actuator 且有 api-contract → smoke fallback 到第一个 GET endpoint', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n  servlet:\n    context-path: /api\n',
      pomXml: '<project></project>',
    },
    apiContract: `openapi: 3.0.0
paths:
  /tasks:
    get:
      summary: List tasks
  /users:
    get:
      summary: List users
`,
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.smoke_endpoint.method, 'GET');
    assert.match(facts.smoke_endpoint.path, /\/tasks$/, '应取 contract 第一个 GET endpoint');
    assert.equal(facts.smoke_endpoint.auth_required, true,
      'fallback 业务 endpoint 通常需要 auth，应提醒用户');
  } finally { cleanup(dir); }
});

test('D36-F: 无 actuator + 无 api-contract → smoke 兜底到 POST /auth/login', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      pomXml: '<project></project>',
    },
  });
  try {
    const facts = runAudit(dir);
    assert.equal(facts.smoke_endpoint.method, 'POST');
    assert.match(facts.smoke_endpoint.path, /\/auth\/login$/);
    assert.match(facts.smoke_endpoint.body_hint, /username.*password/);
  } finally { cleanup(dir); }
});

test('D36-G: 输出 deployment-facts.md 含 docs-agent 必填规则提示', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      pomXml: '<project></project>',
    },
  });
  try {
    const r = spawnSync(process.execPath, [AUDIT_BIN], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    const md = fs.readFileSync(path.join(dir, 'docs', 'deployment-facts.md'), 'utf8');
    assert.match(md, /docs-agent 必填规则/, 'Markdown 必须含必填规则段');
    assert.match(md, /MYSQL_ROOT_PASSWORD/, '必须给出 MySQL 密码具体指引');
    assert.match(md, /禁止凭常识/, '必须有反模式警告');
    assert.match(md, /不得使用.*\/actuator\/health/, '无 actuator 时必须警告不能用该路径');
  } finally { cleanup(dir); }
});

test('D36-H: dry-run 不写文件，只输出计划', () => {
  const dir = makeProject({
    springApp: {
      applicationYml: 'server:\n  port: 8080\n',
      pomXml: '<project></project>',
    },
  });
  try {
    const r = spawnSync(process.execPath, [AUDIT_BIN, '--dry-run'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /扫.*application.*yml/);
    assert.equal(fs.existsSync(path.join(dir, '.ddt', 'deployment-facts.json')), false,
      '--dry-run 不应写文件');
  } finally { cleanup(dir); }
});

test('D36-I: docs-agent.md 含 D36 Hard Requirement', () => {
  const agentMd = fs.readFileSync(
    path.resolve(__dirname, '../../agents/docs-agent.md'), 'utf8'
  );
  assert.match(agentMd, /\.ddt\/deployment-facts\.json/, 'docs-agent 必读文件应在 Inputs 列出');
  assert.match(agentMd, /D36.*部署事实优先/, '应有 D36 Hard Requirement 标注');
  assert.match(agentMd, /禁止凭常识填/, '必须有禁止凭常识填的硬约束');
});

test('D36-I: package.md Phase 1 调用 audit-deployment-config', () => {
  const cmdMd = fs.readFileSync(
    path.resolve(__dirname, '../../commands/package.md'), 'utf8'
  );
  assert.match(cmdMd, /audit-deployment-config\.mjs/,
    '/package Phase 1 必须调用 audit 脚本');
});

test('D36-I: delivery-package skill 含 5 个事实驱动字段', () => {
  const skillMd = fs.readFileSync(
    path.resolve(__dirname, '../../skills/delivery-package/SKILL.md'), 'utf8'
  );
  assert.match(skillMd, /事实驱动.*D36|D36.*事实驱动/, 'skill 必须有 D36 事实驱动段');
  assert.match(skillMd, /facts\.derived\.mysql_root_password/);
  assert.match(skillMd, /facts\.smoke_endpoint/);
  assert.match(skillMd, /facts\.web\.dev_port/);
});
