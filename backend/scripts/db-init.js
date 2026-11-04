// Creates the database from database/schema.sql.
//   npm run db:init   -> only if the database is empty
//   npm run db:fresh  -> DELETES the database and creates it again
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(here, '../../database/schema.sql');
const dbName = process.env.DB_NAME || 'jewellery_system';
const fresh = process.argv.includes('--fresh');

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
});

try {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ?',
    [dbName],
  );
  if (n > 0 && !fresh) {
    console.error(`Database "${dbName}" already has ${n} tables. Run "npm run db:fresh" to delete it and start again.`);
    process.exitCode = 1;
  } else {
    if (fresh) await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    const sql = fs.readFileSync(schemaPath, 'utf8').replace(/\bjewellery_system\b/g, dbName);
    await conn.query(sql);
    console.log(`Database "${dbName}" created from ${schemaPath}`);
  }
} finally {
  await conn.end();
}
