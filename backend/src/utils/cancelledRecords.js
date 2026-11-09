import { pool, withTransaction } from '../config/db.js';
import { requirePermission } from '../middleware/auth.js';
import { HttpError, parseId } from './httpError.js';
import { writeAudit } from './audit.js';
import { adminApproval, recordLabel } from './changeGuard.js';
import { moveToBin } from './recycleBin.js';

// Money records (bills, receipts, payments, expenses, cash entries, craft jobs) are never changed in a way
// that moves money or stock. Adds two routes on `path` (e.g. '/:id'):
//   PATCH  - change only harmless fields such as reference no. and notes (skipped when no `fields`)
//   DELETE - only once the record is cancelled (cancel already reversed stock and money), so deleting
//            changes no balance. The rows go to the recycle bin and come back still cancelled.
// `children(conn, row)` returns [{ table, rows }] that go with the record, in insert order after it,
// and throws if something still depends on it.
function mustBeCancelled(row) {
  if (row.status !== 'cancelled') throw new HttpError(400, 'Cancel it first. Only cancelled records can be deleted.');
}

export function cancelledRecordRoutes(router, { path = '/:id', table, module, fields, children, find }) {
  if (fields) {
    router.patch(path, requirePermission(`${module}.edit`), adminApproval(`${module}.edit`, { table, action: 'update' }, async (req, res) => {
      const id = parseId(req.params.id);
      const data = fields.parse(req.body);
      const cols = Object.keys(data);
      if (!cols.length) throw new HttpError(400, 'Nothing to change');
      await withTransaction(async (conn) => {
        const [[before]] = await conn.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
        if (!before) throw new HttpError(404, 'Record not found');
        await conn.query(`UPDATE ${table} SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => data[c]), id]);
        await writeAudit(conn, req, {
          action: 'update',
          table,
          recordId: id,
          oldValues: Object.fromEntries(cols.map((c) => [c, before[c]])),
          newValues: data,
        });
      });
      res.json(find ? await find(pool, id) : { id });
    }));
  }

  router.delete(path, requirePermission(`${module}.delete`), adminApproval(`${module}.delete`, { table, action: 'delete', check: mustBeCancelled }, async (req, res) => {
    const id = parseId(req.params.id);
    await withTransaction(async (conn) => {
      const [[row]] = await conn.query(`SELECT * FROM ${table} WHERE id = ? FOR UPDATE`, [id]);
      if (!row) throw new HttpError(404, 'Record not found');
      mustBeCancelled(row);
      const parts = [{ table, rows: [row] }, ...(children ? await children(conn, row) : [])];
      await moveToBin(conn, req, { table, recordId: id, label: recordLabel(row), parts });
      // Children first, then the record itself.
      for (const part of [...parts].reverse()) {
        if (part.rows.length) await conn.query(`DELETE FROM ${part.table} WHERE id IN (?)`, [part.rows.map((r) => r.id)]);
      }
      await writeAudit(conn, req, { action: 'delete', table, recordId: id, oldValues: row });
    });
    res.status(204).end();
  }));
}
