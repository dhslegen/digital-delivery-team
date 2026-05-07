#!/usr/bin/env node
// v0.9 A1：从 commands/*.md 派生 mermaid 流程图
//
// 解决 v0.8 实战暴露的问题：用户拼不出"prd → wbs → design → design-brief →
// design-execute → build-web/api → ..."完整流程图，只能通过命令尾部"建议下
// 一步"逐步摸索。本工具把隐式契约显式化。
//
// 用法：
//   node bin/render-flowchart.mjs                       # 输出到 stdout
//   node bin/render-flowchart.mjs --output docs/flowchart.md   # 写文件
//   node bin/render-flowchart.mjs --commands-dir <path>        # 自定义 commands 目录
//
// 输出格式：
//   - 节点：每个命令一个，含 description（mermaid label）
//   - 形状：phase 命令矩形，编排命令圆角，决策门菱形
//   - 边：从命令尾部 "建议下一步: /xxx" / 分支表抽取
//   - 三态分支：spa / server-side / none 边带条件标签

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const PLUGIN_ROOT = resolve(dirname(__filename), '..');

// 命令分类——决定节点形状
const PHASE_COMMANDS = new Set([
  'prd', 'wbs', 'design',
  'design-brief', 'design-execute',
  'build-web', 'build-api',
  'integrate',  // v0.9.11 D28：栈联调 + smoke
  'test', 'review', 'fix', 'package', 'report',
]);
const ORCHESTRATOR_COMMANDS = new Set(['kickoff', 'impl', 'verify', 'ship']);
const UTILITY_COMMANDS = new Set(['doctor', 'preview', 'relay', 'resume']);

// 抽 frontmatter description（命令一句话说明，用作 mermaid label）
export function extractDescription(text) {
  const m = text.match(/^---\s*\n[\s\S]*?description:\s*([^\n]+?)\s*\n[\s\S]*?\n---/);
  return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : '';
}

