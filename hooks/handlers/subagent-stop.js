#!/usr/bin/env node
// T-H06: SubagentStop handler — 记录子代理停止事件，岗位级度量主来源
// M1-4: Claude Code 官方 SubagentStop payload 不携带 subagent_name / duration_ms，
//       通过 lookback join 与 PreToolUse(Task) 写入的 subagent_start 配对获取真实值。
'use strict';
const {
  appendEvent,
  extractUsage,
  findRecentEvent,
  hookResult,
  numberFrom,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');

function lookbackSubagentStart(sessionId, projectId) {
  if (!sessionId) return null;
  return findRecentEvent(ev => {
    if (ev.event !== 'subagent_start') return false;
    if (ev.project_id && projectId && ev.project_id !== projectId) return false;
    return ev.data && ev.data.session_id === sessionId;
  });
}

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const sessionId = resolveSessionId(input);
    const usage = extractUsage(input);

    // 优先从 payload 直接取（极少数 hook payload 自带），否则 lookback
    const payloadName = input.agent_name || input.subagent_name || input.subagent_type || input.name;
    const payloadDuration = numberFrom(input.duration_ms, input.elapsed_ms, input.total_duration_ms);

    let resolvedName = payloadName || '';
    let resolvedDuration = payloadDuration;
    let matchedStart = null;

    if (!resolvedName || !resolvedDuration) {
      matchedStart = lookbackSubagentStart(sessionId, projectId);
      if (matchedStart) {
        if (!resolvedName) {
          resolvedName = matchedStart.data.subagent_name ||
            matchedStart.data.subagent_type ||
            matchedStart.data.description ||
            '';
        }
        if (!resolvedDuration) {
          const startMs = Date.parse(matchedStart.ts);
          if (Number.isFinite(startMs)) {
            resolvedDuration = Date.now() - startMs;
          }
        }
      }
    }

    appendEvent('subagent_stop', projectId, {
      session_id: sessionId,
      subagent_name: resolvedName || 'unknown',
      duration_ms: Number.isFinite(resolvedDuration) ? resolvedDuration : 0,
      tokens_input: usage.input_tokens,
      tokens_output: usage.output_tokens,
      tokens_total: usage.total_tokens,
      success: input.error == null && input.success !== false,
      matched_start: matchedStart ? matchedStart.ts : null,
    });
  } catch (error) {
    return hookResult(raw, `[delivery-hook] subagent-stop error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
