// Shared by db-init.js and db-migrate.js: the database connection, the list of migration files,
// and the schema_migrations table that records which ones have been applied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
export const schemaPath = path.resolve(here, '../../../database/schema.sql');
export const migrationsDir = path.resolve(here, '../../../database/migrations');
export const dbName = process.env.DB_NAME || 'jewellery_system';

export function connect({ database } = {}) {
  return mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    multipleStatements: true,
  });
}

// Migration file names, oldest first (they start with a YYYY-MM-DD date, so name order is date order).
export function migrationFiles() {
  if (!fs.existsSync(migrationsDir)) return [];
  return fs.readdirSync(migrationsDir).filter((f) => f.toLowerCase().endsWith('.sql')).sort();
}

export async function ensureMigrationsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);
}

export async function appliedMigrations(conn) {
  const [rows] = await conn.query('SELECT filename, applied_at FROM schema_migrations ORDER BY filename');
  return new Map(rows.map((r) => [r.filename, r.applied_at]));
}

export async function markApplied(conn, names) {
  if (!names.length) return;
  await conn.query('INSERT IGNORE INTO schema_migrations (filename) VALUES ?', [names.map((n) => [n])]);
}

// Splits a .sql file into single statements the way the mysql command-line client does,
// including its DELIMITER directive (used around CREATE PROCEDURE ... END //).
export function splitSql(sql) {
  const statements = [];
  let delimiter = ';';
  let current = '';
  let i = 0;
  let atLineStart = true;
  const push = () => {
    const s = current.trim();
    if (s) statements.push(s);
    current = '';
  };

  while (i < sql.length) {
    // DELIMITER directive: only at the start of a line.
    if (atLineStart) {
      const m = /^[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)/i.exec(sql.slice(i));
      if (m) {
        push();
        delimiter = m[1];
        i += m[0].length;
        continue;
      }
    }
    const ch = sql[i];
    const next = sql[i + 1];

    // Comments: -- (followed by space/end), #, /* */ — skipped (but /*! version comments are kept).
    if ((ch === '-' && next === '-' && /[\s]|^$/.test(sql[i + 2] ?? '')) || ch === '#') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*' && sql[i + 2] !== '!') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }

    // Quoted strings / identifiers: copy through, honouring '' and \' escapes.
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '\\' && ch !== '`') { j += 2; continue; }
        if (sql[j] === ch) {
          if (sql[j + 1] === ch) { j += 2; continue; }
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j + 1);
      i = j + 1;
      atLineStart = false;
      continue;
    }

    if (sql.startsWith(delimiter, i)) {
      push();
      i += delimiter.length;
      atLineStart = false;
      continue;
    }

    current += ch;
    atLineStart = ch === '\n';
    i += 1;
  }
  push();
  return statements;
}
