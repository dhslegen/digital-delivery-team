#!/usr/bin/env node
// W2: 通道附件包派生器
//
// 输入（来自 W1 编译产物）：
//   docs/design-brief.md             10 字段 SSoT
//   docs/prd.md                      用户故事
//   docs/api-contract.yaml           OpenAPI 契约
//   .ddt/tech-stack.json             栈选型
//   .ddt/design/tokens.json          design tokens
//   .ddt/design/components-inventory.md
//   .ddt/design/assets/              用户参考图
//
// 输出（按通道）：
//   --channel claude-design：
//     .ddt/design/claude-design/upload-package/{01-design-brief.md,...,07-references/}
//     .ddt/design/claude-design/prompt.md
//
//   --channel figma：
//     .ddt/design/figma/upload-package/{...}
//     .ddt/design/figma/prompt.md
//
//   --channel v0：
//     .ddt/design/v0/v0-sources/{openapi.yaml, tokens.css, design-brief.md, components-inventory.md}
//     .ddt/design/v0/project-instructions.md
//     .ddt/design/v0/prompts/<screen>.md（每屏一份，待 W3 命令再细化）
//
// 用法：
//   node bin/derive-channel-package.mjs --channel claude-design [--refresh] [--dry-run]
//   node bin/derive-channel-package.mjs --channel figma
//   node bin/derive-channel-package.mjs --channel v0
//   node bin/derive-channel-package.mjs --channel all       # 派生全部 3 通道
//
// 退出码：0 成功；1 参数错误；2 必需输入缺失；3 输出已存在未传 --refresh

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ANTI_PATTERNS } from './compile-design-brief.mjs';

const __filename = fileURLToPath(import.meta.url);
const SELF_DIR = dirname(__filename);
const PLUGIN_ROOT = resolve(SELF_DIR, '..');

const TEMPLATE_PROMPTS = {
  'claude-design': join(PLUGIN_ROOT, 'templates', 'prompts', 'claude-design.template.md'),
  'figma':         join(PLUGIN_ROOT, 'templates', 'prompts', 'figma.template.md'),
  'v0':            join(PLUGIN_ROOT, 'templates', 'prompts', 'v0.template.md'),
};

export const VALID_CHANNELS = Object.freeze(['claude-design', 'figma', 'v0']);

