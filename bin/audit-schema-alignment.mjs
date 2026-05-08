#!/usr/bin/env node
// DDT v0.9.14 D31 · web mock 字段 vs contract schema 字段层差集审计
//
// 用途：v0.9.13 D30 解决了"mock 数组存在性"，但没解决"mock 字段是否对得上 contract"。
// 实战发现：alv-ops/web mock 平均三方一致字段 ~17%（VEHICLES.x/y vs Vehicle.lon/lat
// 等设计层冲突）。本脚本扫每个 mock 数组的字段集，与 contract schema 做差集，
// 输出 docs/schema-audit.md 让 LLM 在 IMPLEMENT 阶段逐组件按报告改。

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

// types.ts schema 抽取
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
  for (const m of schemasBlock.matchAll(re)) {
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

function extractSchemaFieldNames(body) {
  const names = new Set();
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^            (?:"([^"]+)"|([a-zA-Z_$][\w$]*))(\??)\s*:/);
    if (m) names.add(m[1] || m[2]);
  }
  return names;
}

function walkFiles(dir, files = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'build', '.next'].includes(ent.name)) continue;
      walkFiles(full, files);
    } else if (/\.(ts|tsx|js|jsx)$/.test(ent.name)) {
      if (/\/api\/(types|client)\.ts$/.test(full)) continue;
      if (/(__mocks__|__tests__|\.test\.|\.spec\.)/.test(full)) continue;
      files.push(full);
    }
  }
  return files;
}

