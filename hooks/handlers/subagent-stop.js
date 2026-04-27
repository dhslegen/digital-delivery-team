#!/usr/bin/env node
// T-H06: SubagentStop handler — 记录子代理停止事件，岗位级度量主来源
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
    appendEvent('subagent_stop', projectId, {
      session_id: resolveSessionId(input),
      subagent_name: input.agent_name ||
        input.subagent_name ||
        input.subagent_type ||
        input.name ||
        'unknown',
      duration_ms: numberFrom(input.duration_ms, input.elapsed_ms, input.total_duration_ms),
      tokens_input: usage.input_tokens,
      tokens_output: usage.output_tokens,
      tokens_total: usage.total_tokens,
      success: input.error == null && input.success !== false
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
