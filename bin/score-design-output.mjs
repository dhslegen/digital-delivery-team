#!/usr/bin/env node
// W6: 设计稿落地 10 维客观评分
//
// 评分维度（每维 10 分，总分 100，过门阈值 70）：
//   1.  色彩系统     tokens.json 含 ≥ 3 档 neutral / 1 主色 / 1 警示色；no inline color
//   2.  排版系统     type-scale ≥ 4 档；无 Inter/Arial 系统默认
//   3.  间距网格     全部命中 tokens.spacing；无任意像素值
//   4.  组件复用     与 components-inventory.md 对照，无重复实现
//   5.  响应式       至少 sm/md/lg/xl 4 档断点
//   6.  暗色模式     tokens 双向 light + dark
//   7.  动画         每个动效有 task-purpose；无 scroll-jacking
//   8.  可访问性     aria-label / 键盘导航 / 对比度抽样
//   9.  信息密度     与 visual_direction 匹配（industrial=高密度 / luxury=低密度）
//   10. 打磨度       11 条 anti-patterns 全部未命中（每命中 1 条扣 1 分）
//
// 输入：
//   web/                            web 项目目录（默认）
//   docs/design-brief.md            含 visual_direction（用于维度 9）
//   .ddt/design/tokens.json         设计 tokens
//   .ddt/design/components-inventory.md  组件清单（用于维度 4）
//
// 输出：
//   .ddt/design/design-scorecard.json   完整评分（决策门数据来源）
//   终端 Markdown 摘要
//
// 用法：
//   node bin/score-design-output.mjs                 # 默认 web/
//   node bin/score-design-output.mjs --target apps/web/
//   node bin/score-design-output.mjs --threshold 80  # 自定义阈值
//   node bin/score-design-output.mjs --json          # 仅输出 JSON 到 stdout（CI 友好）
//
// 退出码：
//   0 = 成功（无论分数，决策由用户走决策门）
//   1 = 参数错误
//   2 = web/ 目录不存在
//   3 = brief 缺失（无法判 visual_direction 一致性）

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';

import { ANTI_PATTERNS_DETAILS } from './derive-channel-package.mjs';

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

// 递归读所有 tsx / jsx / ts / css 文件
function collectSources(dir, exts = ['.tsx', '.jsx', '.ts', '.js', '.css']) {
  const files = [];
  if (!existsSync(dir)) return files;
  function walk(p) {
    for (const entry of readdirSync(p)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
      const full = join(p, entry);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else if (exts.includes(extname(entry))) {
          files.push({ path: full, content: readFileSync(full, 'utf8') });
        }
      } catch { /* skip */ }
    }
  }
  walk(dir);
  return files;
}

// ============================================================================
// 10 维评分函数（每维返回 0-10 分）
// ============================================================================

