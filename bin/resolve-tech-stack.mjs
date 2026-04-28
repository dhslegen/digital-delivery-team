#!/usr/bin/env node
// M3-3: 技术栈解析器（优先级链）
//
// 优先级（从高到低）：
//   1. CLI flag: --preset <name>
//   2. project-brief.md "技术栈预设" 字段
//   3. .delivery/tech-stack.json 已有内容（保留用户已确认的选择）
//   4. project root manifest 自动检测：pom.xml/package.json/go.mod/pyproject.toml/Cargo.toml
//   5. 默认（templates/tech-stack-presets.yaml::default_preset）
//
// 用法：
//   node bin/resolve-tech-stack.mjs [--preset <name>] [--ai-design <name>] [--write]
//   --write 会写入 .delivery/tech-stack.json；不传则只输出 JSON 到 stdout。
//
// 退出码：0 = 成功；2 = preset 名无效；3 = preset 模板缺失。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SELF_DIR = dirname(__filename);
const PLUGIN_ROOT = resolve(SELF_DIR, '..');
const PRESETS_PATH = join(PLUGIN_ROOT, 'templates', 'tech-stack-presets.yaml');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        args[key] = next; i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

// 极简 YAML 解析器：仅支持 key:value、嵌套缩进、无锚点/标签
// 比 npm yaml 包零依赖；预设文件结构稳定，无需复杂解析
function parseYaml(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, node: root }];
  for (const rawLine of lines) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^(\s*)/)[1].length;
    const line = rawLine.trim();
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const valuePart = line.slice(colonIdx + 1).trim();
    if (!valuePart) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else {
      let value = valuePart;
      // 去引号
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      } else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      parent[key] = value;
    }
  }
  return root;
}

function loadPresets() {
  if (!existsSync(PRESETS_PATH)) {
    console.error(`❌ presets file not found at ${PRESETS_PATH}`);
    process.exit(3);
  }
  return parseYaml(readFileSync(PRESETS_PATH, 'utf8'));
}

function readBriefPreset(briefPath) {
  if (!existsSync(briefPath)) return { preset: null, aiDesign: null };
  const text = readFileSync(briefPath, 'utf8');
  const presetMatch = text.match(/^[-*]\s*\*\*技术栈预设\*\*[：:]\s*([a-zA-Z0-9_-]+)/m);
  const aiMatch = text.match(/^[-*]\s*\*\*AI-native UI\*\*[：:]\s*([a-zA-Z0-9_-]+)/m);
  return {
    preset: presetMatch ? presetMatch[1].trim() : null,
    aiDesign: aiMatch ? aiMatch[1].trim() : null,
  };
}

function readExistingStack(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function detectFromManifest(cwd) {
  // 仅返回偏向哪个 preset 的提示，不构建完整结构
  if (existsSync(join(cwd, 'pom.xml'))) return 'java-modern';
  if (existsSync(join(cwd, 'build.gradle')) || existsSync(join(cwd, 'build.gradle.kts'))) return 'java-modern';
  if (existsSync(join(cwd, 'pyproject.toml'))) return 'python-fastapi';
  if (existsSync(join(cwd, 'go.mod'))) return 'go-modern';
  if (existsSync(join(cwd, 'package.json'))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps['@nestjs/core']) return 'node-modern';
      if (deps['next']) return 'node-modern';
    } catch { /* ignore */ }
    return 'node-modern';
  }
  return null;
}

function buildStack(presetName, aiDesignName, presetsRoot) {
  const presets = presetsRoot.presets || {};
  const preset = presets[presetName];
  if (!preset) {
    console.error(`❌ preset "${presetName}" 不存在；可选：${Object.keys(presets).join(', ')}`);
    process.exit(2);
  }
  const aiDesignDefault = preset.ai_design || 'claude-design';
  const finalAi = aiDesignName || aiDesignDefault;
  const aiOptions = presetsRoot.ai_design_options || {};
  if (!aiOptions[finalAi]) {
    console.error(`❌ ai-design "${finalAi}" 不存在；可选：${Object.keys(aiOptions).join(', ')}`);
    process.exit(2);
  }
  return {
    preset: presetName,
    label: preset.label,
    backend: preset.backend,
    frontend: preset.frontend,
    ai_design: {
      type: finalAi,
      ...aiOptions[finalAi],
    },
    resolved_at: new Date().toISOString(),
    schema_version: 1,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const stackPath = join(cwd, '.delivery', 'tech-stack.json');
  const briefPath = join(cwd, 'project-brief.md');

  const presetsRoot = loadPresets();
  const defaultPreset = presetsRoot.default_preset || 'java-modern';

  // 优先级链
  let chosenPreset = null;
  let chosenAi = null;
  let source = '';

  if (args.preset) {
    chosenPreset = args.preset;
    chosenAi = args['ai-design'] || null;
    source = 'cli-flag';
  } else {
    const brief = readBriefPreset(briefPath);
    if (brief.preset && brief.preset !== 'custom') {
      chosenPreset = brief.preset;
      chosenAi = brief.aiDesign;
      source = 'project-brief';
    } else {
      const existing = readExistingStack(stackPath);
      if (existing && existing.preset) {
        chosenPreset = existing.preset;
        chosenAi = existing.ai_design && existing.ai_design.type;
        source = 'existing-tech-stack-json';
      } else {
        const detected = detectFromManifest(cwd);
        if (detected) {
          chosenPreset = detected;
          source = 'manifest-detect';
        } else {
          chosenPreset = defaultPreset;
          source = 'default';
        }
      }
    }
  }

  const stack = buildStack(chosenPreset, chosenAi, presetsRoot);
  stack.source = source;

  const json = JSON.stringify(stack, null, 2);
  if (args.write) {
    mkdirSync(dirname(stackPath), { recursive: true });
    writeFileSync(stackPath, json + '\n', 'utf8');
    console.log(`✅ tech-stack.json 已写入 ${stackPath}（来源：${source}，preset：${chosenPreset}）`);
  } else {
    console.log(json);
  }
}

main();
