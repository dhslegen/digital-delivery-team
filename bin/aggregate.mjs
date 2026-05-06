#!/usr/bin/env node
// T-M02: 从 events.jsonl 聚合到 SQLite。支持 --bootstrap 创建新项目 ID。
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, appendFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import { DeliveryStore } from './lib/store.mjs';

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const require = createRequire(import.meta.url);
const { parseTestReport, parseReviewReport } = require('../hooks/lib/quality-parser.js');

const METRICS_DIR = process.env.DDT_METRICS_DIR ||
  join(homedir(), '.claude', 'delivery-metrics');
const EVENTS = join(METRICS_DIR, 'events.jsonl');
const DB = join(METRICS_DIR, 'metrics.db');

const args = new Map(process.argv.slice(2).flatMap((a, i, arr) =>
  a.startsWith('--') ? [[a.replace(/^--/, ''), arr[i+1] && !arr[i+1].startsWith('--') ? arr[i+1] : true]] : []));

mkdirSync(METRICS_DIR, { recursive: true });
const store = new DeliveryStore(DB);
await store.openOrCreate();

// B3: 进程任意退出路径都释放 SQLite 句柄（防长生命周期场景下的句柄泄漏 + 并发实例 EBUSY）
process.on('exit', () => { try { store.close(); } catch (_) { /* already closed */ } });

if (args.get('bootstrap')) {
  const name = args.get('name') || 'untitled';
  const id = `proj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  store.createProject(id, name);
  mkdirSync('.ddt', { recursive: true });
  writeFileSync('.ddt/project-id', id);
  // v0.8.1 D11: 项目根 .gitignore 兜底——避免 Untitled / .DS_Store / staging/ 等
  // 派生物意外入版本（实测 ddt-team-admin-v0.8 留下 Untitled 空文件）
  ensureGitignore();
  console.log(id);
  process.exit(0);
}

// v0.8.1 D11: 把 templates/.gitignore.template 合并到项目根 .gitignore
//   - 项目根无 .gitignore：直接复制
//   - 项目根已有 .gitignore：仅追加缺失的行（不重复，不破坏用户自定义）
function ensureGitignore() {
  const tplPath = join(PLUGIN_ROOT, 'templates', '.gitignore.template');
  if (!existsSync(tplPath)) return;  // 兜底：模板缺失时静默
  const target = '.gitignore';
  const tplContent = readFileSync(tplPath, 'utf8');
  if (!existsSync(target)) {
    copyFileSync(tplPath, target);
    return;
  }
  // 已有 .gitignore：追加未出现的关键条目
  const existing = readFileSync(target, 'utf8');
  const tplLines = tplContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
  const missing = tplLines.filter(l => !existing.includes(l));
  if (missing.length === 0) return;
  appendFileSync(target,
    '\n# ─── DDT v0.8.1 D11 自动追加（避免 Untitled / .DS_Store 等派生物入版本）─\n' +
    missing.join('\n') + '\n');
}

const projectId = args.get('project');

if (args.get('capture-quality')) {
  const pid = projectId || process.env.DDT_PROJECT_ID;
  if (!pid) {
    console.error('Missing project id. Use --project <id> or set DDT_PROJECT_ID.');
    process.exit(2);
  }

  const metrics = captureQualityMetrics();
  const knownValues = Object.values(metrics).filter(value => value !== null && value !== undefined);
  if (!knownValues.length) {
    console.log(JSON.stringify({
      captured_quality: false,
      project: pid,
      reason: 'No quality metrics found in tests/test-report.md or docs/review-report.md',
      db: DB,
    }));
    process.exit(0);
  }

  store.recordQualityMetrics(pid, metrics);
  console.log(JSON.stringify({ captured_quality: true, project: pid, metrics, db: DB }));
  process.exit(0);
}

if (!existsSync(EVENTS)) {
  console.error(`events.jsonl not found at ${EVENTS}`);
  process.exit(2);
}

// M6.1.2: --rebuild 强制全量重 ingest（清空表 + 清水位线）
if (args.get('rebuild')) {
  if (!projectId) {
    console.error('--rebuild 必须搭配 --project <id>，避免清空全部数据');
    process.exit(2);
  }
  store.rebuildProject(projectId);
}

// M6.1.2: 增量 ingest 水位线 — 仅处理 ts > watermark 的事件
//   防 events.jsonl 反复全量 ingest 导致 phase_runs / subagent_runs 行数膨胀
//   （v0.5.1 实测 phase_runs 重复 4 行，工时数字膨胀 5×）
const watermark = projectId ? store.getWatermark(projectId) : null;
const lines = readFileSync(EVENTS, 'utf8').split('\n').filter(Boolean);
let imported = 0;
let skipped = 0;
let maxTs = watermark || '';
for (const line of lines) {
  try {
    const ev = JSON.parse(line);
    if (projectId && ev.project_id !== projectId) continue;
    // 水位线过滤：同 ts 视为已 ingest，避免边界重复（仅在 --project 模式启用）
    if (watermark && ev.ts && ev.ts <= watermark) {
      skipped++;
      continue;
    }
    store.ingestEvent(ev);
    imported++;
    if (ev.ts && ev.ts > maxTs) maxTs = ev.ts;
  } catch { /* skip bad line */ }
}
if (projectId && maxTs && maxTs !== watermark) {
  store.setWatermark(projectId, maxTs);
}
console.log(JSON.stringify({ imported, skipped, watermark: maxTs || null, db: DB }));

function captureQualityMetrics() {
  const testReport   = readIfExists('tests/test-report.md');
  const reviewReport = readIfExists('docs/review-report.md');
  return {
    ...(parseTestReport(testReport) || {}),
    ...(parseReviewReport(reviewReport) || {}),
  };
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}