// 1. 色彩系统
export function scoreColors(tokens, files) {
  let score = 10;
  const issues = [];
  const colors = (tokens && tokens.color) || {};
  // 必备品牌色 + 警示色
  if (!colors.primary) { score -= 3; issues.push('缺 primary 主色'); }
  if (!colors.danger)  { score -= 2; issues.push('缺 danger 警示色'); }
  // 中性色阶 ≥ 3 档
  const neutralCount = Object.keys(colors).filter(k => k.startsWith('neutral')).length;
  if (neutralCount < 3) { score -= 2; issues.push(`中性色阶仅 ${neutralCount} 档（应 ≥ 3）`); }
  // inline color 检测：jsx/tsx 中含 hex 或 rgb()
  let inlineColorCount = 0;
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx')) continue;
    const matches = f.content.match(/(?:color|background|border)\s*:\s*['"]?#[0-9A-Fa-f]{3,6}/g) || [];
    inlineColorCount += matches.length;
  }
  if (inlineColorCount > 0) {
    score -= Math.min(inlineColorCount, 3);
    issues.push(`${inlineColorCount} 处 inline hex 颜色（应用 tokens 变量）`);
  }
  return { score: Math.max(0, score), issues };
}

// 2. 排版系统
export function scoreTypography(tokens, files) {
  let score = 10;
  const issues = [];
  const typo = (tokens && tokens.typography) || {};
  const scale = Array.isArray(typo.scale) ? typo.scale : [];
  if (scale.length < 4) { score -= 3; issues.push(`type-scale 仅 ${scale.length} 档（应 ≥ 4）`); }
  // 默认字体（Inter / Arial / system-ui only）
  for (const key of ['font-sans', 'font-mono']) {
    const v = String(typo[key] || '').toLowerCase();
    if (/^(inter|arial|helvetica)\b/.test(v) || v === 'sans-serif' || v === 'monospace') {
      score -= 2;
      issues.push(`${key} 是通用默认 (${v})；按 visual_direction 选具体字体`);
    }
  }
  // jsx/css 中含 font-family: Inter / Arial（兼容 kebab-case 和 React camelCase）
  let bannedFontHits = 0;
  for (const f of files) {
    const matches = f.content.match(/font-?family\s*:\s*['"]?(?:Inter|Arial|Helvetica)\b/gi) || [];
    bannedFontHits += matches.length;
  }
  if (bannedFontHits > 0) { score -= Math.min(bannedFontHits, 3); issues.push(`${bannedFontHits} 处直接使用 Inter/Arial`); }
  return { score: Math.max(0, score), issues };
}

// 3. 间距网格
export function scoreSpacing(tokens, files) {
  let score = 10;
  const issues = [];
  const spacing = Array.isArray(tokens?.spacing) ? tokens.spacing : [];
  if (spacing.length < 6) { score -= 3; issues.push(`spacing 仅 ${spacing.length} 档（应 ≥ 6）`); }
  // 检测随意像素：margin: 13px / padding: 7px 等不在 tokens 中的值
  // 简化版：统计 tsx 中的 px 数字，看是否都命中 tokens
  let strangePxCount = 0;
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx') && !f.path.endsWith('.css')) continue;
    const matches = f.content.match(/(?:padding|margin|gap)[\w-]*\s*:\s*['"]?(\d+)px/g) || [];
    for (const m of matches) {
      const px = Number(m.match(/(\d+)px/)[1]);
      if (!spacing.includes(px) && px !== 0) strangePxCount++;
    }
  }
  if (strangePxCount > 0) {
    score -= Math.min(Math.ceil(strangePxCount / 5), 3);
    issues.push(`${strangePxCount} 处随意 px（不在 tokens.spacing 中）`);
  }
  return { score: Math.max(0, score), issues };
}

// 4. 组件复用
//
// W7.5 R12：之前的 regex 直接 match(/...g) 拿不到行号，markdown 表头分隔行 |---|---|---|
//   会被误匹配（虽然不命中 [A-Z]，但 `| <Foo> |` 这种带尖括号占位的"示例条目"或表头列名
//   含 PascalCase 词时会被算作"已登记"）。本版改成行级解析：
//   - 跳过分隔行 `|---|---|...|`
//   - 跳过紧跟 header 的 separator 后的第一行之前的所有行（即只读 body 行）
//   - 排除占位符 `<DataTable>` 中的 `_` 与 `(未扫描...)` 等明显 placeholder 行
export function scoreComponentReuse(inventoryText, files) {
  let score = 10;
  const issues = [];
  if (!inventoryText) {
    score -= 3;
    issues.push('components-inventory.md 缺失（无法对照复用率）');
    return { score: Math.max(0, score), issues };
  }
  const registered = parseInventoryComponents(inventoryText);

  // 检测 tsx 是否有同名组件多次"重新定义"
  const definedTimes = {};
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx')) continue;
    const defs = f.content.match(/(?:export\s+(?:default\s+)?function\s+|const\s+)([A-Z][A-Za-z]+)\s*[=:(]/g) || [];
    for (const def of defs) {
      const name = def.match(/([A-Z][A-Za-z]+)/)[1];
      definedTimes[name] = (definedTimes[name] || 0) + 1;
    }
  }
  for (const [name, count] of Object.entries(definedTimes)) {
    if (count > 1 && registered.has(name)) {
      score -= 2;
      issues.push(`组件 ${name} 被重新定义 ${count} 次（应复用 inventory 已登记的）`);
    }
  }
  return { score: Math.max(0, score), issues, registered: [...registered] };
}

// 解析 inventory.md 提取真实组件名（跳过分隔行 / placeholder 行）
//   markdown 表格结构：
//     | 组件 | 路径 | ... |   ← header（中文，跳过）
//     |------|------|-----|   ← separator（必跳过）
//     | Button | ... |        ← body（取首列）
export function parseInventoryComponents(text) {
  const lines = text.split('\n');
  const out = new Set();
  let inTableBody = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 检测分隔行：纯 | --- | --- | ... |（容许两端空格）
    if (/^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line)) {
      inTableBody = true;
      continue;
    }
    // 检测非表格行：重置 body 状态
    if (!/^\s*\|/.test(line)) {
      inTableBody = false;
      continue;
    }
    if (!inTableBody) continue;
    // 现在是 body 行：取首列
    const cells = line.split('|').slice(1, -1).map(c => c.trim());
    if (cells.length === 0) continue;
    const firstCell = cells[0];
    // 跳过 placeholder 行（含 _未扫描..._ / (示例条目编译时会替换) / 完全空）
    if (!firstCell || /^_\(.*\)_$/.test(firstCell) || /^_.*_$/.test(firstCell)) continue;
    if (/^\s*$/.test(firstCell)) continue;
    // 提取首列中的 PascalCase 标识符（处理 `Button` / `<DataTable>` / 反引号包裹）
    // 去掉 markdown 反引号 / 尖括号 / 反引号包裹的标签符号
    const cleaned = firstCell.replace(/[`<>]/g, '');
    const m = cleaned.match(/^([A-Z][A-Za-z0-9]+)/);
    if (m) out.add(m[1]);
  }
  return out;
}

// 5. 响应式
export function scoreResponsive(files) {
  let score = 10;
  const issues = [];
  const breakpointHits = { sm: 0, md: 0, lg: 0, xl: 0 };
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx') && !f.path.endsWith('.css')) continue;
    // Tailwind 断点 prefix
    if (/\bsm:/.test(f.content)) breakpointHits.sm++;
    if (/\bmd:/.test(f.content)) breakpointHits.md++;
    if (/\blg:/.test(f.content)) breakpointHits.lg++;
    if (/\bxl:/.test(f.content)) breakpointHits.xl++;
  }
  for (const bp of ['sm', 'md', 'lg', 'xl']) {
    if (breakpointHits[bp] === 0) {
      score -= 2;
      issues.push(`断点 ${bp}: 未使用`);
    }
  }
  return { score: Math.max(0, score), issues };
}

// 6. 暗色模式
export function scoreDarkMode(tokens, files) {
  let score = 10;
  const issues = [];
  const hasDark = tokens && tokens['color-dark'] && Object.keys(tokens['color-dark']).length > 0;
  if (!hasDark) {
    score -= 4;
    issues.push('tokens 无 color-dark 段（无暗色模式定义）');
  }
  // 检测 prefers-color-scheme 媒体查询或 dark: prefix
  let darkUsageHits = 0;
  for (const f of files) {
    if (/prefers-color-scheme:\s*dark/.test(f.content)) darkUsageHits++;
    if (/\bdark:/.test(f.content)) darkUsageHits++;
  }
  if (darkUsageHits === 0 && hasDark) {
    score -= 3;
    issues.push('tokens 有 dark 段但代码未引用（缺 dark: prefix 或 prefers-color-scheme）');
  }
  return { score: Math.max(0, score), issues };
}

// 7. 动画
export function scoreMotion(files) {
  let score = 10;
  const issues = [];
  // 检测 scroll-jacking 关键字
  let scrollJackHits = 0;
  for (const f of files) {
    if (/scroll-snap|scrollintoview|scrollSpy/i.test(f.content)) scrollJackHits++;
  }
  if (scrollJackHits > 2) {
    score -= 3;
    issues.push(`${scrollJackHits} 处疑似 scroll-jacking（应仅在关键节点）`);
  }
  // 检测 transition / animate 出现频率（< 1 表示无动效，> 50 可能滥用）
  let motionCount = 0;
  for (const f of files) {
    motionCount += (f.content.match(/\b(transition|animate|motion|framer-motion)/gi) || []).length;
  }
  if (motionCount === 0) {
    score -= 2;
    issues.push('无任何动效（建议为 hover / loading / page-transition 加微动效）');
  }
  return { score: Math.max(0, score), issues };
}

// 8. 可访问性
export function scoreA11y(files) {
  let score = 10;
  const issues = [];
  let ariaCount = 0, tabIndexCount = 0, altCount = 0, roleCount = 0;
  let imgWithoutAltCount = 0;
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx')) continue;
    ariaCount    += (f.content.match(/aria-[a-z]+\s*=/g) || []).length;
    tabIndexCount += (f.content.match(/tabIndex\s*=/g) || []).length;
    altCount     += (f.content.match(/\balt\s*=/g) || []).length;
    roleCount    += (f.content.match(/\brole\s*=/g) || []).length;
    // <img> 无 alt
    const imgs = f.content.match(/<img\b[^>]*>/g) || [];
    for (const img of imgs) {
      if (!/\balt\s*=/.test(img)) imgWithoutAltCount++;
    }
  }
  if (ariaCount === 0) { score -= 2; issues.push('无 aria-* 属性（屏幕阅读器支持差）'); }
  if (imgWithoutAltCount > 0) {
    score -= Math.min(imgWithoutAltCount, 3);
    issues.push(`${imgWithoutAltCount} 个 <img> 缺 alt 属性`);
  }
  return { score: Math.max(0, score), issues };
}

// 9. 信息密度（visual_direction 匹配）
export function scoreDensity(briefText, files) {
  let score = 10;
  const issues = [];
  // 提取 brief §8.1 visual_direction
  const vdMatch = briefText && briefText.match(/visual_direction:\s*\n\s*selected:\s*([^\s\n]+)/);
  const direction = vdMatch ? vdMatch[1].trim() : null;
  if (!direction) {
    score -= 5;
    issues.push('brief §8.1 visual_direction 未填，无法判信息密度合规');
    return { score: Math.max(0, score), issues };
  }
  // 期望密度
  const expectedDensity = ({
    'industrial':       'high',
    'brutally-minimal': 'high',
    'maximalist':       'high',
    'editorial':        'mid',
    'geometric':        'mid',
    'playful':          'mid',
    'luxury':           'low',
    'soft-organic':     'low',
    'retro-futurist':   'mid',
  })[direction] || 'mid';
  // 简化指标：tsx 中 padding/margin 平均值 — 高密度应 < 16px / 中 16-24 / 低 > 24
  let totalPx = 0, count = 0;
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx')) continue;
    const matches = f.content.match(/(?:p|px|py|m|mx|my|gap)-(\d+)/g) || [];
    for (const m of matches) {
      const n = Number(m.match(/(\d+)/)[1]);
      // Tailwind 1 unit = 4px
      totalPx += n * 4;
      count++;
    }
  }
  const avg = count > 0 ? totalPx / count : 16;
  const isHigh = avg < 16;
  const isLow  = avg > 24;
  let actual = 'mid';
  if (isHigh) actual = 'high';
  else if (isLow) actual = 'low';
  if (actual !== expectedDensity) {
    score -= 3;
    issues.push(`visual_direction=${direction} 期望密度 ${expectedDensity}，实测 ${actual}（avg padding ${avg.toFixed(1)}px）`);
  }
  return { score: Math.max(0, score), issues, direction, expectedDensity, actualDensity: actual };
}

// 10. 打磨度（anti-patterns 检测）
//
// W7.5 R12：补齐 11 条 anti-patterns（之前只覆盖 5 条，scoring 不够锋利）
//   每命中 1 条扣 1 分（max -10），与 §10.20 评分模型对齐
export function scorePolish(files) {
  let score = 10;
  const issues = [];
  const tripped = [];
  // 11 条 anti-patterns 简化检测（grep 关键词；启发式，false positive 可接受）
  const checks = [
    // 1. 紫蓝默认渐变（"AI 风" 标志）
    { id: 'purple-gradient-default', regex: /from-(?:purple|violet|indigo)-\d+\s+to-(?:blue|cyan|pink)-\d+/i,
      desc: '紫蓝默认渐变（AI slop 标志）' },
    // 2. glass morphism 滥用
    { id: 'glass-morphism-overuse',  regex: /backdrop-blur(-[a-z]+)?/g,
      desc: 'glass morphism', threshold: 5 },
    // 3. 硬编码圆角值（rounded-12 / rounded-24 等不在 design tokens 里的）
    { id: 'uniform-radius',          regex: /rounded-(?!none|full|sm|md|lg|xl|2xl|3xl)\d+/g,
      desc: '硬编码圆角值' },
    // 4. scroll-jacking（与 scoreMotion 不冲突——这里是"声明式"检测）
    { id: 'scroll-jacking',          regex: /scroll-snap-type|scrollIntoView\s*\(\s*\{[^}]*behavior:\s*['"]smooth/g,
      desc: 'scroll-jacking 关键词', threshold: 3 },
    // 5. 居中 hero 在通用渐变上
    { id: 'centered-hero-on-stock-gradient',
      regex: /min-h-screen[\s\S]{0,80}?items-center[\s\S]{0,80}?justify-center[\s\S]{0,80}?bg-gradient/,
      desc: '居中 hero on stock gradient' },
    // 6. 通用 font-sans / font-mono 大量使用（无 visual_direction 锚定）
    { id: 'generic-sans-serif',      regex: /\bfont-(?:sans|mono)\b/g,
      desc: '通用 font-sans/mono 滥用', threshold: 50 },
    // 7. 通用情绪色（saas-hero 标志：teal-500 / sky-500 / emerald-500 + warm gray 组合）
    { id: 'generic-emotional-color', regex: /\b(?:bg|text|border)-(?:teal|sky|emerald|amber)-(?:400|500|600)\b/g,
      desc: '通用情绪色（teal/sky/emerald saas 默认）', threshold: 8 },
    // 8. 可互换 saas hero（"Trusted by ..." / "Build faster with ..." 等模板文案）
    { id: 'interchangeable-saas-hero',
      regex: /(?:Trusted by|Build faster|Ship faster|Loved by|Join \d+,?\d* (?:teams|developers|companies))/i,
      desc: '可互换 saas hero 文案' },
    // 9. 通用 card 堆叠（grid grid-cols-3 + 3 个无差异 card；启发式：rounded + border + p- 同时大量出现）
    { id: 'generic-card-piles',      regex: /(?:rounded-\w+\s+border\s+p-\d+){3,}/g,
      desc: '通用 card 堆叠' },
    // 10. 随机点缀色（无 design system 的 accent；非 tokens 中定义的 hex 字面）
    { id: 'random-accent-without-system',
      regex: /(?:bg|text|border)-\[#[0-9a-f]{3,8}\]/gi,
      desc: '随机点缀色（[#xxx] arbitrary value）', threshold: 3 },
    // 11. 无目的动效（每个 button / div 都加 transition）
    { id: 'motion-without-purpose',  regex: /\btransition-all\b/g,
      desc: 'transition-all 无目的动效', threshold: 10 },
  ];
  for (const f of files) {
    if (!f.path.endsWith('.tsx') && !f.path.endsWith('.jsx')) continue;
    for (const check of checks) {
      if (tripped.includes(check.id)) continue;       // 已扣过分
      const matches = f.content.match(check.regex);
      if (matches) {
        const hits = matches.length;
        const threshold = check.threshold || 1;
        if (hits >= threshold) {
          tripped.push(check.id);
          score -= 1;
          const apIdx = ANTI_PATTERNS_DETAILS.findIndex(p => p.id === check.id);
          issues.push(`anti-pattern${apIdx >= 0 ? ' #' + (apIdx + 1) : ''} (${check.desc}) 命中（${hits} 处）`);
        }
      }
    }
  }
  return { score: Math.max(0, score), issues, tripped };
}

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const target = args.target || 'web';
  const targetPath = join(cwd, target);
  if (!existsSync(targetPath)) {
    console.error(`❌ 目标目录不存在: ${targetPath}`);
    process.exit(2);
  }

  const tokensPath    = join(cwd, '.ddt', 'design', 'tokens.json');
  const briefPath     = join(cwd, 'docs', 'design-brief.md');
  const inventoryPath = join(cwd, '.ddt', 'design', 'components-inventory.md');

  if (!existsSync(briefPath)) {
    console.error(`❌ ${briefPath} 不存在；先跑 /design-brief`);
    process.exit(3);
  }

  const tokens = existsSync(tokensPath) ? JSON.parse(readFileSync(tokensPath, 'utf8')) : null;
  const briefText = readFileSync(briefPath, 'utf8');
  const inventoryText = existsSync(inventoryPath) ? readFileSync(inventoryPath, 'utf8') : null;

  const files = collectSources(targetPath);

  // 跑 10 维评分
  const dims = {
    'colors':        scoreColors(tokens, files),
    'typography':    scoreTypography(tokens, files),
    'spacing':       scoreSpacing(tokens, files),
    'components':    scoreComponentReuse(inventoryText, files),
    'responsive':    scoreResponsive(files),
    'dark-mode':     scoreDarkMode(tokens, files),
    'motion':        scoreMotion(files),
    'a11y':          scoreA11y(files),
    'density':       scoreDensity(briefText, files),
    'polish':        scorePolish(files),
  };

  const totalScore = Object.values(dims).reduce((s, d) => s + d.score, 0);
  // 注意：args.threshold === '0' 时 Number('0') === 0 是 falsy，需显式 undefined 检查
  const threshold  = args.threshold !== undefined ? Number(args.threshold) : 70;
  const passed     = totalScore >= threshold;

  const scorecard = {
    generated_at: new Date().toISOString(),
    target,
    files_scanned: files.length,
    threshold,
    total_score: totalScore,
    max_score: 100,
    passed,
    dimensions: dims,
  };

  // 写 scorecard.json
  const outPath = join(cwd, '.ddt', 'design', 'design-scorecard.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(scorecard, null, 2), 'utf8');

  if (args.json) {
    console.log(JSON.stringify(scorecard, null, 2));
    process.exit(0);
  }

  // 终端 Markdown 摘要
  const icon = passed ? '✅' : '❌';
  console.log(`\n## 设计稿 10 维评分\n`);
  console.log(`总分: **${totalScore} / 100**`);
  console.log(`阈值: ${threshold}`);
  console.log(`状态: ${icon} ${passed ? '通过' : '未达门槛'}\n`);
  console.log(`### 分项明细\n`);
  for (const [name, d] of Object.entries(dims)) {
    const dimIcon = d.score >= 8 ? '✅' : d.score >= 5 ? '⚠️ ' : '❌';
    console.log(`${dimIcon} **${name}** ${d.score}/10`);
    if (d.issues && d.issues.length > 0) {
      for (const issue of d.issues) console.log(`   - ${issue}`);
    }
  }
  console.log(`\n📊 完整 scorecard: ${outPath}`);
  console.log(`📁 扫描文件: ${files.length} 个`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
