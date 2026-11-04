import { pool } from '../config/db.js';

export async function getSetting(key, fallback) {
  const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  return rows.length ? rows[0].setting_value : fallback;
}
