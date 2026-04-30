#!/usr/bin/env node
// M1-5: UserPromptSubmit handler — 抓取 slash command 作为 phase 标签，
//       为效率报告提供精确阶段维度。
'use strict';
const {
  appendEvent,
  hookResult,
  markPhaseStarted,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');

// DDT 自身的阶段命令（含编排命令 kickoff/impl/verify/ship/report）
const DDT_PHASE_COMMANDS = [
  'kickoff',
  'prd',
  'wbs',
  'design',
  'design-brief',     // W3 (v0.8): brief 编译器
  'design-execute',   // W3 (v0.8): 通道执行器
  'impl',
  'build-web',
  'build-api',
  'verify',
  'test',
  'review',
  'fix',
  'ship',
  'package',
  'report',
];

// M4-2: phase command → progress.json phase key 映射
// 编排命令（kickoff/impl/verify/ship）不直接对应 progress phase，由 Stop hook 的 infer 推断
const ORCHESTRATOR_COMMANDS = new Set(['kickoff', 'impl', 'verify', 'ship']);
function mapToProgressPhase(cmd) {
  if (ORCHESTRATOR_COMMANDS.has(cmd)) return null;
  return cmd;
}

// PR-B P0-3：业务级命令（prd/wbs/design/test/...）的 phase 事件由 commands/X.md 内 emit-phase 唯一发起，
//   user-prompt-submit hook 不再重复发 phase_start，避免 hook + emit-phase 双源时间窗叠加（实测重复计算 30-50%）。
//   编排级命令（kickoff/impl/verify/ship）由 hook 抓（commands/kickoff.md 内部不调 emit-phase 编排级 phase）。
function shouldEmitPhaseEvent(cmd) {
  return ORCHESTRATOR_COMMANDS.has(cmd);
}

const PHASE_PATTERN = new RegExp(
  String.raw`^\s*/(?:digital-delivery-team:)?(${DDT_PHASE_COMMANDS.join('|')})\b(.*)$`,
  'i'
);

function detectPhase(prompt) {
  if (!prompt || typeof prompt !== 'string') return null;
  const m = prompt.match(PHASE_PATTERN);
  if (!m) return null;
  return {
    phase: m[1].toLowerCase(),
    args: (m[2] || '').trim(),
  };
}

function run(raw) {
  try {
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);
    const projectId = resolveProjectId(cwd);
    const sessionId = resolveSessionId(input);
    const prompt = input.prompt || input.user_prompt || input.message || '';

    const detected = detectPhase(prompt);
    if (detected) {
      // PR-B：仅编排级（kickoff/impl/verify/ship）由 hook 抓 phase_start；
      //   业务级（prd/wbs/design/...）由 commands/X.md 内 emit-phase 唯一发起，避免双源叠加。
      if (shouldEmitPhaseEvent(detected.phase)) {
        appendEvent('phase_start', projectId, {
          session_id: sessionId,
          phase: detected.phase,
          args: detected.args.slice(0, 200),
          source: 'hook',
        });
      }
      // M4-2: 同步更新 progress.json（仅非编排命令；与 phase 事件无关，保留原逻辑）
      const progressPhase = mapToProgressPhase(detected.phase);
      if (progressPhase) {
        markPhaseStarted(cwd, progressPhase);
      }
    }
  } catch (error) {
    return hookResult(raw, `[delivery-hook] user-prompt-submit error: ${error.message}\n`);
  }
  return hookResult(raw);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run, detectPhase, mapToProgressPhase, DDT_PHASE_COMMANDS };
