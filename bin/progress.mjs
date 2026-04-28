#!/usr/bin/env node
// M4-1: .delivery/progress.json 状态机维护工具
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

const PROGRESS_DIR = '.delivery';
const PROGRESS_PATH = join(PROGRESS_DIR, 'progress.json');

// 10 个 phase 与对应 artifact（用于 infer 推断）
const PHASE_ARTIFACTS = {
  prd:         ['docs/prd.md'],
  wbs:         ['docs/wbs.md', 'docs/risks.md'],
  design:      ['docs/arch.md', 'docs/api-contract.yaml', 'docs/data-model.md'],
  'build-web': ['web/package.json'],
  'build-api': ['server/package.json', 'server/pom.xml', 'server/go.mod', 'server/pyproject.toml'],
  test:        ['tests/test-report.md'],
  review:      ['docs/review-report.md'],
  fix:         [], // fix 由 review-report.md::Fix Log 段落判定
  package:     ['README.md', 'docs/deploy.md', 'docs/demo-script.md'],
  report:      ['docs/efficiency-report.md'],
};

const PHASE_ORDER = Object.keys(PHASE_ARTIFACTS);
const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed']);

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
    return readFileSync(join('.delivery', 'project-id'), 'utf8').trim();
  } catch {
    return null;
  }
}

// 根据 artifacts 文件存在性推断 phase 是否完成
function inferPhaseStatus(phase, currentStatus) {
  const artifacts = PHASE_ARTIFACTS[phase];
  if (!artifacts || artifacts.length === 0) return currentStatus; // fix 阶段无固定 artifact
  // 任一 artifact 存在 → completed（保守：完整产出由 agent self-check 兜底）
  const anyExists = artifacts.some(p => existsSync(p));
  if (anyExists) return 'completed';
  return currentStatus || 'pending';
}

function infer() {
  const progress = readProgress() || emptyProgress();
  for (const phase of PHASE_ORDER) {
    const cur = progress.phases[phase];
    const newStatus = inferPhaseStatus(phase, cur ? cur.status : 'pending');
    if (!progress.phases[phase]) {
      progress.phases[phase] = {
        status: newStatus,
        started_at: null,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
        artifacts: PHASE_ARTIFACTS[phase],
      };
    } else if (cur.status !== 'completed' && newStatus === 'completed') {
      progress.phases[phase].status = 'completed';
      progress.phases[phase].completed_at = progress.phases[phase].completed_at || new Date().toISOString();
    }
  }
  // current_phase = 第一个非 completed 的 phase
  progress.current_phase = PHASE_ORDER.find(p => progress.phases[p].status !== 'completed') || null;
  writeProgress(progress);
  return progress;
}

function update(phase, status) {
  if (!PHASE_ORDER.includes(phase)) {
    console.error(`❌ 未知 phase：${phase}（合法：${PHASE_ORDER.join(', ')}）`);
    process.exit(1);
  }
  if (!VALID_STATUSES.has(status)) {
    console.error(`❌ 未知 status：${status}（合法：pending|in_progress|completed）`);
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
  if (status === 'completed') {
    ph.completed_at = now;
    if (progress.current_phase === phase) {
      // 推进到下一个 pending phase
      progress.current_phase = PHASE_ORDER.find(p =>
        progress.phases[p] && progress.phases[p].status !== 'completed' && p !== phase) || null;
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
