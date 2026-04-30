#!/usr/bin/env node
// W6: design-tokens.json → tokens-preview.html
//
// 让用户**视觉化审阅 tokens**而不是读 JSON。生成的 HTML 含：
//   - 色卡（每色样本 + hex + 暗色对比）
//   - Spacing 标尺（可视化各档间距）
//   - Type-scale 样张（每档字号 + line-height + weight）
//   - Radius / Shadow 样张
//   - Motion duration 演示
//
// 用法：
//   node bin/render-tokens-preview.mjs                # 默认从 .ddt/design/tokens.json 读
//   node bin/render-tokens-preview.mjs --in <path>    # 指定输入
//   node bin/render-tokens-preview.mjs --out <path>   # 指定输出（默认 .ddt/design/tokens-preview.html）
//   node bin/render-tokens-preview.mjs --dry-run
//
// 退出码：
//   0 = 成功
//   1 = 参数错误
//   2 = 输入文件不存在 / JSON 解析失败

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

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

// 转义 HTML 特殊字符（防 XSS / token 含 < > & 时显示错乱）
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 渲染色卡区
function renderColorSwatches(colors, title = 'Colors') {
  if (!colors || typeof colors !== 'object') return '';
  const swatches = Object.entries(colors).map(([name, value]) => {
    const safeName = esc(name);
    const safeValue = esc(value);
    return `
      <div class="swatch">
        <div class="swatch-color" style="background-color: ${safeValue}"></div>
        <div class="swatch-meta">
          <code>--color-${safeName}</code>
          <span class="swatch-hex">${safeValue}</span>
        </div>
      </div>`;
  }).join('');
  return `
    <section>
      <h2>${esc(title)}</h2>
      <div class="swatch-grid">${swatches}</div>
    </section>`;
}