// 11 条 anti-patterns 的中英双语描述（用于 prompt 块注入；与 §8.3 模板对齐）
export const ANTI_PATTERNS_DETAILS = Object.freeze([
  { id: 'purple-gradient-default',          zh: '紫蓝默认渐变（from-purple-500 to-blue-500）',          en: 'Default purple-to-blue gradient (from-purple-500 to-blue-500)' },
  { id: 'glass-morphism-overuse',           zh: '无意义 glass morphism（毛玻璃滥用）',                  en: 'Gratuitous glass morphism' },
  { id: 'uniform-radius',                   zh: '不该圆角的圆角（按钮/卡片/输入框统一 8px）',           en: 'Uniform 8px radius across all components' },
  { id: 'scroll-jacking',                   zh: '滚动过度动画（parallax / scroll-jacking）',            en: 'Scroll-jacking / excessive parallax' },
  { id: 'centered-hero-on-stock-gradient',  zh: '居中 hero on stock gradient',                          en: 'Centered hero on stock gradient' },
  { id: 'generic-sans-serif',               zh: '通用 sans-serif（Inter / Arial / 系统默认）',          en: 'Generic sans-serif (Inter / Arial / system default)' },
  { id: 'generic-emotional-color',          zh: '通用情感色（饱和蓝 / 天蓝）',                          en: 'Generic emotional color (saturated blue / sky blue)' },
  { id: 'interchangeable-saas-hero',        zh: 'interchangeable SaaS hero（标题 + 副标 + 双 CTA）',    en: 'Interchangeable SaaS hero (title + subtitle + double CTA)' },
  { id: 'generic-card-piles',               zh: 'generic card piles（无层级的卡片堆叠）',               en: 'Generic card piles (cards without hierarchy)' },
  { id: 'random-accent-without-system',     zh: 'random accent without system（随手用色）',             en: 'Random accent without design system' },
  { id: 'motion-without-purpose',           zh: '动效无目的（motion that exists only because animation was easy）', en: 'Motion without task purpose' },
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

function ensureDir(p) { mkdirSync(p, { recursive: true }); }

// 从 design-brief.md 抽取关键字段（用于填 prompt 模板占位）
export function parseBriefMeta(briefText) {
  const meta = {
    visualDirection: '',
    visualRationale: '',
    styleKeywords: '',
    persona: '',
    scenario: '',
    painPoint: '',
    iaTree: '',
    userStoriesBlock: '',
    screenInventoryHeadings: [],
    endpointsSummary: [],
    tokensSummary: '',
    references: [],
  };

  // visual_direction（来自 §8.1 yaml 块）
  const vdMatch = briefText.match(/visual_direction:\s*\n\s*selected:\s*([^\s\n]+)\s*\n\s*rationale:\s*([^\n]+)/);
  if (vdMatch) {
    meta.visualDirection = vdMatch[1].trim().replace(/^[<>]/, '').replace(/[<>]$/, '');
    meta.visualRationale = vdMatch[2].trim();
  }

  // §1 Problem Alignment
  const problemMatch = briefText.match(/##\s*1\.\s*Problem Alignment[\s\S]*?(?=##\s*2\.)/);
  if (problemMatch) {
    const seg = problemMatch[0];
    meta.persona = (seg.match(/\*\*用户\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
    meta.painPoint = (seg.match(/\*\*痛点\*\*[：:]\s*([^\n]+)/) || [])[1] || '';
  }

  // §2 User Stories（连同表格保留）
  const storiesMatch = briefText.match(/##\s*2\.\s*User Stories[\s\S]*?(?=##\s*3\.)/);
  if (storiesMatch) {
    meta.userStoriesBlock = storiesMatch[0].replace(/^##\s*2\.\s*User Stories\s*\n+/, '').trim();
  }

  // §3 IA tree（取 ``` 代码块）
  const iaMatch = briefText.match(/##\s*3\.\s*Information Architecture[\s\S]*?```text?\n([\s\S]*?)\n```/);
  if (iaMatch) meta.iaTree = iaMatch[1].trim();

  // §4 Screen Inventory headings
  const screenMatches = briefText.matchAll(/^###\s*Screen\s*\d+:\s*([^\n]+)/gm);
  for (const m of screenMatches) {
    meta.screenInventoryHeadings.push(m[1].trim());
  }

  // §6 endpoints 列表（- `<METHOD> <path>`）
  const endpointMatches = briefText.matchAll(/^-\s*`([A-Z]+)\s+(\/\S+?)`/gm);
  for (const m of endpointMatches) {
    meta.endpointsSummary.push(`${m[1]} ${m[2]}`);
  }

  // §9 References 风格关键词
  const styleMatch = briefText.match(/\*\*风格关键词\*\*[：:]\s*([^\n]+)/);
  if (styleMatch) meta.styleKeywords = styleMatch[1].trim();

  // §9 参考截图列表
  const refMatches = briefText.matchAll(/^-\s*`(\.ddt\/design\/assets\/[^`]+)`/gm);
  for (const m of refMatches) {
    meta.references.push(m[1].trim());
  }

  return meta;
}

// 把 11 条 anti-patterns 渲染成中文 markdown 块
function renderAntiPatternsBlockZH() {
  return ANTI_PATTERNS_DETAILS.map((p, i) => `${i + 1}. ❌ ${p.zh}`).join('\n');
}

// 英文版（v0 Project Instructions 用）
function renderAntiPatternsBlockEN() {
  return ANTI_PATTERNS_DETAILS.map((p, i) => `${i + 1}. ${p.en}`).join('\n');
}

// 渲染 tokens 摘要（取主色 + 字体 + 圆角，避免完整 JSON 过长）
function renderTokensSummary(tokens) {
  const lines = [];
  if (tokens.color?.primary)    lines.push(`- **主色**: \`${tokens.color.primary}\``);
  if (tokens.color?.danger)     lines.push(`- **警示**: \`${tokens.color.danger}\``);
  if (tokens.color?.success)    lines.push(`- **成功**: \`${tokens.color.success}\``);
  if (tokens.typography?.['font-sans']) lines.push(`- **字体**: ${tokens.typography['font-sans']}`);
  if (tokens.radius)            lines.push(`- **圆角档**: ${Object.entries(tokens.radius).map(([k, v]) => `${k}=${v}`).join(' / ')}`);
  if (tokens.spacing)           lines.push(`- **间距档**: ${tokens.spacing.join(' / ')}px`);
  return lines.join('\n');
}

// 派生 claude-design 通道
function deriveClaudeDesign(cwd, meta, opts) {
  const dir = join(cwd, '.ddt', 'design', 'claude-design');
  const uploadDir = join(dir, 'upload-package');

  if (existsSync(uploadDir) && !opts.refresh && !opts.dryRun) {
    throw new Error(`${uploadDir} 已存在；如需重新生成请加 --refresh`);
  }

  if (!opts.dryRun) {
    if (existsSync(uploadDir) && opts.refresh) rmSync(uploadDir, { recursive: true, force: true });
    ensureDir(uploadDir);
    ensureDir(join(uploadDir, '07-references'));
  }

  const writes = [];
  // 复制 7 文件
  const copies = [
    ['docs/design-brief.md',                          '01-design-brief.md'],
    ['docs/prd.md',                                   '02-prd.md'],
    ['docs/api-contract.yaml',                        '03-api-contract.yaml'],
    ['.ddt/tech-stack.json',                          '04-tech-stack.json'],
    ['.ddt/design/tokens.json',                       '05-design-tokens.json'],
    ['.ddt/design/components-inventory.md',           '06-components-inventory.md'],
  ];
  for (const [src, dst] of copies) {
    const srcPath = join(cwd, src);
    const dstPath = join(uploadDir, dst);
    writes.push({ from: srcPath, to: dstPath });
    if (!opts.dryRun && existsSync(srcPath)) copyFileSync(srcPath, dstPath);
  }
  // 复制 references/ 目录
  const assetsDir = join(cwd, '.ddt', 'design', 'assets');
  if (existsSync(assetsDir)) {
    for (const f of readdirSync(assetsDir)) {
      if (/\.(png|jpg|jpeg|gif|webp)$/i.test(f)) {
        const src = join(assetsDir, f);
        const dst = join(uploadDir, '07-references', f);
        writes.push({ from: src, to: dst });
        if (!opts.dryRun) copyFileSync(src, dst);
      }
    }
  }

  // 渲染 prompt.md
  const tpl = readFileSync(TEMPLATE_PROMPTS['claude-design'], 'utf8');
  const tokens = JSON.parse(readFileSync(join(cwd, '.ddt', 'design', 'tokens.json'), 'utf8'));
  const prompt = tpl
    .replace(/\{\{PROJECT_NAME\}\}/g,                       opts.projectName)
    .replace(/\{\{VISUAL_DIRECTION\}\}/g,                   meta.visualDirection || '<未填写，请先编辑 brief §8.1>')
    .replace(/\{\{VISUAL_DIRECTION_RATIONALE\}\}/g,         meta.visualRationale || '<请填写>')
    .replace(/\{\{ANTI_PATTERNS_BLOCK\}\}/g,                renderAntiPatternsBlockZH())
    .replace(/\{\{USER_STORIES_BLOCK\}\}/g,                 meta.userStoriesBlock || '_(brief §2 暂无)_')
    .replace(/\{\{SCREEN_INVENTORY_PLACEHOLDER\}\}/g,       meta.screenInventoryHeadings.length > 0
      ? meta.screenInventoryHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')
      : '_(brief §4 暂无屏幕清单，请先编辑)_')
    .replace(/\{\{TOKENS_SUMMARY\}\}/g,                     renderTokensSummary(tokens))
    .replace(/\{\{ENDPOINTS_SUMMARY\}\}/g,                  meta.endpointsSummary.length > 0
      ? meta.endpointsSummary.map(e => `- \`${e}\``).join('\n')
      : '_(brief §6 暂无)_');

  const promptPath = join(dir, 'prompt.md');
  writes.push({ from: '<rendered>', to: promptPath, size: prompt.length });
  if (!opts.dryRun) writeFileSync(promptPath, prompt, 'utf8');

  return { dir, writes, promptPath };
}

// 派生 figma 通道
function deriveFigma(cwd, meta, opts) {
  const dir = join(cwd, '.ddt', 'design', 'figma');
  const uploadDir = join(dir, 'upload-package');

  if (existsSync(uploadDir) && !opts.refresh && !opts.dryRun) {
    throw new Error(`${uploadDir} 已存在；如需重新生成请加 --refresh`);
  }

  if (!opts.dryRun) {
    if (existsSync(uploadDir) && opts.refresh) rmSync(uploadDir, { recursive: true, force: true });
    ensureDir(uploadDir);
    ensureDir(join(uploadDir, '07-references'));
  }

  const writes = [];
  // figma 通道附件包结构与 claude-design 相同
  const copies = [
    ['docs/design-brief.md',                          '01-design-brief.md'],
    ['docs/prd.md',                                   '02-prd.md'],
    ['docs/api-contract.yaml',                        '03-api-contract.yaml'],
    ['.ddt/tech-stack.json',                          '04-tech-stack.json'],
    ['.ddt/design/tokens.json',                       '05-design-tokens.json'],
    ['.ddt/design/components-inventory.md',           '06-components-inventory.md'],
  ];
  for (const [src, dst] of copies) {
    const srcPath = join(cwd, src);
    const dstPath = join(uploadDir, dst);
    writes.push({ from: srcPath, to: dstPath });
    if (!opts.dryRun && existsSync(srcPath)) copyFileSync(srcPath, dstPath);
  }
  const assetsDir = join(cwd, '.ddt', 'design', 'assets');
  if (existsSync(assetsDir)) {
    for (const f of readdirSync(assetsDir)) {
      if (/\.(png|jpg|jpeg|gif|webp)$/i.test(f)) {
        const src = join(assetsDir, f);
        const dst = join(uploadDir, '07-references', f);
        writes.push({ from: src, to: dst });
        if (!opts.dryRun) copyFileSync(src, dst);
      }
    }
  }

  // 渲染 figma TC-EBC prompt
  const tpl = readFileSync(TEMPLATE_PROMPTS['figma'], 'utf8');
  const tokens = JSON.parse(readFileSync(join(cwd, '.ddt', 'design', 'tokens.json'), 'utf8'));
  const taskOneLiner = `为 ${opts.projectName} 项目设计 ${meta.screenInventoryHeadings.length} 个核心页面（${meta.screenInventoryHeadings.slice(0, 3).join(' / ') || '待填写'}）。`;
  const refsBlock = meta.references.length > 0
    ? meta.references.map(r => `- \`${r}\``).join('\n')
    : '_(暂无；建议上传截图至 .ddt/design/assets/)_';
  const prompt = tpl
    .replace(/\{\{PROJECT_NAME\}\}/g,                opts.projectName)
    .replace(/\{\{TASK_ONE_LINER\}\}/g,              taskOneLiner)
    .replace(/\{\{PERSONA\}\}/g,                     meta.persona || '<请填 brief §1>')
    .replace(/\{\{SCENARIO\}\}/g,                    '<场景，从 brief §1 摘要>')
    .replace(/\{\{PAIN_POINT\}\}/g,                  meta.painPoint || '<请填 brief §1>')
    .replace(/\{\{USER_STORIES_BLOCK\}\}/g,          meta.userStoriesBlock || '_(brief §2 暂无)_')
    .replace(/\{\{IA_TREE\}\}/g,                     meta.iaTree || '<待填 brief §3>')
    .replace(/\{\{SCREEN_INVENTORY_PLACEHOLDER\}\}/g,meta.screenInventoryHeadings.length > 0
      ? meta.screenInventoryHeadings.map((h, i) => `${i + 1}. ${h}`).join('\n')
      : '_(brief §4 暂无)_')
    .replace(/\{\{VISUAL_DIRECTION\}\}/g,            meta.visualDirection || '<未填写>')
    .replace(/\{\{VISUAL_DIRECTION_RATIONALE\}\}/g,  meta.visualRationale || '<请填>')
    .replace(/\{\{TOKENS_SUMMARY\}\}/g,              renderTokensSummary(tokens))
    .replace(/\{\{ANTI_PATTERNS_BLOCK\}\}/g,         renderAntiPatternsBlockZH())
    .replace(/\{\{REFERENCES_BLOCK\}\}/g,            refsBlock)
    .replace(/\{\{STYLE_KEYWORDS\}\}/g,              meta.styleKeywords || '<待填 brief §9>');

  const promptPath = join(dir, 'prompt.md');
  writes.push({ from: '<rendered>', to: promptPath, size: prompt.length });
  if (!opts.dryRun) writeFileSync(promptPath, prompt, 'utf8');

  return { dir, writes, promptPath };
}

// 派生 v0 通道
function deriveV0(cwd, meta, opts) {
  const dir = join(cwd, '.ddt', 'design', 'v0');
  const sourcesDir = join(dir, 'v0-sources');
  const promptsDir = join(dir, 'prompts');

  if (existsSync(sourcesDir) && !opts.refresh && !opts.dryRun) {
    throw new Error(`${sourcesDir} 已存在；如需重新生成请加 --refresh`);
  }

  if (!opts.dryRun) {
    if (existsSync(sourcesDir) && opts.refresh) rmSync(sourcesDir, { recursive: true, force: true });
    if (existsSync(promptsDir) && opts.refresh) rmSync(promptsDir, { recursive: true, force: true });
    ensureDir(sourcesDir);
    ensureDir(promptsDir);
  }

  const writes = [];
  // v0 Sources 上传文件（4 个）
  const sourceCopies = [
    ['docs/api-contract.yaml',          'openapi.yaml'],
    ['docs/design-brief.md',            'design-brief.md'],
    ['.ddt/design/components-inventory.md', 'components-inventory.md'],
  ];
  for (const [src, dst] of sourceCopies) {
    const srcPath = join(cwd, src);
    const dstPath = join(sourcesDir, dst);
    writes.push({ from: srcPath, to: dstPath });
    if (!opts.dryRun && existsSync(srcPath)) copyFileSync(srcPath, dstPath);
  }

  // tokens.css（从 tokens.json 派生 CSS variables）
  const tokens = JSON.parse(readFileSync(join(cwd, '.ddt', 'design', 'tokens.json'), 'utf8'));
  const tokensCss = renderTokensCss(tokens);
  const tokensCssPath = join(sourcesDir, 'tokens.css');
  writes.push({ from: '<rendered>', to: tokensCssPath, size: tokensCss.length });
  if (!opts.dryRun) writeFileSync(tokensCssPath, tokensCss, 'utf8');

  // 渲染 project-instructions.md
  const tpl = readFileSync(TEMPLATE_PROMPTS['v0'], 'utf8');
  // v0 模板含 Project Instructions（统一）+ 每屏 prompt 的 schema 占位
  // 这里把 Project Instructions 段注入 visual + anti-patterns
  let instructions = tpl
    .replace(/\{\{PROJECT_NAME\}\}/g,               opts.projectName)
    .replace(/\{\{VISUAL_DIRECTION\}\}/g,           meta.visualDirection || '<未填写>')
    .replace(/\{\{VISUAL_DIRECTION_RATIONALE\}\}/g, meta.visualRationale || '<请填>')
    .replace(/\{\{ANTI_PATTERNS_BLOCK_EN\}\}/g,     renderAntiPatternsBlockEN())
    .replace(/\{\{STYLE_KEYWORDS\}\}/g,             meta.styleKeywords || '<待填>')
    // Screen 1 占位（W3 命令展开时会逐屏生成；本派生器先填首屏占位）
    .replace(/\{\{SCREEN_1_NAME\}\}/g,    meta.screenInventoryHeadings[0] || '<screen-1>')
    .replace(/\{\{SCREEN_1_TYPE\}\}/g,    'page')
    .replace(/\{\{SCREEN_1_ELEMENTS\}\}/g,'<elements from brief §4>')
    .replace(/\{\{SCREEN_1_STATES\}\}/g,  'default / loading / empty / error')
    .replace(/\{\{SCREEN_1_PERSONA\}\}/g, meta.persona || '<persona>')
    .replace(/\{\{SCREEN_1_MOMENT\}\}/g,  '<moment>')
    .replace(/\{\{SCREEN_1_OUTCOME\}\}/g, '<outcome>')
    .replace(/\{\{SCREEN_1_LOADING\}\}/g, 'spinner + disabled fields')
    .replace(/\{\{SCREEN_1_EMPTY\}\}/g,   'empty illustration + CTA')
    .replace(/\{\{SCREEN_1_ENDPOINT\}\}/g, meta.endpointsSummary[0] ? `'${meta.endpointsSummary[0].split(' ')[1]}'` : "'<endpoint>'");

  const instructionsPath = join(dir, 'project-instructions.md');
  writes.push({ from: '<rendered>', to: instructionsPath, size: instructions.length });
  if (!opts.dryRun) writeFileSync(instructionsPath, instructions, 'utf8');

  // 每屏 prompt（先生成首屏占位 stub，W3 命令再细化）
  if (meta.screenInventoryHeadings.length > 0) {
    for (let i = 0; i < meta.screenInventoryHeadings.length; i++) {
      const screenName = meta.screenInventoryHeadings[i];
      const stub = `# v0 Prompt for Screen ${i + 1}: ${screenName}\n\n` +
        `> 由 ddt-derive-channel-package 生成的 stub。在 W3 命令成熟后会自动填充屏级细节。\n` +
        `> 现在请参考 ../project-instructions.md 中的 "每屏 Prompt" 模板手动展开。\n`;
      const stubPath = join(promptsDir, `${String(i + 1).padStart(2, '0')}-${slugify(screenName)}.md`);
      writes.push({ from: '<rendered>', to: stubPath, size: stub.length });
      if (!opts.dryRun) writeFileSync(stubPath, stub, 'utf8');
    }
  }

  return { dir, writes, promptPath: instructionsPath };
}

function slugify(s) {
  return String(s).toLowerCase().replace(/[^\w一-龥-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

// 把 tokens.json 派生为 CSS variables（v0 Sources 用）
export function renderTokensCss(tokens) {
  const lines = ['/* generated by ddt-derive-channel-package */', ':root {'];
  if (tokens.color) {
    for (const [k, v] of Object.entries(tokens.color)) {
      lines.push(`  --color-${k}: ${v};`);
    }
  }
  if (tokens.spacing && Array.isArray(tokens.spacing)) {
    for (let i = 0; i < tokens.spacing.length; i++) {
      lines.push(`  --spacing-${i}: ${tokens.spacing[i]}px;`);
    }
  }
  if (tokens.radius) {
    for (const [k, v] of Object.entries(tokens.radius)) {
      lines.push(`  --radius-${k}: ${v};`);
    }
  }
  if (tokens.typography?.scale && Array.isArray(tokens.typography.scale)) {
    for (let i = 0; i < tokens.typography.scale.length; i++) {
      lines.push(`  --text-${i}: ${tokens.typography.scale[i]}px;`);
    }
  }
  if (tokens.typography?.['font-sans']) {
    lines.push(`  --font-sans: ${tokens.typography['font-sans']};`);
  }
  if (tokens.typography?.['font-mono']) {
    lines.push(`  --font-mono: ${tokens.typography['font-mono']};`);
  }
  lines.push('}');
  if (tokens['color-dark']) {
    lines.push('');
    lines.push('@media (prefers-color-scheme: dark) {');
    lines.push('  :root {');
    for (const [k, v] of Object.entries(tokens['color-dark'])) {
      lines.push(`    --color-${k}: ${v};`);
    }
    lines.push('  }');
    lines.push('}');
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const channel = args.channel;
  if (!channel) {
    console.error(`❌ --channel 必填：${VALID_CHANNELS.join(' / ')} | all`);
    process.exit(1);
  }
  const channels = channel === 'all' ? VALID_CHANNELS.slice() : [channel];
  for (const c of channels) {
    if (!VALID_CHANNELS.includes(c)) {
      console.error(`❌ 未知 channel: ${c}（合法：${VALID_CHANNELS.join(' / ')} / all）`);
      process.exit(1);
    }
  }

  // 必需输入
  const required = [
    ['docs/design-brief.md',          'docs/design-brief.md（先跑 /design-brief）'],
    ['docs/prd.md',                   'docs/prd.md'],
    ['docs/api-contract.yaml',        'docs/api-contract.yaml'],
    ['.ddt/tech-stack.json',          '.ddt/tech-stack.json'],
    ['.ddt/design/tokens.json',       '.ddt/design/tokens.json（先跑 /design-brief）'],
    ['.ddt/design/components-inventory.md', '.ddt/design/components-inventory.md（先跑 /design-brief）'],
  ];
  for (const [p, label] of required) {
    if (!existsSync(join(cwd, p))) {
      console.error(`❌ 必需输入缺失：${label}`);
      process.exit(2);
    }
  }

  const briefText = readFileSync(join(cwd, 'docs', 'design-brief.md'), 'utf8');
  const meta = parseBriefMeta(briefText);
  const techStack = JSON.parse(readFileSync(join(cwd, '.ddt', 'tech-stack.json'), 'utf8'));

  const opts = {
    refresh: Boolean(args.refresh),
    dryRun:  Boolean(args['dry-run']),
    projectName: techStack.preset || 'untitled',
  };

  const summary = [];
  for (const c of channels) {
    let res;
    try {
      if (c === 'claude-design') res = deriveClaudeDesign(cwd, meta, opts);
      if (c === 'figma')         res = deriveFigma(cwd, meta, opts);
      if (c === 'v0')            res = deriveV0(cwd, meta, opts);
    } catch (e) {
      console.error(`❌ ${c} 派生失败：${e.message}`);
      process.exit(3);
    }
    summary.push({ channel: c, ...res });
  }

  if (opts.dryRun) {
    console.log('--- DRY RUN ---');
    for (const s of summary) {
      console.log(`\n[${s.channel}] → ${s.dir}`);
      for (const w of s.writes) {
        console.log(`  ${w.from} → ${w.to}${w.size ? ` (${w.size} 字符)` : ''}`);
      }
    }
    process.exit(0);
  }

  console.log(`✅ 通道附件包派生完成`);
  for (const s of summary) {
    console.log(`\n[${s.channel}]`);
    console.log(`  📦 ${s.dir}`);
    console.log(`  📄 prompt: ${s.promptPath}`);
    console.log(`  📊 写入: ${s.writes.length} 个文件`);
  }
  console.log('');
  console.log(`👀 下一步：`);
  console.log(`   1. 检查 brief 中的占位（visual_direction / persona / IA / screen_inventory）已填`);
  if (channels.includes('claude-design')) {
    console.log(`   2. 打开 https://claude.ai/design 创建项目，拖入 .ddt/design/claude-design/upload-package/，粘 prompt.md`);
  }
  if (channels.includes('figma')) {
    console.log(`   2. 打开 Figma Make，上传 references，粘 .ddt/design/figma/prompt.md`);
  }
  if (channels.includes('v0')) {
    console.log(`   2. v0.dev 创建 Project，Sources 上传 .ddt/design/v0/v0-sources/，Instructions 粘 project-instructions.md`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
