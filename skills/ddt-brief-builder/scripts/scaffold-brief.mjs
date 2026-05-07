#!/usr/bin/env node
// ddt-brief-builder · 项目目录一键脚手
//
// 实战痛点：用户每次新项目都要 mkdir + cp brief + .gitignore + git init + commit 五个手动步骤。
// 本脚本把"已经选定项目名 + 已经写好 brief 内容"的状态一键落地为可启动 /prd 的项目。
//
// 用法：
//   node scaffold-brief.mjs --target <dir> --brief <brief-path> [--no-git]
//   node scaffold-brief.mjs --target /Users/me/work/alv-ops --brief /tmp/brief.md
//
// 默认行为：
//   1. mkdir --target（含父目录）
//   2. cp brief 到 <target>/project-brief.md
//   3. cp 插件根的 templates/.gitignore.template 到 <target>/.gitignore
//   4. git init -b main + add + initial commit（除非传 --no-git）
//   5. 输出"下一步" 引导
//
// 退出码：
//   0 = 完成
//   1 = 参数错误 / 目标已存在且非空
//   2 = 文件 IO 失败

import { existsSync, mkdirSync, copyFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const SKILL_ROOT = dirname(dirname(__filename));      // skills/ddt-brief-builder/
const PLUGIN_ROOT = dirname(dirname(SKILL_ROOT));     // plugin root
const GITIGNORE_TEMPLATE = join(PLUGIN_ROOT, 'templates', '.gitignore.template');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else args[key] = true;
    } else args._.push(a);
  }
  return args;
}

function isDirEmpty(dir) {
  try { return readdirSync(dir).length === 0; }
  catch { return true; }
}

function gitInit(targetDir) {
  const env = { ...process.env };
  // 用本地 git config 兜底缺失的 user.email / user.name
  try {
    execFileSync('git', ['init', '-b', 'main'], { cwd: targetDir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch {
    // git < 2.28 不支持 -b，fallback
    execFileSync('git', ['init'], { cwd: targetDir, stdio: ['pipe', 'pipe', 'pipe'] });
  }
  // 检测是否已有 user.email / user.name；缺失则用本地 fallback（不污染 global）
  let hasIdentity = true;
  try {
    execFileSync('git', ['config', 'user.email'], { cwd: targetDir, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { hasIdentity = false; }
  if (!hasIdentity) {
    execFileSync('git', ['config', 'user.email', 'ddt@local'], { cwd: targetDir });
    execFileSync('git', ['config', 'user.name', 'DDT scaffold'], { cwd: targetDir });
  }
  execFileSync('git', ['add', '.'], { cwd: targetDir });
  execFileSync('git', ['commit', '-m',
    'chore: initial brief from ddt-brief-builder\n\n由 ddt-brief-builder skill 自动脚手生成。\n下一步：跑 /digital-delivery-team:prd 进入 DDT 工作流。'
  ], { cwd: targetDir });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target || !args.brief) {
    console.error('❌ 用法：scaffold-brief.mjs --target <dir> --brief <brief-path> [--no-git]');
    process.exit(1);
  }

  const targetDir = resolve(args.target);
  const briefSrc = resolve(args.brief);
  const wantGit = !args['no-git'];

  if (!existsSync(briefSrc)) {
    console.error(`❌ brief 源文件不存在：${briefSrc}`);
    process.exit(1);
  }

  if (existsSync(targetDir) && !isDirEmpty(targetDir)) {
    console.error(`❌ 目标目录已存在且非空：${targetDir}`);
    console.error(`   建议：换个目录名 / 先备份现有内容 / 加 --force（暂不支持）`);
    process.exit(1);
  }

  // 1. mkdir
  mkdirSync(targetDir, { recursive: true });

  // 2. cp brief
  copyFileSync(briefSrc, join(targetDir, 'project-brief.md'));

  // 3. .gitignore（v0.8.1 D11 模板）
  if (existsSync(GITIGNORE_TEMPLATE)) {
    copyFileSync(GITIGNORE_TEMPLATE, join(targetDir, '.gitignore'));
  } else {
    // fallback 最小 .gitignore
    const minimal = '.DS_Store\nUntitled\n.ddt/locks/\nstaging/\nnode_modules/\n';
    require('node:fs').writeFileSync(join(targetDir, '.gitignore'), minimal);
  }

  // 4. git init + commit（可选）
  if (wantGit) {
    try {
      gitInit(targetDir);
    } catch (e) {
      console.error(`⚠️  git init 失败：${e.message}`);
      console.error(`   不阻塞——文件已落盘，你可以手动 cd ${targetDir} && git init`);
    }
  }

  // 5. 下一步引导
  console.log('');
  console.log(`✅ 项目脚手完成：${targetDir}`);
  console.log('');
  console.log('下一步（Claude Code 会话内，cd 到该目录后）：');
  console.log('  /digital-delivery-team:prd       # 让 product-agent 出 PRD');
  console.log('  /digital-delivery-team:wbs       # 拆任务（baseline 已校准则估算更准）');
  console.log('  /digital-delivery-team:design    # 出架构 + OpenAPI');
  console.log('  ...                              # 完整流程见 docs/architecture/flowchart.md');
  console.log('');
  console.log('如有 baseline 信息（人员需求表 / 工时表）：');
  console.log('  对 Claude 说"导入工时数据 baseline"，会触发 ddt-baseline-sync skill');
}

main();
