import app from './app.js';
import { env } from './config/env.js';
import { pool } from './config/db.js';

try {
  await pool.query('SELECT 1');
} catch (err) {
  console.error(`Cannot connect to MySQL at ${env.db.host}:${env.db.port} (${err.code || err.message})`);
  process.exit(1);
}

app.listen(env.port, () => {
  console.log(`Jewellery API running on http://localhost:${env.port}`);
});
