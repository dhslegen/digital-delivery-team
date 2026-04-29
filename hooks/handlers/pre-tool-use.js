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

// M6.3.5: 硬拦截 .ddt/tech-stack.json 的 Write/Edit/MultiEdit
//   仅 resolve-tech-stack.mjs 自身允许写入；agent / LLM 直接 Edit 一律拒绝。
//   实测 v0.5.x 中 LLM 多次直接 Edit 把 nestjs 改 express，违反 SSoT 原则。
const TECH_STACK_RELATIVE_PATHS = new Set([
  '.ddt/tech-stack.json',
]);

function isProtectedTechStackPath(cwd, filePath) {
  if (!filePath) return false;
  try {
    const path = require('path');
    const abs = path.resolve(cwd, filePath);
    const rel = path.relative(cwd, abs).split(path.sep).join('/');
    return TECH_STACK_RELATIVE_PATHS.has(rel);
  } catch {
    return false;
  }
}

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

    // M6.3.5: 硬拦截 .ddt/tech-stack.json 编辑
    if (['Write', 'Edit', 'MultiEdit'].includes(toolName) &&
        isProtectedTechStackPath(cwd, filePath)) {
      const reason = '.ddt/tech-stack.json 是技术栈 SSoT，禁止 agent 直接编辑。' +
        '正确方式：(1) 修改 project-brief.md 后重跑 /design --refresh；' +
        '(2) 跑 /design --preset <name> 切换预设；' +
        '(3) 用 AskUserQuestion 问卷重新收集（design.md::Phase 2b）。';
      // Claude Code v2.1+ PreToolUse hook decision API
      const decision = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      };
      return {
        stdout: JSON.stringify(decision),
        stderr: `[delivery-hook] BLOCKED: ${reason}\n`,
        exitCode: 0,
      };
    }

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
