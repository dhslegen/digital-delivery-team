#!/usr/bin/env node
// T-M04: 从 metrics.db + baseline.locked.json 产出 efficiency-report.raw.md
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { DeliveryStore } from './lib/store.mjs';

const METRICS_DIR = process.env.DDT_METRICS_DIR ||
  join(homedir(), '.claude', 'delivery-metrics');
const DB = join(METRICS_DIR, 'metrics.db');
const DEFAULT_BASELINE = 'baseline/baseline.locked.json';
const DEFAULT_OUT = 'docs/efficiency-report.raw.md';

const args = new Map(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith('--') ? [[a.replace(/^--/, ''), arr[i+1] && !arr[i+1].startsWith('--') ? arr[i+1] : true]] : []));

if (args.has('help')) {
  console.log(`Usage: node report.mjs [options]

Options:
  --project <id>     按项目 ID 过滤
  --out <path>       输出文件路径（默认: ${DEFAULT_OUT}）
  --baseline <path>  baseline.locked.json 路径（默认: ${DEFAULT_BASELINE}）
  --allow-missing-baseline
                    允许 baseline 缺失时输出不可证明报告
  --help             显示帮助
`);
  process.exit(0);
}

const outPath = args.get('out') || DEFAULT_OUT;
const baselinePath = args.get('baseline') || DEFAULT_BASELINE;
const projectId = args.get('project') || null;

// V3 canonical stage → agent names 映射
const STAGES = {
  requirements: ['product-agent', 'pm-agent'],
  architecture: ['architect-agent'],
  frontend: ['frontend-agent'],
  backend: ['backend-agent'],
  testing: ['test-agent', 'review-agent'],
  docs: ['docs-agent'],
};

// 读 baseline
let baseline = null;
if (existsSync(baselinePath)) {
  baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
} else if (!args.has('allow-missing-baseline')) {
  console.error(`baseline missing at ${baselinePath}. Run baseline.mjs in the project root or pass --allow-missing-baseline.`);
  process.exit(3);
}

// 读 DB
if (!existsSync(DB)) {
  console.error(`metrics.db 不存在于 ${DB}，请先运行 aggregate.mjs`);
  process.exit(2);
}
const store = new DeliveryStore(DB);
await store.openOrCreate();

const actualByAgent  = projectId ? store.aggregateStageHours(projectId) : {};
// T-R04: 改用 qualitySnapshot 分别获取测试和审查的最新行
const { testRow, reviewRow } = projectId
  ? store.qualitySnapshot(projectId)
  : { testRow: null, reviewRow: null };
const actual = aggregateCanonicalStages(actualByAgent);
const quality = evaluateQuality(testRow, reviewRow);

// 构建报告
const ts = new Date().toISOString();
const lines = [];

lines.push(`# Efficiency Report (Raw)`);
lines.push(`> 生成时间: ${ts}${projectId ? ` · 项目: \`${projectId}\`` : ' · 全量（未指定项目）'}`);
lines.push('');

if (!baseline) {
  lines.push('⚠️ baseline 缺失：阶段提效不可证明。');
  lines.push('');
}
if (quality.missing) {
  lines.push('⚠️ 质量指标缺失：coverage / defects / acceptance 不可证明，metrics-agent 必须判为不可证明。');
  lines.push('');
} else if (quality.issues.length) {
  lines.push(`⚠️ 质量劣化警告：${quality.issues.join('；')}`);
  lines.push('');
}

// 1. 阶段对比表
lines.push('## 1. 阶段级对比表');
lines.push('');
lines.push('| 阶段 | 基线(h) | 实际(h) | Δ% | 状态 |');
lines.push('|------|---------|---------|-----|------|');

const mergedBase = baseline?.merged || {};
let anyDegradation = false;

for (const stage of Object.keys(STAGES)) {
  const base = mergedBase[stage] ?? null;
  const act  = actual[stage]   ?? null;
  let delta  = '—';
  let status = '—';
  if (base !== null && act !== null) {
    const pct = base > 0 ? ((act - base) / base * 100) : 0;
    delta = `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    if (pct > 20) {
      status = '⚠️ 超时';
      anyDegradation = true;
    } else if (pct < -10) {
      status = '✅ 加速';
    } else {
      status = '✅ 正常';
    }
  }
  const baseStr = base !== null ? base.toFixed(2) : '—';
  const actStr  = act  !== null ? act.toFixed(2)  : '—';
  lines.push(`| ${stage} | ${baseStr} | ${actStr} | ${delta} | ${status} |`);
}

lines.push('');

