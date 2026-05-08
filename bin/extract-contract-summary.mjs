#!/usr/bin/env node
// DDT v0.9.14 D31 · 把 OpenAPI 契约提炼为 design AI 友好的紧凑字段摘要
//
// 用途：v0.9.14 实战发现 design AI 拿到 94KB / 41 paths 的完整 contract.yaml
// 仍然会"视觉合理性优先"生造 x/y/sla/level 等字段。根因是长文档里的关键
// 字段约束被注意力稀释。本脚本利用 v0.9.13 generate-api-client 已生成的
// types.ts（结构化 TS 接口）抽出每个 schema 的字段集，渲染紧凑摘要。
//
// 输入：<target>/src/api/types.ts（v0.9.13 D30 generate-api-client 产物）
// 输出：默认 stdout；--output 写文件
// 格式：
//   ## RealtimeVehicle
//   { vin: string, lon: number, lat: number, status: enum["ON_TASK","IDLE","CHARGING"], ... }
//
// 用法：
//   node bin/extract-contract-summary.mjs                      # stdout
//   node bin/extract-contract-summary.mjs --output <path>      # 写文件
//   node bin/extract-contract-summary.mjs --target=app         # 改前端目录
//   node bin/extract-contract-summary.mjs --dry-run            # 计划

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
// types.ts schema 抽取
// ============================================================================

function extractSchemasBlock(text) {
  const compStart = text.indexOf('interface components');
  if (compStart < 0) return null;
  const schemasStart = text.indexOf('schemas: {', compStart);
  if (schemasStart < 0) return null;
  let depth = 1;
  let pos = schemasStart + 'schemas: {'.length;
  while (pos < text.length && depth > 0) {
    const c = text[pos];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    pos++;
  }
  return text.slice(schemasStart + 'schemas: {'.length, pos - 1);
}

function splitSchemas(schemasBlock) {
  const schemas = [];
  const re = /^        ([A-Za-z][\w]*):\s*\{$/gm;
  const indices = [];
  let m;
  while ((m = re.exec(schemasBlock)) !== null) {
    indices.push({ name: m[1], start: m.index, openEnd: m.index + m[0].length });
  }
  for (let i = 0; i < indices.length; i++) {
    const cur = indices[i];
    const next = indices[i + 1];
    const bodyEnd = next ? next.start : schemasBlock.length;
    const body = schemasBlock.slice(cur.openEnd, bodyEnd);
    schemas.push({ name: cur.name, body });
  }
  return schemas;
}

function extractFields(body) {
  const fields = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^            (?:"([^"]+)"|([a-zA-Z_$][\w$]*))(\??)\s*:\s*(.+?);\s*$/);
    if (m) {
      const name = m[1] || m[2];
      const optional = m[3] === '?';
      const type = simplifyType(m[4].trim());
      fields.push({ name, type, optional });
    }
  }
  return fields;
}

function simplifyType(t) {
  t = t.trim();
  if (t === 'Record<string, never>') return 'object';

  const literalUnion = t.match(/^(?:(?:"[^"]*"|\d+)\s*\|\s*)+(?:"[^"]*"|\d+)$/);
  if (literalUnion) {
    const vals = t.split('|').map(x => x.trim().replace(/^"|"$/g, ''));
    return `enum[${vals.map(v => `"${v}"`).join(',')}]`;
  }

  t = t.replace(/components\["schemas"\]\["([^"]+)"\]/g, '$1');
  if (t.endsWith('[]')) return `array<${t.slice(0, -2)}>`;

  return t;
}

// ============================================================================
// 渲染
// ============================================================================

function fieldToString(f) {
  return `${f.name}${f.optional ? '?' : ''}: ${f.type}`;
}

const WRAPPER_PREFIXES = ['ApiResponse', 'Page', 'PageVo'];
function isBusinessSchema(name) {
  return !WRAPPER_PREFIXES.some(p => name.startsWith(p));
}

function render(schemas) {
  const lines = [
    '# Contract Schema 摘要（v0.9.14 D31 · design AI 字段约束）',
    '',
    '> ⚠️ **此文件是字段名硬约束**：design AI 设计 mock 数据时 **必须使用以下字段名**，',
    '> 禁止凭训练偏置生造视觉用字段（如 `x` `y` `sla` `level` `progress` 等——除非 contract 真有）。',
    '> 如果你需要某个字段而 contract 里没有，请在输出里**显式 flag**："发现需要 `<field>` 但 contract 未定义，请用户决策"。',
    '',
    `共 ${schemas.length} 个业务 schema（已过滤 ApiResponseX / PageX 包装）。`,
    '',
  ];

  for (const s of schemas) {
    if (s.fields.length === 0) continue;
    lines.push(`## ${s.name}`);
    lines.push('');
    lines.push(`{ ${s.fields.map(fieldToString).join(', ')} }`);
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
// 主流程
// ============================================================================

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || 'web';
  const typesPath = join(PROJECT_ROOT, target, 'src', 'api', 'types.ts');

  if (args['dry-run']) {
    console.log('# extract-contract-summary --dry-run');
    console.log('1. 读 ' + typesPath + '（v0.9.13 D30 generate-api-client 产物）');
    console.log('2. 不存在则提示用户先跑 generate-api-client.mjs');
    console.log('3. 解析 components.schemas 段抽每个 schema 的字段集');
    console.log('4. 过滤 ApiResponseX / PageX 包装（仅展示业务 schema）');
    console.log('5. 渲染紧凑摘要 + v0.9.14 D31 反模式黑名单');
    console.log(args.output ? '6. 写到 ' + args.output : '6. 输出到 stdout');
    process.exit(0);
  }

  if (!existsSync(typesPath)) {
    console.error('❌ ' + typesPath + ' 不存在');
    console.error('💡 请先跑：node $DDT_PLUGIN_ROOT/bin/generate-api-client.mjs');
    console.error('   该命令会从 docs/api-contract.yaml 生成 types.ts，本脚本依赖之');
    process.exit(2);
  }

  const text = readFileSync(typesPath, 'utf8');
  const schemasBlock = extractSchemasBlock(text);
  if (!schemasBlock) {
    console.error('❌ 在 types.ts 中找不到 components.schemas 段；types.ts 格式可能与预期不符');
    process.exit(3);
  }

  const allSchemas = splitSchemas(schemasBlock).map(s => ({
    ...s,
    fields: extractFields(s.body),
  }));

  const businessSchemas = allSchemas.filter(s =>
    isBusinessSchema(s.name) && s.fields.length > 0
  );

  const output = render(businessSchemas);

  if (args.output) {
    const outPath = resolve(args.output);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, output);
    console.log('✅ 写入 ' + outPath + '（' + businessSchemas.length + ' 业务 schema / 总 ' + allSchemas.length + '）');
  } else {
    console.log(output);
  }

  process.exit(0);
}

main();
