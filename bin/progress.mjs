#!/usr/bin/env node
// M4-1: .ddt/progress.json 状态机维护工具
//
// schema (v1):
// {
//   "schema_version": 1,
//   "project_id": "<id>",
//   "current_phase": "design" | null,
//   "last_activity_at": "ISO timestamp",
//   "phases": {
//     "prd":       { "status": "pending" | "in_progress" | "completed",
//                    "started_at": "...", "completed_at": "...", "artifacts": ["docs/prd.md"] },
//     "wbs":       { ... },
//     "design":    { ... },
//     "build-web": { ... },
//     "build-api": { ... },
//     "test":      { ... },
//     "review":    { ... },
//     "fix":       { ... },
//     "package":   { ... },
//     "report":    { ... }
//   }
// }
//
// 用法：
//   node bin/progress.mjs --init [--project-id <id>]    # 初始化
//   node bin/progress.mjs --print                       # 输出当前 progress.json
//   node bin/progress.mjs --update <phase> <status>     # 手动更新某 phase 状态
//   node bin/progress.mjs --infer                       # 根据 docs/* 文件存在性推断状态
//   node bin/progress.mjs --current                     # 输出 current_phase
//
// 退出码：0 = 成功；1 = 参数错误；2 = 文件 IO 失败

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROGRESS_DIR = '.ddt';
const PROGRESS_PATH = join(PROGRESS_DIR, 'progress.json');

// 12 个 phase 与对应 artifact（用于 infer 推断）
// v0.8.1 D9: 加 design-brief / design-execute（与 emit-phase VALID_PHASES 对齐）
const PHASE_ARTIFACTS = {
  prd:              ['docs/prd.md'],
  wbs:              ['docs/wbs.md', 'docs/risks.md'],
  design:           ['docs/arch.md', 'docs/api-contract.yaml', 'docs/data-model.md'],
  'design-brief':   ['docs/design-brief.md'],
  'design-execute': ['.ddt/design/claude-design/upload-package',
                     '.ddt/design/figma/upload-package',
                     '.ddt/design/v0/v0-sources'],
  'build-web':      ['web/package.json'],
  'build-api':      ['server/package.json', 'server/pom.xml', 'server/go.mod', 'server/pyproject.toml'],
  test:             ['tests/test-report.md'],
  review:           ['docs/review-report.md'],
  fix:              [], // fix 由 review-report.md::Fix Log 段落判定
  package:          ['README.md', 'docs/deploy.md', 'docs/demo-script.md'],
  report:           ['docs/efficiency-report.md'],
};

const PHASE_ORDER = Object.keys(PHASE_ARTIFACTS);
// v0.8.1: 加 'skipped'，语义为"按规则跳过"（如 frontend.type !== 'spa' 时的 design-brief / design-execute）
// completed 与 skipped 在 current_phase 推进时等价处理
const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'skipped']);
const TERMINAL_STATUSES = new Set(['completed', 'skipped']);

// v0.8.1: 读取 frontend.type 决定 design-brief / design-execute 是否应跳过
function readFrontendType(cwd = process.cwd()) {
  try {
    const text = readFileSync(join(cwd, '.ddt', 'tech-stack.json'), 'utf8');
    const obj = JSON.parse(text);
    return obj?.frontend?.type || null;
  } catch { return null; }
}

