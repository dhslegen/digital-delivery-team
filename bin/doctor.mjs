#!/usr/bin/env node
// M2-6: DDT 安装自检
//   检查项：plugin root 解析 / Node 版本 / hook 注册 / events.jsonl 写入 / metrics.db 可读 / 工具链
//   退出码：0 = 全部通过；1 = 至少一项失败
import { existsSync, readFileSync, mkdirSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const SELF_DIR = dirname(__filename);
const PLUGIN_ROOT = resolve(SELF_DIR, '..');
const METRICS_DIR = process.env.DDT_METRICS_DIR ||
  join(homedir(), '.claude', 'delivery-metrics');

const checks = [];
function check(name, fn) {
  let ok = false; let detail = '';
  try {
    const r = fn();
    if (r && typeof r === 'object') { ok = !!r.ok; detail = r.detail || ''; }
    else { ok = !!r; }
  } catch (err) {
    ok = false; detail = err.message;
  }
  checks.push({ name, ok, detail });
}

// 1. Node 版本
check('Node ≥ 22', () => {
  const major = Number(process.versions.node.split('.')[0]);
  return { ok: major >= 22, detail: `当前 ${process.versions.node}` };
});

// 2. plugin root marker
check('插件 root 完整性', () => {
  const requiredFiles = ['bin/aggregate.mjs', 'bin/report.mjs', 'bin/baseline.mjs',
    'bin/lib/store.mjs', 'hooks/hooks.json', 'hooks/handlers/session-start.js',
    'hooks/handlers/user-prompt-submit.js', 'hooks/handlers/stop.js'];
  for (const rel of requiredFiles) {
    if (!existsSync(join(PLUGIN_ROOT, rel))) {
      return { ok: false, detail: `缺失 ${rel}` };
    }
  }
  return { ok: true, detail: PLUGIN_ROOT };
});

// 3. .ddt-plugin-root 持久化（SessionStart 写入）
check('SessionStart hook 已写入 plugin-root marker', () => {
  const markerPath = join(METRICS_DIR, '.ddt-plugin-root');
  if (!existsSync(markerPath)) {
    return { ok: false, detail: `marker 缺失 ${markerPath}（首次会话还未触发 SessionStart hook）` };
  }
  const value = readFileSync(markerPath, 'utf8').trim();
  return {
    ok: existsSync(value),
    detail: value || '空值',
  };
});

// 4. hooks.json 注册的核心事件（M4 新增 UserPromptSubmit / Stop / SubagentStop）
check('hooks.json 注册了核心 7 个事件', () => {
  const hooksPath = join(PLUGIN_ROOT, 'hooks/hooks.json');
  const data = JSON.parse(readFileSync(hooksPath, 'utf8'));
  const required = ['SessionStart', 'SessionEnd', 'PreToolUse', 'PostToolUse',
    'SubagentStop', 'UserPromptSubmit', 'Stop'];
  const missing = required.filter(ev => !data.hooks[ev]);
  return {
    ok: missing.length === 0,
    detail: missing.length ? `缺失 ${missing.join(', ')}` : `共 ${Object.keys(data.hooks).length} 类`
  };
});

// 5. events.jsonl 可写
check('events.jsonl 可写', () => {
  mkdirSync(METRICS_DIR, { recursive: true });
  const probePath = join(METRICS_DIR, '.doctor-probe');
  writeFileSync(probePath, '{"ok":true}\n');
  const stat = statSync(probePath);
  unlinkSync(probePath);
  return { ok: stat.size > 0, detail: METRICS_DIR };
});

// 6. metrics.db 可读（若存在）
check('metrics.db 完整性', () => {
  const dbPath = join(METRICS_DIR, 'metrics.db');
  if (!existsSync(dbPath)) {
    return { ok: true, detail: '尚未生成（首次运行 /report 时自动创建）' };
  }
  const stat = statSync(dbPath);
  return { ok: stat.size > 0, detail: `${(stat.size / 1024).toFixed(1)} KB` };
});

// 7. npx redocly 可用（OpenAPI lint 工具链）
check('OpenAPI lint 工具链（@redocly/cli）', () => {
  const result = spawnSync('npx', ['--yes', '@redocly/cli', '--version'],
    { encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) {
    return { ok: false, detail: '运行 npx --yes @redocly/cli --version 失败；首次执行可能需要联网安装' };
  }
  return { ok: true, detail: result.stdout.trim() };
});

// 8. 关键脚本可执行
check('bin/check-blockers.sh 可执行', () => {
  const p = join(PLUGIN_ROOT, 'bin/check-blockers.sh');
  if (!existsSync(p)) return { ok: false, detail: '文件缺失' };
  const stat = statSync(p);
  return { ok: (stat.mode & 0o111) !== 0, detail: '权限位检查' };
});

// 9. M3 / M4 新增脚本完整性
check('M3/M4 新增脚本齐全', () => {
  const required = [
    'bin/find-plugin-root.mjs',
    'bin/resolve-tech-stack.mjs',
    'bin/check-contract-alignment.mjs',
    'bin/progress.mjs',
    'bin/resume.mjs',
    'bin/doctor.mjs',
    'hooks/handlers/lib/advisory-lock.js',
  ];
  for (const rel of required) {
    if (!existsSync(join(PLUGIN_ROOT, rel))) {
      return { ok: false, detail: `缺失 ${rel}` };
    }
  }
  return { ok: true, detail: `${required.length} 个脚本齐全` };
});

// 10. M3 templates / skills
check('M3 技术栈预设与 ai-native-design skill', () => {
  const required = [
    'templates/tech-stack-presets.yaml',
    'skills/ai-native-design/SKILL.md',
  ];
  for (const rel of required) {
    if (!existsSync(join(PLUGIN_ROOT, rel))) {
      return { ok: false, detail: `缺失 ${rel}` };
    }
  }
  return { ok: true, detail: '齐全' };
});

// 11. progress.json 可写（轻量探针）
check('progress.json 写入路径可达', () => {
  // 在 metrics dir 下做一次 probe，避免污染用户项目目录
  const probeDir = join(METRICS_DIR, '.doctor-progress-probe');
  mkdirSync(probeDir, { recursive: true });
  const probePath = join(probeDir, 'progress.json');
  writeFileSync(probePath, '{"schema_version":1,"phases":{}}\n');
  const stat = statSync(probePath);
  unlinkSync(probePath);
  // 清理空目录
  try { require('node:fs').rmdirSync(probeDir); } catch { /* ignore */ }
  return { ok: stat.size > 0, detail: '可写' };
});

// 输出
let allOk = true;
console.log('\n=== DDT Doctor ===');
for (const { name, ok, detail } of checks) {
  const icon = ok ? '✅' : '❌';
  console.log(`${icon}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) allOk = false;
}
console.log(`\n结论：${allOk ? '✅ 所有检查通过' : '❌ 存在失败项，请按上方提示修复'}\n`);
process.exit(allOk ? 0 : 1);
