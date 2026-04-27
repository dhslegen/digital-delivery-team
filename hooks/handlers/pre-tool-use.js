#!/usr/bin/env node
// T-H04: PreToolUse handler — 记录工具调用前事件，提取 tool_name/file_path/bash_head/task_subagent
'use strict';
const {
  appendEvent,
  hookResult,
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
    const toolInput = input.tool_input || input.input || {};
    appendEvent('pre_tool_use', projectId, {
      session_id: resolveSessionId(input),
      tool_name: input.tool_name || input.toolName || input.name || '',
      file_path: toolInput.file_path || toolInput.path || '',
      bash_head: toolInput.command ? String(toolInput.command).slice(0, 80) : '',
      task_subagent: toolInput.subagent_type ||
        (toolInput.description ? String(toolInput.description).slice(0, 100) : '')
    });
  } catch (error) {
    return hookResult(raw, `[delivery-hook] pre-tool-use error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
