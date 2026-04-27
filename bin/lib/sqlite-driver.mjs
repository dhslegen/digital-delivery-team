import fs from 'node:fs';
import path from 'node:path';

export async function openSqliteDatabase(dbPath) {
  try {
    return await openNativeDatabase(dbPath);
  } catch (error) {
    throw new Error([
      'DDT metrics require Node.js 22+ with built-in node:sqlite.',
      'Upgrade Node.js to 22 or newer; no npm SQLite dependency is used.',
      `Original error: ${error.message}`,
    ].join(' '));
  }
}

async function openNativeDatabase(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  ensureParentDir(dbPath);
  const rawDb = new DatabaseSync(dbPath);

  return {
    driver: 'native',
    exec(sql) {
      rawDb.exec(sql);
    },
    prepare(sql) {
      const statement = rawDb.prepare(sql);
      return {
        run(...args) {
          return statement.run(...normalizeArgs(args));
        },
        get(...args) {
          return statement.get(...normalizeArgs(args));
        },
        all(...args) {
          return statement.all(...normalizeArgs(args));
        },
      };
    },
    close() {
      if (typeof rawDb.close === 'function') {
        rawDb.close();
      }
    },
  };
}

function normalizeArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0];
  }
  return args;
}

function ensureParentDir(dbPath) {
  if (dbPath === ':memory:') return;
  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
}
