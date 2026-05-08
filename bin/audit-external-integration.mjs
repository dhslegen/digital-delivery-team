#!/usr/bin/env node
// DDT v0.9.16 D33 · 外部集成审计：brief §11 vs server 实际 client 类
//
// 用途：v0.9.13 D30 解决了 web mock；v0.9.14-15 D31-32 解决了 design AI 字段约束；
// 但 server 端的"假 service"问题没人检测——alv-ops 实测 server 与外部平台耦合度 0%
// （NeolixClient 类不存在 / 18 endpoint 全没调 / VehicleService.triggerSync 返回假成功）。
// 本脚本做事后审计：扫 brief §11 标注的外部依赖，与 server/src 的实际 client 类对照。
//
// 输入：
//   project-brief.md §11 集成依赖（指向 API 文档目录）
//   server/src/main/java（找 client / properties / service triggerSync 反模式）
//   server/src/main/resources/application*.yml（看外部配置是否被消费）
// 输出：docs/external-integration-audit.md

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';

const PROJECT_ROOT = process.cwd();

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=');
      const next = argv[i + 1];
      if (v !== undefined) { args[k] = v; }
      else if (next !== undefined && !next.startsWith('--')) { args[k] = next; i++; }
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

// ============================================================================
// 1. 解析 brief §11（找契约目录 + 鉴权方式 + endpoint 数）
// ============================================================================

