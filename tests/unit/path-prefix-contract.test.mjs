// v0.9.3 D19 / D21：commands + agents 中"plugin 内资源"引用必须显式 $DDT_PLUGIN_ROOT/ 前缀
//
// 实战 v0.9.2 暴露：LLM 跑 /prd 时去项目根找 templates/（找不到说"templates 不存在"），
// 但模板实际在 plugin 根。根因是 commands 文档写 `templates/xxx.template.md` 没显式前缀，
// 让 LLM 误读为项目相对路径。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '../..');
const COMMANDS = join(ROOT, 'commands');
const AGENTS = join(ROOT, 'agents');

// "plugin 内资源"目录名（这些路径出现在文档里时必须带 $DDT_PLUGIN_ROOT/ 前缀）
// 'skills' 不在内——Claude Code Skill tool 自动加载，无需路径
const PLUGIN_ROOT_DIRS = ['templates', 'contexts', 'rules'];

// "项目内资源"目录名（这些保持相对路径，不该带 $DDT_PLUGIN_ROOT/）
const PROJECT_ROOT_DIRS = ['docs', 'web', 'server', 'tests', 'src'];

// 在反引号包裹的 markdown 内联代码里出现的引用
//   形如 `templates/xxx.template.md` / `contexts/delivery.md`
//   不算通过的：`$DDT_PLUGIN_ROOT/templates/xxx`
const REF_RE = (dir) => new RegExp('`' + dir + '/[a-z][^`]*`', 'g');

function scanFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const offenders = [];
  for (const dir of PLUGIN_ROOT_DIRS) {
    for (const m of text.matchAll(REF_RE(dir))) {
      // 跳过已带 $DDT_PLUGIN_ROOT 前缀的（实际上正则不会匹配，但保险）
      if (m[0].includes('$DDT_PLUGIN_ROOT')) continue;
      offenders.push(m[0]);
    }
  }
  return offenders;
}

test('D19: commands/*.md 中 templates/contexts/rules 引用必须带 $DDT_PLUGIN_ROOT/ 前缀', () => {
  const files = readdirSync(COMMANDS).filter(f => f.endsWith('.md'));
  const allOffenders = [];
  for (const f of files) {
    const offenders = scanFile(join(COMMANDS, f));
    if (offenders.length > 0) {
      allOffenders.push(`commands/${f}: ${offenders.join(', ')}`);
    }
  }
  assert.deepEqual(allOffenders, [],
    `以下文件含未加 $DDT_PLUGIN_ROOT/ 前缀的 plugin 资源引用（v0.9.3 D19 BUG 复发）：\n` +
    allOffenders.join('\n'));
});

test('D19: agents/*.md 中 templates/contexts/rules 引用必须带 $DDT_PLUGIN_ROOT/ 前缀', () => {
  const files = readdirSync(AGENTS).filter(f => f.endsWith('.md'));
  const allOffenders = [];
  for (const f of files) {
    const offenders = scanFile(join(AGENTS, f));
    if (offenders.length > 0) {
      allOffenders.push(`agents/${f}: ${offenders.join(', ')}`);
    }
  }
  assert.deepEqual(allOffenders, [],
    `以下 agent 含未加 $DDT_PLUGIN_ROOT/ 前缀的 plugin 资源引用：\n` +
    allOffenders.join('\n'));
});

test('D19: 项目资源（docs/web/server/tests）不应带 $DDT_PLUGIN_ROOT/ 前缀', () => {
  // 反向防御：避免把 docs/ 等项目相对路径误加 $DDT_PLUGIN_ROOT/
  const offenders = [];
  const wrongRe = /\$DDT_PLUGIN_ROOT\/(?:docs|web|server|tests|src)\//g;
  for (const dir of [COMMANDS, AGENTS]) {
    const files = readdirSync(dir).filter(f => f.endsWith('.md'));
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(wrongRe)) {
        offenders.push(`${dir.split('/').pop()}/${f}: "${m[0]}"`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    `以下文件把项目资源（docs/web/server/...）误标为 plugin 资源：\n` +
    offenders.join('\n'));
});
