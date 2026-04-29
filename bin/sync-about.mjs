#!/usr/bin/env node
// 把 .claude-plugin/plugin.json 当 GitHub About 的唯一真相源。
//   --check   校验 description 中数字 vs 文件系统；校验 GitHub About 是否与 plugin.json 一致
//   --apply   把 plugin.json description 推到 GitHub About
//   (默认)    dry-run，打印当前与目标的 diff

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLUGIN_JSON = path.join(ROOT, '.claude-plugin', 'plugin.json');
const PKG_JSON    = path.join(ROOT, 'package.json');
const MARKET_JSON = path.join(ROOT, '.claude-plugin', 'marketplace.json');

const ABOUT_MAX = 350;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function countDir(dir, filter) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(filter).length;
}

function actualCounts() {
  return {
    agents:   countDir(path.join(ROOT, 'agents'),   f => f.endsWith('.md')),
    commands: countDir(path.join(ROOT, 'commands'), f => f.endsWith('.md')),
    skills:   countDir(path.join(ROOT, 'skills'),   name => {
      try { return fs.statSync(path.join(ROOT, 'skills', name)).isDirectory(); } catch { return false; }
    }),
  };
}

// 解析 "8 子代理 + 19 命令 + 11 skill" 这种结构（中英文数字）
function parseDeclaredCounts(desc) {
  const num = (re) => {
    const m = desc.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    agents:   num(/(\d+)\s*(?:个\s*)?子代理/),
    commands: num(/(\d+)\s*(?:个\s*)?命令/),
    skills:   num(/(\d+)\s*(?:个\s*)?skill/i),
  };
}

function parseRepoSlug(plugin) {
  const url = plugin?.repository || readJson(MARKET_JSON).plugins?.[0]?.repository;
  if (!url) return null;
  const m = url.match(/github\.com[:\/]([^\/]+)\/([^\/.]+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function checkConsistency() {
  const plugin = readJson(PLUGIN_JSON);
  const pkg    = readJson(PKG_JSON);
  const market = readJson(MARKET_JSON);
  const declared = parseDeclaredCounts(plugin.description);
  const actual = actualCounts();

  const errors = [];
  for (const k of ['agents', 'commands', 'skills']) {
    if (declared[k] === null) {
      errors.push(`plugin.json description 未声明 ${k} 数量（无法解析）`);
    } else if (declared[k] !== actual[k]) {
      errors.push(`${k}: plugin.json 声明 ${declared[k]}，实际 ${actual[k]}`);
    }
  }

  // 三个 manifest 中的"X 子代理 / X 命令 / X skill"必须一致
  const sources = { 'plugin.json': plugin.description, 'package.json': pkg.description, 'marketplace.json': market.plugins?.[0]?.description ?? '' };
  for (const [name, desc] of Object.entries(sources)) {
    const dc = parseDeclaredCounts(desc);
    for (const k of ['agents', 'commands', 'skills']) {
      if (dc[k] !== null && dc[k] !== actual[k]) {
        errors.push(`${name} 中 ${k} 数量 ${dc[k]} 与实际 ${actual[k]} 不一致`);
      }
    }
  }

  return { errors, declared, actual, plugin };
}

function getRemoteAbout(slug) {
  try {
    const out = execFileSync('gh', ['repo', 'view', slug, '--json', 'description,homepageUrl'], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    return null;
  }
}

function applyAbout(slug, description, homepage) {
  if (description.length > ABOUT_MAX) {
    throw new Error(`description 长度 ${description.length} 超过 GitHub About 上限 ${ABOUT_MAX}`);
  }
  const args = ['repo', 'edit', slug, '--description', description];
  if (homepage) args.push('--homepage', homepage);
  execFileSync('gh', args, { stdio: 'inherit' });
}

const mode = process.argv[2] || 'dry-run';
const { errors, actual, plugin } = checkConsistency();
const slug = parseRepoSlug(plugin);

if (errors.length) {
  console.error('❌ 元信息一致性检查失败:');
  for (const e of errors) console.error(`  - ${e}`);
  if (mode === '--check' || mode === '--apply') process.exit(1);
}

const targetDesc     = plugin.description;
const targetHomepage = `https://github.com/${slug}#5-分钟上手`;

console.log(`✅ 实际数量: ${actual.agents} agents / ${actual.commands} commands / ${actual.skills} skills`);

if (mode === '--check') {
  if (!slug) { console.error('❌ 无法解析 GitHub repo slug'); process.exit(1); }
  const remote = getRemoteAbout(slug);
  if (!remote) { console.error(`⚠️  无法读取 GitHub About（gh 未登录或 ${slug} 不可访问），跳过远程比对`); process.exit(0); }
  const driftErrors = [];
  if (remote.description !== targetDesc) driftErrors.push(`description drift\n    remote: ${remote.description}\n    target: ${targetDesc}`);
  if (remote.homepageUrl !== targetHomepage) driftErrors.push(`homepage drift\n    remote: ${remote.homepageUrl}\n    target: ${targetHomepage}`);
  if (driftErrors.length) {
    console.error('❌ GitHub About 与 plugin.json 不一致:');
    for (const e of driftErrors) console.error(`  - ${e}`);
    console.error('\n  跑 `node bin/sync-about.mjs --apply` 修复');
    process.exit(1);
  }
  console.log('✅ GitHub About 与 plugin.json 完全一致');
  process.exit(0);
}

if (mode === '--apply') {
  if (!slug) { console.error('❌ 无法解析 GitHub repo slug'); process.exit(1); }
  console.log(`▶ 同步 GitHub About → ${slug}`);
  console.log(`  description: ${targetDesc}`);
  console.log(`  homepage:    ${targetHomepage}`);
  applyAbout(slug, targetDesc, targetHomepage);
  console.log('✅ 已同步');
  process.exit(0);
}

// 默认 dry-run
console.log(`\nGitHub About 目标值（用 --apply 同步）:`);
console.log(`  slug:        ${slug}`);
console.log(`  description: ${targetDesc}`);
console.log(`  homepage:    ${targetHomepage}`);
console.log(`  长度:        ${targetDesc.length} / ${ABOUT_MAX}`);
