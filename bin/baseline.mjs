#!/usr/bin/env node
// T-M03: 从 historical CSV + expert MD 产出项目目录内的 baseline.locked.json。
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const DEFAULT_HIST = 'baseline/historical-projects.csv';
const DEFAULT_EXPERT = 'baseline/estimation-rules.md';
const DEFAULT_OUT = 'baseline/baseline.locked.json';

const STAGE_COMPONENTS = {
  requirements: ['prd', 'wbs'],
  architecture: ['design'],
  frontend: ['frontend'],
  backend: ['backend'],
  testing: ['test', 'review'],
  docs: ['docs'],
};

function parseArgs(argv) {
  const parsed = new Map();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      parsed.set(key, next);
      i++;
    } else {
      parsed.set(key, true);
    }
  }
  return parsed;
}

function usage() {
  console.log(`Usage: node baseline.mjs [options]

Options:
  --lock             生成封盘 baseline（默认行为）
  --force            覆盖已有封盘文件，并写入 baseline.history.jsonl
  --hist <path>      历史项目 CSV（默认: ${DEFAULT_HIST}）
  --expert <path>    专家估算 Markdown（默认: ${DEFAULT_EXPERT}）
  --out <path>       输出 locked baseline（默认: ${DEFAULT_OUT}）
  --help             显示帮助
`);
}

function round(value) {
  return +value.toFixed(2);
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    throw new Error('historical CSV must include a header row and at least one data row');
  }
  const header = lines.shift().split(',').map(v => v.trim());
  return lines.map(line => {
    const values = line.split(',');
    return Object.fromEntries(values.map((value, index) => [header[index], value.trim()]));
  });
}

function parseMarkdownTables(text) {
  const tables = [];
  let current = [];

  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\|.*\|\s*$/.test(line)) {
      current.push(line.trim());
    } else if (current.length) {
      tables.push(current);
      current = [];
    }
  }
  if (current.length) tables.push(current);

  return tables.map(lines => {
    const rows = lines
      .filter(line => !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|$/.test(line))
      .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()));
    const header = rows.shift() || [];
    return rows.map(row => Object.fromEntries(row.map((value, index) => [header[index], value])));
  });
}

function parseExpertTable(text) {
  const expert = {};
  for (const table of parseMarkdownTables(text)) {
    if (!table.length) continue;
    const columns = Object.keys(table[0]);
    if (!columns.includes('stage') || !columns.includes('expert_hours')) continue;

    for (const row of table) {
      const stage = row.stage;
      const hours = Number.parseFloat(row.expert_hours);
      if (stage && Number.isFinite(hours)) {
        expert[stage] = round(hours);
      }
    }
  }
  return expert;
}

function componentAverage(rows, component) {
  const values = rows
    .map(row => Number.parseFloat(row[`${component}_hours`] ?? row[component]))
    .filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function buildHist(rows) {
  const componentHist = {};
  for (const component of new Set(Object.values(STAGE_COMPONENTS).flat())) {
    const avg = componentAverage(rows, component);
    if (avg === null) {
      throw new Error(`historical CSV missing numeric column for component: ${component}`);
    }
    componentHist[component] = round(avg);
  }

  const hist = {};
  for (const [stage, components] of Object.entries(STAGE_COMPONENTS)) {
    const perProject = rows.map(row => components.reduce((sum, component) => {
      const value = Number.parseFloat(row[`${component}_hours`] ?? row[component]);
      if (!Number.isFinite(value)) {
        throw new Error(`historical CSV row missing numeric value for component: ${component}`);
      }
      return sum + value;
    }, 0));
    hist[stage] = round(perProject.reduce((sum, value) => sum + value, 0) / perProject.length);
  }

  return { hist, componentHist };
}

const args = parseArgs(process.argv.slice(2));

if (args.has('help')) {
  usage();
  process.exit(0);
}

const histPath = args.get('hist') || DEFAULT_HIST;
const expertPath = args.get('expert') || DEFAULT_EXPERT;
const outPath = args.get('out') || DEFAULT_OUT;
const historyPath = join(dirname(outPath), 'baseline.history.jsonl');

try {
  if (existsSync(outPath) && !args.has('force')) {
    console.error('baseline already locked. Use --force to override.');
    process.exit(3);
  }

  if (!existsSync(histPath)) {
    console.error(`Missing: ${histPath}`);
    process.exit(2);
  }
  if (!existsSync(expertPath)) {
    console.error(`Missing: ${expertPath}`);
    process.exit(2);
  }

  const rows = parseCsv(readFileSync(histPath, 'utf8'));
  const { hist, componentHist } = buildHist(rows);
  const expert = parseExpertTable(readFileSync(expertPath, 'utf8'));
  const missingExpertStages = Object.keys(STAGE_COMPONENTS).filter(stage => expert[stage] === undefined);
  if (missingExpertStages.length) {
    console.error(`Missing expert estimate stage(s): ${missingExpertStages.join(', ')}`);
    process.exit(2);
  }

  const merged = Object.fromEntries(
    Object.keys(STAGE_COMPONENTS).map(stage => [stage, round((hist[stage] + expert[stage]) / 2)])
  );

  const payload = {
    lockedAt: new Date().toISOString(),
    source: {
      hist: histPath,
      expert: expertPath,
      stage_components: STAGE_COMPONENTS,
    },
    hist,
    expert,
    merged,
    component_hist: componentHist,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  if (existsSync(outPath) && args.has('force')) {
    appendFileSync(
      historyPath,
      JSON.stringify({ replacedAt: new Date().toISOString(), prev: JSON.parse(readFileSync(outPath, 'utf8')) }) + '\n'
    );
  }

  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(outPath);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