// 2. 质量守门表
lines.push('## 2. 质量守门表');
lines.push('');
if (anyDegradation) {
  lines.push('⚠️ 存在劣化指标，请 metrics-agent 重点分析。');
  lines.push('');
}
if (testRow || reviewRow) {
  lines.push('| 指标 | 值 | 来源 |');
  lines.push('|------|----|----- |');
  if (testRow) {
    pushMetric(lines, 'coverage_pct', testRow.coverage_pct, '%', testRow.source);
    pushMetric(lines, 'tests_total', testRow.tests_total, '', testRow.source);
    pushMetric(lines, 'tests_passed', testRow.tests_passed, '', testRow.source);
    pushMetric(lines, 'tests_failed', testRow.tests_failed, '', testRow.source);
    pushMetric(lines, 'defects_critical', testRow.defects_critical, '', testRow.source);
    pushMetric(lines, 'defects_major', testRow.defects_major, '', testRow.source);
    pushMetric(lines, 'defects_minor', testRow.defects_minor, '', testRow.source);
    pushMetric(lines, 'rework_count', testRow.rework_count, '', testRow.source);
    pushMetric(lines, 'acceptance_pass_pct', testRow.acceptance_pass_pct, '%', testRow.source);
  }
  if (reviewRow) {
    pushMetric(lines, 'blocker_count', reviewRow.blocker_count, '', reviewRow.source);
    pushMetric(lines, 'warning_count', reviewRow.warning_count, '', reviewRow.source);
    pushMetric(lines, 'suggestion_count', reviewRow.suggestion_count, '', reviewRow.source);
  }
  lines.push('');
  if (quality.issues.length) {
    lines.push(`质量守门结论：⚠️ ${quality.issues.join('；')}`);
  } else {
    lines.push('质量守门结论：✅ 当前已入库指标未见劣化。');
  }
} else {
  lines.push('_（无质量度量数据，请运行 /test 和 /review）_');
}

lines.push('');

// 3. 原始数据链接
lines.push('## 3. 原始数据链接');
lines.push('');
lines.push(`- **DB**: \`${DB}\``);
lines.push(`- **Baseline**: \`${baselinePath}\``);
lines.push(`- **Events JSONL**: \`${join(METRICS_DIR, 'events.jsonl')}\``);
lines.push('');
lines.push('> metrics-agent 接手后将在此基础上做自然语言解读。');

// 写入输出文件
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(JSON.stringify({ out: outPath, degradation: anyDegradation || quality.issues.length > 0 || quality.missing, ts }));

function aggregateCanonicalStages(actualByAgent) {
  return Object.fromEntries(Object.entries(STAGES).map(([stage, agents]) => {
    const values = agents.map(agent => actualByAgent[agent]).filter(value => value !== undefined && value !== null);
    if (!values.length) return [stage, null];
    return [stage, values.reduce((sum, value) => sum + value, 0)];
  }));
}

function evaluateQuality(testRow, reviewRow) {
  const issues = [];
  const knownValues = [
    testRow?.coverage_pct,
    testRow?.tests_total,
    testRow?.tests_passed,
    testRow?.tests_failed,
    testRow?.defects_critical,
    testRow?.defects_major,
    testRow?.defects_minor,
    testRow?.rework_count,
    testRow?.acceptance_pass_pct,
    reviewRow?.blocker_count,
    reviewRow?.warning_count,
    reviewRow?.suggestion_count,
  ].filter(value => value !== null && value !== undefined && value !== '');

  if (testRow) {
    const coverage = nullableNumber(testRow.coverage_pct);
    if (coverage !== null && coverage < 70) issues.push(`coverage ${coverage}% < 70%`);

    const failed = nullableNumber(testRow.tests_failed);
    if (failed !== null && failed > 0) issues.push(`测试失败 ${failed} 条`);

    const critical = nullableNumber(testRow.defects_critical);
    if (critical !== null && critical > 0) issues.push(`critical 缺陷 ${critical} 条`);

    const major = nullableNumber(testRow.defects_major);
    if (major !== null && major > 0) issues.push(`major 缺陷 ${major} 条`);

    const rework = nullableNumber(testRow.rework_count);
    if (rework !== null && rework > 0) issues.push(`返工 ${rework} 次`);

    const acceptance = nullableNumber(testRow.acceptance_pass_pct);
    if (acceptance !== null && acceptance < 100) issues.push(`验收通过率 ${acceptance}% < 100%`);
  }

  if (reviewRow) {
    const blockers = nullableNumber(reviewRow.blocker_count);
    if (blockers !== null && blockers > 0) issues.push(`review 阻塞 ${blockers} 条`);
  }

  return { issues, missing: knownValues.length === 0 };
}

function nullableNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pushMetric(lines, name, value, suffix, source) {
  if (value === null || value === undefined || value === '') return;
  lines.push(`| ${name} | ${value}${suffix || ''} | ${source || 'unknown'} |`);
}
