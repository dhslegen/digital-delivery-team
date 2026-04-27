import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const HOOKS_JSON = join(ROOT, 'hooks', 'hooks.json');

function collectOuterEntries(hooks) {
  const entries = [];
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      entries.push({ event, entry });
    }
  }
  return entries;
}

test('hooks.json is valid JSON', () => {
  const raw = readFileSync(HOOKS_JSON, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'hooks.json must be valid JSON');
});

test('hooks.json has a "hooks" object', () => {
  const data = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  assert.ok(data.hooks && typeof data.hooks === 'object', 'hooks.json must have a "hooks" object');
});

test('each outer entry has a unique id', () => {
  const data = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const entries = collectOuterEntries(data.hooks);
  const ids = new Set();
  for (const { event, entry } of entries) {
    assert.ok(entry.id, `${event} entry missing 'id' field`);
    assert.ok(!ids.has(entry.id), `Duplicate hook id: '${entry.id}'`);
    ids.add(entry.id);
  }
});

test('each inner hook command uses ECC-style inline DDT bootstrap', () => {
  const data = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const entries = collectOuterEntries(data.hooks);
  for (const { entry } of entries) {
    for (const hook of (entry.hooks || [])) {
      if (!hook.command) continue;
      assert.ok(hook.command.startsWith('node -e '), `hook '${entry.id}' must use inline node bootstrap`);
      assert.ok(hook.command.includes('DDT_PLUGIN_ROOT'), `hook '${entry.id}' must resolve DDT_PLUGIN_ROOT`);
      assert.ok(hook.command.includes('plugin-hook-bootstrap.js'), `hook '${entry.id}' must route through bootstrap`);
      assert.ok(!hook.command.includes('${CLAUDE_PLUGIN_ROOT}'), `hook '${entry.id}' must not use raw shell placeholders`);
    }
  }
});

test('handler files referenced in hook commands exist', () => {
  const data = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
  const entries = collectOuterEntries(data.hooks);
  for (const { entry } of entries) {
    for (const hook of (entry.hooks || [])) {
      if (!hook.command) continue;
      const m = hook.command.match(/hooks\/handlers\/(\S+\.js)/);
      if (!m) continue;
      const handlerPath = join(ROOT, 'hooks', 'handlers', m[1]);
      assert.ok(
        existsSync(handlerPath),
        `hook '${entry.id}': handler file '${m[1]}' does not exist at ${handlerPath}`
      );
    }
  }
});
