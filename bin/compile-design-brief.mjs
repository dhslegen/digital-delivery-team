#!/usr/bin/env node
// W1: design-brief 编译器
//
// 输入：
//   docs/prd.md                          (必需) 用户故事 / 目标 / 验收标准
//   docs/api-contract.yaml               (必需) endpoint 列表 → §6
//   .ddt/tech-stack.json                 (必需) 栈选型，决定 stack 段
//   .ddt/design/tokens.json              (可选) 用户已编辑的 design tokens；缺失则复制模板
//   .ddt/design/assets/*.{png,jpg,...}   (可选) 用户上传的参考截图
//   web/components.json + web/components/ (可选) 现有组件清单
//
// 输出：
//   docs/design-brief.md                 主产物（10 字段填充）
//   .ddt/design/tokens.json              若不存在则复制 templates/design-tokens.template.json
//   .ddt/design/components-inventory.md  扫描已有组件生成
//
// 用法：
//   node bin/compile-design-brief.mjs                # 跑编译；写 docs/design-brief.md
//   node bin/compile-design-brief.mjs --refresh      # 即便 brief 已存在也重新编译
//   node bin/compile-design-brief.mjs --dry-run      # 仅打印将写入的文件，不落盘
//   node bin/compile-design-brief.mjs --visual-direction <name>   # 显式指定视觉方向（CI / 自动化）
//
// 退出码：
//   0 = 成功
//   1 = 参数错误
//   2 = 必需输入缺失（PRD / api-contract / tech-stack）
//   3 = brief 已存在但未传 --refresh

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const SELF_DIR = dirname(__filename);
const PLUGIN_ROOT = resolve(SELF_DIR, '..');

const TEMPLATE_BRIEF      = join(PLUGIN_ROOT, 'templates', 'design-brief.template.md');
const TEMPLATE_TOKENS     = join(PLUGIN_ROOT, 'templates', 'design-tokens.template.json');
const TEMPLATE_INVENTORY  = join(PLUGIN_ROOT, 'templates', 'components-inventory.template.md');

// 9 种 visual direction 的合法枚举（与模板 §8.1 对齐）
export const VISUAL_DIRECTIONS = Object.freeze([
  'brutally-minimal',
  'editorial',
  'industrial',
  'luxury',
  'playful',
  'geometric',
  'retro-futurist',
  'soft-organic',
  'maximalist',
]);

// 11 条 anti-patterns（与模板 §8.3 对齐；用于通道 prompt 派生时校验完整性）
export const ANTI_PATTERNS = Object.freeze([
  'purple-gradient-default',
  'glass-morphism-overuse',
  'uniform-radius',
  'scroll-jacking',
  'centered-hero-on-stock-gradient',
  'generic-sans-serif',
  'generic-emotional-color',
  'interchangeable-saas-hero',
  'generic-card-piles',
  'random-accent-without-system',
  'motion-without-purpose',
]);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next; i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// 从 PRD markdown 抽取 user stories（§4 功能/用户故事段落）
// 兼容多种格式：
//   **用户故事**：As a X, I want Y, so that Z.       (英文逗号 / 行内)
//   **用户故事**\nAs a X，I want Y，so that Z。       (中文逗号 / 跨行 / 句号)
//   **用户故事**：As a `X`, I want `Y`, so that `Z`. (引号包裹)
export function extractUserStories(prdText) {
  const stories = [];
  // [，,] 中英文逗号；终止符 [。.\n]——句末或换行
  // (.+?) lazy 匹配，允许中间含 backtick / 引号 / 括号（PRD 常用 `/` 等路径引用）
  const re = /\*\*用户故事\*\*\s*[：:]?\s*As a\s+(.+?)\s*[，,]\s*I want\s+(.+?)\s*[，,]\s*so that\s+(.+?)\s*[。.\n]/gi;
  let m, idx = 1;
  while ((m = re.exec(prdText)) !== null) {
    stories.push({
      id: `US-${String(idx).padStart(2, '0')}`,
      role: m[1].trim(),
      want: m[2].trim(),
      value: m[3].trim(),
    });
    idx++;
  }
  return stories;
}

// 从 OpenAPI yaml 抽取 paths（极简 — 不做 schema 解析，仅取 method + path 行）
export function extractEndpoints(yamlText) {
  const endpoints = [];
  const lines = yamlText.split('\n');
  let inPaths = false;
  let currentPath = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^paths\s*:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths && /^\S/.test(line) && !line.startsWith(' ')) { inPaths = false; }
    if (!inPaths) continue;

    // path 行：缩进 2 空格，以 / 开头，冒号结尾
    const pathMatch = line.match(/^\s{2}(\/\S*?)\s*:\s*$/);
    if (pathMatch) { currentPath = pathMatch[1]; continue; }

    // method 行：缩进 4 空格，常见 HTTP method
    const methodMatch = line.match(/^\s{4}(get|post|put|patch|delete|head|options)\s*:\s*$/i);
    if (methodMatch && currentPath) {
      endpoints.push({
        method: methodMatch[1].toUpperCase(),
        path: currentPath,
        line: i + 1,
      });
    }
  }
  return endpoints;
}

