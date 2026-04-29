#!/usr/bin/env node
// M6.5.2: 接力 prompt 构造器
//
// 用途：自动收集 DDT 项目背景（progress.json / tech-stack.json / git / 关键产物路径）
//   → 输出 prompt 模板（含 9 个待 LLM 补全段落）→ 写入 .ddt/relay-<ts>.md
//
// 用法：
//   node bin/build-relay-prompt.mjs [--out <path>] [--quiet]
//   --out      默认 .ddt/relay-<YYYYMMDD-HHMMSS>.md
//   --quiet    只写文件，不输出到 stdout
//
// 退出码：0 总是返回 0（不阻塞 LLM 后续操作）

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next; i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function tryRead(path) {
  try { return readFileSync(path, 'utf8'); } catch { return null; }
}

function tryReadJson(path) {
  const text = tryRead(path);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function git(cmd) {
  const result = spawnSync('git', cmd, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function fmtTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const args = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const ddtDir = join(cwd, '.ddt');
const outPath = args.out || join(ddtDir, `relay-${fmtTs()}.md`);

// ── 1. 收集 DDT 项目背景 ──
const progress = tryReadJson(join(ddtDir, 'progress.json'));
const techStack = tryReadJson(join(ddtDir, 'tech-stack.json'));
const projectId = (tryRead(join(ddtDir, 'project-id')) || '').trim() || 'unknown';

const completedPhases = progress
  ? Object.keys(progress.phases || {}).filter(p => progress.phases[p].status === 'completed')
  : [];
const currentPhase = progress?.current_phase || 'unknown';

// 技术栈摘要
let stackSummary = '（未指定）';
if (techStack) {
  const be = techStack.backend || {};
  const fe = techStack.frontend || {};
  const ai = techStack.ai_design || {};
  stackSummary = `${be.framework || '?'} (${be.language || '?'}) + ${be.database?.primary || '?'} | ${fe.framework || '?'} + ${fe.bundler || '?'} + ${fe.ui?.css || '?'} | AI: ${ai.type || '?'}`;
}

// ── 2. Git 摘要 ──
const branch = git(['branch', '--show-current']) || 'unknown';
const recentCommits = git(['log', '--oneline', '-5']);
const uncommittedFiles = git(['status', '--short']).split('\n').filter(Boolean);
const lastCommitTs = git(['log', '-1', '--format=%cI']);

// ── 3. 关键产物存在性 ──
const knownArtifacts = [
  ['PRD', 'docs/prd.md'],
  ['WBS', 'docs/wbs.md'],
  ['风险', 'docs/risks.md'],
  ['架构', 'docs/arch.md'],
  ['API 契约', 'docs/api-contract.yaml'],
  ['数据模型', 'docs/data-model.md'],
  ['评审', 'docs/review-report.md'],
  ['测试', 'tests/test-report.md'],
  ['效率', 'docs/efficiency-report.md'],
  ['阻塞', 'docs/blockers.md'],
  ['Brief', 'project-brief.md'],
  ['Tech Stack', '.ddt/tech-stack.json'],
];
const artifactRows = knownArtifacts
  .filter(([_, p]) => existsSync(join(cwd, p)))
  .map(([label, p]) => `| ${label} | \`${p}\` |`)
  .join('\n');

// ── 4. 可能的阻塞条目（自动从 blockers.md 提取未解决）──
let openBlockers = '';
const blockersText = tryRead(join(cwd, 'docs/blockers.md'));
if (blockersText) {
  const matches = blockersText.match(/^##\s+.*$/gm) || [];
  const unresolvedHits = blockersText.match(/^- \*\*resolved_at\*\*: null$/gm) || [];
  if (unresolvedHits.length) {
    openBlockers = `（自动检测：docs/blockers.md 中存在 ${unresolvedHits.length} 条 \`resolved_at: null\` 未解决项，请在下方"Blockers & Open Questions"段落复述）`;
  }
}

// ── 5. 构造 prompt ──
const ts = new Date().toISOString();
const prompt = `# DDT Relay Prompt（请整段复制到下一会话开头）

You are continuing DDT delivery for project: \`${projectId}\`
Last session ended: \`${ts}\`

═══════════════════════════════════════════════════

## 项目背景（DDT 自动注入，请勿改写）

- **项目目录**: \`${cwd}\`
- **项目 ID**: \`${projectId}\`
- **当前 phase**: \`${currentPhase}\`
- **已完成 phase**: ${completedPhases.length ? completedPhases.map(p => `\`${p}\``).join(' / ') : '（无）'}
- **技术栈**: ${stackSummary}

### 关键产物路径

| 类型 | 路径 |
|------|------|
${artifactRows || '| _暂无产物_ | _需先跑 /kickoff_ |'}

### Git 摘要

- **当前分支**: \`${branch}\`
- **最近 commit 时间**: ${lastCommitTs || '（无 commit）'}
- **最近 5 commits**:

\`\`\`
${recentCommits || '（无 commit）'}
\`\`\`

- **未提交改动**: ${uncommittedFiles.length} 个文件
${uncommittedFiles.length ? '\n```\n' + uncommittedFiles.slice(0, 20).join('\n') + (uncommittedFiles.length > 20 ? '\n... (truncated)' : '') + '\n```' : ''}

═══════════════════════════════════════════════════

## 1. What We Are Building（**请 LLM 在生成 prompt 时填写**）

<1-3 段：项目目标 / 为什么需要 / 在系统中的位置。可参考 project-brief.md 与 docs/prd.md 第 1 段>

## 2. What WORKED (with evidence)（**LLM 填**）

每条必须带具体证据（test 通过 / lint 0 错 / git commit / 用户确认）：

- ✅ <成果>: 证据 = <具体证据>
- ✅ ...

## 3. What Did NOT Work (and why)（**LLM 填，最关键，绝不省略**）

每条带精确失败原因（防止下次重试同一坑）：

- ❌ <尝试>: 失败原因 = <具体 error message / 错误假设 / 被 X 阻塞>
- ❌ ...

如本次会话无失败尝试，写："本次会话无失败尝试。"

## 4. What Has NOT Been Tried Yet（**LLM 填**）

- <方向>: <为什么值得尝试>
- ...

## 5. Current State of Files（**LLM 填**）

参考上方"未提交改动"列表 + git diff 结果：

| File | Status | Notes |
| --- | --- | --- |
| <path> | ✅ Complete / 🟡 In Progress / ❌ Broken / ⏸ Not Started | <一句话说明> |

## 6. Decisions Made（**LLM 填**）

- <决策>: 理由 = <为什么 vs 替代方案>
- ...

## 7. Blockers & Open Questions（**LLM 填**）

${openBlockers ? openBlockers + '\n\n' : ''}- <blocker>: 等待 = <什么 / 谁>
- ...

## 8. Exact Next Step（**LLM 填，精确到无需思考**）

<下一步具体指令，含命令 / 文件路径 / 行号 / 验证方式>

例如：
- 在 server/src/routes/tasks.ts:55 处修复 PATCH body schema：把 \`status\` 改为 \`newStatus\` 与 docs/api-contract.yaml::/tasks/{id}/status::requestBody 对齐
- 跑 \`cd server && npm test --filter tasks\` 验证 15/15 通过
- 然后跑 /digital-delivery-team:verify

## 9. Environment & Setup Notes（可选）

- 启动后端: \`cd server && npm run dev\`
- 启动前端: \`cd web && npm run dev\`
- 环境变量: <如 DATABASE_URL>

═══════════════════════════════════════════════════

## 续作前必做（接力 AI 看到此 prompt 后请按顺序执行）：

1. \`/digital-delivery-team:doctor\` — 确认环境
2. \`/digital-delivery-team:resume\` — 读 progress.json
3. 然后从 "Exact Next Step" 开始第一行
4. 如有疑问按 Blockers 处理或追加新 blocker 到 docs/blockers.md，不要猜测

— DDT Relay v1（auto-generated by build-relay-prompt.mjs）—
`;

// ── 6. 写文件 ──
mkdirSync(ddtDir, { recursive: true });
writeFileSync(outPath, prompt, 'utf8');

if (!args.quiet) {
  console.log(prompt);
  console.log('\n');
  console.log(`✅ Relay prompt 已写入：${outPath}`);
  console.log(`   请把上方 ═══ 之间的内容（含两侧分隔线）整段复制到下一会话开头`);
  console.log(`   下次会话使用：粘贴 → AI 看到完整背景 → 从 "Exact Next Step" 续作`);
}

process.exit(0);
