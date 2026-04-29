#!/usr/bin/env node
// M3-3: 技术栈解析器（优先级链）
//
// 优先级（从高到低）：
//   1. CLI flag: --preset <name>
//   2. project-brief.md "技术栈预设" 字段
//   3. .ddt/tech-stack.json 已有内容（保留用户已确认的选择）
//   4. project root manifest 自动检测：pom.xml/package.json/go.mod/pyproject.toml/Cargo.toml
//   5. 默认（templates/tech-stack-presets.yaml::default_preset）
//
// 用法：
//   node bin/resolve-tech-stack.mjs [--preset <name>] [--ai-design <name>] [--write]
//   node bin/resolve-tech-stack.mjs --components-json <path> [--write]
//     --components-json: 用户通过 AskUserQuestion 收集后写入的临时 JSON 文件，
//                        包含 backend / frontend / ai_design 三段；脚本合并后输出 tech-stack.json
//   --write 会写入 .ddt/tech-stack.json；不传则只输出 JSON 到 stdout。
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

// M6.3.3: 用 AskUserQuestion 收集到的具体组件清单，可与 preset 合并产出最终 tech-stack
// PR-A 修复（M6.3.4）：LLM 经常写出扁平字符串 schema（如 backend: "java-spring-boot"），
//   spread 操作会把字符串展开成 {0:'j',1:'a',...} 字符索引对象污染 tech-stack.json，
//   静默丢弃用户偏好。这里增加 schema 校验 + 扁平字符串自动映射 + 异常拒绝。
function readComponentsJson(path) {
  if (!path || !existsSync(path)) return null;
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`❌ --components-json 解析失败：${err.message}`);
    process.exit(2);
  }
  return normalizeComponents(raw);
}

// 扁平字符串 → 嵌套对象的映射表。
// LLM 在 AskUserQuestion 后倾向写出扁平 schema，这里给每个常见字面量定义到嵌套对象的展开规则。
// 未命中的字符串 → 报错并退出，强制 LLM/用户改写为合法格式（避免静默吞掉）。
const BACKEND_STRING_MAP = {
  'java-spring-boot':  { language: 'java',       framework: 'spring-boot' },
  'java-quarkus':      { language: 'java',       framework: 'quarkus' },
  'java-micronaut':    { language: 'java',       framework: 'micronaut' },
  'kotlin-spring-boot':{ language: 'kotlin',     framework: 'spring-boot' },
  'kotlin-ktor':       { language: 'kotlin',     framework: 'ktor' },
  'node-express':      { language: 'typescript', framework: 'express' },
  'node-nestjs':       { language: 'typescript', framework: 'nestjs' },
  'node-fastify':      { language: 'typescript', framework: 'fastify' },
  'node-hono':         { language: 'typescript', framework: 'hono' },
  'python-fastapi':    { language: 'python',     framework: 'fastapi' },
  'python-django':     { language: 'python',     framework: 'django' },
  'python-flask':      { language: 'python',     framework: 'flask' },
  'go-gin':            { language: 'go',         framework: 'gin' },
  'go-echo':           { language: 'go',         framework: 'echo' },
  'go-fiber':          { language: 'go',         framework: 'fiber' },
  'rust-axum':         { language: 'rust',       framework: 'axum' },
  'rust-actix':        { language: 'rust',       framework: 'actix-web' },
};

const FRONTEND_STRING_MAP = {
  'html-css':       { framework: 'none',    bundler: 'none' },
  'react-vite':     { framework: 'react',   bundler: 'vite' },
  'react-nextjs':   { framework: 'react',   bundler: 'nextjs' },
  'vue-vite':       { framework: 'vue',     bundler: 'vite' },
  'vue-nuxt':       { framework: 'vue',     bundler: 'nuxt' },
  'svelte-kit':     { framework: 'svelte',  bundler: 'sveltekit' },
  'solid-start':    { framework: 'solid',   bundler: 'solidstart' },
  'angular':        { framework: 'angular' },
};

const AI_DESIGN_STRING_MAP = {
  'claude-design': { type: 'claude-design' },
  'figma':         { type: 'figma' },
  'v0':            { type: 'v0' },
  'lovable':       { type: 'lovable' },
  'none':          { type: 'claude-design' },     // 用户选"不需要"= claude-design 默认通道
};

// 把字符串 / 布尔 / 顶层扁平字段规范成 design.md::Phase 2b 期望的嵌套对象 schema
function normalizeComponents(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    console.error('❌ --components-json 必须是对象');
    process.exit(2);
  }
  const out = { ...raw };

  out.backend  = normalizeSection('backend',  raw.backend,  BACKEND_STRING_MAP);
  out.frontend = normalizeSection('frontend', raw.frontend, FRONTEND_STRING_MAP);
  out.ai_design = normalizeAiDesign(raw.ai_design);

  // 处理顶层扁平字段（database / language / framework / orm / cache / auth / testing）
  // 把它们 merge 进 backend 嵌套对象，保持向后兼容
  if (typeof raw.database === 'string') {
    out.backend = out.backend || {};
    out.backend.database = raw.database === 'none'
      ? { primary: 'none' }
      : { primary: raw.database };
    delete out.database;
  }
  for (const flat of ['language', 'framework', 'orm', 'cache', 'auth', 'testing', 'build']) {
    if (typeof raw[flat] === 'string' && !raw.backend) {
      out.backend = out.backend || {};
      out.backend[flat] = raw[flat];
      delete out[flat];
    }
  }

  return out;
}

