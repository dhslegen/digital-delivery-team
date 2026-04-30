#!/usr/bin/env node
// W4: figma 通道摄取器
//
// 输入：用户提供的 Figma file URL（含 ?node-id=... 可选）
//
// 设计约束：Figma MCP 工具（mcp__figma__get_design_context 等）只能在 Claude Code
//   会话内调用，无法从 bin 脚本直接调用。所以本脚本只做：
//   1. URL 校验 + 解析（提取 fileKey / nodeId）
//   2. 写 ingest-instructions.md：main thread 应执行的 MCP 调用清单
//   3. 记录历史 .ddt/design/figma/ingest-history.jsonl
//   4. 提示用户：main thread 接下来会读 instructions 调 MCP 拉取上下文
//
// 用法：
//   node bin/ingest-figma-context.mjs --url <figma-url>
//   node bin/ingest-figma-context.mjs --url <url> --dry-run
//
// 退出码：
//   0 = 成功
//   1 = 参数错误（URL 格式 / 不是 figma.com）
//   2 = 无法提取 fileKey

import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

// 解析 Figma URL：提取 fileKey + nodeId
//   支持格式：
//     https://www.figma.com/design/<fileKey>/<file-name>?node-id=<nodeId>
//     https://www.figma.com/design/<fileKey>/branch/<branchKey>/<file-name>?node-id=<nodeId>
//     https://www.figma.com/file/<fileKey>/<file-name>?node-id=<nodeId>     (旧版)
//     https://www.figma.com/board/<fileKey>/<file-name>                      (FigJam)
//     https://www.figma.com/make/<makeFileKey>/<name>                        (Figma Make)
export function parseFigmaUrl(url) {
  if (typeof url !== 'string' || url.length > 2048) {
    return { valid: false, reason: 'URL 太长或非字符串' };
  }
  if (!/^https:\/\/(www\.)?figma\.com\//.test(url)) {
    return { valid: false, reason: '域名必须是 figma.com（含 www）' };
  }
  // 标准字符校验（防 shell 注入）
  if (!/^https?:\/\/[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+$/.test(url)) {
    return { valid: false, reason: 'URL 含非法字符' };
  }

  // 提取 fileKey 与类型
  const designMatch = url.match(/figma\.com\/design\/([A-Za-z0-9]+)/);
  const fileMatch   = url.match(/figma\.com\/file\/([A-Za-z0-9]+)/);
  const boardMatch  = url.match(/figma\.com\/board\/([A-Za-z0-9]+)/);
  const makeMatch   = url.match(/figma\.com\/make\/([A-Za-z0-9]+)/);
  const branchMatch = url.match(/\/branch\/([A-Za-z0-9]+)/);

  let fileKey = null;
  let kind = null;
  if (designMatch) { fileKey = designMatch[1]; kind = 'design'; }
  else if (fileMatch)  { fileKey = fileMatch[1];  kind = 'file (legacy)'; }
  else if (boardMatch) { fileKey = boardMatch[1]; kind = 'board (FigJam)'; }
  else if (makeMatch)  { fileKey = makeMatch[1];  kind = 'make'; }

  if (!fileKey) {
    return { valid: false, reason: '无法提取 fileKey（不识别的 Figma URL 类型）' };
  }

  // branch URL 用 branchKey 替代 fileKey（按 Figma MCP 文档约定）
  if (branchMatch) {
    fileKey = branchMatch[1];
  }

  // 提取 nodeId（query string）
  let nodeId = null;
  const nodeMatch = url.match(/[?&]node-id=([^&]+)/);
  if (nodeMatch) {
    // Figma URL 用 - 替代 :，MCP 期望原始的 :
    nodeId = decodeURIComponent(nodeMatch[1]).replace(/-/g, ':');
  }

  return { valid: true, fileKey, nodeId, kind, url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const url = args.url;
  if (!url) {
    console.error(`❌ --url <figma-url> 必填`);
    process.exit(1);
  }

  const parsed = parseFigmaUrl(url);
  if (!parsed.valid) {
    console.error(`❌ Figma URL 不合法：${parsed.reason}`);
    process.exit(parsed.reason.includes('fileKey') ? 2 : 1);
  }

  if (args['dry-run']) {
    console.log(`--- DRY RUN ---`);
    console.log(`URL: ${parsed.url}`);
    console.log(`fileKey: ${parsed.fileKey}`);
    console.log(`nodeId: ${parsed.nodeId || '(未指定，将拉整个文件)'}`);
    console.log(`kind: ${parsed.kind}`);
    process.exit(0);
  }

  // 写 ingest-instructions.md（main thread 后续读这个文件调 MCP）
  const instructionsDir = join(cwd, '.ddt', 'design', 'figma');
  mkdirSync(instructionsDir, { recursive: true });

  const instructions = renderInstructions(parsed);
  const instructionsPath = join(instructionsDir, 'ingest-instructions.md');
  writeFileSync(instructionsPath, instructions, 'utf8');

  // 记录历史
  const historyPath = join(instructionsDir, 'ingest-history.jsonl');
  appendFileSync(historyPath, JSON.stringify({
    ts: new Date().toISOString(),
    url: parsed.url,
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
    kind: parsed.kind,
  }) + '\n', 'utf8');

  console.log(`✅ Figma URL 已解析`);
  console.log(`   fileKey: ${parsed.fileKey}`);
  console.log(`   nodeId:  ${parsed.nodeId || '(整个文件)'}`);
  console.log(`   kind:    ${parsed.kind}`);
  console.log('');
  console.log(`📋 main thread 操作指令已写入: ${instructionsPath}`);
  console.log('');
  console.log(`👀 下一步（由 main thread 在 Claude Code 会话内执行）：`);
  console.log(`   1. 调用 mcp__figma__get_design_context（fileKey + nodeId）拉取节点上下文`);
  console.log(`   2. 输出含 React + Tailwind 参考代码 + 截图 + tokens`);
  console.log(`   3. frontend-development skill 改写为 web/ 项目结构 + 项目契约`);
  console.log(`   4. 跑 web/ 构建 + lint + 测试 + 10 维评分决策门`);
}

function renderInstructions(parsed) {
  return `# Figma Ingest Instructions（W4 自动生成）

> 由 ddt-ingest-figma-context 生成。**请 main thread 在 Claude Code 会话内按下面步骤执行**——
> Figma MCP 工具只能在会话内调用，bin 脚本无法直接调。

## 来源

- **URL**: ${parsed.url}
- **fileKey**: \`${parsed.fileKey}\`
- **nodeId**: \`${parsed.nodeId || '(未指定，将拉整个文件根)'}\`
- **kind**: ${parsed.kind}
- **解析时间**: ${new Date().toISOString()}

## main thread 应执行的 MCP 调用

### Step 1：拉取节点上下文（含参考代码 + 截图 + tokens）

\`\`\`typescript
mcp__figma__get_design_context({
  fileKey: '${parsed.fileKey}'${parsed.nodeId ? `,
  nodeId: '${parsed.nodeId}'` : ''}
})
\`\`\`

输出包含：
- React + Tailwind 参考代码（注：是参考，不是直接落地代码）
- 节点截图
- 设计 tokens（颜色 / 字体 / 间距等 Variables）
- Code Connect 映射（如团队已打桩，会返回项目真实代码片段）

### Step 2（可选）：拉取截图

\`\`\`typescript
mcp__figma__get_screenshot({
  fileKey: '${parsed.fileKey}'${parsed.nodeId ? `,
  nodeId: '${parsed.nodeId}'` : ''}
})
\`\`\`

把截图保存到 \`.ddt/design/figma/screenshots/\`，用于后续 10 维评分对比。

### Step 3（可选）：拉取设计系统 tokens

\`\`\`typescript
mcp__figma__get_variable_defs({
  fileKey: '${parsed.fileKey}'
})
\`\`\`

把 Figma Variables 与 \`.ddt/design/tokens.json\` 对齐。

## Step 4：改写为 web/ 结构

按 \`skills/frontend-development/SKILL.md\` 与 \`skills/api-contract-first/SKILL.md\` 改写：

- 参考代码 → \`web/components/<screen>.tsx\`
- 数据层 → \`web/lib/api-client.ts\`（OpenAPI 生成，不要 fetch / axios）
- 设计 token → 合并到 \`web/styles/tokens.css\` + \`tailwind.config.js\`
- 路由 → 项目栈对应（React Router v6 / Next.js App Router）

## 红线（任一触发就丢弃 Figma 输出）

- ❌ 含 \`fetch('/api/...')\` 或 \`axios.*\` 直连
- ❌ 含 mock / fake / placeholder 数据
- ❌ 单组件含未在 components-inventory.md 中登记的新 UI 库（如 antd / mui）
- ❌ tokens 不是 Tailwind config 兼容的 CSS variables
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