// 扫描 web/components/ 抽取已有组件
function scanComponents(cwd) {
  const result = { shadcn: [], custom: [], hasShadcn: false };
  const componentsJson = join(cwd, 'web', 'components.json');
  if (existsSync(componentsJson)) {
    try {
      JSON.parse(readFileSync(componentsJson, 'utf8'));
      result.hasShadcn = true;
    } catch { /* ignore */ }
  }
  const stripExt = (f) => basename(f, extname(f));
  const uiDir = join(cwd, 'web', 'components', 'ui');
  if (existsSync(uiDir)) {
    for (const f of readdirSync(uiDir)) {
      if (f.endsWith('.tsx') || f.endsWith('.jsx')) {
        result.shadcn.push({ name: stripExt(f), path: `web/components/ui/${f}` });
      }
    }
  }
  const customDir = join(cwd, 'web', 'components');
  if (existsSync(customDir)) {
    for (const f of readdirSync(customDir)) {
      const fp = join(customDir, f);
      if (statSync(fp).isFile() && (f.endsWith('.tsx') || f.endsWith('.jsx'))) {
        result.custom.push({ name: stripExt(f), path: `web/components/${f}` });
      }
    }
  }
  return result;
}

// 扫描 .ddt/design/assets/ 列出参考图
function listReferenceAssets(cwd) {
  const dir = join(cwd, '.ddt', 'design', 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /\.(png|jpg|jpeg|gif|webp)$/i.test(f))
    .sort()
    .map(f => `.ddt/design/assets/${f}`);
}

function readProjectId(cwd) {
  const p = join(cwd, '.ddt', 'project-id');
  return existsSync(p) ? readFileSync(p, 'utf8').trim() : 'unknown';
}