function parseBriefIntegration(briefText) {
  const result = { systems: [], hasIntegration: false };

  // 找 §11 集成依赖段
  const m = briefText.match(/##\s+(?:§11\s+)?集成依赖[\s\S]*?(?=\n##\s|\n#\s|$)/);
  if (!m) return result;
  result.hasIntegration = true;

  const block = m[0];

  // 抽每个第三方系统（### 第三方系统：X 或 ### 系统名）
  const sysMatches = [...block.matchAll(/###\s+(?:第三方系统[：:]\s*)?([^\n]+)/g)];

  for (const sm of sysMatches) {
    const name = sm[1].trim();
    // 抽契约文档路径
    const contractMatch = block.slice(sm.index).match(/契约文档[^\n]*?[`'"]([^`'"\n]+)[`'"]/);
    // 抽 endpoint 数
    const epCountMatch = block.slice(sm.index).match(/Endpoint[^\d]*?(\d+)/i);
    // 抽鉴权方式
    const authMatch = block.slice(sm.index).match(/鉴权方式[^\n]*?\|\s*([^\n|]+)/);
    // 抽基础 URL（多个）
    const urlMatches = [...block.slice(sm.index).matchAll(/(https?:\/\/[a-z0-9.\-/]+)/gi)];

    result.systems.push({
      name,
      contractDir: contractMatch ? contractMatch[1].trim() : null,
      endpointCount: epCountMatch ? parseInt(epCountMatch[1]) : null,
      authMethod: authMatch ? authMatch[1].trim() : null,
      baseUrls: [...new Set(urlMatches.map(u => u[1]))].slice(0, 5),
    });
  }

  return result;
}

// ============================================================================
// 2. 扫 server/src 找外部 client 类（启发式）
// ============================================================================

function walkJava(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['target', 'build', '.idea', 'node_modules'].includes(ent.name)) continue;
      walkJava(full, files);
    } else if (ent.isFile() && ent.name.endsWith('.java')) {
      files.push(full);
    }
  }
  return files;
}

function scanServerForExternalClient(serverRoot, system) {
  const javaSrc = join(serverRoot, 'src', 'main', 'java');
  const result = {
    propertiesClasses: [],     // @ConfigurationProperties 含 system 关键字
    oauthClasses: [],          // OAuth / AccessToken 处理类
    clientClasses: [],         // 含 baseUrl / system 关键字 + RestClient/WebClient
    signatureClasses: [],      // 签名工具类
    fakeSyncMethods: [],       // 假 sync 反模式
    httpCallSites: [],         // 任何 RestClient/WebClient/RestTemplate 实际调用
  };

  if (!existsSync(javaSrc)) return result;

  // 系统关键字（用于命名匹配）
  const sysKeywords = new Set();
  if (system && system.name) {
    // 提取英文 / 中文关键字（如"新石器" → 中文 + 域名 neolix）
    const englishMatch = system.name.match(/\b([A-Za-z]+)\b/);
    if (englishMatch) sysKeywords.add(englishMatch[1].toLowerCase());
    if (/新石器/.test(system.name)) sysKeywords.add('neolix');
  }
  if (system?.baseUrls) {
    for (const url of system.baseUrls) {
      const hostMatch = url.match(/https?:\/\/([^/]+)/);
      if (hostMatch) {
        const host = hostMatch[1];
        // 取主域名片段（如 scapi.neolix.net → neolix）
        const parts = host.split('.');
        if (parts.length >= 2) sysKeywords.add(parts[parts.length - 2].toLowerCase());
      }
    }
  }

  const files = walkJava(javaSrc);

  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const rel = f.replace(serverRoot + '/', '');
    const className = (text.match(/public\s+(?:abstract\s+|final\s+)?(?:class|interface)\s+(\w+)/) || [])[1];

    // 是否含系统关键字
    const lowerText = text.toLowerCase();
    const matchesSystem = [...sysKeywords].some(k => lowerText.includes(k));

    // @ConfigurationProperties
    if (matchesSystem && /@ConfigurationProperties/.test(text)) {
      result.propertiesClasses.push({ file: rel, className });
    }

    // OAuth/AccessToken 类（命名启发）
    if (matchesSystem && /(OAuth|AccessToken|TokenService)/i.test(className || '')) {
      result.oauthClasses.push({ file: rel, className });
    }

    // Signature 工具类
    if (matchesSystem && /(Sign|Signature|Hmac)/i.test(className || '')) {
      result.signatureClasses.push({ file: rel, className });
    }

    // Client 类（含 RestClient/WebClient/RestTemplate import + 系统关键字）
    if (matchesSystem && /\b(RestClient|WebClient|RestTemplate|HttpClient|OkHttpClient)\b/.test(text)) {
      // 进一步确认有调用：.get() / .post() / .uri() 等
      if (/\.(get|post|put|delete|patch)\(\)|\.uri\(|\.exchange\(/.test(text)) {
        result.clientClasses.push({ file: rel, className });
      }
    }

    // 假 sync 反模式：含 triggerSync + 返回硬编码 inserted=0/status=COMPLETED 等
    const fakePattern = /(?:triggerSync|fetchExternal|syncFrom)[\s\S]{0,500}?(?:inserted\s*[=:]\s*0|status\s*[=:]\s*['"]COMPLETED['"]|占位结果|占位返回|实际同步逻辑由[\s\S]{0,30}实现)/;
    if (fakePattern.test(text)) {
      const m = text.match(fakePattern);
      if (m) {
        const lineNo = text.slice(0, m.index).split(/\r?\n/).length;
        result.fakeSyncMethods.push({ file: rel, line: lineNo, className, snippet: m[0].slice(0, 100) + '...' });
      }
    }

    // HTTP 调用点（任何方向）
    const httpCallMatches = [...text.matchAll(/\b(restClient|webClient|restTemplate)\s*\.\s*(get|post|put|delete|exchange|uri)\(/gi)];
    for (const m of httpCallMatches) {
      const lineNo = text.slice(0, m.index).split(/\r?\n/).length;
      result.httpCallSites.push({ file: rel, line: lineNo, snippet: m[0] });
    }
  }

  return result;
}

// ============================================================================
// 3. 扫 application.yml 看 neolix 配置是否健康
// ============================================================================

function scanYamlConfig(serverRoot, system) {
  const result = { found: false, hasPlaceholder: false, baseUrlMatch: null, configKeys: [] };

  const configDir = join(serverRoot, 'src', 'main', 'resources');
  if (!existsSync(configDir)) return result;

  const yamls = readdirSync(configDir).filter(f => /^application.*\.ya?ml$/.test(f));
  if (yamls.length === 0) return result;

  const sysKeywords = new Set();
  if (/新石器/.test(system?.name || '')) sysKeywords.add('neolix');
  for (const url of system?.baseUrls || []) {
    const m = url.match(/https?:\/\/[^.]*\.([^.]+)\./);
    if (m) sysKeywords.add(m[1].toLowerCase());
  }

  for (const yfile of yamls) {
    const text = readFileSync(join(configDir, yfile), 'utf8');
    for (const kw of sysKeywords) {
      const re = new RegExp('^(\\s*)([\\w-]*' + kw + '[\\w-]*)\\s*:', 'gim');
      for (const m of text.matchAll(re)) {
        result.found = true;
        result.configKeys.push({ file: yfile, key: m[2] });
      }
      // 看 base-url
      const urlRe = new RegExp('base[-_]?url[^\\n]*?(' + kw + '[^\\n\\s]*)', 'i');
      const um = text.match(urlRe);
      if (um) {
        const expected = system.baseUrls?.[0] || '';
        const actualHost = um[1].match(/[a-z0-9.\-]+\.[a-z]+/i)?.[0] || '';
        const expectedHost = expected.match(/https?:\/\/([^/]+)/)?.[1] || '';
        result.baseUrlMatch = (actualHost && expectedHost && actualHost.includes(expectedHost.split('.').slice(-2).join('.')))
          ? { match: true, configured: actualHost, expected: expectedHost }
          : { match: false, configured: actualHost, expected: expectedHost };
      }
      // 占位检查：${X:}（empty default）
      if (/\$\{[A-Z_]+:\s*\}/.test(text)) result.hasPlaceholder = true;
    }
  }

  return result;
}

// ============================================================================
// 4. 渲染审计报告
// ============================================================================

function renderAudit(integration, scans) {
  const lines = [
    '# 外部集成审计报告（v0.9.16 D33）',
    '',
    '> 扫描时间：' + new Date().toISOString(),
    '> brief §11 集成依赖：' + (integration.hasIntegration ? '已声明' : '❌ 未声明'),
    '',
  ];

  if (!integration.hasIntegration) {
    lines.push('## ❌ 未发现外部集成依赖');
    lines.push('');
    lines.push('project-brief.md 没有 §11 集成依赖段。如本项目确实无外部 API 依赖，可忽略本审计。');
    lines.push('如有外部依赖未声明，请在 brief §11 补充（参考 `templates/project-brief.template.md`）。');
    return lines.join('\n');
  }

  for (const s of integration.systems) {
    const scan = scans[s.name];
    if (!scan) continue;

    const totalRequiredClasses = 4; // Properties + OAuth + Client + Signature
    let actualClasses = 0;
    if (scan.propertiesClasses.length > 0) actualClasses++;
    if (scan.oauthClasses.length > 0) actualClasses++;
    if (scan.clientClasses.length > 0) actualClasses++;
    if (scan.signatureClasses.length > 0) actualClasses++;

    const couplingPct = Math.round((actualClasses / totalRequiredClasses) * 100);
    const couplingIcon = couplingPct >= 75 ? '🟢' : couplingPct >= 25 ? '🟡' : '🔴';

    lines.push('## ' + couplingIcon + ' 系统：' + s.name);
    lines.push('');
    lines.push('- 契约文档：`' + (s.contractDir || '<未声明>') + '`');
    lines.push('- 鉴权方式：' + (s.authMethod || '<未声明>'));
    lines.push('- Endpoint 总数：' + (s.endpointCount || '<未声明>'));
    lines.push('- 基础 URL：' + (s.baseUrls.length ? s.baseUrls.map(u => '`' + u + '`').join(', ') : '<未声明>'));
    lines.push('- **耦合度：' + couplingPct + '%（' + actualClasses + '/' + totalRequiredClasses + ' 核心类已实现）**');
    lines.push('');

    // 核心类清单
    lines.push('### 核心类实现状态');
    lines.push('');
    lines.push('| 类别 | 状态 | 实际位置 |');
    lines.push('|---|---|---|');
    lines.push('| Properties (`@ConfigurationProperties`) | ' + (scan.propertiesClasses.length > 0 ? '✅' : '❌') + ' | ' + (scan.propertiesClasses[0]?.file || '_缺失_') + ' |');
    lines.push('| OAuth / TokenService | ' + (scan.oauthClasses.length > 0 ? '✅' : '❌') + ' | ' + (scan.oauthClasses[0]?.file || '_缺失_') + ' |');
    lines.push('| Client (RestClient/WebClient 调用) | ' + (scan.clientClasses.length > 0 ? '✅' : '❌') + ' | ' + (scan.clientClasses[0]?.file || '_缺失_') + ' |');
    lines.push('| Signature 工具 | ' + (scan.signatureClasses.length > 0 ? '✅' : '❌') + ' | ' + (scan.signatureClasses[0]?.file || '_缺失_') + ' |');
    lines.push('');

    // HTTP 调用点
    if (scan.httpCallSites.length === 0) {
      lines.push('### ⚠️ HTTP 调用点');
      lines.push('');
      lines.push('**0 个**——server 端没有任何 RestClient/WebClient/RestTemplate 实际调用。');
      lines.push('物理上无法连接外部平台。');
      lines.push('');
    } else {
      lines.push('### HTTP 调用点（' + scan.httpCallSites.length + '）');
      lines.push('');
      for (const c of scan.httpCallSites.slice(0, 10)) {
        lines.push('- `' + c.file + ':' + c.line + '` — `' + c.snippet + '`');
      }
      lines.push('');
    }

    // 假 sync 反模式
    if (scan.fakeSyncMethods.length > 0) {
      lines.push('### 🔴 假 Sync 反模式 hot-list');
      lines.push('');
      lines.push('以下方法返回假 success 但实际未调外部 API（业务上必须接外部数据）：');
      lines.push('');
      for (const m of scan.fakeSyncMethods) {
        lines.push('- `' + m.file + ':' + m.line + '` (`' + m.className + '`)');
      }
      lines.push('');
    }

    // YAML 配置健康
    const yamlScan = scan.yamlConfig;
    if (yamlScan && yamlScan.found) {
      lines.push('### 配置健康检查');
      lines.push('');
      lines.push('- 配置项已声明（共 ' + yamlScan.configKeys.length + ' 个 key）');
      if (yamlScan.hasPlaceholder) {
        lines.push('- ⚠️ 含空占位 `${VAR:}`——生产环境需填真实凭证');
      }
      if (yamlScan.baseUrlMatch && !yamlScan.baseUrlMatch.match) {
        lines.push('- 🔴 **base-url 错配**：配置 `' + yamlScan.baseUrlMatch.configured + '` ≠ brief §11 实际 `' + yamlScan.baseUrlMatch.expected + '`');
      }
      lines.push('');
    } else if (yamlScan) {
      lines.push('### ⚠️ 配置健康检查');
      lines.push('');
      lines.push('- application.yml 中未发现 `' + s.name + '` 相关配置项');
      lines.push('- 即使 client 类实现了，也无凭证可读');
      lines.push('');
    }
  }

  // 行动建议
  lines.push('---');
  lines.push('');
  lines.push('## 行动建议（按修复优先级排序）');
  lines.push('');
  lines.push('1. **如耦合度 < 50%**：跑 `node $DDT_PLUGIN_ROOT/bin/generate-external-client.mjs` 生成 7 个核心 Java 类骨架（Properties + OAuth + Signature + Client interface + Real/Mock 实现 + Config）');
  lines.push('2. **修假 sync 反模式**：把 `triggerSync` 类方法的假 success 返回改为真实调用 `client.fetchVehicles()` 等');
  lines.push('3. **配置健康**：补 `application.yml` 的 `app.<system>.base-url / app-id / app-secret` + `@ConfigurationProperties` 绑定 Bean');
  lines.push('4. **双轨模式**：用 `@Profile("dev")` 跑 MockClient（返回 fixture 数据）/ `@Profile("prod")` 跑 RealClient（真实 API）');
  lines.push('5. **回调端**：如外部 API 含 webhook（任务完成回调等），在 server 加对应 `@PostMapping` controller');
  lines.push('');
  lines.push('LLM 在 IMPLEMENT 时按本报告逐 Service 改造，不要凭记忆改。');

  return lines.join('\n');
}

// ============================================================================
// 主流程
// ============================================================================

function main() {
  const args = parseArgs(process.argv.slice(2));
  const briefPath = args.brief || join(PROJECT_ROOT, 'project-brief.md');
  const serverRoot = join(PROJECT_ROOT, args.server || 'server');
  const outputPath = args.output || join(PROJECT_ROOT, 'docs', 'external-integration-audit.md');

  if (args['dry-run']) {
    console.log('# audit-external-integration --dry-run');
    console.log('1. 解析 ' + briefPath + ' §11 集成依赖');
    console.log('2. 扫 ' + serverRoot + '/src/main/java 找 client/oauth/properties/signature 类');
    console.log('3. 扫 application.yml 配置健康');
    console.log('4. 检测假 sync 反模式（triggerSync 返回硬编码 success）');
    console.log('5. 计算耦合度 + 缺失类清单');
    console.log('6. 输出 ' + outputPath + '（行动建议按优先级）');
    process.exit(0);
  }

  if (!existsSync(briefPath)) {
    console.error('❌ ' + briefPath + ' 不存在');
    process.exit(2);
  }
  if (!existsSync(serverRoot)) {
    console.error('❌ ' + serverRoot + ' 不存在；--server=<dir> 改路径');
    process.exit(2);
  }

  const briefText = readFileSync(briefPath, 'utf8');
  const integration = parseBriefIntegration(briefText);

  const scans = {};
  for (const s of integration.systems) {
    const scan = scanServerForExternalClient(serverRoot, s);
    scan.yamlConfig = scanYamlConfig(serverRoot, s);
    scans[s.name] = scan;
  }

  const report = renderAudit(integration, scans);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report);

  console.log('▶ 外部集成审计完成');
  console.log('  brief §11 系统数：' + integration.systems.length);
  for (const s of integration.systems) {
    const scan = scans[s.name];
    const total = ['propertiesClasses', 'oauthClasses', 'clientClasses', 'signatureClasses'].filter(k => scan[k].length > 0).length;
    console.log('  ' + s.name + '：' + total + '/4 核心类 / ' + scan.httpCallSites.length + ' HTTP 调用点 / ' + scan.fakeSyncMethods.length + ' 假 sync');
  }
  console.log('✅ 报告已写入：' + outputPath);

  process.exit(0);
}

main();
