#!/usr/bin/env node
// M6.1.3: 业务阶段事件发射器
//
// 用途：commands 内部 bash 在 Phase 1 起 / Phase 5 末尾各调一次，
//   保证 PRD/WBS/Design 等业务阶段都有独立 phase_start/phase_end 事件，
//   即使 /kickoff 内部 chain 调用（不触发 UserPromptSubmit hook）也能产生独立工时。
//
// 用法：
//   node bin/emit-phase.mjs --phase prd --action start [--args "..."]
//   node bin/emit-phase.mjs --phase prd --action end
//
// 退出码：0 成功；1 参数错误；写入失败也返回 0（不阻塞 command 流程）。

import { existsSync, mkdirSync, appendFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const VALID_PHASES = new Set([
  'prd', 'wbs', 'design',
  // v0.8 W3：前端实现流程重构后的两阶段
  'design-brief', 'design-execute',
  'build-web', 'build-api',
  'test', 'review', 'fix',
  'package', 'report',
  // 编排命令也允许（虽通常由 UserPromptSubmit hook 抓取，但允许冗余触发）
  'kickoff', 'impl', 'verify', 'ship',
]);

const VALID_ACTIONS = new Set(['start', 'end']);

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

function findRecentPhaseStart(eventsFile, projectId, phase, sessionId) {
  if (!existsSync(eventsFile)) return null;
  try {
    const text = readFileSync(eventsFile, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    // 反向扫描，找最近一条同 project+phase 的 phase_start，
    // 且后面没有对应 phase_end（即"未闭合"）
    let pendingStart = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const ev = JSON.parse(lines[i]);
        if (ev.project_id !== projectId) continue;
        if (ev.event === 'phase_end' && ev.data?.phase === phase) {
          // 已经有 end 了，说明再往前的 start 已闭合
          return null;
        }
        if (ev.event === 'phase_start' && ev.data?.phase === phase) {
          pendingStart = ev;
          break;
        }
      } catch { /* skip */ }
    }
    return pendingStart;
  } catch {
    return null;
  }
}

const args = parseArgs(process.argv.slice(2));
const phase = args.phase;
const action = args.action;

if (!phase || !VALID_PHASES.has(phase)) {
  console.error(`❌ --phase 必须是: ${[...VALID_PHASES].join(' / ')}`);
  process.exit(1);
}
if (!action || !VALID_ACTIONS.has(action)) {
  console.error(`❌ --action 必须是: start / end`);
  process.exit(1);
}

const cwd = process.cwd();
const projectId = resolveProjectId(cwd);
const sessionId = resolveSessionId();
const metricsDir = getMetricsDir();
const eventsFile = join(metricsDir, 'events.jsonl');

try {
  mkdirSync(metricsDir, { recursive: true });

  const ts = new Date().toISOString();
  let record;

  if (action === 'start') {
    record = {
      ts,
      event: 'phase_start',
      project_id: projectId,
      data: {
        session_id: sessionId,
        phase,
        args: typeof args.args === 'string' ? args.args.slice(0, 200) : '',
        source: 'emit-phase',
      },
    };
  } else {
    // end：尝试关联最近未闭合的 phase_start
    const startEv = findRecentPhaseStart(eventsFile, projectId, phase, sessionId);
    let durationMs = 0;
    let matchedStart = null;
    if (startEv) {
      const startMs = Date.parse(startEv.ts);
      if (Number.isFinite(startMs)) {
        durationMs = Date.now() - startMs;
        matchedStart = startEv.ts;
      }
    }
    record = {
      ts,
      event: 'phase_end',
      project_id: projectId,
      data: {
        session_id: sessionId,
        phase,
        duration_ms: durationMs,
        matched_start: matchedStart,
        source: 'emit-phase',
      },
    };
  }

  appendFileSync(eventsFile, JSON.stringify(record) + '\n', 'utf8');
  // stdout 输出简要信息供 commands 调试
  if (action === 'end' && record.data.duration_ms > 0) {
    console.log(`[emit-phase] ${phase} ${action} (${(record.data.duration_ms / 1000).toFixed(1)}s)`);
  } else {
    console.log(`[emit-phase] ${phase} ${action}`);
  }
  process.exit(0);
} catch (err) {
  // 写入失败不阻塞 command（degraded 模式：command 仍能继续，只是丢这一条度量）
  process.stderr.write(`[emit-phase] WARNING: ${err.message}\n`);
  process.exit(0);
}
