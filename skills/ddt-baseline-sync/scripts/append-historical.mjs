#!/usr/bin/env node
// ddt-baseline-sync · 把 parse-staffing.py 的 JSON 输出追加到 baseline/historical-projects.csv
//
// 用法：
//   node append-historical.mjs --json <staffing.json> --type "B2B-后台"
//   node append-historical.mjs --json - --type "SaaS"                    # stdin 读 JSON
//   node append-historical.mjs --json staffing.json --type "B2B-后台" \
//     --target /path/baseline.csv \
//     --on-duplicate skip|overwrite|append \
//     --with-examples
//
// 默认行为（v0.9.7 标准化）：
//   1. 写入目标永远是用户项目根 <cwd>/baseline/historical-projects.csv（除非 --target）
//   2. 不存在则从 skill assets/historical-projects.template.csv（仅表头）初始化
//      —— 不再从插件根 baseline/historical-projects.csv 复制（那含 8 行教学示例，会污染）
//   3. 自动生成 HIST-NNN（扫描已有最大编号 +1，与示例无关）
//   4. 按 project_name 查重；存在时按 --on-duplicate 决策（默认 skip）
//   5. --with-examples 显式 opt-in 时，初始化用 examples/historical-projects.example.csv（教学）
//   6. 输出 stdout 包含 status JSON 让 LLM 解析
//
// 退出码：
//   0 = 已写入新行 / overwrite / append-as-new 成功
//   2 = JSON 不合法（缺 total_hours 等关键字段）
//   3 = 写入失败（IO）
//   4 = 同名项目 + on-duplicate=skip（用户预期内的"幂等保护"，非错误）
//   1 = 参数错误

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SKILL_ROOT = dirname(dirname(__filename));
const TEMPLATE_PATH = join(SKILL_ROOT, 'assets', 'historical-projects.template.csv');
const EXAMPLE_PATH = join(SKILL_ROOT, 'examples', 'historical-projects.example.csv');

