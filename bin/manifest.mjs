#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLUGIN_JSON = path.join(ROOT, '.claude-plugin', 'plugin.json');

const KNOWN_POSITIONAL    = new Set(['prd','wbs','design','design-brief','design-execute','build-web','build-api','test','review','package','report','fix']);
const KNOWN_ORCHESTRATION = new Set(['kickoff','impl','verify','ship']);
const KNOWN_AUXILIARY     = new Set(['doctor', 'resume', 'relay', 'preview']);

function scanAgents() {
  return fs.readdirSync(path.join(ROOT, 'agents'))
    .filter(f => f.endsWith('.md'))
    .map(f => `./agents/${f}`)
    .sort();
}

function scanSkills() {
  return fs.readdirSync(path.join(ROOT, 'skills'))
    .filter(name => {
      try { return fs.statSync(path.join(ROOT, 'skills', name)).isDirectory(); } catch { return false; }
    })
    .map(name => {
      const skillFile = path.join(ROOT, 'skills', name, 'SKILL.md');
      let origin = null;
      if (fs.existsSync(skillFile)) {
        const content = fs.readFileSync(skillFile, 'utf8');
        const m = content.match(/^origin:\s*(.+)$/m);
        if (m) origin = m[1].trim();
      }
      return { name, origin };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function scanCommands() {
  const files = fs.readdirSync(path.join(ROOT, 'commands'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''));

  const positional = [];
  const orchestration = [];
  const auxiliary = [];
  const unknown = [];
  for (const name of files) {
    if (KNOWN_POSITIONAL.has(name))           positional.push(name);
    else if (KNOWN_ORCHESTRATION.has(name))   orchestration.push(name);
    else if (KNOWN_AUXILIARY.has(name))       auxiliary.push(name);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    console.error(`ERROR: Unknown commands (not in v3 spec): ${unknown.join(', ')}`);
    process.exit(1);
  }
  const posOrder = ['prd','wbs','design','design-brief','design-execute','build-web','build-api','test','review','fix','package','report'];
  const orchOrder = ['kickoff','impl','verify','ship'];
  positional.sort((a, b) => posOrder.indexOf(a) - posOrder.indexOf(b));
  orchestration.sort((a, b) => orchOrder.indexOf(a) - orchOrder.indexOf(b));
  auxiliary.sort();
  return { positional, orchestration, auxiliary };
}

function scanHooks() {
  const hooksFile = path.join(ROOT, 'hooks', 'hooks.json');
  const data = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  const ids = new Set();
  const hooksObj = data.hooks || data;
  for (const entries of Object.values(hooksObj)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry.id) ids.add(entry.id);
    }
  }
  return [...ids].sort();
}

function buildComponents() {
  return {
    agents: scanAgents(),
    skills: scanSkills(),
    commands: scanCommands(),
    hooks: scanHooks(),
  };
}

function buildPluginSurface() {
  return {
    skills: ['./skills/'],
    commands: ['./commands/'],
  };
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const args = process.argv.slice(2);
const mode = args[0] || 'print';

const scanned = buildComponents();
const expectedSurface = buildPluginSurface();

if (mode === '--check') {
  const pluginJson = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  const actualSurface = {
    skills: pluginJson.skills,
    commands: pluginJson.commands,
  };

  const errors = [];
  if (!deepEqual(actualSurface, expectedSurface)) {
    errors.push([
      'MISMATCH between scanned plugin surface and plugin.json:',
      `Expected: ${JSON.stringify(expectedSurface, null, 2)}`,
      `Got:      ${JSON.stringify(actualSurface, null, 2)}`,
    ].join('\n'));
  }
  for (const forbidden of ['agents', 'components', 'hooks', 'authors']) {
    if (Object.prototype.hasOwnProperty.call(pluginJson, forbidden)) {
      errors.push(`plugin.json must not declare '${forbidden}'`);
    }
  }
  if (pluginJson.homepage === '' || pluginJson.repository === '') {
    errors.push('plugin.json must omit unknown homepage/repository instead of using empty strings');
  }

  if (!errors.length) {
    console.log('plugin manifest is consistent with the DDT plugin surface.');
    process.exit(0);
  } else {
    console.error(errors.join('\n'));
    process.exit(1);
  }
} else if (mode === '--write') {
  const pluginJson = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));
  delete pluginJson.agents;
  delete pluginJson.components;
  delete pluginJson.hooks;
  delete pluginJson.authors;
  if (pluginJson.homepage === '') delete pluginJson.homepage;
  if (pluginJson.repository === '') delete pluginJson.repository;
  pluginJson.skills = expectedSurface.skills;
  pluginJson.commands = expectedSurface.commands;
  fs.writeFileSync(PLUGIN_JSON, JSON.stringify(pluginJson, null, 2) + '\n', 'utf8');
  console.log('plugin.json DDT surface updated.');
} else {
  console.log(JSON.stringify({ plugin: expectedSurface, components: scanned }, null, 2));
}
