import { HttpError } from './httpError.js';
import { writeAudit } from './audit.js';
import { parseJson, recordLabel } from './changeGuard.js';

// Rows that are about to be deleted. `db` can be the pool or a transaction connection.
export async function snapshot(db, table, where, params) {
  const [rows] = await db.query(`SELECT * FROM ${table} WHERE ${where}`, params);
  return rows;
}

// Call inside the delete transaction, before the DELETE statements.
// parts: [{ table, rows }] in the order they must be inserted back (parents first).
// extra: side effects of the delete that restore must undo (e.g. { stock_returns: [...] }).
export async function moveToBin(db, req, { table, recordId, label, parts, extra = null }) {
  await db.query(
    `INSERT INTO deleted_records (table_name, record_id, record_label, data, extra, deleted_by, change_request_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [table, recordId, label ? String(label).slice(0, 150) : null, JSON.stringify(parts.filter((p) => p.rows.length)),
      extra ? JSON.stringify(extra) : null, req.user.id, req.changeRequestId ?? null],
  );
}

// Single-row delete: the row goes in the bin labelled with its name / number.
export async function binRecord(db, req, table, id) {
  const rows = await snapshot(db, table, 'id = ?', [id]);
  await moveToBin(db, req, { table, recordId: id, label: recordLabel(rows[0]), parts: [{ table, rows }] });
}

// JSON columns come back as objects; everything else (dateStrings, decimalNumbers) goes back as-is.
function toSql(value) {
  return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
}

export async function restoreFromBin(conn, req, binId) {
  const [[bin]] = await conn.query('SELECT * FROM deleted_records WHERE id = ? FOR UPDATE', [binId]);
  if (!bin) throw new HttpError(404, 'Deleted record not found');
  if (bin.restored_at) throw new HttpError(400, 'This record was already restored');

  try {
    for (const part of parseJson(bin.data)) {
      for (const row of part.rows) {
        const cols = Object.keys(row);
        await conn.query(
          `INSERT INTO ${part.table} (${cols.map((c) => `\`${c}\``).join(', ')}) VALUES (?)`,
          [cols.map((c) => toSql(row[c]))],
        );
      }
    }
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      throw new HttpError(409, 'A record with the same name, number or code exists now. Change or remove it first.');
    }
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      throw new HttpError(409, 'Something this record belongs to (category, karat, supplier, customer…) was deleted. Restore that first.');
    }
    throw err;
  }

  const extra = parseJson(bin.extra);
  for (const r of extra?.stock_returns || []) {
    await conn.query('UPDATE items SET stock_qty = stock_qty + ? WHERE id = ?', [r.qty, r.item_id]);
    await conn.query(
      `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, note, created_by)
       VALUES (?, 'adjustment', ?, ?, ?, ?, 'Restored from recycle bin', ?)`,
      [r.item_id, r.qty, r.weight_g, bin.table_name, bin.record_id, req.user.id],
    );
  }

  await conn.query('UPDATE deleted_records SET restored_by = ?, restored_at = NOW() WHERE id = ?', [req.user.id, binId]);
  await writeAudit(conn, req, {
    action: 'restore',
    table: bin.table_name,
    recordId: bin.record_id,
    newValues: { recycle_bin_id: bin.id, label: bin.record_label },
  });
  return bin;
}
