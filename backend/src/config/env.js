import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load backend/.env when the app is started without --env-file (e.g. by a hosting panel).
// Values already set in the environment win.
const envFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name} (see backend/.env.example)`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT || 5000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'jewellery_system',
  },
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  goldPriceUrl: process.env.GOLD_PRICE_URL || 'https://www.goldpricetoday.lk/api/v1/gold-price',
  // Help desk: support requests go to the system provider's Task Manager. The key stays on the server.
  taskManager: {
    url: (process.env.TASK_MANAGER_API_URL || '').trim().replace(/\/+$/, ''),
    key: (process.env.TASK_MANAGER_API_KEY || '').trim(),
    branchCode: (process.env.TASK_MANAGER_BRANCH_CODE || '').trim(),
  },
};