function shouldSkipPhase(phase, frontendType) {
  if (phase !== 'design-brief' && phase !== 'design-execute') return false;
  // 仅 spa 类型需要走 brief / execute；server-side 与 none 跳过
  return frontendType !== null && frontendType !== 'spa';
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next; i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function ensureDir() {
  mkdirSync(PROGRESS_DIR, { recursive: true });
}

function readProgress() {
  if (!existsSync(PROGRESS_PATH)) return null;
  try {
    return JSON.parse(readFileSync(PROGRESS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeProgress(progress) {
  ensureDir();
  progress.last_activity_at = new Date().toISOString();
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2) + '\n', 'utf8');
}

function emptyProgress(projectId) {
  const phases = {};
  for (const name of PHASE_ORDER) {
    phases[name] = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      artifacts: PHASE_ARTIFACTS[name],
    };
  }
  return {
    schema_version: 1,
    project_id: projectId || readProjectIdFromFile() || 'unknown',
    current_phase: null,
    last_activity_at: new Date().toISOString(),
    phases,
  };
}

function readProjectIdFromFile() {
  try {
    return readFileSync(join('.ddt', 'project-id'), 'utf8').trim();
  } catch {
    return null;
  }
}

// 根据 artifacts 文件存在性推断 phase 是否完成
function inferPhaseStatus(phase, currentStatus, frontendType) {
  // v0.8.1 D9: design-brief / design-execute 在 frontend.type !== 'spa' 时主动跳过
  if (shouldSkipPhase(phase, frontendType)) return 'skipped';
  const artifacts = PHASE_ARTIFACTS[phase];
  if (!artifacts || artifacts.length === 0) return currentStatus; // fix 阶段无固定 artifact
  // 任一 artifact 存在 → completed（保守：完整产出由 agent self-check 兜底）
  const anyExists = artifacts.some(p => existsSync(p));
  if (anyExists) return 'completed';
  return currentStatus || 'pending';
}

function infer() {
  const progress = readProgress() || emptyProgress();
  // PR-C: 自愈 project_id —— 第一次 --init 时若 SessionStart hook 时序差让 .ddt/project-id
  //   还没就绪，会落 "unknown"。后续 --infer 时若 .ddt/project-id 已就绪且与现状不一致，
  //   主动覆盖为真实 ID，避免 progress.json::project_id 永远停留 unknown 与实际数据脱节。
  const fileId = readProjectIdFromFile();
  if (fileId && progress.project_id !== fileId) {
    progress.project_id = fileId;
  }
  // v0.8.1 D9: 读取 frontend.type 决定 design-brief / design-execute 是 pending 还是 skipped
  const frontendType = readFrontendType();
  for (const phase of PHASE_ORDER) {
    const cur = progress.phases[phase];
    const newStatus = inferPhaseStatus(phase, cur ? cur.status : 'pending', frontendType);
    const now = new Date().toISOString();
    if (!progress.phases[phase]) {
      progress.phases[phase] = {
        status: newStatus,
        started_at: null,
        completed_at: TERMINAL_STATUSES.has(newStatus) ? now : null,
        artifacts: PHASE_ARTIFACTS[phase],
      };
    } else if (!TERMINAL_STATUSES.has(cur.status) && TERMINAL_STATUSES.has(newStatus)) {
      progress.phases[phase].status = newStatus;
      progress.phases[phase].completed_at = progress.phases[phase].completed_at || now;
      // v0.8.1 D8: 跳到 completed/skipped 时若 started_at 仍为 null，回填同一时刻 + 标记估算
      if (!progress.phases[phase].started_at) {
        progress.phases[phase].started_at = now;
        progress.phases[phase].duration_estimated = true;
      }
    }
  }
  // current_phase = 第一个非 terminal 的 phase（completed 或 skipped 都跳过）
  progress.current_phase = PHASE_ORDER.find(p => !TERMINAL_STATUSES.has(progress.phases[p].status)) || null;
  writeProgress(progress);
  return progress;
}

function update(phase, status) {
  if (!PHASE_ORDER.includes(phase)) {
    console.error(`❌ 未知 phase：${phase}（合法：${PHASE_ORDER.join(', ')}）`);
    process.exit(1);
  }
  if (!VALID_STATUSES.has(status)) {
    console.error(`❌ 未知 status：${status}（合法：pending|in_progress|completed|skipped）`);
    process.exit(1);
  }
  const progress = readProgress() || emptyProgress();
  if (!progress.phases[phase]) {
    progress.phases[phase] = {
      status: 'pending',
      started_at: null,
      completed_at: null,
      artifacts: PHASE_ARTIFACTS[phase],
    };
  }
  const ph = progress.phases[phase];
  const now = new Date().toISOString();
  if (status === 'in_progress' && ph.status !== 'in_progress') {
    ph.started_at = ph.started_at || now;
    progress.current_phase = phase;
  }
  if (TERMINAL_STATUSES.has(status)) {
    ph.completed_at = now;
    // v0.8.1 D8: 跳到 terminal 时若 started_at 仍为 null，回填同一时刻 + 标记估算
    if (!ph.started_at) {
      ph.started_at = now;
      ph.duration_estimated = true;
    }
    if (progress.current_phase === phase) {
      // 推进到下一个非 terminal phase
      progress.current_phase = PHASE_ORDER.find(p =>
        progress.phases[p] && !TERMINAL_STATUSES.has(progress.phases[p].status) && p !== phase) || null;
    }
  }
  ph.status = status;
  writeProgress(progress);
  return progress;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.init) {
    if (existsSync(PROGRESS_PATH)) {
      console.log(`✅ progress.json 已存在 ${PROGRESS_PATH}`);
      process.exit(0);
    }
    const progress = emptyProgress(args['project-id']);
    writeProgress(progress);
    console.log(`✅ progress.json 已初始化（${PROGRESS_PATH}）`);
    return;
  }

  if (args.infer) {
    const progress = infer();
    console.log(JSON.stringify({
      current_phase: progress.current_phase,
      completed: PHASE_ORDER.filter(p => progress.phases[p].status === 'completed'),
    }));
    return;
  }

  if (args.update) {
    const phase = args.update;
    const status = args._[0];
    if (!status) {
      console.error('❌ --update <phase> <status> 缺 status 参数');
      process.exit(1);
    }
    update(phase, status);
    console.log(`✅ ${phase} → ${status}`);
    return;
  }

  if (args.current) {
    const progress = readProgress();
    if (!progress) {
      console.log('null');
      return;
    }
    console.log(progress.current_phase || 'null');
    return;
  }

  if (args.print || process.argv.length === 2) {
    const progress = readProgress();
    if (!progress) {
      console.error(`❌ ${PROGRESS_PATH} 不存在；先跑 --init`);
      process.exit(2);
    }
    console.log(JSON.stringify(progress, null, 2));
    return;
  }

  console.error('用法：node bin/progress.mjs [--init | --print | --update <phase> <status> | --infer | --current]');
  process.exit(1);
}

main();
