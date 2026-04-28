#!/usr/bin/env node
// T-H04: PreToolUse handler — 记录工具调用前事件，提取 tool_name/file_path/bash_head/task_subagent
// M1: Task 工具触发时额外写入 subagent_start，建立后续 lookback join 起点
'use strict';
const path = require('path');
const {
  appendEvent,
  hookResult,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');
const { tryAcquire } = require('./lib/advisory-lock');

function run(raw) {
  let advisoryWarning = '';
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const toolInput = input.tool_input || input.input || {};
    const toolName = input.tool_name || input.toolName || input.name || '';
    const sessionId = resolveSessionId(input);
    const subagentType = toolInput.subagent_type || '';
    const description = toolInput.description ? String(toolInput.description).slice(0, 100) : '';
    const filePath = toolInput.file_path || toolInput.path || '';

    appendEvent('pre_tool_use', projectId, {
      session_id: sessionId,
      tool_name: toolName,
      file_path: filePath,
      bash_head: toolInput.command ? String(toolInput.command).slice(0, 80) : '',
      task_subagent: subagentType || description
    });

    // M1-3: Task 工具调用 = 子代理启动，记录起点用于 SubagentStop 时 lookback join
    if (toolName === 'Task' || toolName === 'Agent') {
      appendEvent('subagent_start', projectId, {
        session_id: sessionId,
        subagent_name: subagentType || description || 'unknown',
        subagent_type: subagentType,
        description,
      });
    }

    // M4-4: advisory lock — Write/Edit/MultiEdit 关键 artifact 时抢锁；冲突仅 warn 不阻塞
    if (['Write', 'Edit', 'MultiEdit'].includes(toolName) && filePath) {
      const rel = path.relative(cwd, path.resolve(cwd, filePath));
      const lockResult = tryAcquire(cwd, rel, sessionId);
      if (lockResult.conflict) {
        advisoryWarning = lockResult.warning;
      }
    }
  } catch (error) {
    return hookResult(raw, `[delivery-hook] pre-tool-use error: ${error.message}\n`);
  }
  return hookResult(raw, advisoryWarning);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
