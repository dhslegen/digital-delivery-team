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

// V3 canonical stage → agent names 映射（subagent 维度，精度较低，作为 fallback）
const STAGES = {
  requirements: ['product-agent', 'pm-agent'],
  architecture: ['architect-agent'],
  frontend: ['frontend-agent'],
  backend: ['backend-agent'],
  testing: ['test-agent', 'review-agent'],
  docs: ['docs-agent'],
};

// M1-7: stage → slash-command (phase) 映射（精确，优先来源）
//   一个 stage 可由多个 slash command 贡献工时；编排命令（kickoff/impl/verify/ship）
//   作为 *额外加权* 不属于任何子阶段，在 STAGE_PHASES 单独标记。
const STAGE_PHASES = {
  requirements: ['prd', 'wbs'],
  architecture: ['design'],
  frontend: ['build-web'],
  backend: ['build-api'],
  testing: ['test', 'review', 'verify'],
  docs: ['package', 'report'],
};
const ORCHESTRATOR_PHASES = ['kickoff', 'impl', 'ship'];

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

// B3: 进程任意退出路径都释放 SQLite 句柄
process.on('exit', () => { try { store.close(); } catch (_) { /* already closed */ } });

const actualByAgent  = projectId ? store.aggregateStageHours(projectId) : {};
const actualByPhase  = projectId ? store.aggregatePhaseHours(projectId) : {};
// T-R04: 改用 qualitySnapshot 分别获取测试和审查的最新行
const { testRow, reviewRow } = projectId
  ? store.qualitySnapshot(projectId)
  : { testRow: null, reviewRow: null };
const actual = aggregateCanonicalStages(actualByAgent, actualByPhase);
const orchestratorTotal = sumPhases(actualByPhase, ORCHESTRATOR_PHASES);
// P2-2: 编排开销 = 每个编排命令工时 - 该命令实际包含的子 phase 工时
//   每个编排命令对应一组明确的子 phase（容器关系）：
//     kickoff = prd + wbs + design   （需求 + 架构）
//     impl    = build-web + build-api（前后端实现）
//     ship    = package              （打包发布）
//   编排开销 = 用户交互 + 决策门暂停 + 阶段切换间隙（可独立优化的协调成本）
const ORCHESTRATOR_TO_CHILDREN = {
  kickoff: ['prd', 'wbs', 'design'],
  impl:    ['build-web', 'build-api'],
  ship:    ['package'],
};
const orchestrationBreakdown = [];
let orchestrationOverheadTotal = 0;
for (const [orch, children] of Object.entries(ORCHESTRATOR_TO_CHILDREN)) {
  const orchHours  = actualByPhase[orch] || 0;
  if (orchHours === 0) continue;
  const childHours = children.reduce((sum, c) => sum + (actualByPhase[c] || 0), 0);
  const overhead   = Math.max(0, orchHours - childHours);
  orchestrationOverheadTotal += overhead;
  orchestrationBreakdown.push({ orch, orchHours, childHours, overhead, children });
}
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

// M1-7: 暴露 phase 与编排工时供 metrics-agent 引用
lines.push('## 4. 阶段与编排原始工时（精确，单位小时）');
lines.push('');
const phaseEntries = Object.entries(actualByPhase).sort(([a], [b]) => a.localeCompare(b));
if (phaseEntries.length) {
  lines.push('| Phase | 实际工时(h) |');
  lines.push('|-------|------------|');
  for (const [phase, hours] of phaseEntries) {
    lines.push(`| ${phase} | ${hours.toFixed(3)} |`);
  }
} else {
  lines.push('_（暂无 phase 工时数据；UserPromptSubmit hook 未捕获或会话内未触发任何 slash command）_');
}
lines.push('');
if (orchestrationBreakdown.length) {
  lines.push('### 编排开销拆解');
  lines.push('');
  lines.push('| 编排命令 | 总工时(h) | 子阶段合计(h) | 编排开销(h) | 子 phase |');
  lines.push('|---------|----------|--------------|------------|---------|');
  for (const row of orchestrationBreakdown) {
    lines.push(`| ${row.orch} | ${row.orchHours.toFixed(3)} | ${row.childHours.toFixed(3)} | **${row.overhead.toFixed(3)}** | ${row.children.join(' + ')} |`);
  }
  lines.push('');
  lines.push(`> **编排开销合计：${orchestrationOverheadTotal.toFixed(3)} h**（用户交互 + 决策门暂停 + 阶段切换间隙；可独立优化）`);
  lines.push('> 子阶段工时已分别计入阶段对比表，不重复计算。');
  lines.push('');
}

// P2-1: 数据快照声明 — 让 metrics-agent / 用户清楚 raw 数据的时点边界
lines.push('## 5. 数据快照说明');
lines.push('');
lines.push(`- **raw 报告生成时点**：${ts}`);
lines.push('- **统计口径**：仅含已配对完成的 phase（phase_start + phase_end 都已落盘）');
lines.push('- **本次 /report 自身工时**：尚未计入本快照——`/report` phase_end 在 raw 写完后才发射，');
lines.push('  下次 `/report` 跑时才会被纳入工时统计。这不是 bug，而是事件配对模型的边界条件。');
lines.push('- **建议**：若需含本次 /report 完整工时，跑完一次 `/report` 后再跑 `/report --refresh` 即可。');
lines.push('');

lines.push('> metrics-agent 接手后将在此基础上做自然语言解读。');

// 写入输出文件
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(JSON.stringify({ out: outPath, degradation: anyDegradation || quality.issues.length > 0 || quality.missing, ts }));

// M1-7: 优先 phase 维度（精确）→ fallback subagent 维度（粗）→ 都缺则 null
function aggregateCanonicalStages(actualByAgent, actualByPhase) {
  return Object.fromEntries(Object.entries(STAGES).map(([stage, agents]) => {
    const phases = STAGE_PHASES[stage] || [];
    const phaseHours = phases.map(p => actualByPhase[p]).filter(v => v !== undefined && v !== null);
    if (phaseHours.length) {
      return [stage, phaseHours.reduce((sum, v) => sum + v, 0)];
    }
    const agentHours = agents.map(a => actualByAgent[a]).filter(v => v !== undefined && v !== null);
    if (agentHours.length) {
      return [stage, agentHours.reduce((sum, v) => sum + v, 0)];
    }
    return [stage, null];
  }));
}

function sumPhases(actualByPhase, phaseList) {
  let sum = 0;
  let any = false;
  for (const p of phaseList) {
    if (actualByPhase[p] !== undefined && actualByPhase[p] !== null) {
      sum += actualByPhase[p];
      any = true;
    }
  }
  return any ? sum : null;
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
