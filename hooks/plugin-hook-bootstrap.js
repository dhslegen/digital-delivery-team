#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

function ok(r) {
  return r && fs.existsSync(path.join(r, 'hooks', 'plugin-hook-bootstrap.js'));
}

function resolveRoot() {
  // Priority 0: self-locate via __dirname — always correct when installed via marketplace or --plugin-dir
  const byLocation = path.resolve(__dirname, '..');
  if (ok(byLocation)) return byLocation;

  // Priority 1: explicit env override (dev / CI usage only)
  const env = process.env.DDT_PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT;
  if (ok(env)) return path.resolve(env);

  const home = path.join(os.homedir(), '.claude');

  // Priority 2: standard named install paths
  const candidates = [
    path.join(home, 'plugins', 'digital-delivery-team'),
    path.join(home, 'plugins', 'digital-delivery-team@digital-delivery-team'),
    path.join(home, 'plugins', 'marketplace', 'digital-delivery-team'),
    path.join(home, 'plugins', 'marketplaces', 'digital-delivery-team'),
  ];
  for (const r of candidates) {
    if (ok(r)) return r;
  }

  // Priority 3: marketplaces directory walk — covers marketplace-named-after-other-publisher case
  try {
    const ms = path.join(home, 'plugins', 'marketplaces');
    for (const m of fs.readdirSync(ms, { withFileTypes: true })) {
      if (!m.isDirectory()) continue;
      const direct = path.join(ms, m.name);
      if (ok(direct)) return direct;
      const nested = path.join(ms, m.name, 'digital-delivery-team');
      if (ok(nested)) return nested;
    }
  } catch (_) {}

  // Priority 4: marketplace cache — correct structure: cache/<publisher>/digital-delivery-team/<version>/
  try {
    const cacheBase = path.join(home, 'plugins', 'cache');
    for (const pub of fs.readdirSync(cacheBase, { withFileTypes: true })) {
      if (!pub.isDirectory()) continue;
      const pluginDir = path.join(cacheBase, pub.name, 'digital-delivery-team');
      if (!fs.existsSync(pluginDir)) continue;
      for (const v of fs.readdirSync(pluginDir, { withFileTypes: true })) {
        if (!v.isDirectory()) continue;
        const r = path.join(pluginDir, v.name);
        if (ok(r)) return r;
      }
    }
  } catch (_) {}

  return path.resolve(__dirname, '..');
}

function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function writeStderr(msg) {
  if (msg && msg.length > 0) {
    process.stderr.write(msg.endsWith('\n') ? msg : `${msg}\n`);
  }
}

function main() {
  const [, , hookId, handlerRel, profilesRaw] = process.argv;

  if (!hookId || !handlerRel) {
    process.stdin.pipe(process.stdout);
    return;
  }

  const raw = readStdinSync();
  const root = resolveRoot();
  process.env.DDT_PLUGIN_ROOT = root;
  process.env.CLAUDE_PLUGIN_ROOT = root;

  const result = spawnSync(
    process.execPath,
    [path.join(root, 'hooks', 'run-with-flags.js'), hookId, handlerRel, profilesRaw || ''],
    {
      input: raw,
      encoding: 'utf8',
      env: { ...process.env },
      cwd: process.cwd(),
      timeout: 30000,
      windowsHide: true,
    }
  );

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    process.stdout.write(stdout);
  } else if (!Number.isInteger(result.status) || result.status === 0) {
    process.stdout.write(raw);
  }

  writeStderr(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `terminated by signal ${result.signal}`
        : 'missing exit status';
    writeStderr(`[DDT Hook] bootstrap execution failed: ${reason}`);
    process.exit(0);
  }

  process.exit(Number.isInteger(result.status) ? result.status : 0);
}

main();