// 用 execFileSync 安全调 git（避免 shell injection）
function gitSha(cwd, file) {
  try {
    const out = execFileSync('git', ['-C', cwd, 'log', '-1', '--format=%h', '--', file], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    return out.trim() || 'untracked';
  } catch {
    return 'untracked';
  }
}

// 用提取出的字段填充模板（占位符 <xxx> → 实际内容）
export function renderBrief(template, ctx) {
  let out = template;
  // 标题与版本
  out = out.replace('Design Brief · <项目名称>', `Design Brief · ${ctx.projectName}`);
  out = out.replace('<YYYY-MM-DD>', ctx.date);
  out = out.replace('<project_id>', ctx.projectId);

  // §2 User Stories 表填充
  if (ctx.stories.length > 0) {
    const rows = ctx.stories.map(s =>
      `| ${s.id} | ${s.role} | ${s.want} | ${s.value} | <填写 Given/When/Then> |`
    ).join('\n');
    out = out.replace(
      /\| US-01 \| <role> \| <goal> \| <value> \| Given \.\.\. \/ When \.\.\. \/ Then \.\.\. \|\n\| US-02 \|  \|  \|  \|  \|/,
      rows,
    );
  }

  // §6 Data & API Contract endpoint 列表
  if (ctx.endpoints.length > 0) {
    const epLines = ctx.endpoints.map(ep =>
      `- \`${ep.method} ${ep.path}\` → 见 api-contract.yaml#L${ep.line}，对应屏幕：\`<screen>\``
    ).join('\n');
    out = out.replace(
      /- `<METHOD> <path>` → 见 api-contract\.yaml#L<line>，对应屏幕：`<screen>`\n- \.\.\./,
      epLines,
    );
  }

  // §9 References 参考截图列表
  if (ctx.assets.length > 0) {
    const lines = ctx.assets.map(a => `- \`${a}\``).join('\n');
    out = out.replace(
      /- `\.ddt\/design\/assets\/ref-01-<desc>\.png`\n- `\.ddt\/design\/assets\/ref-02-<desc>\.png`/,
      lines,
    );
  }

  // 编译信息块（YAML）
  const compileInfo = [
    `generated_at:  ${ctx.generatedAt}`,
    `generator:     ddt-design-brief-compiler v0.8.0`,
    `inputs:`,
    `  prd:           docs/prd.md@${ctx.gitSha.prd}`,
    `  api_contract:  docs/api-contract.yaml@${ctx.gitSha.contract}`,
    `  tech_stack:    .ddt/tech-stack.json`,
    `  user_assets:`,
    ...(ctx.assets.length > 0 ? ctx.assets.map(a => `    - ${a}`) : ['    - (无)']),
    `    - .ddt/design/tokens.json`,
    `derived_packages:`,
    `  - .ddt/design/claude-design/upload-package/`,
    `  - .ddt/design/figma/upload-package/   (if --channel includes figma)`,
    `  - .ddt/design/v0/v0-sources/          (if --channel includes v0)`,
  ].join('\n');
  out = out.replace(
    /generated_at:  <ISO 8601 timestamp>[\s\S]*?  - \.ddt\/design\/v0\/v0-sources\/          \(if --channel includes v0\)/,
    compileInfo,
  );

  return out;
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  // 必需输入
  const prdPath = join(cwd, 'docs', 'prd.md');
  const contractPath = join(cwd, 'docs', 'api-contract.yaml');
  const techStackPath = join(cwd, '.ddt', 'tech-stack.json');

  for (const [name, p] of [['docs/prd.md', prdPath], ['docs/api-contract.yaml', contractPath], ['.ddt/tech-stack.json', techStackPath]]) {
    if (!existsSync(p)) {
      console.error(`❌ 必需输入缺失：${name}（请先跑 /prd → /design）`);
      process.exit(2);
    }
  }

  const briefPath = join(cwd, 'docs', 'design-brief.md');
  if (existsSync(briefPath) && !args.refresh && !args['dry-run']) {
    console.error(`❌ ${briefPath} 已存在；如需重新编译请加 --refresh`);
    process.exit(3);
  }

  // visual direction 校验
  if (args['visual-direction'] && !VISUAL_DIRECTIONS.includes(args['visual-direction'])) {
    console.error(`❌ --visual-direction 必须是: ${VISUAL_DIRECTIONS.join(' / ')}`);
    process.exit(1);
  }

  // 读取输入
  const prdText = readFileSync(prdPath, 'utf8');
  const contractText = readFileSync(contractPath, 'utf8');
  const techStack = JSON.parse(readFileSync(techStackPath, 'utf8'));
  const template = readFileSync(TEMPLATE_BRIEF, 'utf8');

  // .ddt/design/ 目录
  const designDir = join(cwd, '.ddt', 'design');
  ensureDir(designDir);
  ensureDir(join(designDir, 'assets'));

  // tokens.json: 若不存在则复制模板
  const tokensPath = join(designDir, 'tokens.json');
  if (!existsSync(tokensPath) && !args['dry-run']) {
    copyFileSync(TEMPLATE_TOKENS, tokensPath);
    console.error(`✅ 已复制默认 tokens 到 ${tokensPath}（用户可手动调整）`);
  }

  // 渲染 brief
  const ctx = {
    projectName: techStack.preset || 'untitled',
    projectId: readProjectId(cwd),
    date: new Date().toISOString().slice(0, 10),
    stories: extractUserStories(prdText),
    endpoints: extractEndpoints(contractText),
    assets: listReferenceAssets(cwd),
    generatedAt: new Date().toISOString(),
    gitSha: {
      prd: gitSha(cwd, 'docs/prd.md'),
      contract: gitSha(cwd, 'docs/api-contract.yaml'),
    },
  };

  const briefOut = renderBrief(template, ctx);

  // components-inventory
  const inventoryTemplate = readFileSync(TEMPLATE_INVENTORY, 'utf8');
  const components = scanComponents(cwd);
  const inventoryOut = inventoryTemplate
    .replace('Components Inventory · <项目名称>', `Components Inventory · ${ctx.projectName}`)
    .replace('generated_at: <ISO 8601 timestamp>', `generated_at: ${ctx.generatedAt}`)
    + (components.shadcn.length > 0
      ? `\n\n<!-- 自动扫描：${components.shadcn.length} 个 shadcn 组件 / ${components.custom.length} 个 custom 组件 -->\n`
      : '\n\n<!-- 自动扫描：未发现 web/components/，请项目初始化后重跑 -->\n');

  const inventoryPath = join(designDir, 'components-inventory.md');

  if (args['dry-run']) {
    console.log('--- DRY RUN ---');
    console.log(`docs/design-brief.md (${briefOut.length} 字符)`);
    console.log(`.ddt/design/components-inventory.md (${inventoryOut.length} 字符)`);
    console.log(`.ddt/design/tokens.json (${existsSync(tokensPath) ? '已存在' : '将复制模板'})`);
    process.exit(0);
  }

  writeFileSync(briefPath, briefOut, 'utf8');
  writeFileSync(inventoryPath, inventoryOut, 'utf8');

  // 终端摘要
  console.log(`✅ Design Brief 编译完成`);
  console.log(`   📄 ${briefPath}`);
  console.log(`   📄 ${inventoryPath}`);
  console.log(`   🎨 ${tokensPath}`);
  console.log('');
  console.log(`📋 抽取摘要：`);
  console.log(`   - User Stories: ${ctx.stories.length} 条`);
  console.log(`   - API Endpoints: ${ctx.endpoints.length} 个`);
  console.log(`   - Reference Assets: ${ctx.assets.length} 张`);
  console.log(`   - Components: ${components.shadcn.length} shadcn + ${components.custom.length} custom`);
  console.log('');
  console.log(`👀 下一步：`);
  console.log(`   1. 编辑 docs/design-brief.md 填充 §1 概述 / §3 IA / §4 Screen Inventory / §8.1 visual_direction`);
  console.log(`   2. 调整 .ddt/design/tokens.json（若需要不同色系）`);
  console.log(`   3. 上传参考图到 .ddt/design/assets/（命名 ref-XX-<desc>.png）`);
  console.log(`   4. 跑 /design-execute --channel claude-design 派生通道附件包并启动设计流程`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
