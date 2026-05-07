#!/usr/bin/env node
// ddt-brief-builder · 第三方 API 文档摘要器（D25 / v0.9.8）
//
// 把 第三方 API 文档目录 / OpenAPI yaml / OpenAPI JSON 解析为 brief §11 集成依赖片段。
//
// 输入形态：
//   1. 目录树（如 alv-ops/项目资料/无人车开放平台API/）→ 扫文件 + 抽 README + endpoint files
//   2. 单 OpenAPI yaml 文件（*.openapi.yaml / *.yaml 含 openapi: 顶层） → 零依赖正则解析
//   3. 单 OpenAPI JSON 文件（swagger.json / openapi.json） → JSON.parse + 同上抽取
//   4. 单 markdown 含 endpoint 章节 → 章节切分 + 标题抽取
//
// 用法：
//   node dump-api-docs.mjs <path> [--name "系统名"] [--json]
//
// 输出（默认）：markdown §11 片段 + JSON 摘要（--- JSON --- 分隔）
// 退出码：0 成功 / 1 参数错误 / 2 文件不存在 / 3 无法识别为 API 文档
//
// 安全：敏感字段（client_secret/api_key/access_token 等）强制脱敏为 ***。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, basename, join, relative, resolve } from 'node:path';

// ============================================================================
// 敏感字段脱敏
// ============================================================================

const SECRET_PATTERNS = [
  /(client_secret|appSecret|app_secret|api_key|apiKey|secret_key|secretKey|password|access_token|accessToken)\s*[:=]\s*["']?([^\s"'\n,}]+)["']?/gi,
  /(Authorization\s*[:=]\s*Bearer\s+)([^\s"'\n,}]+)/gi,
];

function redactSecrets(text) {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (whole, key, value) => {
      const sep = whole.slice(key.length, whole.length - value.length);
      return `${key}${sep}***`;
    });
  }
  return out;
}

// ============================================================================
// 输入类型探测
// ============================================================================

function detectInputType(p) {
  const stat = statSync(p);
  if (stat.isDirectory()) return 'directory';

  const ext = extname(p).toLowerCase();
  const text = readFileSync(p, 'utf8');

  if (ext === '.json') {
    try {
      const obj = JSON.parse(text);
      if (obj.openapi || obj.swagger || obj.paths) return 'openapi-json';
    } catch {}
  }
  if (ext === '.yaml' || ext === '.yml') {
    if (/^\s*openapi\s*:/m.test(text) || /^\s*swagger\s*:/m.test(text)) return 'openapi-yaml';
  }
  if (ext === '.md' || ext === '.markdown') {
    if (/^\s*##+\s+(GET|POST|PUT|DELETE|PATCH)\s/im.test(text) || /\bendpoint\b/i.test(text)) {
      return 'markdown-single';
    }
  }
  return 'unknown';
}

// ============================================================================
// OpenAPI YAML 零依赖解析（仅抽 info / servers / paths / securitySchemes）
// ============================================================================

function parseOpenApiYaml(text) {
  const lines = text.split(/\r?\n/);
  const result = {
    info: { title: null, version: null },
    servers: [],
    paths: [],
    securitySchemes: [],
  };

  let section = null;
  let pathContext = null;
  let inSecuritySchemes = false;
  let lastSecScheme = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch[1].length;

    if (indent === 0) {
      const m = line.match(/^([a-zA-Z_][\w-]*)\s*:/);
      if (m) {
        section = m[1].toLowerCase();
        pathContext = null;
        inSecuritySchemes = false;
        lastSecScheme = null;
        continue;
      }
    }

    if (section === 'info' && indent === 2) {
      const m = line.match(/^\s+(title|version)\s*:\s*["']?([^"'\n]+?)["']?\s*$/);
      if (m) result.info[m[1]] = m[2].trim();
    }

    if (section === 'servers') {
      const m = line.match(/^\s+-?\s*url\s*:\s*["']?([^"'\n]+?)["']?\s*$/);
      if (m) result.servers.push(m[1].trim());
    }

    if (section === 'paths') {
      if (indent === 2) {
        const m = line.match(/^\s{2}(\/[^\s:]+)\s*:/);
        if (m) {
          pathContext = m[1];
          continue;
        }
      }
      if (indent === 4 && pathContext) {
        const m = line.match(/^\s{4}(get|post|put|delete|patch|options|head)\s*:/i);
        if (m) {
          result.paths.push({ path: pathContext, method: m[1].toUpperCase() });
        }
      }
    }

    if (section === 'components') {
      if (/^\s{2}securitySchemes\s*:/.test(line)) {
        inSecuritySchemes = true;
        continue;
      }
      if (inSecuritySchemes && indent === 4) {
        const m = line.match(/^\s{4}([a-zA-Z_][\w-]*)\s*:/);
        if (m) {
          lastSecScheme = { name: m[1], type: null };
          result.securitySchemes.push(lastSecScheme);
          continue;
        }
      }
      if (lastSecScheme && indent === 6) {
        const m = line.match(/^\s+type\s*:\s*["']?([^"'\n]+?)["']?\s*$/);
        if (m) lastSecScheme.type = m[1].trim();
      }
    }
  }

  return result;
}

