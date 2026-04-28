#!/usr/bin/env node
// T-H02: SessionStart handler — 记录会话开始事件、Node 版本预检、自动 bootstrap project_id
// M2-2: 检测到 project-brief.md 但无 .delivery/project-id 时同步触发 aggregate.mjs --bootstrap
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const {
  appendEvent,
  hookResult,
  parseHookInput,
  resolveCwd,
  resolveProjectId,
  resolveSessionId,
  runCli,
} = require('./lib/events');

const REQUIRED_NODE_MAJOR = 22;

// M4-2: SessionStart 时根据 docs/* artifacts 推断 progress.json，让多会话恢复有据可依
function maybeInferProgress(cwd) {
  try {
    const root = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    const progressScript = path.join(root, 'bin', 'progress.mjs');
    if (!fs.existsSync(progressScript)) return;
    const projectIdFile = path.join(cwd, '.delivery', 'project-id');
    if (!fs.existsSync(projectIdFile)) return; // 未 bootstrap 的项目跳过
    spawnSync(process.execPath, [progressScript, '--init'],
      { cwd, encoding: 'utf8', timeout: 3000, env: process.env });
    spawnSync(process.execPath, [progressScript, '--infer'],
      { cwd, encoding: 'utf8', timeout: 3000, env: process.env });
  } catch (_) { /* hook 必须容错 */ }
}

// M2-1 / M5-3: 把解析好的 plugin root 持久化到 ~/.claude/delivery-metrics/.ddt-plugin-root，
//   让 commands 用 1 行 fallback 读取代替 80 行 inline node。
//   M5-3：写入前必须验证 root 含 bin/aggregate.mjs，避免把无效 env 值（如旧路径）污染 marker
function persistPluginRoot() {
  try {
    const root = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return;
    if (!fs.existsSync(path.join(root, 'bin', 'aggregate.mjs'))) {
      // env 变量指向无效目录（典型场景：用户 shell rc 设了旧路径），不写 marker
      return;
    }
    const os = require('os');
    const dir = process.env.DDT_METRICS_DIR ||
      path.join(os.homedir(), '.claude', 'delivery-metrics');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.ddt-plugin-root'), root, 'utf8');
  } catch (_) {
    // 写入失败不阻塞会话启动
  }
}

function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  if (Number.isFinite(major) && major < REQUIRED_NODE_MAJOR) {
    return `[delivery-hook] WARNING: Node.js ${process.versions.node} detected. ` +
      `DDT metrics require Node ${REQUIRED_NODE_MAJOR}+ (uses node:sqlite). ` +
      `aggregate.mjs / report.mjs / baseline.mjs will fail. Please upgrade Node.\n`;
  }
  return '';
}

