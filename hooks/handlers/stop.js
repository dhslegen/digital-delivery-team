#!/usr/bin/env node
// M1-5: Stop handler — 在每个 turn 结束时关闭最近一个未闭合的 phase，
//       并触发后台 metrics 聚合（events.jsonl → metrics.db）。
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const {
  appendEvent,
  findRecentEvent,
  hookResult,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');

function lookbackOpenPhase(sessionId, projectId) {
  if (!sessionId) return null;
  // 反向扫描：若先遇到 phase_end（同 session）说明已关闭，停止；
  // 若先遇到 phase_start（同 session）则视为未关闭，命中。
  return findRecentEvent(ev => {
    if (!ev.data || ev.data.session_id !== sessionId) return false;
    if (ev.project_id && projectId && ev.project_id !== projectId) return false;
    return ev.event === 'phase_start' || ev.event === 'phase_end';
  });
}

function triggerAggregate(projectId) {
  if (!projectId || projectId === 'unknown') return;
  // 后台触发 aggregate.mjs，detached + unref，不阻塞 Stop hook 路径
  try {
    const root = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    const aggregateScript = path.join(root, 'bin', 'aggregate.mjs');
    const child = spawn(process.execPath, [aggregateScript, '--project', projectId], {
      detached: true,
      stdio: 'ignore',
      cwd: process.cwd(),
      env: process.env,
    });
    child.unref();
  } catch (_) {
    // 度量失败必须静默
  }
}

// M4-2: Stop hook 关闭 phase 后跑 progress infer，根据 artifact 文件存在性更新 progress.json
function triggerProgressInfer(cwd) {
  try {
    const root = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    const progressScript = path.join(root, 'bin', 'progress.mjs');
    const child = spawn(process.execPath, [progressScript, '--infer'], {
      detached: true,
      stdio: 'ignore',
      cwd,
      env: process.env,
    });
    child.unref();
  } catch (_) { /* 静默 */ }
}

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const sessionId = resolveSessionId(input);

    const recentPhaseEvent = lookbackOpenPhase(sessionId, projectId);
    if (recentPhaseEvent && recentPhaseEvent.event === 'phase_start') {
      const startMs = Date.parse(recentPhaseEvent.ts);
      const duration = Number.isFinite(startMs) ? Date.now() - startMs : 0;
      appendEvent('phase_end', projectId, {
        session_id: sessionId,
        phase: recentPhaseEvent.data.phase,
        duration_ms: duration,
        matched_start: recentPhaseEvent.ts,
      });
    }

    triggerAggregate(projectId);
    triggerProgressInfer(cwd);
  } catch (error) {
    return hookResult(raw, `[delivery-hook] stop error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