// ============================================================================
// OpenAPI JSON 解析
// ============================================================================

function parseOpenApiJson(obj) {
  const result = {
    info: { title: obj?.info?.title || null, version: obj?.info?.version || null },
    servers: (obj?.servers || []).map(s => s.url).filter(Boolean),
    paths: [],
    securitySchemes: [],
  };
  for (const [path, methods] of Object.entries(obj?.paths || {})) {
    for (const method of Object.keys(methods || {})) {
      if (['get', 'post', 'put', 'delete', 'patch', 'options', 'head'].includes(method.toLowerCase())) {
        result.paths.push({ path, method: method.toUpperCase() });
      }
    }
  }
  for (const [name, scheme] of Object.entries(obj?.components?.securitySchemes || {})) {
    result.securitySchemes.push({ name, type: scheme?.type || null });
  }
  if (obj?.host && !result.servers.length) {
    const scheme = (obj.schemes || ['https'])[0];
    const base = `${scheme}://${obj.host}${obj.basePath || ''}`;
    result.servers.push(base);
  }
  return result;
}

// ============================================================================
// 目录树扫描（递归）
// ============================================================================

const DIR_README_NAMES = ['README.md', 'readme.md', 'README.markdown'];
const ENDPOINT_KEYWORDS = /api|接口|endpoint/i;
const AUTH_KEYWORDS = /auth|鉴权|签名|token|oauth/i;
const ERROR_KEYWORDS = /error|错误码|errcode/i;
const FLOW_KEYWORDS = /接入|流程|onboarding|integration/i;
// 元信息文件（非真正 endpoint 描述）
const META_FILE_PATTERNS = /faq|总览|应用信息|版本记录|产品地图|changelog|常见问题/i;

function walkMarkdownTree(rootDir) {
  const out = { readme: null, endpoints: [], authDocs: [], errorDocs: [], flowDocs: [], metaDocs: [], all: [] };

  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!ent.isFile()) continue;
      const ext = extname(ent.name).toLowerCase();
      if (ext !== '.md' && ext !== '.markdown') continue;

      const rel = relative(rootDir, full);
      out.all.push(rel);

      if (DIR_README_NAMES.includes(ent.name) && relative(rootDir, dir) === '') {
        out.readme = rel;
        continue;
      }
      // 子目录里的 README 也归元信息（如 03-Cloud-API/README.md = 接口总览）
      if (DIR_README_NAMES.includes(ent.name)) {
        out.metaDocs.push(rel);
        continue;
      }
      const name = ent.name;
      if (META_FILE_PATTERNS.test(name)) out.metaDocs.push(rel);
      else if (AUTH_KEYWORDS.test(name)) out.authDocs.push(rel);
      else if (ERROR_KEYWORDS.test(name)) out.errorDocs.push(rel);
      else if (FLOW_KEYWORDS.test(name)) out.flowDocs.push(rel);
      else out.endpoints.push(rel); // 默认归 endpoint（已先排除 meta/auth/error/flow）
    }
  }

  walk(rootDir);
  return out;
}