// E2: 构造 SessionStart additionalContext，让 Claude 在新会话即感知 DDT 工作流
//     输出格式：Claude Code v2.1+ 支持 hookSpecificOutput.additionalContext 注入 system prompt
function buildAdditionalContext(cwd, projectId, bootstrapped) {
  const lines = [];
  const hasBrief = fs.existsSync(path.join(cwd, 'project-brief.md'));
  const hasProjectId = fs.existsSync(path.join(cwd, '.delivery', 'project-id'));
  const progressPath = path.join(cwd, '.delivery', 'progress.json');
  let progress = null;
  try {
    if (fs.existsSync(progressPath)) {
      progress = JSON.parse(fs.readFileSync(progressPath, 'utf8'));
    }
  } catch (_) { /* ignore parse errors */ }

  // 仅在确认是 DDT 项目（已 bootstrap 或 brief 存在）时注入，避免污染普通项目
  if (!hasBrief && !hasProjectId) {
    return '';
  }

  lines.push('# DDT (digital-delivery-team) 工作流可用');
  lines.push('');
  lines.push('当前目录是 DDT 项目，所有交付以契约先行 + 数字员工分工模式推进。');
  lines.push('');

  if (projectId && projectId !== 'unknown') {
    lines.push(`**项目 ID**：\`${projectId}\``);
    if (bootstrapped) lines.push('（本次会话自动初始化）');
    lines.push('');
  }

  if (progress) {
    const phases = progress.phases || {};
    const order = Object.keys(phases);
    const completed = order.filter(p => phases[p].status === 'completed');
    const inProgress = order.filter(p => phases[p].status === 'in_progress');
    lines.push(`**进度**：${completed.length} / ${order.length} 个 phase 已完成` +
      (inProgress.length ? `；当前在 \`${inProgress[0]}\`` : ''));
    if (progress.current_phase) {
      lines.push(`**下一步建议**：\`/${progress.current_phase}\``);
    }
    lines.push('');
  } else if (hasBrief && !hasProjectId) {
    lines.push('**下一步建议**：运行 `/digital-delivery-team:kickoff`（或先 `/prd`）开始全流程');
    lines.push('');
  }

  lines.push('## 可用命令（速查）');
  lines.push('- `/kickoff [--preset java-modern|node-modern|go-modern|python-fastapi]` — 一键 PRD → WBS → Design');
  lines.push('- `/impl` — 前后端并行实现');
  lines.push('- `/verify` — 测试 + 评审并行');
  lines.push('- `/fix --severity blocker|warning [--apply]` — 按 review-report 修复（默认 dry-run）');
  lines.push('- `/import-design --from figma|v0|lovable|claude-design --url <url>` — 导入 AI 设计稿');
  lines.push('- `/ship` — 交付出包 + 效率报告');
  lines.push('- `/digital-delivery-team:resume` — 跨会话恢复进度');
  lines.push('- `/digital-delivery-team:doctor` — 安装自检');
  lines.push('');
  lines.push('## 关键约束');
  lines.push('- **唯一真相源**：契约（`docs/api-contract.yaml`）/ PRD / WBS / 数据模型 / 技术栈（`.delivery/tech-stack.json`）一旦冻结禁止偏离');
  lines.push('- **数字员工边界**：每个 agent 只对其唯一交付物负责，不得跨产物写入（blockers.md 除外）');
  lines.push('- **不可证明则不证明**：度量数据缺失时 metrics-agent 必须输出"不可证明"，禁止用 WBS 预估替代实际工时');

  return lines.join('\n');
}

// M2-2: 项目首次会话时静默初始化 .delivery/project-id
function maybeBootstrap(cwd) {
  try {
    const briefPath = path.join(cwd, 'project-brief.md');
    const projectIdPath = path.join(cwd, '.delivery', 'project-id');
    if (!fs.existsSync(briefPath)) return null;     // 用户尚未填写需求 → 跳过
    if (fs.existsSync(projectIdPath)) return null;  // 已经初始化过 → 跳过

    const root = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
    if (!root) return null;
    const aggregateScript = path.join(root, 'bin', 'aggregate.mjs');
    if (!fs.existsSync(aggregateScript)) return null;

    const projectName = path.basename(cwd) || 'untitled';
    const result = spawnSync(
      process.execPath,
      [aggregateScript, '--bootstrap', '--name', projectName],
      { cwd, encoding: 'utf8', timeout: 5000, env: process.env }
    );
    if (result.status === 0 && typeof result.stdout === 'string') {
      const id = result.stdout.trim();
      return id || null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

function run(raw) {
  let warning = '';
  let bootstrapInfo = '';
  let additionalContext = '';
  try {
    warning = checkNodeVersion();
    persistPluginRoot();
    const input = parseHookInput(raw);
    const cwd = resolveCwd(input);

    const newProjectId = maybeBootstrap(cwd);
    if (newProjectId) {
      bootstrapInfo = `[delivery-hook] DDT 项目已自动初始化：${newProjectId}\n`;
    }

    maybeInferProgress(cwd);

    const projectId = resolveProjectId(cwd);
    appendEvent('session_start', projectId, {
      session_id: resolveSessionId(input),
      cwd,
      node_version: process.versions.node,
      bootstrapped: Boolean(newProjectId),
    });

    additionalContext = buildAdditionalContext(cwd, projectId, Boolean(newProjectId));
  } catch (error) {
    return hookResult(raw, `[delivery-hook] session-start error: ${error.message}\n`);
  }

  // E2: 输出 hookSpecificOutput.additionalContext JSON 让 Claude 注入 system prompt
  if (additionalContext) {
    const payload = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext,
      },
    };
    return {
      stdout: JSON.stringify(payload),
      stderr: warning + bootstrapInfo,
      exitCode: 0,
    };
  }
  return hookResult(raw, warning + bootstrapInfo);
}

if (require.main === module) {
  runCli(run);
}

module.exports = { run };
