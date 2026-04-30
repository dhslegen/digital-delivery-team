#!/usr/bin/env node
// M6.2.2: 用户决策事件发射器
//
// 用途：commands 在 AskUserQuestion 决策门前后各调用一次：
//   - point：决策门弹出（记录"用户被询问了"）
//   - resolved：用户已选择（记录用户做了什么决定）
//
// 数据用途：metrics-agent 分析"哪个 phase 用户最常修改"、"哪个 phase 一次接受率最高"
//   反馈到 baseline 调优 + 优化用户体验。
//
// 用法：
//   node bin/emit-decision.mjs --phase prd --action point [--options "accept|modify|add|regenerate"]
//   node bin/emit-decision.mjs --phase prd --action resolved --user-action accept [--note "..."]
//
// 同时把每条决策追加到 .ddt/decisions.jsonl（项目本地，便于 /relay 与审计）

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VALID_PHASES = new Set([
  'prd', 'wbs', 'design',
  // v0.8 W3：前端实现流程重构后的两阶段
  'design-brief', 'design-execute',
  'build-web', 'build-api',
  'test', 'review', 'fix',
  'package', 'report',
  'kickoff', 'impl', 'verify', 'ship',
]);

const VALID_ACTIONS = new Set(['point', 'resolved']);
const VALID_USER_ACTIONS = new Set(['accept', 'modify', 'add', 'regenerate', 'other', 'pending']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next; i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function getMetricsDir() {
  return process.env.DDT_METRICS_DIR ||
    join(homedir(), '.claude', 'delivery-metrics');
}

function resolveProjectId(cwd) {
  if (process.env.DDT_PROJECT_ID) return process.env.DDT_PROJECT_ID;
  try {
    return readFileSync(join(cwd, '.ddt', 'project-id'), 'utf8').trim();
  } catch {
    return 'unknown';
  }
}

function resolveSessionId() {
  return process.env.CLAUDE_SESSION_ID ||
    process.env.DDT_SESSION_ID ||
    'cli-' + Date.now().toString(36);
}

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
const action = args.action;
const userAction = args['user-action'];
const note = typeof args.note === 'string' ? args.note.slice(0, 200) : '';
const options = typeof args.options === 'string' ? args.options : '';

if (!phase || !VALID_PHASES.has(phase)) {
  console.error(`❌ --phase 必须是: ${[...VALID_PHASES].join(' / ')}`);
  process.exit(1);
}
if (!action || !VALID_ACTIONS.has(action)) {
  console.error('❌ --action 必须是: point / resolved');
  process.exit(1);
}
if (action === 'resolved' && (!userAction || !VALID_USER_ACTIONS.has(userAction))) {
  console.error(`❌ --action resolved 必须搭配 --user-action ${[...VALID_USER_ACTIONS].join('/')}`);
  process.exit(1);
}

const cwd = process.cwd();
const projectId = resolveProjectId(cwd);
const sessionId = resolveSessionId();
const ts = new Date().toISOString();
const eventName = action === 'point' ? 'decision_point' : 'decision_resolved';

const record = {
  ts,
  event: eventName,
  project_id: projectId,
  data: {
    session_id: sessionId,
    phase,
    ...(action === 'point' ? { options } : { user_action: userAction, note }),
  },
};

try {
  // 1. 写到全局 events.jsonl 供 aggregate 入库
  const metricsDir = getMetricsDir();
  mkdirSync(metricsDir, { recursive: true });
  appendFileSync(join(metricsDir, 'events.jsonl'),
    JSON.stringify(record) + '\n', 'utf8');

  // 2. 同时追加到项目本地 .ddt/decisions.jsonl（便于 /relay 与审计）
  const localDir = join(cwd, '.ddt');
  mkdirSync(localDir, { recursive: true });
  appendFileSync(join(localDir, 'decisions.jsonl'),
    JSON.stringify(record) + '\n', 'utf8');

  if (action === 'point') {
    console.log(`[emit-decision] ${phase} point (options: ${options || 'standard 4'})`);
  } else {
    console.log(`[emit-decision] ${phase} resolved → ${userAction}` +
      (note ? ` (${note.slice(0, 60)}${note.length > 60 ? '...' : ''})` : ''));
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`[emit-decision] WARNING: ${err.message}\n`);
  process.exit(0);  // 不阻塞 command 流程
}