const VALID_DUP_STRATEGIES = new Set(['skip', 'overwrite', 'append']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function readJsonInput(jsonPath) {
  if (jsonPath === '-') {
    return JSON.parse(readFileSync(0, 'utf8'));
  }
  if (!existsSync(jsonPath)) {
    console.error(`❌ JSON 文件不存在: ${jsonPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

function ensureBaseline(targetPath, { withExamples }) {
  if (existsSync(targetPath)) return { initialized: false };

  const sourcePath = withExamples ? EXAMPLE_PATH : TEMPLATE_PATH;
  if (!existsSync(sourcePath)) {
    console.error(`❌ skill 内置模板缺失: ${sourcePath}`);
    process.exit(3);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  console.error(
    withExamples
      ? `ℹ️  从 skill examples 复制 baseline（含 8 行教学示例）→ ${targetPath}`
      : `ℹ️  从 skill assets 模板初始化 baseline（仅表头，干净起点）→ ${targetPath}`
  );
  return { initialized: true, withExamples };
}

function parseRows(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return { header: '', rows: [] };
  const header = lines[0];
  const cols = header.split(',');
  const rows = lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const obj = Object.fromEntries(cols.map((k, i) => [k.trim(), values[i] ?? '']));
    obj.__raw = line;
    return obj;
  });
  return { header, rows };
}

// 简化版 CSV 行解析：支持引号转义（与 csvEscape 互逆）
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuote = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function nextProjectId(rows) {
  const ids = rows
    .map(r => (String(r.project_id || '').match(/^HIST-(\d+)$/) || [])[1])
    .filter(Boolean)
    .map(Number);
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `HIST-${String(max + 1).padStart(3, '0')}`;
}

function findByName(rows, name) {
  if (!name) return null;
  return rows.find(r => String(r.name || '').trim() === String(name).trim()) || null;
}

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildCsvRow(staffing, type, projectId) {
  const ph = staffing.phase_hours || {};
  const notes = `${staffing.total_person_months} 人月 / ${staffing.team_size} 角色 / ${staffing.time_window || '时间窗未知'} / 复杂度 ${staffing.complexity}`;
  return [
    projectId,
    csvEscape(staffing.project_name || 'unknown'),
    csvEscape(type),
    staffing.total_hours || 0,
    ph.prd_hours || 0,
    ph.wbs_hours || 0,
    ph.design_hours || 0,
    ph.frontend_hours || 0,
    ph.backend_hours || 0,
    ph.test_hours || 0,
    ph.review_hours || 0,
    ph.docs_hours || 0,
    '',
    '',
    staffing.team_size || 0,
    csvEscape(notes),
  ].join(',');
}

function writeCsv(targetPath, header, rows) {
  const body = rows.map(r => r.__raw).join('\n');
  const text = body ? `${header}\n${body}\n` : `${header}\n`;
  writeFileSync(targetPath, text);
}

function emitResult(result) {
  console.log('--- RESULT ---');
  console.log(JSON.stringify(result, null, 2));
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.json || !args.type) {
    console.error('❌ 用法: append-historical.mjs --json <staffing.json> --type <项目类型>');
    console.error('   --type 可选值：B2B-后台 / SaaS / API-Mobile / 其他');
    console.error('   --on-duplicate skip|overwrite|append（默认 skip）');
    console.error('   --with-examples 用 examples 教学数据初始化（默认 false 仅表头）');
    process.exit(1);
  }

  const onDuplicate = args['on-duplicate'] || 'skip';
  if (!VALID_DUP_STRATEGIES.has(onDuplicate)) {
    console.error(`❌ --on-duplicate 不合法: ${onDuplicate}（应为 skip|overwrite|append）`);
    process.exit(1);
  }

  const staffing = readJsonInput(args.json);
  if (!staffing.total_hours || !staffing.phase_hours) {
    console.error('❌ JSON 缺 total_hours / phase_hours 字段（应来自 parse-staffing.py）');
    process.exit(2);
  }

  const targetPath = args.target
    ? resolve(args.target)
    : resolve(process.cwd(), 'baseline', 'historical-projects.csv');

  const initInfo = ensureBaseline(targetPath, { withExamples: !!args['with-examples'] });

  const text = readFileSync(targetPath, 'utf8');
  const { header, rows } = parseRows(text);
  const existingDup = findByName(rows, staffing.project_name);

  if (existingDup) {
    if (onDuplicate === 'skip') {
      const result = {
        status: 'skipped_duplicate',
        target: targetPath,
        existing_project_id: existingDup.project_id,
        existing_project_name: existingDup.name,
        message: '同名项目已存在，本次跳过（幂等保护）。如需覆盖，重跑加 --on-duplicate overwrite；如需作两期独立项目，加 --on-duplicate append',
        initialized: initInfo.initialized,
      };
      emitResult(result);
      console.log('');
      console.log(`ℹ️  跳过：baseline 已含 ${existingDup.project_id} "${existingDup.name}"`);
      process.exit(4);
    }

    if (onDuplicate === 'overwrite') {
      const projectId = existingDup.project_id;
      const newRow = buildCsvRow(staffing, args.type, projectId);
      const newRows = rows.map(r =>
        r.project_id === projectId ? { ...r, __raw: newRow } : r
      );
      writeCsv(targetPath, header, newRows);
      const result = {
        status: 'overwritten',
        target: targetPath,
        project_id: projectId,
        new_row: newRow,
        initialized: initInfo.initialized,
      };
      emitResult(result);
      console.log('');
      console.log(`✅ 覆盖 ${projectId}: ${newRow}`);
      process.exit(0);
    }
    // 'append' 落入下方常规追加分支（保留旧行 + 新行作新 HIST-NNN）
  }

  const projectId = nextProjectId(rows);
  const newRow = buildCsvRow(staffing, args.type, projectId);
  const newRows = [...rows, { __raw: newRow, project_id: projectId, name: staffing.project_name }];
  writeCsv(targetPath, header, newRows);

  const result = {
    status: existingDup ? 'appended_as_new' : 'appended',
    target: targetPath,
    project_id: projectId,
    new_row: newRow,
    initialized: initInfo.initialized,
    duplicate_of: existingDup ? existingDup.project_id : null,
  };
  emitResult(result);
  console.log('');
  console.log(`✅ 追加 ${projectId}: ${newRow}`);
  console.log('');
  console.log('下一步：');
  console.log('  下次 /digital-delivery-team:wbs 时 pm-agent 会读到本行作为同类项目工时基准');
  console.log('  /digital-delivery-team:report 阶段也会用此 baseline 做对比');
  process.exit(0);
}

main();
