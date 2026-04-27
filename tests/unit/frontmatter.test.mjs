import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { _exists: false, _keys: new Set() };
  const fm = { _exists: true, _keys: new Set() };
  for (const line of m[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    fm[key] = val;
    fm._keys.add(key);
  }
  return fm;
}

test('agents frontmatter has name / description / tools / model', () => {
  const dir = join(ROOT, 'agents');
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  assert.ok(files.length > 0, 'no agent files found');
  for (const file of files) {
    const fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    for (const field of ['name', 'description', 'tools', 'model']) {
      assert.ok(fm._keys.has(field), `agents/${file}: frontmatter missing '${field}'`);
    }
  }
});

test('agents reference rules/delivery/agent-invariants.md', () => {
  const dir = join(ROOT, 'agents');
  for (const file of readdirSync(dir).filter(f => f.endsWith('.md'))) {
    const content = readFileSync(join(dir, file), 'utf8');
    assert.ok(
      content.includes('rules/delivery/agent-invariants.md'),
      `agents/${file}: does not reference rules/delivery/agent-invariants.md`
    );
  }
});

test('skills SKILL.md frontmatter has name / description / origin=DDT', () => {
  const dir = join(ROOT, 'skills');
  const skillDirs = readdirSync(dir).filter(n => statSync(join(dir, n)).isDirectory());
  assert.ok(skillDirs.length > 0, 'no skill directories found');
  for (const name of skillDirs) {
    const file = join(dir, name, 'SKILL.md');
    const fm = parseFrontmatter(readFileSync(file, 'utf8'));
    for (const field of ['name', 'description', 'origin']) {
      assert.ok(fm._keys.has(field), `skills/${name}/SKILL.md: frontmatter missing '${field}'`);
    }
    assert.equal(fm.origin, 'DDT', `skills/${name}/SKILL.md: origin must be 'DDT', got '${fm.origin}'`);
  }
});

test('commands frontmatter has description and argument-hint', () => {
  const dir = join(ROOT, 'commands');
  const files = readdirSync(dir).filter(f => f.endsWith('.md'));
  assert.ok(files.length > 0, 'no command files found');
  for (const file of files) {
    const fm = parseFrontmatter(readFileSync(join(dir, file), 'utf8'));
    for (const field of ['description', 'argument-hint']) {
      assert.ok(fm._keys.has(field), `commands/${file}: frontmatter missing '${field}'`);
    }
  }
});
