// M4-4: advisory lock — warn-only，不阻塞工具调用
//   仅对受保护 artifact 起效；防止跨 session 同时改导致内容覆盖
//
// 用法：
//   const { tryAcquire, peekHolder } = require('./advisory-lock');
//   const result = tryAcquire(cwd, 'docs/api-contract.yaml', sessionId);
//   if (result.conflict) writeStderr(result.warning);
'use strict';
const fs = require('fs');
const path = require('path');

// 白名单：只对最易冲突的产物加锁（覆盖契约级与单一产物原则保护的文件）
const PROTECTED_ARTIFACTS = new Set([
  'docs/api-contract.yaml',
  'docs/prd.md',
  'docs/wbs.md',
  'docs/arch.md',
  'docs/data-model.md',
  '.ddt/tech-stack.json',
]);

const LOCK_TTL_MS = 30 * 60 * 1000;
const LOCKS_DIR = '.ddt/locks';

function isProtected(relPath) {
  if (!relPath) return false;
  const normalized = relPath.split(path.sep).join('/');
  return PROTECTED_ARTIFACTS.has(normalized);
}

function lockFilePath(cwd, relPath) {
  // 把斜杠替换为下划线避免目录嵌套
  const safe = relPath.split(/[\\/]/).join('__');
  return path.join(cwd, LOCKS_DIR, `${safe}.lock`);
}

function readLock(lockPath) {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function isStale(lock) {
  if (!lock || !lock.acquired_at) return true;
  const acquiredMs = Date.parse(lock.acquired_at);
  if (!Number.isFinite(acquiredMs)) return true;
  return Date.now() - acquiredMs > LOCK_TTL_MS;
}

function writeLock(lockPath, sessionId) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = { session_id: sessionId, acquired_at: new Date().toISOString() };
  fs.writeFileSync(lockPath, JSON.stringify(payload), 'utf8');
}

/**
 * 尝试为 artifact 抢锁。冲突时返回 warning 但不阻塞。
 * @returns {{ conflict: boolean, warning: string, lock: object|null }}
 */
function tryAcquire(cwd, relPath, sessionId) {
  if (!isProtected(relPath)) {
    return { conflict: false, warning: '', lock: null };
  }
  const lockPath = lockFilePath(cwd, relPath);
  const existing = readLock(lockPath);
  if (existing && !isStale(existing) && existing.session_id !== sessionId) {
    const minutes = Math.round((Date.now() - Date.parse(existing.acquired_at)) / 60000);
    return {
      conflict: true,
      warning: `[delivery-hook] WARNING: ${relPath} 正被另一会话编辑（session ${existing.session_id.slice(0, 8)}…，${minutes} 分钟前），改动可能冲突。\n`,
      lock: existing,
    };
  }
  // 抢锁（覆盖 stale 或同 session 的锁）
  try {
    writeLock(lockPath, sessionId);
  } catch (_) { /* 不阻塞 */ }
  return { conflict: false, warning: '', lock: null };
}

function peekHolder(cwd, relPath) {
  if (!isProtected(relPath)) return null;
  return readLock(lockFilePath(cwd, relPath));
}

function releaseSessionLocks(cwd, sessionId) {
  // 由 SessionEnd 调用：删除该 session 持有的锁
  try {
    const dir = path.join(cwd, LOCKS_DIR);
    if (!fs.existsSync(dir)) return;
    for (const file of fs.readdirSync(dir)) {
      const full = path.join(dir, file);
      const lock = readLock(full);
      if (lock && lock.session_id === sessionId) {
        try { fs.unlinkSync(full); } catch { /* ignore */ }
      }
    }
  } catch (_) { /* 静默 */ }
}

module.exports = {
  PROTECTED_ARTIFACTS,
  LOCK_TTL_MS,
  isProtected,
  isStale,
  peekHolder,
  releaseSessionLocks,
  tryAcquire,
};
