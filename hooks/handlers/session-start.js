#!/usr/bin/env node
// T-H02: SessionStart handler — 记录会话开始事件
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
    appendEvent('session_start', projectId, {
      session_id: resolveSessionId(input),
      cwd
    });
  } catch (error) {
    return hookResult(raw, `[delivery-hook] session-start error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
