#!/usr/bin/env node
// T-H03: SessionEnd handler — 记录会话结束事件 + 释放该会话持有的 advisory lock
'use strict';
const {
  appendEvent,
  extractUsage,
  hookResult,
  numberFrom,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');
const { releaseSessionLocks } = require('./lib/advisory-lock');

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const sessionId = resolveSessionId(input);
    const usage = extractUsage(input);
    appendEvent('session_end', projectId, {
      session_id: sessionId,
      cwd,
      turns: numberFrom(input.num_turns, input.turns),
      total_cost_usd: numberFrom(input.total_cost_usd, input.cost_usd),
      tokens_input: usage.input_tokens,
      tokens_output: usage.output_tokens,
      tokens_total: usage.total_tokens,
    });
    // M4-4: 释放本会话持有的 advisory lock，防止下次会话误判冲突
    releaseSessionLocks(cwd, sessionId);
  } catch (error) {
    return hookResult(raw, `[delivery-hook] session-end error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
