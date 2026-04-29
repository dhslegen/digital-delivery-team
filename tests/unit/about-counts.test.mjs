import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');

function countDir(dir, filter) {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(filter).length;
}

function actualCounts() {
  return {
    agents:   countDir(join(ROOT, 'agents'),   f => f.endsWith('.md')),
    commands: countDir(join(ROOT, 'commands'), f => f.endsWith('.md')),
    skills:   countDir(join(ROOT, 'skills'),   name => {
      try { return statSync(join(ROOT, 'skills', name)).isDirectory(); } catch { return false; }
    }),
  };
}

function parseDeclared(desc) {
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

const SOURCES = [
  { name: '.claude-plugin/plugin.json',      get: () => JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8')).description },
  { name: 'package.json',                    get: () => JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).description },
  { name: '.claude-plugin/marketplace.json', get: () => JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8')).plugins[0].description },
];

test('plugin.json description 中的资源数量与文件系统一致', () => {
  const actual = actualCounts();
  const desc = SOURCES[0].get();
  const declared = parseDeclared(desc);
  assert.equal(declared.agents, actual.agents, `agents: declared ${declared.agents}, actual ${actual.agents}`);
  assert.equal(declared.commands, actual.commands, `commands: declared ${declared.commands}, actual ${actual.commands}`);
  assert.equal(declared.skills, actual.skills, `skills: declared ${declared.skills}, actual ${actual.skills}`);
});

test('package.json / marketplace.json 数字与 plugin.json 一致', () => {
  const actual = actualCounts();
  for (const src of SOURCES) {
    const declared = parseDeclared(src.get());
    for (const k of ['agents', 'commands', 'skills']) {
      if (declared[k] !== null) {
        assert.equal(declared[k], actual[k], `${src.name} 中 ${k} 数量 ${declared[k]} 与实际 ${actual[k]} 不一致`);
      }
    }
  }
});

test('bin/sync-about.mjs --check 不报本地不一致', () => {
  // 仅检查本地一致性；远程比对依赖 gh，CI 无凭据时会跳过远程检查（exit 0）
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'bin', 'sync-about.mjs'), '--check'],
    { cwd: ROOT, encoding: 'utf8' }
  );
  // status 0：远程一致或无 gh
  // status 1：本地不一致或远程 drift；本测试只关注本地一致性，远程 drift 不应导致 fail
  if (result.status !== 0 && /元信息一致性检查失败/.test(result.stderr)) {
    assert.fail(`本地一致性失败:\n${result.stderr}`);
  }
});
