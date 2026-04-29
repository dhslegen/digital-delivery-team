import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PLUGIN_JSON = join(ROOT, '.claude-plugin', 'plugin.json');

test('bin/manifest.mjs --check exits 0 (manifest matches filesystem)', () => {
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'bin', 'manifest.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    process.stderr.write(`stdout: ${result.stdout}\n`);
    process.stderr.write(`stderr: ${result.stderr}\n`);
  }
  assert.equal(result.status, 0, `manifest --check failed:\n${result.stderr}`);
});

test('plugin.json uses top-level component paths', () => {
  const plugin = JSON.parse(readFileSync(PLUGIN_JSON, 'utf8'));
  assert.deepEqual(plugin.skills, ['./skills/']);
  assert.deepEqual(plugin.commands, ['./commands/']);
  assert.ok(!('agents' in plugin), 'agents are auto-discovered by convention');
  assert.ok(!('components' in plugin), 'components must not be the plugin loading surface');
  assert.ok(!('hooks' in plugin), 'hooks/hooks.json is auto-loaded by convention');
  assert.ok(!('authors' in plugin), 'use author, not authors');
});
