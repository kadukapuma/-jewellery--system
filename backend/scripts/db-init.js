// Creates the database from database/schema.sql.
//   npm run db:init   -> only if the database is empty
//   npm run db:fresh  -> DELETES the database and creates it again
// schema.sql already includes every migration, so they are all recorded as applied in schema_migrations.
import fs from 'node:fs';
import {
  connect, dbName, ensureMigrationsTable, markApplied, migrationFiles, schemaPath,
} from './lib/migrations.js';

const fresh = process.argv.includes('--fresh');

const conn = await connect();

try {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
    [dbName],
  );
  if (n > 0 && !fresh) {
    console.error(`Database "${dbName}" already has ${n} tables. Run "npm run db:fresh" to delete it and start again,`);
    console.error('or "npm run db:migrate" to bring it up to date.');
    process.exitCode = 1;
  } else {
    if (fresh) await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    const sql = fs.readFileSync(schemaPath, 'utf8').replace(/\bjewellery_system\b/g, dbName);
    await conn.query(sql);
    await conn.query(`USE \`${dbName}\``);
    await ensureMigrationsTable(conn);
    const files = migrationFiles();
    await markApplied(conn, files);
    console.log(`Database "${dbName}" created from ${schemaPath}`);
    console.log(`Recorded ${files.length} migration(s) as already applied (schema.sql includes them).`);
  }
} finally {
  await conn.end();
}