const MOCK_DECL_RE = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::\s*[^=]+)?=\s*\[/gm;

function extractFirstObjectKeys(text, startIdx) {
  const len = text.length;
  let pos = startIdx;
  while (pos < len && text[pos] !== '{') pos++;
  if (pos >= len) return null;

  let depth = 0;
  const objStart = pos;
  let objEnd = -1;
  for (; pos < len; pos++) {
    const c = text[pos];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { objEnd = pos; break; }
    }
  }
  if (objEnd < 0) return null;

  const objBody = text.slice(objStart + 1, objEnd);
  const keys = new Set();
  let depth2 = 0;
  let cur = '';
  for (let i = 0; i < objBody.length; i++) {
    const c = objBody[i];
    if (c === '{' || c === '[') depth2++;
    else if (c === '}' || c === ']') depth2--;
    if (depth2 === 0 && c === ',') {
      const m = cur.match(/^\s*(?:'|")?([a-zA-Z_$][\w$]*)(?:'|")?\s*:/);
      if (m) keys.add(m[1]);
      cur = '';
      continue;
    }
    cur += c;
  }
  const m = cur.match(/^\s*(?:'|")?([a-zA-Z_$][\w$]*)(?:'|")?\s*:/);
  if (m) keys.add(m[1]);
  return keys;
}

function findMocksInFile(filePath, text) {
  const mocks = [];
  for (const m of text.matchAll(MOCK_DECL_RE)) {
    const name = m[1];
    const declEnd = m.index + m[0].length;
    const keys = extractFirstObjectKeys(text, declEnd);
    if (!keys || keys.size < 2) continue;
    const lineNo = text.slice(0, m.index).split(/\r?\n/).length;
    mocks.push({ file: filePath, line: lineNo, name, keys });
  }
  return mocks;
}

function singularize(name) {
  if (name.endsWith('IES')) return name.slice(0, -3) + 'Y';
  if (name.endsWith('ES')) return name.slice(0, -2);
  if (name.endsWith('S')) return name.slice(0, -1);
  return name;
}

function matchSchema(mockName, schemas) {
  const candidates = [
    mockName,
    singularize(mockName),
    mockName.replace(/_LIST|_QUEUE|_DATA|_DIST|_ITEMS$/i, ''),
    singularize(mockName.replace(/_LIST|_QUEUE|_DATA|_DIST|_ITEMS$/i, '')),
  ];
  for (const c of candidates) {
    const cu = c.toUpperCase();
    const exact = schemas.find(s => s.name.toUpperCase() === cu);
    if (exact) return exact;
    const partial = schemas.find(s => {
      const su = s.name.toUpperCase();
      return su.includes(cu) || cu.includes(su);
    });
    if (partial) return partial;
  }
  return null;
}

const VIRTUAL_FIELDS = {
  x: '应改用 lon （真实经度）',
  y: '应改用 lat （真实纬度）',
  progress: '应用 startTime + finishTime 推算',
  sla: '应用 occurAt + 业务规则计算',
  level: '应用 alertType (业务类型) + UI 着色规则',
  client: '应用 stationId + 关联查询',
  state: '应用 status (英文 enum) 替代中文枚举',
  org: '应用 deptName',
  t: '应用 occurAt / startAt / accidentTime 等全名时间字段',
  v: '应用 vin（VIN 全名）',
};

function diff(setA, setB) {
  const onlyA = [...setA].filter(x => !setB.has(x));
  const onlyB = [...setB].filter(x => !setA.has(x));
  const both = [...setA].filter(x => setB.has(x));
  return { onlyA, onlyB, both };
}

function renderAudit(mocks, schemas) {
  const lines = [
    '# Schema 对齐审计报告（v0.9.14 D31）',
    '',
    '> 扫描时间：' + new Date().toISOString(),
    '> Mock 数组：' + mocks.length + '  ·  Contract schema：' + schemas.length,
    '',
  ];

  let matchedCount = 0;
  let totalAlignment = 0;
  const matched = [];
  const unmatched = [];

  for (const m of mocks) {
    const schema = matchSchema(m.name, schemas);
    if (schema) {
      const schemaFields = extractSchemaFieldNames(schema.body);
      const d = diff(m.keys, schemaFields);
      const alignmentPct = m.keys.size > 0
        ? Math.round((d.both.length / m.keys.size) * 100)
        : 0;
      matched.push({ ...m, schema: schema.name, schemaFields, ...d, alignmentPct });
      matchedCount++;
      totalAlignment += alignmentPct;
    } else {
      unmatched.push(m);
    }
  }

  const avgAlignment = matchedCount > 0 ? Math.round(totalAlignment / matchedCount) : 0;

  lines.push('## 整体诊断');
  lines.push('');
  lines.push('- 命中 contract schema 的 mock：' + matchedCount + ' / ' + mocks.length);
  lines.push('- 平均字段一致比例（按 mock 字段分母）：**' + avgAlignment + '%**');
  if (avgAlignment < 30) {
    lines.push('- 评级：🔴 **严重错位**（< 30%）—— mock 字段几乎完全脱钩 contract');
  } else if (avgAlignment < 60) {
    lines.push('- 评级：🟡 **中度错位**（30-60%）—— mock 部分字段需重构');
  } else {
    lines.push('- 评级：🟢 **基本对齐**（≥ 60%）—— mock 字段 vs contract 主要一致');
  }
  lines.push('');

  if (matched.length > 0) {
    lines.push('## 详细差集（按 mock 命中 contract schema）');
    lines.push('');
    for (const m of matched) {
      const rel = m.file.replace(PROJECT_ROOT + '/', '');
      const icon = m.alignmentPct >= 60 ? '🟢' : m.alignmentPct >= 30 ? '🟡' : '🔴';
      lines.push('### ' + icon + ' ' + m.name + ' → `' + m.schema + '`（' + m.alignmentPct + '% 一致）');
      lines.push('');
      lines.push('位置：`' + rel + ':' + m.line + '`');
      lines.push('');
      lines.push('| Mock 字段 | Contract Schema 字段 | 处理建议 |');
      lines.push('|---|---|---|');

      for (const f of m.onlyA) {
        const hint = VIRTUAL_FIELDS[f] || '检查是否真有业务需求；contract 未承诺此字段';
        lines.push('| ❌ `' + f + '` | _(无)_ | ' + hint + ' |');
      }
      for (const f of m.both) {
        lines.push('| ✅ `' + f + '` | `' + f + '` | 字段名一致，检查类型/枚举值 |');
      }
      for (const f of m.onlyB.slice(0, 8)) {
        lines.push('| _(mock 缺)_ | ➕ `' + f + '` | 应在 mock 中补充或在 UI 展示 |');
      }
      if (m.onlyB.length > 8) {
        lines.push('| ... | _(+' + (m.onlyB.length - 8) + ' 个 contract 字段)_ | 详见 `web/src/api/types.ts::' + m.schema + '` |');
      }
      lines.push('');
    }
  }

  if (unmatched.length > 0) {
    lines.push('## 未命中 contract schema 的 mock');
    lines.push('');
    lines.push('以下 mock 数组未找到对应 contract schema（可能是合法 fixture / enum / UI 静态数据）：');
    lines.push('');
    for (const m of unmatched) {
      const rel = m.file.replace(PROJECT_ROOT + '/', '');
      lines.push('- `' + m.name + '` (' + m.keys.size + ' 字段) — `' + rel + ':' + m.line + '`');
    }
    lines.push('');
  }

  const hotPatterns = [];
  for (const m of matched) {
    for (const f of m.onlyA) {
      if (VIRTUAL_FIELDS[f]) {
        hotPatterns.push({ field: f, mock: m.name, file: m.file, line: m.line, hint: VIRTUAL_FIELDS[f] });
      }
    }
  }
  if (hotPatterns.length > 0) {
    lines.push('## 反模式 hot-list（高优先级修复）');
    lines.push('');
    lines.push('以下字段在 mock 中存在但 contract 未定义，且匹配 v0.9.14 D31 反模式黑名单：');
    lines.push('');
    lines.push('| 文件:行 | Mock 数组 | 虚构字段 | 建议 |');
    lines.push('|---|---|---|---|');
    for (const h of hotPatterns) {
      const rel = h.file.replace(PROJECT_ROOT + '/', '');
      lines.push('| `' + rel + ':' + h.line + '` | `' + h.mock + '` | `' + h.field + '` | ' + h.hint + ' |');
    }
    lines.push('');
  }

  const designLayerConflicts = matched.filter(m =>
    m.onlyA.some(f => f === 'x' || f === 'y') &&
    m.schemaFields.has('lon') && m.schemaFields.has('lat')
  );
  if (designLayerConflicts.length > 0) {
    lines.push('## ⚠️ 设计层冲突（需 LLM 在 IMPLEMENT 阶段做决策）');
    lines.push('');
    lines.push('以下 mock 用 SVG 画布坐标 `x`/`y`，contract 用真实地理 `lon`/`lat`：');
    lines.push('');
    for (const m of designLayerConflicts) {
      const rel = m.file.replace(PROJECT_ROOT + '/', '');
      lines.push('- `' + rel + ':' + m.line + '` (`' + m.name + '`)');
    }
    lines.push('');
    lines.push('**这不是数据层适配能解决的**——SVG 大屏组件依赖 `transform={translate(${v.x} ${v.y})}` 直接定位；');
    lines.push('换成 `lon`/`lat` 后必须**用真实地图底图**（Leaflet / 高德 JSAPI / MapboxGL / ECharts geo 组件）');
    lines.push('替代 SVG viewBox 坐标系。LLM 在 IMPLEMENT 时需做选型决策，建议主动询问用户。');
    lines.push('');
  }

  lines.push('## 行动建议（按修复成本排序）');
  lines.push('');
  lines.push('1. **低成本（命名一致）**：mock 字段与 schema 同名但拼写不同（如 `state`/`status`、`v`/`vin`）→ 全局重命名');
  lines.push('2. **中成本（mock 独有展示字段）**：mock 字段 contract 未定义（如 `mileage`、`waybills`）→ 与后端协商：补 contract 或前端通过关联查询拼接');
  lines.push('3. **中成本（enum 重映射）**：mock 用中文枚举，contract 用英文枚举 → 加 i18n / display map');
  lines.push('4. **高成本（设计层冲突）**：x/y → lon/lat（见上面警示段）→ 替换地图组件，可能影响视觉');
  lines.push('5. **高成本（UI 重设计）**：mock 含视觉用虚构字段（progress 进度条 / sla 倒计时） → 删字段 + 改组件 / 用现有 contract 字段推算');
  lines.push('');
  lines.push('LLM 在 IMPLEMENT 时按本报告逐组件 review，不要凭记忆改 mock。');

  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = args.target || 'web';
  const outputPath = args.output || join(PROJECT_ROOT, 'docs', 'schema-audit.md');
  const typesPath = join(PROJECT_ROOT, target, 'src', 'api', 'types.ts');
  const targetSrcDir = join(PROJECT_ROOT, target, 'src');

  if (args['dry-run']) {
    console.log('# audit-schema-alignment --dry-run');
    console.log('1. 读 ' + typesPath + ' 抽 components.schemas');
    console.log('2. 扫 ' + targetSrcDir + ' 下 .tsx/.ts 找 const X = [...] mock 数组');
    console.log('3. 对每个 mock 抽第一项的字段集');
    console.log('4. 按 mock 名匹配 contract schema（精确 + 单数化 + _LIST/_QUEUE 后缀剥离）');
    console.log('5. 字段集差集：mock 独有 / 三方一致 / schema 独有');
    console.log('6. 反模式 hot-list（x/y/progress/sla/level/client/state/org/t/v）');
    console.log('7. 设计层冲突警示（x/y vs lon/lat）');
    console.log('8. 行动建议（按修复成本排序）');
    console.log('9. 写到 ' + outputPath);
    process.exit(0);
  }

  if (!existsSync(typesPath)) {
    console.error('❌ ' + typesPath + ' 不存在');
    console.error('💡 请先跑：node $DDT_PLUGIN_ROOT/bin/generate-api-client.mjs');
    process.exit(2);
  }

  if (!existsSync(targetSrcDir)) {
    console.error('❌ ' + targetSrcDir + ' 不存在；--target=<dir> 改前端目录');
    process.exit(2);
  }

  const typesText = readFileSync(typesPath, 'utf8');
  const schemasBlock = extractSchemasBlock(typesText);
  if (!schemasBlock) {
    console.error('❌ types.ts 中找不到 components.schemas 段');
    process.exit(3);
  }
  const schemas = splitSchemas(schemasBlock);

  const files = walkFiles(targetSrcDir);
  const allMocks = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    allMocks.push(...findMocksInFile(f, text));
  }

  const report = renderAudit(allMocks, schemas);

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, report);

  console.log('▶ schema 对齐审计完成');
  console.log('  扫描文件：' + files.length);
  console.log('  发现 mock 数组：' + allMocks.length);
  console.log('  Contract schema：' + schemas.length);
  console.log('✅ 报告已写入：' + outputPath);

  process.exit(0);
}

main();
