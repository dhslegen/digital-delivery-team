#!/usr/bin/env node
// T-H03: SessionEnd handler — 记录会话结束事件
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

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const usage = extractUsage(input);
    appendEvent('session_end', projectId, {
      session_id: resolveSessionId(input),
      cwd,
      turns: numberFrom(input.num_turns, input.turns),
      total_cost_usd: numberFrom(input.total_cost_usd, input.cost_usd),
      tokens_input: usage.input_tokens,
      tokens_output: usage.output_tokens,
      tokens_total: usage.total_tokens,
    });
  } catch (error) {
    return hookResult(raw, `[delivery-hook] session-end error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