function normalizeSection(name, value, stringMap) {
  if (value === undefined || value === null || value === false) return undefined;
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const mapped = stringMap[value];
    if (mapped) {
      console.error(`⚠️  components-json.${name} 是扁平字符串 "${value}"，已映射为 ${JSON.stringify(mapped)}`);
      return mapped;
    }
    console.error(`❌ components-json.${name} 是未识别字符串 "${value}"。请改写为嵌套对象，如 { language, framework, ... }`);
    process.exit(2);
  }
  console.error(`❌ components-json.${name} 类型非法（${typeof value}）。期望对象或扁平字符串`);
  process.exit(2);
}

// 最终防线：禁止 backend/frontend/ai_design 含纯数字索引 key（典型字符串展开污染信号）
function assertCleanStack(stack) {
  for (const section of ['backend', 'frontend', 'ai_design']) {
    const obj = stack[section];
    if (!obj || typeof obj !== 'object') continue;
    for (const key of Object.keys(obj)) {
      if (/^\d+$/.test(key)) {
        console.error(`❌ tech-stack.${section} 含数字索引 key "${key}"，疑似字符串展开污染。` +
          '请检查 components-json 输入是否把字符串当作对象传入了。');
        process.exit(2);
      }
    }
  }
}

function normalizeAiDesign(value) {
  if (value === undefined || value === null || value === false) return { type: 'claude-design' };
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const mapped = AI_DESIGN_STRING_MAP[value];
    if (mapped) {
      console.error(`⚠️  components-json.ai_design 是扁平字符串 "${value}"，已映射为 ${JSON.stringify(mapped)}`);
      return mapped;
    }
    console.error(`❌ components-json.ai_design 未识别字符串 "${value}"。允许值：${Object.keys(AI_DESIGN_STRING_MAP).join(' / ')}`);
    process.exit(2);
  }
  console.error(`❌ components-json.ai_design 类型非法（${typeof value}）`);
  process.exit(2);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const stackPath = join(cwd, '.ddt', 'tech-stack.json');
  const briefPath = join(cwd, 'project-brief.md');

  const presetsRoot = loadPresets();
  const defaultPreset = presetsRoot.default_preset || 'java-modern';

  // M6.3.3: --components-json 优先级最高（用户已通过 AskUserQuestion 明确选择）
  const componentsJsonPath = args['components-json'];
  const userComponents = readComponentsJson(componentsJsonPath);

  // 优先级链
  let chosenPreset = null;
  let chosenAi = null;
  let source = '';

  if (args.preset) {
    chosenPreset = args.preset;
    chosenAi = args['ai-design'] || null;
    source = 'cli-flag';
  } else if (userComponents && userComponents.preset) {
    chosenPreset = userComponents.preset;
    chosenAi = userComponents.ai_design && userComponents.ai_design.type;
    source = 'askuserquestion';
  } else {
    const brief = readBriefPreset(briefPath);
    // brief 写 'interactive' 表示用户希望走 AskUserQuestion 问卷而非 preset
    if (brief.preset && brief.preset !== 'custom' && brief.preset !== 'interactive') {
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

  // M6.3.3: 合并用户通过 AskUserQuestion 选择的具体组件
  if (userComponents) {
    if (userComponents.backend) {
      stack.backend = { ...stack.backend, ...userComponents.backend };
    }
    if (userComponents.frontend) {
      stack.frontend = { ...stack.frontend, ...userComponents.frontend };
    }
    if (userComponents.ai_design) {
      stack.ai_design = { ...stack.ai_design, ...userComponents.ai_design };
    }
    if (Array.isArray(userComponents.components)) {
      stack.components = userComponents.components;  // 用户细粒度选择的组件 ID 列表
    }
    stack.user_customized = true;
  }

  // PR-A 第二层防御：写入前校验最终对象不含数字索引 key（防字符串展开污染漏网）
  assertCleanStack(stack);

  const json = JSON.stringify(stack, null, 2);
  if (args.write) {
    mkdirSync(dirname(stackPath), { recursive: true });
    writeFileSync(stackPath, json + '\n', 'utf8');
    const note = userComponents ? '+用户自定义组件' : '';
    console.log(`✅ tech-stack.json 已写入 ${stackPath}（来源：${source}${note}，preset：${chosenPreset}）`);
  } else {
    console.log(json);
  }
}

main();
