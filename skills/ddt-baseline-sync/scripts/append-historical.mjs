#!/usr/bin/env node
// ddt-baseline-sync · 把 parse-staffing.py 的 JSON 输出追加到 baseline/historical-projects.csv
//
// 用法：
//   node append-historical.mjs --json <staffing.json> --type "B2B-后台"
//   node append-historical.mjs --json - --type "SaaS"          # 从 stdin 读 JSON
//   node append-historical.mjs --json staffing.json --type "B2B-后台" --target /path/baseline.csv
//
// 默认行为：
//   1. 优先 <cwd>/baseline/historical-projects.csv（项目级）
//   2. 不存在则从插件根 baseline/historical-projects.csv 复制后追加
//   3. 自动生成 HIST-NNN（扫描已有最大编号 +1）
//   4. 输出新 CSV 行 + 路径
//
// 退出码：0 = 完成；1 = 参数错误；2 = JSON 不合法；3 = 写入失败

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SKILL_ROOT = dirname(dirname(__filename));
const PLUGIN_ROOT = dirname(dirname(SKILL_ROOT));
const PLUGIN_BASELINE = join(PLUGIN_ROOT, 'baseline', 'historical-projects.csv');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function readJsonInput(jsonPath) {
  if (jsonPath === '-') {
    return JSON.parse(readFileSync(0, 'utf8'));  // stdin
  }
  if (!existsSync(jsonPath)) {
    console.error(`❌ JSON 文件不存在: ${jsonPath}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

function ensureBaseline(targetPath) {
  if (existsSync(targetPath)) return;
  // 项目根 baseline 不存在 → 从插件根复制
  if (!existsSync(PLUGIN_BASELINE)) {
    console.error(`❌ 插件根 baseline 也不存在: ${PLUGIN_BASELINE}`);
    process.exit(3);
  }
  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(PLUGIN_BASELINE, targetPath);
  console.error(`ℹ️  从插件根复制 baseline → ${targetPath}`);
}

function nextProjectId(csvPath) {
  const text = readFileSync(csvPath, 'utf8');
  const ids = text.split('\n')
    .map(line => (line.match(/^HIST-(\d+),/) || [])[1])
    .filter(Boolean)
    .map(Number);
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `HIST-${String(max + 1).padStart(3, '0')}`;
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
    '',  // defect_count（项目未跑完）
    '',  // coverage_pct
    staffing.team_size || 0,
    csvEscape(notes),
  ].join(',');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.json || !args.type) {
    console.error('❌ 用法: append-historical.mjs --json <staffing.json> --type <项目类型>');
    console.error('   --type 可选值：B2B-后台 / SaaS / API-only / Mobile / 其他');
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

  ensureBaseline(targetPath);

  const projectId = nextProjectId(targetPath);
  const newRow = buildCsvRow(staffing, args.type, projectId);

  // 追加（保留末尾换行规范）
  const existing = readFileSync(targetPath, 'utf8');
  const sep = existing.endsWith('\n') ? '' : '\n';
  writeFileSync(targetPath, existing + sep + newRow + '\n');

  console.log(`✅ 追加到 ${targetPath}:`);
  console.log(`   ${newRow}`);
  console.log('');
  console.log('下一步：');
  console.log('  下次 /digital-delivery-team:wbs 时 pm-agent 会读到本行作为同类项目工时基准');
  console.log('  /digital-delivery-team:report 阶段也会用此 baseline 做对比');
}

main();
