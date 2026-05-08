#!/usr/bin/env node
// DDT v0.9.15 D32 · 把 OpenAPI 契约提炼为 design AI 友好的紧凑字段摘要
//
// 时序设计：/design-execute 在 /build-web 之前——web/ 还没 scaffold，types.ts 不存在。
// 因此本脚本只读 docs/api-contract.yaml（SSoT，时序上 always 已存在），
// 不依赖 v0.9.13 D30 generate-api-client 的 types.ts 派生品。
//
// 输入：docs/api-contract.yaml（OpenAPI 3.x，唯一真相源）
// 输出：默认 stdout；--output 写文件
// 模式：既是 CLI 又是 module（导出 generateContractSummary 供 derive-channel-package 调用）
//
// 用法（CLI）：
//   node bin/extract-contract-summary.mjs                      # stdout
//   node bin/extract-contract-summary.mjs --output <path>      # 写文件
//   node bin/extract-contract-summary.mjs --dry-run            # 计划
//
// 用法（module）：
//   import { generateContractSummary } from './extract-contract-summary.mjs';
//   const summary = generateContractSummary({ projectRoot, output });

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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
// OpenAPI yaml schemas 解析（仅 components.schemas 段，混合 inline + 多行）
// ============================================================================

// 找 components → schemas 段范围
function findSchemasRange(lines) {
  let inComponents = false;
  let schemasStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^components:\s*$/.test(line)) { inComponents = true; continue; }
    if (inComponents && /^  schemas:\s*$/.test(line)) { schemasStart = i + 1; break; }
    // 顶层另一段（指 components 块结束）
    if (inComponents && /^[a-zA-Z]/.test(line) && !/^components:/.test(line)) { inComponents = false; }
  }
  if (schemasStart < 0) return null;
  // 找 schemas 段终点：下一个缩进 ≤ 2 的非空非注释行
  let schemasEnd = lines.length;
  for (let i = schemasStart; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^( *)/)[1].length;
    if (indent <= 2) { schemasEnd = i; break; }
  }
  return { start: schemasStart, end: schemasEnd };
}

// 切分每个 schema（缩进 4 + PascalCase: 行）
function splitSchemas(lines, range) {
  const schemaIndices = [];
  for (let i = range.start; i < range.end; i++) {
    const line = lines[i];
    if (/^    [A-Z][\w]*:\s*$/.test(line)) {
      const m = line.match(/^    (\w+):/);
      schemaIndices.push({ name: m[1], start: i });
    }
  }
  const result = [];
  for (let i = 0; i < schemaIndices.length; i++) {
    const cur = schemaIndices[i];
    const next = i + 1 < schemaIndices.length ? schemaIndices[i + 1].start : range.end;
    result.push({ name: cur.name, lines: lines.slice(cur.start + 1, next) });
  }
  return result;
}

