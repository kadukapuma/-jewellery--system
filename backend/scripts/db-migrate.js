// Brings an existing database up to date by running the files in database/migrations/ that it hasn't had yet.
// Each applied file is recorded in the schema_migrations table, so it never runs twice.
//   npm run db:migrate                   -> run every pending migration, oldest first
//   npm run db:migrate -- --status       -> list applied and pending migrations, change nothing
//   npm run db:migrate -- --mark-all     -> record every migration as applied WITHOUT running it
//                                           (for a database already brought up to date by hand)
//   npm run db:migrate -- --mark <file>  -> record one migration as applied without running it
import fs from 'node:fs';
import path from 'node:path';
import {
  appliedMigrations, connect, dbName, ensureMigrationsTable, markApplied, migrationFiles, migrationsDir, splitSql,
} from './lib/migrations.js';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

let conn;
try {
  conn = await connect({ database: dbName });
} catch (err) {
  console.error(`Could not connect to database "${dbName}": ${err.message}`);
  console.error('If it does not exist yet, run "npm run db:init" first.');
  process.exit(1);
}

try {
  await ensureMigrationsTable(conn);
  const files = migrationFiles();
  const applied = await appliedMigrations(conn);
  const pending = files.filter((f) => !applied.has(f));

  if (has('--status')) {
    for (const f of files) {
      const at = applied.get(f);
      console.log(`${at ? 'applied' : 'PENDING'}  ${f}${at ? `  (${new Date(at).toLocaleString()})` : ''}`);
    }
    for (const name of applied.keys()) {
      if (!files.includes(name)) console.log(`applied  ${name}  (file no longer in database/migrations)`);
    }
    console.log(`\n${pending.length} pending of ${files.length}.`);
  } else if (has('--mark-all')) {
    await markApplied(conn, pending);
    console.log(pending.length
      ? `Recorded ${pending.length} migration(s) as applied without running them:\n  ${pending.join('\n  ')}`
      : 'Nothing to mark: every migration is already recorded.');
  } else if (has('--mark')) {
    const name = args[args.indexOf('--mark') + 1];
    if (!name || !files.includes(name)) {
      console.error(`Give a file name from database/migrations, e.g. --mark ${files[files.length - 1] || '2026-01-01-example.sql'}`);
      process.exitCode = 1;
    } else {
      await markApplied(conn, [name]);
      console.log(`Recorded ${name} as applied without running it.`);
    }
  } else if (!pending.length) {
    console.log(`Database "${dbName}" is up to date (${files.length} migration(s) applied).`);
  } else {
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      const statements = splitSql(sql);
      process.stdout.write(`Running ${file} (${statements.length} statements)… `);
      for (const [n, statement] of statements.entries()) {
        try {
          await conn.query(statement);
        } catch (err) {
          console.log('FAILED');
          console.error(`\nStatement ${n + 1} of ${file} failed: ${err.message}\n\n${statement}\n`);
          console.error('Stopped here. Earlier statements of this file may already have run (MySQL cannot undo table changes).');
          console.error(`Fix the problem, then run "npm run db:migrate" again — or if the change is already in place,`);
          console.error(`record it with: npm run db:migrate -- --mark ${file}`);
          process.exit(1);
        }
      }
      await markApplied(conn, [file]);
      console.log('done');
    }
    console.log(`\nApplied ${pending.length} migration(s). Database "${dbName}" is up to date.`);
  }
} finally {
  await conn.end();
}