function extractFromReadme(readmePath) {
  if (!readmePath || !existsSync(readmePath)) return {};
  const text = readFileSync(readmePath, 'utf8');
  const result = {};

  // 优先从 markdown 表格 row 抽：| 基础 URL | https://... |
  const tableUrls = [...text.matchAll(/\|\s*(?:基础\s*URL|base\s*URL|.*?基地址|API\s*基地址|.*?Endpoint.*?)\s*\|\s*([^\n|]+?)\s*\|/gi)];
  if (tableUrls.length) {
    const urls = tableUrls.map(m => (m[1].match(/https?:\/\/[^\s|`]+/) || [])[0]).filter(Boolean);
    if (urls.length) result.baseUrls = [...new Set(urls)];
  }
  // fallback：通用匹配（适合非表格形式）
  if (!result.baseUrls) {
    const baseUrlMatches = [...text.matchAll(/(?:基地址|基础\s*URL|base\s*URL|API\s*Endpoint|API\s*基地址)[^\n]*?(https?:\/\/[^\s|`]+)/gi)];
    if (baseUrlMatches.length) {
      const urls = baseUrlMatches.map(m => (m[0].match(/https?:\/\/[^\s|`]+/) || [])[0]).filter(Boolean);
      result.baseUrls = [...new Set(urls)];
    }
  }

  // 优先从 markdown 表格 row 抽鉴权方式：| 鉴权方式 | OAuth2 ... |
  const tableAuth = text.match(/\|\s*(?:鉴权方式|认证方式|auth\s*method)\s*\|\s*([^\n|]+?)\s*\|/i);
  if (tableAuth) {
    result.authHint = tableAuth[1].trim().slice(0, 80);
  } else {
    // fallback：通用匹配
    const authMatch = text.match(/(?:鉴权方式|auth\s*method|认证方式|授权方式)[^\n]*?[：:]\s*([^\n|`]+?)(?:\n|`|\|)/i);
    if (authMatch) result.authHint = authMatch[1].trim().slice(0, 80);
  }

  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch) result.title = titleMatch[1].trim();

  return result;
}

// ============================================================================
// 单 markdown 文件内 endpoint 抽取
// ============================================================================

function parseSingleMarkdown(text) {
  const result = { title: null, endpoints: [] };
  const titleMatch = text.match(/^#\s+(.+)$/m);
  if (titleMatch) result.title = titleMatch[1].trim();

  const reHeading = /^#{2,4}\s+(GET|POST|PUT|DELETE|PATCH)\s+([\/\w\-:{}\.\?=&]+)/gim;
  for (const m of text.matchAll(reHeading)) {
    result.endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
  }

  const reTableRow = /\|\s*(GET|POST|PUT|DELETE|PATCH)\s+([\/\w\-:{}\.\?=&]+)\s*\|/gi;
  for (const m of text.matchAll(reTableRow)) {
    result.endpoints.push({ method: m[1].toUpperCase(), path: m[2] });
  }

  return result;
}

// ============================================================================
// 输出生成
// ============================================================================

function formatMarkdown(systemName, summary, originalPath) {
  const lines = [`### 第三方系统：${systemName}`, ''];
  lines.push('| 项目 | 值 |');
  lines.push('|---|---|');
  lines.push(`| 契约文档 | \`${originalPath}\` |`);
  lines.push(`| 基础 URL | ${summary.baseUrl || '<待确认>'} |`);
  lines.push(`| 鉴权方式 | ${summary.authType || '<待确认>'} |`);
  lines.push(`| Endpoint 数 | ${summary.endpointCount} 个${summary.endpointGroups ? '（' + summary.endpointGroups + '）' : ''} |`);
  if (summary.keyCapabilities && summary.keyCapabilities.length) {
    lines.push(`| 关键能力 | ${summary.keyCapabilities.slice(0, 5).join(' / ')} |`);
  }
  if (summary.errorPath) lines.push(`| 错误码 | 见 \`${summary.errorPath}\` |`);
  if (summary.flowPath) lines.push(`| 接入流程 | 见 \`${summary.flowPath}\` |`);
  if (summary.redacted) lines.push(`| 安全 | **敏感字段已脱敏**（client_secret/api_key 等） |`);

  if (summary.endpointSamples && summary.endpointSamples.length) {
    lines.push('');
    lines.push('**Endpoint 样本**（前 5 个）：');
    for (const ep of summary.endpointSamples.slice(0, 5)) {
      lines.push(`- \`${ep.method} ${ep.path}\``);
    }
  }
  return lines.join('\n') + '\n';
}

// ============================================================================
// 主入口
// ============================================================================

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[k] = next; i++; }
      else args[k] = true;
    } else args._.push(a);
  }
  return args;
}

function summarizeFromOpenApi(parsed, redacted) {
  const summary = {
    baseUrl: parsed.servers[0] || null,
    endpointCount: parsed.paths.length,
    endpointSamples: parsed.paths.slice(0, 10),
    authType: null,
    keyCapabilities: [],
    redacted,
  };
  if (parsed.securitySchemes.length) {
    summary.authType = parsed.securitySchemes
      .map(s => `${s.name}${s.type ? ` (${s.type})` : ''}`)
      .join(' / ');
  }
  const caps = new Set();
  for (const ep of parsed.paths.slice(0, 8)) {
    const seg = ep.path.split('/').filter(Boolean);
    if (seg.length) caps.add(seg[seg.length - 1]);
  }
  summary.keyCapabilities = [...caps];
  return summary;
}

function summarizeFromDirectory(rootDir, tree) {
  const readmeAbs = tree.readme ? join(rootDir, tree.readme) : null;
  const readmeData = extractFromReadme(readmeAbs);

  const allEndpointFiles = [...tree.endpoints];
  const summary = {
    baseUrl: (readmeData.baseUrls && readmeData.baseUrls[0]) || null,
    endpointCount: allEndpointFiles.length,
    endpointSamples: allEndpointFiles.slice(0, 10).map(f => ({ method: 'DOC', path: f })),
    authType: readmeData.authHint || null,
    keyCapabilities: allEndpointFiles.slice(0, 5).map(f => basename(f).replace(/^\d+-/, '').replace(/\.md$/i, '')),
    errorPath: tree.errorDocs[0] || null,
    flowPath: tree.flowDocs[0] || null,
    endpointGroups: null,
    redacted: false,
  };
  if (readmeData.baseUrls && readmeData.baseUrls.length > 1) {
    summary.endpointGroups = readmeData.baseUrls.length + ' 组（如 Cloud + Video）';
  }
  return summary;
}

function summarizeFromMarkdown(parsed, redacted) {
  return {
    baseUrl: null,
    endpointCount: parsed.endpoints.length,
    endpointSamples: parsed.endpoints.slice(0, 10),
    authType: null,
    keyCapabilities: [],
    redacted,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args._[0];
  if (!inputPath) {
    console.error('❌ 用法：dump-api-docs.mjs <path> [--name "系统名"] [--json]');
    console.error('   path 可为：目录 / *.openapi.yaml / *.openapi.json / *.md');
    process.exit(1);
  }
  const abs = resolve(inputPath);
  if (!existsSync(abs)) {
    console.error(`❌ 文件不存在：${abs}`);
    process.exit(2);
  }

  const type = detectInputType(abs);
  let summary;
  let originalPath = inputPath;
  let systemName = args.name;

  if (type === 'directory') {
    const tree = walkMarkdownTree(abs);
    if (!tree.all.length) {
      console.error(`❌ 目录中无 markdown 文件：${abs}`);
      process.exit(3);
    }
    const readmeAbs = tree.readme ? join(abs, tree.readme) : null;
    const readmeData = extractFromReadme(readmeAbs);
    if (!systemName) systemName = readmeData.title || basename(abs);
    summary = summarizeFromDirectory(abs, tree);
  } else if (type === 'openapi-yaml') {
    const text = redactSecrets(readFileSync(abs, 'utf8'));
    const parsed = parseOpenApiYaml(text);
    if (!systemName) systemName = parsed.info.title || basename(abs);
    summary = summarizeFromOpenApi(parsed, true);
  } else if (type === 'openapi-json') {
    const text = readFileSync(abs, 'utf8');
    const obj = JSON.parse(redactSecrets(text));
    const parsed = parseOpenApiJson(obj);
    if (!systemName) systemName = parsed.info.title || basename(abs);
    summary = summarizeFromOpenApi(parsed, true);
  } else if (type === 'markdown-single') {
    const text = redactSecrets(readFileSync(abs, 'utf8'));
    const parsed = parseSingleMarkdown(text);
    if (!systemName) systemName = parsed.title || basename(abs);
    summary = summarizeFromMarkdown(parsed, true);
  } else {
    console.error(`❌ 无法识别为 API 文档：${abs}（type=${type}）`);
    console.error('   支持：目录树（含 README.md + 多 *.md）/ *.openapi.yaml / *.openapi.json / 含 endpoint 章节的 *.md');
    process.exit(3);
  }

  const md = formatMarkdown(systemName, summary, originalPath);

  if (args.json) {
    console.log(JSON.stringify({ systemName, type, summary, markdown: md }, null, 2));
  } else {
    console.log(md);
    console.log('--- JSON ---');
    console.log(JSON.stringify({ systemName, type, summary }, null, 2));
  }
  process.exit(0);
}

main();
