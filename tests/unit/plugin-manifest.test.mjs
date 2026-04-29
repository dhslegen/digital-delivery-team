import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const PLUGIN_JSON = join(ROOT, '.claude-plugin', 'plugin.json');
const MARKETPLACE_JSON = join(ROOT, '.claude-plugin', 'marketplace.json');
const PACKAGE_JSON = join(ROOT, 'package.json');

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

// H8: description 字段中的"N 命令 / N skill"必须与磁盘真实数量一致，
//     否则发版时会把"17 命令 + 9 skill"这种过期描述带到插件市场（v0.6.x → v0.7.0 实测过）
function countCommands() {
  return readdirSync(join(ROOT, 'commands')).filter(f => f.endsWith('.md')).length;
}
function countSkills() {
  return readdirSync(join(ROOT, 'skills')).filter(name => {
    try { return statSync(join(ROOT, 'skills', name)).isDirectory(); } catch { return false; }
  }).length;
}
function extractCount(text, label) {
  // 匹配类似 "19 命令"、"19 个命令"、"11 skill"、"11 个 skill"、"11 技能"
  const re = new RegExp(`(\\d+)\\s*(?:个\\s*)?${label}`);
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

test('manifest description 中的命令/skill 数量与磁盘一致 (H8)', () => {
  const cmdCount = countCommands();
  const skillCount = countSkills();

  const sources = [
    { name: 'plugin.json',      desc: JSON.parse(readFileSync(PLUGIN_JSON, 'utf8')).description },
    { name: 'marketplace.json', desc: JSON.parse(readFileSync(MARKETPLACE_JSON, 'utf8')).plugins[0].description },
    { name: 'package.json',     desc: JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).description },
  ];

  for (const { name, desc } of sources) {
    const cmd = extractCount(desc, '命令');
    const skill = extractCount(desc, 'skill') ?? extractCount(desc, '技能');
    assert.equal(cmd, cmdCount,
      `${name} description 命令数 ${cmd} ≠ commands/ 实际 ${cmdCount}\nDesc: ${desc}`);
    assert.equal(skill, skillCount,
      `${name} description skill 数 ${skill} ≠ skills/ 实际 ${skillCount}\nDesc: ${desc}`);
  }
});
