import { HttpError } from './httpError.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// 'YYYY-MM-DD' -> '9 Nov 2026'
export function prettyDate(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// Today's date as the database sees it (sales and receipts are stamped with NOW()).
export async function dbToday(conn) {
  const [[{ today }]] = await conn.query('SELECT CURDATE() AS today');
  return String(today).slice(0, 10);
}

// Throws when the day end has been done for this date. Call inside the transaction that saves
// or cancels a record of that date. `date` can be 'YYYY-MM-DD', a DATETIME string, or null (= today).
// LOCK IN SHARE MODE (not FOR SHARE, which MariaDB rejects): a day being closed at the same moment waits for this save to finish (and the other way round).
export async function assertDayOpen(conn, date = null) {
  const ymd = date ? String(date).slice(0, 10) : await dbToday(conn);
  const [[closed]] = await conn.query(
    "SELECT id FROM day_closings WHERE close_date = ? AND status = 'closed' LOCK IN SHARE MODE",
    [ymd],
  );
  if (closed) {
    throw new HttpError(400, `${prettyDate(ymd)} is closed (day end done). Ask an Admin to re-open the day first.`, 'DAY_CLOSED');
  }
}