// 解析单个 schema：required + fields
function parseSchema(name, schemaLines) {
  const required = new Set();
  const fields = [];
  let inProperties = false;
  let inRequiredList = false;

  for (let i = 0; i < schemaLines.length; i++) {
    const line = schemaLines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^( *)/)[1].length;

    // required: [a, b, c]
    if (indent === 6 && /^      required:\s*\[/.test(line)) {
      const m = line.match(/required:\s*\[([^\]]*)\]/);
      if (m) m[1].split(',').forEach(s => required.add(s.trim().replace(/['"]/g, '')));
      inRequiredList = false;
      continue;
    }
    // required:\n  - a\n  - b
    if (indent === 6 && /^      required:\s*$/.test(line)) {
      inRequiredList = true;
      continue;
    }
    if (inRequiredList && indent === 8 && /^\s+-\s*(\w+)/.test(line)) {
      const m = line.match(/^\s+-\s*['"]?(\w+)['"]?/);
      if (m) required.add(m[1]);
      continue;
    }
    if (inRequiredList && indent <= 6) inRequiredList = false;

    // properties: 段开始
    if (indent === 6 && /^      properties:\s*$/.test(line)) {
      inProperties = true;
      continue;
    }
    // 退出 properties 段（同级或上级 key）
    if (inProperties && indent === 6 && /\S/.test(line)) {
      inProperties = false;
    }

    // 字段行（缩进 8）
    if (inProperties && indent === 8) {
      const m = line.match(/^\s+([a-zA-Z_$][\w$]*)\s*:(.*)$/);
      if (!m) continue;
      const fname = m[1];
      const rest = m[2].trim();
      const field = { name: fname, type: 'unknown', enumValues: null, isArray: false };

      if (rest && rest.startsWith('{')) {
        // inline 风格：可能跨行（用 brace 计数）
        let inlineText = rest;
        let braceDepth = 0;
        for (const c of rest) {
          if (c === '{') braceDepth++;
          else if (c === '}') braceDepth--;
        }
        let j = i;
        while (braceDepth > 0 && j + 1 < schemaLines.length) {
          j++;
          const next = schemaLines[j];
          inlineText += ' ' + next.trim();
          for (const c of next) {
            if (c === '{') braceDepth++;
            else if (c === '}') braceDepth--;
          }
        }
        parseInlineProps(inlineText, field);
        i = j; // 跳过已合并的行
      } else if (rest === '') {
        // 多行展开 → 扫子缩进（10）行
        for (let j = i + 1; j < schemaLines.length; j++) {
          const sub = schemaLines[j];
          if (!sub.trim()) continue;
          const subIndent = sub.match(/^( *)/)[1].length;
          if (subIndent <= 8) break; // 退出当前字段
          if (subIndent === 10) parseAttrLine(sub, field);
          // 12+ 缩进是嵌套属性的子细节，忽略
        }
      } else {
        // 形如 `fieldName: integer`（少见，但 OpenAPI 允许）
        // 不做处理
      }
      fields.push({ ...field, optional: !required.has(fname) });
    }
  }

  return { name, fields };
}

function parseInlineProps(inlineText, field) {
  // inline: { type: string, format: date-time, enum: [A, B], $ref: '...', nullable: true }
  const typeMatch = inlineText.match(/\btype:\s*(\w+)/);
  if (typeMatch) field.type = typeMatch[1];

  const enumMatch = inlineText.match(/\benum:\s*\[([^\]]*)\]/);
  if (enumMatch) {
    field.enumValues = enumMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }

  const refMatch = inlineText.match(/\$ref:\s*['"]?#\/components\/schemas\/(\w+)['"]?/);
  if (refMatch) field.type = refMatch[1];

  const formatMatch = inlineText.match(/\bformat:\s*([\w-]+)/);
  if (formatMatch && (formatMatch[1] === 'date-time' || formatMatch[1] === 'date')) {
    field.type = formatMatch[1];
  }

  if (field.type === 'array') field.isArray = true;
}

function parseAttrLine(line, field) {
  const trimmed = line.trim();

  if (/^type:\s*\w+/.test(trimmed)) {
    const m = trimmed.match(/^type:\s*(\w+)/);
    if (m) field.type = m[1];
  }
  if (/^format:\s*[\w-]+/.test(trimmed)) {
    const m = trimmed.match(/^format:\s*([\w-]+)/);
    if (m && (m[1] === 'date-time' || m[1] === 'date')) field.type = m[1];
  }
  if (/^enum:\s*\[/.test(trimmed)) {
    const m = trimmed.match(/^enum:\s*\[([^\]]*)\]/);
    if (m) field.enumValues = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }
  if (/\$ref:/.test(trimmed)) {
    const m = trimmed.match(/\$ref:\s*['"]?#\/components\/schemas\/(\w+)['"]?/);
    if (m) field.type = m[1];
  }
}

// ============================================================================
// 渲染
// ============================================================================

function fieldToString(f) {
  let typeStr = f.type;
  if (f.enumValues && f.enumValues.length) {
    typeStr = 'enum["' + f.enumValues.join('","') + '"]';
  }
  return f.name + (f.optional ? '?' : '') + ': ' + typeStr;
}

const WRAPPER_PREFIXES = ['ApiResponse', 'Page', 'PageVo'];
function isBusinessSchema(name) {
  return !WRAPPER_PREFIXES.some(p => name.startsWith(p));
}

function render(schemas) {
  const lines = [
    '# Contract Schema 摘要（v0.9.15 D32 · design AI 字段约束）',
    '',
    '> ⚠️ **此文件是字段名硬约束**：design AI 设计 mock 数据时 **必须使用以下字段名**，',
    '> 禁止凭训练偏置生造视觉用字段（如 `x` `y` `sla` `level` `progress` 等——除非 contract 真有）。',
    '> 如果你需要某个字段而 contract 里没有，请在输出里**显式 flag**："发现需要 `<field>` 但 contract 未定义，请用户决策"。',
    '',
    '> 来源：`docs/api-contract.yaml` · ' + schemas.length + ' 个业务 schema（已过滤 ApiResponseX / PageX 包装）',
    '',
  ];

  for (const s of schemas) {
    if (s.fields.length === 0) continue;
    lines.push('## ' + s.name);
    lines.push('');
    lines.push('{ ' + s.fields.map(fieldToString).join(', ') + ' }');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## 反模式黑名单（v0.9.14 D31 实战提炼）');
  lines.push('');
  lines.push('以下字段是 design AI 历史上常生造的"视觉用虚构字段"，**禁止使用**（除非 contract 真有）：');
  lines.push('');
  lines.push('| 虚构字段 | 应改用 | 真因 |');
  lines.push('|---|---|---|');
  lines.push('| `x`, `y` （SVG 画布百分比） | `lon`, `lat` （真实经纬度） | 换地图底图，不要 SVG 硬定位 |');
  lines.push('| `progress` (0-1 比例) | 用 `startTime` + `finishTime` 推算 | contract 不承诺进度比例 |');
  lines.push('| `sla` (倒计时秒数) | 用 `occurAt` + 业务规则计算 | 同上 |');
  lines.push('| `level: err/warn` | `alertType` (业务类型) + UI 着色规则 | level 是展示概念不是数据 |');
  lines.push('| `client` (客户名字符串) | `stationId` + 关联查询 | 关联实体应用 ID 而非内联字符串 |');
  lines.push('| `state: 待处置/处置中` (中文) | `status: ACTIVE/PROCESSED` (英文 enum) | 用 contract enum 值 |');
  lines.push('| `t` `v` `org` (单字母简写) | `occurAt` `vin` `deptName` (全名) | 用 contract 字段全名 |');
  lines.push('');
  lines.push('如果 mock 数据里出现以上字段且不在 contract 摘要里，**视为 design 错误**，main thread 改写时会报告并要求重做。');

  return lines.join('\n');
}

// ============================================================================
// 核心 module 函数（既给 CLI 用也给 derive-channel-package 用）
// ============================================================================

export function generateContractSummary(options) {
  const projectRoot = options.projectRoot || process.cwd();
  const yamlPath = options.yamlPath || resolve(projectRoot, 'docs/api-contract.yaml');

  if (!existsSync(yamlPath)) {
    return { ok: false, error: 'YAML_NOT_FOUND', message: yamlPath + ' 不存在' };
  }

  const text = readFileSync(yamlPath, 'utf8');
  const lines = text.split(/\r?\n/);
  const range = findSchemasRange(lines);
  if (!range) {
    return { ok: false, error: 'SCHEMAS_NOT_FOUND', message: 'yaml 中找不到 components.schemas 段' };
  }

  const allSchemas = splitSchemas(lines, range).map(s => parseSchema(s.name, s.lines));
  const businessSchemas = allSchemas.filter(s => isBusinessSchema(s.name) && s.fields.length > 0);

  const markdown = render(businessSchemas);

  if (options.output) {
    const outPath = resolve(options.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, markdown);
  }

  return {
    ok: true,
    markdown,
    totalSchemas: allSchemas.length,
    businessSchemas: businessSchemas.length,
    yamlPath,
    outputPath: options.output ? resolve(options.output) : null,
  };
}

// ============================================================================
// CLI 入口（仅在直接运行时触发）
// ============================================================================

import { fileURLToPath } from 'node:url';
const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  const args = parseArgs(process.argv.slice(2));

  if (args['dry-run']) {
    console.log('# extract-contract-summary --dry-run');
    console.log('1. 读 docs/api-contract.yaml（OpenAPI 3.x SSoT）');
    console.log('2. 找 components.schemas 段范围');
    console.log('3. 切分每个 schema（缩进 4 + PascalCase: 行）');
    console.log('4. 解析每个 schema 的 required + properties 字段（混合 inline + 多行展开）');
    console.log('5. 过滤 ApiResponseX / PageX 包装类');
    console.log('6. 渲染紧凑摘要：## SchemaName → { field?: type, ... } + enum 值');
    console.log('7. 末尾附 v0.9.14 D31 反模式黑名单');
    console.log(args.output ? '8. 写到 ' + args.output : '8. 输出到 stdout');
    process.exit(0);
  }

  const result = generateContractSummary({
    projectRoot: process.cwd(),
    output: args.output,
  });

  if (!result.ok) {
    if (result.error === 'YAML_NOT_FOUND') {
      console.error('❌ ' + result.message + '；先跑 /design');
      process.exit(2);
    }
    console.error('❌ ' + result.message);
    process.exit(3);
  }

  if (result.outputPath) {
    console.log('✅ 写入 ' + result.outputPath + '（' + result.businessSchemas + ' 业务 schema / 总 ' + result.totalSchemas + '）');
  } else {
    console.log(result.markdown);
  }
  process.exit(0);
}
