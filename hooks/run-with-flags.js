#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { isHookEnabled } = require('./lib/hook-flags');

const MAX_STDIN = 1024 * 1024;

function readStdinRaw() {
  return new Promise(resolve => {
    let raw = '';
    let truncated = false;
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (raw.length < MAX_STDIN) {
        const remaining = MAX_STDIN - raw.length;
        raw += chunk.substring(0, remaining);
        if (chunk.length > remaining) {
          truncated = true;
        }
      } else {
        truncated = true;
      }
    });
    process.stdin.on('end', () => resolve({ raw, truncated }));
    process.stdin.on('error', () => resolve({ raw, truncated }));
  });
}

function writeStderr(stderr) {
  if (typeof stderr === 'string' && stderr.length > 0) {
    process.stderr.write(stderr.endsWith('\n') ? stderr : `${stderr}\n`);
  }
}

function emitHookResult(raw, output) {
  if (typeof output === 'string' || Buffer.isBuffer(output)) {
    process.stdout.write(String(output));
    return 0;
  }

  if (output && typeof output === 'object') {
    writeStderr(output.stderr);

    if (Object.prototype.hasOwnProperty.call(output, 'stdout')) {
      process.stdout.write(String(output.stdout ?? ''));
    } else if (!Number.isInteger(output.exitCode) || output.exitCode === 0) {
      process.stdout.write(raw);
    }

    return Number.isInteger(output.exitCode) ? output.exitCode : 0;
  }

  process.stdout.write(raw);
  return 0;
}

function writeLegacySpawnOutput(raw, result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  if (stdout) {
    process.stdout.write(stdout);
    return;
  }

  if (Number.isInteger(result.status) && result.status === 0) {
    process.stdout.write(raw);
  }
}

function getPluginRoot() {
  if (process.env.DDT_PLUGIN_ROOT && process.env.DDT_PLUGIN_ROOT.trim()) {
    return process.env.DDT_PLUGIN_ROOT.trim();
  }

  if (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT.trim()) {
    return process.env.CLAUDE_PLUGIN_ROOT.trim();
  }

  return path.resolve(__dirname, '..');
}

async function main() {
  const [, , hookId, relScriptPath, profilesCsv] = process.argv;
  const { raw, truncated } = await readStdinRaw();

  if (!hookId || !relScriptPath) {
    process.stdout.write(raw);
    process.exit(0);
  }

  if (!isHookEnabled(hookId, { profiles: profilesCsv })) {
    process.stdout.write(raw);
    process.exit(0);
  }

  const pluginRoot = getPluginRoot();
  const resolvedRoot = path.resolve(pluginRoot);
  const scriptPath = path.resolve(pluginRoot, relScriptPath);

  if (
    scriptPath !== resolvedRoot &&
    !scriptPath.startsWith(resolvedRoot + path.sep)
  ) {
    writeStderr(`[DDT Hook] Path traversal rejected for ${hookId}: ${scriptPath}`);
    process.stdout.write(raw);
    process.exit(0);
  }

  if (!fs.existsSync(scriptPath)) {
    writeStderr(`[DDT Hook] Script not found for ${hookId}: ${scriptPath}`);
    process.stdout.write(raw);
    process.exit(0);
  }

  let hookModule;
  const source = fs.readFileSync(scriptPath, 'utf8');
  const hasRunExport = /\bmodule\.exports\b/.test(source) && /\brun\b/.test(source);

  if (hasRunExport) {
    try {
      hookModule = require(scriptPath);
    } catch (error) {
      writeStderr(`[DDT Hook] require() failed for ${hookId}: ${error.message}`);
    }
  }

  if (hookModule && typeof hookModule.run === 'function') {
    try {
      const output = hookModule.run(raw, { truncated, maxStdin: MAX_STDIN });
      process.exit(emitHookResult(raw, output));
    } catch (error) {
      writeStderr(`[DDT Hook] run() error for ${hookId}: ${error.message}`);
      process.stdout.write(raw);
      process.exit(0);
    }
  }

  const result = spawnSync(process.execPath, [scriptPath], {
    input: raw,
    encoding: 'utf8',
    env: {
      ...process.env,
      DDT_HOOK_INPUT_TRUNCATED: truncated ? '1' : '0',
      DDT_HOOK_INPUT_MAX_BYTES: String(MAX_STDIN),
    },
    cwd: process.cwd(),
    timeout: 30000,
    windowsHide: true,
  });

  writeLegacySpawnOutput(raw, result);
  writeStderr(result.stderr);

  if (result.error || result.signal || result.status === null) {
    const reason = result.error
      ? result.error.message
      : result.signal
        ? `terminated by signal ${result.signal}`
        : 'missing exit status';
    writeStderr(`[DDT Hook] legacy hook execution failed for ${hookId}: ${reason}`);
    process.exit(1);
  }

  process.exit(Number.isInteger(result.status) ? result.status : 0);
}

main().catch(error => {
  writeStderr(`[DDT Hook] run-with-flags error: ${error.message}`);
  process.exit(0);
});
