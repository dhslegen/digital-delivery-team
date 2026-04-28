#!/usr/bin/env node
// M2-1: DDT plugin root 解析器（commands 共享）
// 输出（stdout）：插件根目录绝对路径
// 退出码：0 = 找到；1 = 找不到（stderr 写错误信息）
//
// 优先级：
//   1. $DDT_PLUGIN_ROOT 或 $CLAUDE_PLUGIN_ROOT 环境变量
//   2. $HOME/.claude/plugins/{digital-delivery-team, digital-delivery-team@digital-delivery-team, marketplace/digital-delivery-team}
//   3. $HOME/.claude/plugins/cache/<publisher>/digital-delivery-team/<version>/
//   4. 自身相对路径（dev 模式：bin/ 的父目录）
//
// 命令侧用法：
//   DDT_PLUGIN_ROOT="$(node "$DDT_PLUGIN_ROOT_HINT/bin/find-plugin-root.mjs" 2>/dev/null)" \
//     || DDT_PLUGIN_ROOT="$HOME/.claude/plugins/digital-delivery-team"
//
// 或更简单（在已知一个候选 hint 的情况下）：
//   DDT_PLUGIN_ROOT="$(node /path/to/find-plugin-root.mjs)" || exit 1
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SLUG = 'digital-delivery-team';
const REQUIRED_MARKER = join('bin', 'aggregate.mjs');

function isValidRoot(candidate) {
  return Boolean(candidate) && existsSync(join(candidate, REQUIRED_MARKER));
}

function tryEnv() {
  for (const key of ['DDT_PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']) {
    const value = process.env[key];
    if (value && value.trim() && isValidRoot(value.trim())) {
      return resolve(value.trim());
    }
  }
  return null;
}

function tryStandardPaths() {
  const home = join(homedir(), '.claude');
  const candidates = [
    join(home, 'plugins', SLUG),
    join(home, 'plugins', `${SLUG}@${SLUG}`),
    join(home, 'plugins', 'marketplace', SLUG),    // 单数（旧）
    join(home, 'plugins', 'marketplaces', SLUG),   // 复数（v2.1+ Claude Code marketplace 实际目录）
  ];
  for (const candidate of candidates) {
    if (isValidRoot(candidate)) return candidate;
  }
  return null;
}

// M5-5: marketplaces/<marketplace-name>/<plugin-name> 通配扫描
//   覆盖：marketplace 与 plugin 不同名（如 publisher-x/digital-delivery-team），
//   或 marketplace 直接就是 plugin 本身（如 marketplaces/digital-delivery-team）。
function tryMarketplacesDir() {
  const ms = join(homedir(), '.claude', 'plugins', 'marketplaces');
  if (!existsSync(ms)) return null;
  try {
    for (const m of readdirSync(ms, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      const direct = join(ms, m.name);
      if (isValidRoot(direct)) return direct;
      const nested = join(ms, m.name, SLUG);
      if (isValidRoot(nested)) return nested;
    }
  } catch { /* ignore */ }
  return null;
}

function tryCacheDir() {
  const cacheBase = join(homedir(), '.claude', 'plugins', 'cache');
  if (!existsSync(cacheBase)) return null;
  try {
    for (const pubEntry of readdirSync(cacheBase, { withFileTypes: true })) {
      if (!pubEntry.isDirectory()) continue;
      const pluginDir = join(cacheBase, pubEntry.name, SLUG);
      if (!existsSync(pluginDir)) continue;
      for (const verEntry of readdirSync(pluginDir, { withFileTypes: true })) {
        if (!verEntry.isDirectory()) continue;
        const candidate = join(pluginDir, verEntry.name);
        if (isValidRoot(candidate)) return candidate;
      }
    }
  } catch {
    // 缓存目录访问失败可忽略
  }
  return null;
}

function trySelfRelative() {
  // dev 模式：本脚本位于 <root>/bin/，父目录就是 root
  const candidate = resolve(__dirname, '..');
  if (isValidRoot(candidate)) return candidate;
  return null;
}

function resolvePluginRoot() {
  return tryEnv() || tryStandardPaths() || tryMarketplacesDir() || tryCacheDir() || trySelfRelative();
}

const root = resolvePluginRoot();
if (root) {
  process.stdout.write(root + '\n');
  process.exit(0);
}
process.stderr.write(
  '❌ DDT plugin root not found. Set DDT_PLUGIN_ROOT or install via marketplace.\n'
);
process.exit(1);