// 抽"建议下一步"——支持多种写法：
//   1. > ✅ 建议下一步：`/wbs`
//   2. 建议下一步：/impl
//   3. spa → /design-brief / server-side|none → /impl（design.md 分支表）
//   4. （等用户回贴）→ /build-web（design-execute.md 双阶段）
//   5. v0.9 A2：dry-run 段里的 --next "/verify"（适配 build-web/build-api 这种走 6-phase 的命令）
export function extractNextSteps(text) {
  const result = [];  // [{ to, condition? }]
  // 1. 简单引用：建议下一步：/xxx 或 `/xxx`
  const simpleRe = /建议下一步\s*[：:]\s*`?(\/[a-z][a-z0-9-]+)/g;
  for (const m of text.matchAll(simpleRe)) {
    result.push({ to: m[1] });
  }
  // 2. v0.9 A2：从 print-dry-run.mjs --next 参数抽（适配 build-web/build-api）
  //    不需要 dry-run 段在某段——直接 grep 整个文件
  const dryRunNextRe = /print-dry-run\.mjs[^\n]*--next\s+"([^"]+)"/g;
  for (const m of text.matchAll(dryRunNextRe)) {
    // --next 可能含 " | " 分支，逐个抽 /xxx 命令
    const cmds = [...m[1].matchAll(/\/([a-z][a-z0-9-]+)/g)].map(x => `/${x[1]}`);
    for (const cmd of cmds) {
      // 跳过命令名后的参数（如 /design-execute --channel claude-design）
      result.push({ to: cmd });
    }
  }
  // 3. 分支表：spa → /design-brief / server-side|none → /impl
  // 抓 `<value>` → `/cmd` 模式
  const branchRe = /`?([a-z][a-z|-]+(?:\/[a-z][a-z-]+)?)`?\s*[→]\s*`?(\/[a-z][a-z0-9-]+)/g;
  const seen = new Set(result.map(r => `${r.condition || ''}|${r.to}`));
  for (const m of text.matchAll(branchRe)) {
    const cond = m[1];
    const to = m[2];
    const key = `${cond}|${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // 跳过"看似条件但实际是普通文本"的（如 a/b）
    if (!/^(spa|server-side|none|unknown|\w+\/\w+)/.test(cond)) continue;
    result.push({ to, condition: cond });
  }
  // 去重 to（保留 condition 优先）
  const dedup = new Map();
  for (const r of result) {
    const key = `${r.condition || ''}|${r.to}`;
    if (!dedup.has(key)) dedup.set(key, r);
  }
  return [...dedup.values()];
}

// 节点形状：mermaid 语法
function nodeShape(name, label) {
  // 转义 mermaid label 中的引号
  const safe = label.replace(/"/g, "'");
  if (PHASE_COMMANDS.has(name)) return `${name}["/${name}<br/>${safe}"]`;
  if (ORCHESTRATOR_COMMANDS.has(name)) return `${name}(["/${name}<br/>${safe}"])`;
  return `${name}["/${name}<br/>${safe}"]`;
}

// 主入口
export function renderFlowchart(commandsDir) {
  const files = readdirSync(commandsDir).filter(f => f.endsWith('.md'));
  const nodes = new Map();
  const edges = [];

  for (const f of files) {
    const name = basename(f, '.md');
    if (UTILITY_COMMANDS.has(name)) continue;  // doctor/preview/relay/resume 不进流程图
    const text = readFileSync(join(commandsDir, f), 'utf8');
    const desc = extractDescription(text);
    nodes.set(name, desc);
    for (const step of extractNextSteps(text)) {
      const targetName = step.to.replace(/^\//, '').replace(/\s.*$/, '');  // /design-execute --channel xxx → design-execute
      edges.push({ from: name, to: targetName, condition: step.condition });
    }
  }

  // 渲染 mermaid
  const lines = ['```mermaid'];
  lines.push('flowchart LR');
  lines.push('  %% 节点定义');
  for (const [name, desc] of nodes) {
    lines.push(`  ${nodeShape(name, desc.slice(0, 30))}`);
  }
  lines.push('');
  lines.push('  %% 依赖边（从命令尾部"建议下一步"抽取）');
  // 去重边
  const seen = new Set();
  for (const e of edges) {
    const key = `${e.from}|${e.to}|${e.condition || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!nodes.has(e.to)) continue;  // 跳过指向 utility 或不存在的命令
    if (e.condition) {
      lines.push(`  ${e.from} -- ${e.condition} --> ${e.to}`);
    } else {
      lines.push(`  ${e.from} --> ${e.to}`);
    }
  }

  // 类型样式
  lines.push('');
  lines.push('  %% 节点类型样式');
  lines.push('  classDef phase fill:#e1f5fe,stroke:#0277bd,stroke-width:2px');
  lines.push('  classDef orch fill:#fff3e0,stroke:#ef6c00,stroke-width:2px,stroke-dasharray:5');
  const phaseList = [...nodes.keys()].filter(n => PHASE_COMMANDS.has(n)).join(',');
  const orchList = [...nodes.keys()].filter(n => ORCHESTRATOR_COMMANDS.has(n)).join(',');
  if (phaseList) lines.push(`  class ${phaseList} phase`);
  if (orchList) lines.push(`  class ${orchList} orch`);

  lines.push('```');
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const opts = { output: null, commandsDir: join(PLUGIN_ROOT, 'commands') };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output') opts.output = args[++i];
    else if (args[i] === '--commands-dir') opts.commandsDir = args[++i];
  }
  if (!existsSync(opts.commandsDir)) {
    console.error(`❌ commands 目录不存在: ${opts.commandsDir}`);
    process.exit(1);
  }
  const md = '# DDT 命令依赖图\n\n' +
    '> v0.9 A1：从 `commands/*.md` 自动派生（frontmatter description + 建议下一步段落）。\n' +
    '> 重新生成：`node bin/render-flowchart.mjs --output <path>`\n\n' +
    renderFlowchart(opts.commandsDir) +
    '\n\n## 节点形状说明\n\n' +
    '- `phase` 类（蓝色矩形）：单一职责的开发阶段命令\n' +
    '- `orch` 类（橙色虚线圆角）：编排命令，串/并行调下游 phase 命令\n' +
    '- `utility` 类（doctor / preview / relay / resume）不在本图（无 phase 关系）\n';
  if (opts.output) {
    writeFileSync(opts.output, md);
    console.log(`✅ flowchart 已写入: ${opts.output}`);
  } else {
    console.log(md);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
