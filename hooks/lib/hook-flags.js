#!/usr/bin/env node
'use strict';

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function getHookProfile() {
  const raw = String(process.env.DDT_HOOK_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds() {
  const raw = String(process.env.DDT_DISABLED_HOOKS || '');
  if (!raw.trim()) {
    return new Set();
  }

  return new Set(
    raw
      .split(',')
      .map(value => normalizeId(value))
      .filter(Boolean)
  );
}

function parseProfiles(rawProfiles, fallback = ['standard', 'strict']) {
  if (!rawProfiles) {
    return [...fallback];
  }

  if (Array.isArray(rawProfiles)) {
    const parsed = rawProfiles
      .map(value => String(value || '').trim().toLowerCase())
      .filter(value => VALID_PROFILES.has(value));
    return parsed.length > 0 ? parsed : [...fallback];
  }

  const parsed = String(rawProfiles)
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => VALID_PROFILES.has(value));

  return parsed.length > 0 ? parsed : [...fallback];
}

function isHookEnabled(hookId, options = {}) {
  const id = normalizeId(hookId);
  if (!id) {
    return true;
  }

  if (getDisabledHookIds().has(id)) {
    return false;
  }

  return parseProfiles(options.profiles).includes(getHookProfile());
}

module.exports = {
  VALID_PROFILES,
  normalizeId,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
};