function renderSpacingRulers(spacing) {
  if (!Array.isArray(spacing)) return '';
  const rows = spacing.map((px, i) => `
      <tr>
        <td><code>--spacing-${i}</code></td>
        <td>${px}px</td>
        <td><div class="ruler" style="width: ${px}px"></div></td>
      </tr>`).join('');
  return `
    <section>
      <h2>Spacing</h2>
      <table class="ruler-table">
        <thead><tr><th>Token</th><th>值</th><th>视觉</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function renderRadius(radius) {
  if (!radius || typeof radius !== 'object') return '';
  const samples = Object.entries(radius).map(([k, v]) => `
      <div class="radius-sample">
        <div class="radius-box" style="border-radius: ${esc(v)}"></div>
        <code>--radius-${esc(k)}: ${esc(v)}</code>
      </div>`).join('');
  return `
    <section>
      <h2>Radius</h2>
      <div class="radius-grid">${samples}</div>
    </section>`;
}

function renderTypography(typo) {
  if (!typo || typeof typo !== 'object') return '';
  const fontSans  = typo['font-sans']  || 'system-ui, sans-serif';
  const fontMono  = typo['font-mono']  || 'monospace';
  const fontSerif = typo['font-serif'] || 'serif';
  const scale     = Array.isArray(typo.scale) ? typo.scale : [];

  const scaleSamples = scale.map((px, i) => `
      <div class="type-sample" style="font-family: ${esc(fontSans)}; font-size: ${px}px;">
        <span class="type-token"><code>--text-${i}</code> · ${px}px</span>
        <span class="type-text">敏捷的棕色狐狸跳过懒狗 The quick brown fox jumps over the lazy dog</span>
      </div>`).join('');

  return `
    <section>
      <h2>Typography</h2>
      <p>
        <strong>Sans</strong>: <span style="font-family: ${esc(fontSans)}">${esc(fontSans)} — 敏捷的棕色狐狸 The quick brown fox</span><br/>
        <strong>Mono</strong>: <span style="font-family: ${esc(fontMono)}">${esc(fontMono)} — 0123456789 const x = 42</span><br/>
        <strong>Serif</strong>: <span style="font-family: ${esc(fontSerif)}">${esc(fontSerif)} — 敏捷的棕色狐狸 The quick brown fox</span>
      </p>
      <div class="type-scale">${scaleSamples}</div>
    </section>`;
}

function renderShadows(shadows) {
  if (!shadows || typeof shadows !== 'object') return '';
  const samples = Object.entries(shadows).map(([k, v]) => `
      <div class="shadow-sample">
        <div class="shadow-box" style="box-shadow: ${esc(v)}"></div>
        <code>--shadow-${esc(k)}</code>
      </div>`).join('');
  return `
    <section>
      <h2>Shadows</h2>
      <div class="shadow-grid">${samples}</div>
    </section>`;
}

function renderMotion(motion) {
  if (!motion || typeof motion !== 'object') return '';
  const durations = motion.duration || {};
  const samples = Object.entries(durations).map(([k, v]) => `
      <div class="motion-sample">
        <div class="motion-box" style="--motion-duration: ${esc(v)}; animation-duration: ${esc(v)}"></div>
        <code>--motion-${esc(k)}: ${esc(v)}</code>
      </div>`).join('');
  return `
    <section>
      <h2>Motion</h2>
      <p style="font-size: 14px; color: #6e7781">悬停时观察动画速度差异</p>
      <div class="motion-grid">${samples}</div>
    </section>`;
}

export function renderTokensHtml(tokens) {
  const hasDark = tokens['color-dark'] && Object.keys(tokens['color-dark']).length > 0;
  const css = `
    :root {
      --bg: #ffffff; --fg: #1f2328; --muted: #6e7781; --border: #d0d7de;
    }
    @media (prefers-color-scheme: dark) {
      :root { --bg: #0d1117; --fg: #f0f6fc; --muted: #8b949e; --border: #30363d; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: ui-sans-serif, system-ui, sans-serif;
      background: var(--bg); color: var(--fg);
      max-width: 1200px; margin: 0 auto; padding: 32px 24px;
      line-height: 1.6;
    }
    h1 { font-size: 28px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin: 32px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
    code { font-family: ui-monospace, monospace; font-size: 12px; background: var(--border); padding: 2px 6px; border-radius: 4px; opacity: 0.8; }
    section { margin-bottom: 32px; }
    .swatch-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .swatch { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
    .swatch-color { height: 64px; }
    .swatch-meta { padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
    .swatch-hex { color: var(--muted); }
    .ruler-table { width: 100%; border-collapse: collapse; }
    .ruler-table th, .ruler-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 14px; }
    .ruler { height: 12px; background: linear-gradient(90deg, #1f6feb 0%, #1f6feb 100%); border-radius: 2px; }
    .radius-grid, .shadow-grid, .motion-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 16px; }
    .radius-sample, .shadow-sample, .motion-sample { display: flex; flex-direction: column; align-items: center; gap: 8px; }
    .radius-box { width: 64px; height: 64px; background: #1f6feb; }
    .shadow-box { width: 64px; height: 64px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
    .motion-box { width: 64px; height: 64px; background: #1f6feb; border-radius: 8px; transition: transform var(--motion-duration, 200ms) ease; }
    .motion-sample:hover .motion-box { transform: scale(1.4); }
    .type-sample { padding: 8px 0; border-bottom: 1px dashed var(--border); display: flex; align-items: baseline; gap: 16px; }
    .type-token { font-size: 12px; color: var(--muted); flex-shrink: 0; min-width: 140px; }
    .type-text { flex: 1; }
    .meta { color: var(--muted); font-size: 14px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
  `;

  const sections = [
    renderColorSwatches(tokens.color,        'Colors (Light)'),
    hasDark ? renderColorSwatches(tokens['color-dark'], 'Colors (Dark)') : '',
    renderSpacingRulers(tokens.spacing),
    renderRadius(tokens.radius),
    renderTypography(tokens.typography),
    renderShadows(tokens.shadow),
    renderMotion(tokens.motion),
  ].filter(Boolean).join('');

  const meta = `
    <div class="meta">
      Generated by <code>ddt-render-tokens-preview</code> ·
      schema v${tokens.version || '1.0.0'} ·
      ${new Date().toISOString()}
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>Design Tokens Preview</title>
<style>${css}</style>
</head>
<body>
<h1>Design Tokens Preview</h1>
<p class="meta">视觉化审阅 <code>.ddt/design/tokens.json</code>。审阅 brief 时**务必打开本页**，不要只读 JSON。</p>
${sections}
${meta}
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();

  const inPath = args.in || join(cwd, '.ddt', 'design', 'tokens.json');
  const outPath = args.out || join(cwd, '.ddt', 'design', 'tokens-preview.html');

  if (!existsSync(inPath)) {
    console.error(`❌ tokens 文件不存在: ${inPath}`);
    console.error(`   请先跑 /design-brief（会复制 tokens 模板到 .ddt/design/tokens.json）`);
    process.exit(2);
  }

  let tokens;
  try {
    tokens = JSON.parse(readFileSync(inPath, 'utf8'));
  } catch (e) {
    console.error(`❌ tokens.json 解析失败: ${e.message}`);
    process.exit(2);
  }

  const html = renderTokensHtml(tokens);

  if (args['dry-run']) {
    console.log(`--- DRY RUN ---`);
    console.log(`输入: ${inPath} (${readFileSync(inPath, 'utf8').length} 字符)`);
    console.log(`输出: ${outPath} (${html.length} 字符)`);
    process.exit(0);
  }

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, html, 'utf8');

  console.log(`✅ Tokens preview 已生成`);
  console.log(`   📄 ${outPath}`);
  console.log(`   📊 ${html.length} 字符`);
  console.log('');
  console.log(`👀 用浏览器打开:`);
  console.log(`   open ${outPath}     (macOS)`);
  console.log(`   xdg-open ${outPath} (Linux)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
