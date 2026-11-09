import { Router } from 'express';
import { ZodError, z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { adminOnlyChanges, parseJson, replayChange } from '../../utils/changeGuard.js';
import { restoreFromBin } from '../../utils/recycleBin.js';

// Admin only (mounted with requireAdmin): the edit/delete lock, change requests, recycle bin and danger log.
const router = Router();

// Change requests the logged-in user sent (any user).
export const myRequestsRouter = Router();

const REQUEST_SELECT = `
  SELECT cr.*, u.name AS requested_by_name, rv.name AS reviewed_by_name
  FROM change_requests cr
  JOIN users u ON u.id = cr.requested_by
  LEFT JOIN users rv ON rv.id = cr.reviewed_by`;

function presentRequest(row) {
  return { ...row, params: parseJson(row.params), payload: parseJson(row.payload), old_values: parseJson(row.old_values) };
}

// True when the record changed (or is gone) since the request was made, so Admin knows the request may be out of date.
async function isStale(request) {
  const [[current]] = await pool.query(`SELECT * FROM ${request.table_name} WHERE id = ?`, [request.record_id]);
  if (!current) return true;
  const before = request.old_values || {};
  return Object.keys(before).some((k) => JSON.stringify(current[k]) !== JSON.stringify(before[k]));
}

router.get('/settings', async (req, res) => {
  res.json({ admin_only_changes: await adminOnlyChanges() });
});

router.put('/settings', async (req, res) => {
  const { admin_only_changes: on } = z.object({ admin_only_changes: z.boolean() }).parse(req.body);
  const before = await adminOnlyChanges();
  await pool.query(
    "INSERT INTO settings (setting_key, setting_value) VALUES ('admin_only_changes', ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
    [on ? '1' : '0'],
  );
  await writeAudit(pool, req, {
    action: 'update',
    table: 'settings',
    oldValues: { admin_only_changes: before },
    newValues: { admin_only_changes: on },
  });
  res.json({ admin_only_changes: on });
});

router.get('/requests', async (req, res) => {
  const { status } = z.object({ status: z.enum(['pending', 'all']).default('pending') }).parse(req.query);
  const [rows] = await pool.query(
    `${REQUEST_SELECT} ${status === 'pending' ? "WHERE cr.status = 'pending'" : ''} ORDER BY cr.id DESC LIMIT 300`,
  );
  const list = rows.map(presentRequest);
  for (const r of list) if (r.status === 'pending') r.is_stale = await isStale(r);
  res.json(list);
});

// Claims a pending request so two Admins cannot answer it at the same time.
async function claim(id, adminId) {
  const [result] = await pool.query(
    "UPDATE change_requests SET reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending' AND reviewed_at IS NULL",
    [adminId, id],
  );
  if (!result.affectedRows) throw new HttpError(409, 'This request was already answered');
  const [[row]] = await pool.query(`${REQUEST_SELECT} WHERE cr.id = ?`, [id]);
  return presentRequest(row);
}

router.post('/requests/:id/approve', async (req, res) => {
  const request = await claim(parseId(req.params.id), req.user.id);
  try {
    await replayChange(request, req);
  } catch (err) {
    let message = 'The change could not be applied';
    if (err instanceof HttpError) message = err.message.slice(0, 255);
    else if (err instanceof ZodError) message = err.issues[0]?.message || 'Some values are not valid any more';
    else if (err.code === 'ER_DUP_ENTRY') message = 'A record with the same name or code exists now';
    else console.error(err);
    await pool.query("UPDATE change_requests SET status = 'failed', review_note = ? WHERE id = ?", [message, request.id]);
    await writeAudit(pool, req, { action: 'approve_failed', table: request.table_name, recordId: request.record_id, newValues: { request_id: request.id, message } });
    throw new HttpError(409, `Could not apply the change: ${message}`);
  }
  await pool.query("UPDATE change_requests SET status = 'approved' WHERE id = ?", [request.id]);
  await writeAudit(pool, req, {
    action: 'approve',
    table: request.table_name,
    recordId: request.record_id,
    newValues: { request_id: request.id, requested_by: request.requested_by_name, change: request.action },
  });
  res.json({ ...request, status: 'approved' });
});

router.post('/requests/:id/reject', async (req, res) => {
  const note = optionalText(255).parse(req.body?.note);
  const request = await claim(parseId(req.params.id), req.user.id);
  await pool.query("UPDATE change_requests SET status = 'rejected', review_note = ? WHERE id = ?", [note, request.id]);
  await writeAudit(pool, req, {
    action: 'reject',
    table: request.table_name,
    recordId: request.record_id,
    newValues: { request_id: request.id, requested_by: request.requested_by_name, note },
  });
  res.json({ ...request, status: 'rejected', review_note: note });
});

router.get('/recycle-bin', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT d.*, u.name AS deleted_by_name, r.name AS restored_by_name
     FROM deleted_records d
     JOIN users u ON u.id = d.deleted_by
     LEFT JOIN users r ON r.id = d.restored_by
     ORDER BY d.id DESC LIMIT 300`,
  );
  res.json(rows.map((r) => ({ ...r, data: parseJson(r.data), extra: parseJson(r.extra) })));
});

router.post('/recycle-bin/:id/restore', async (req, res) => {
  const id = parseId(req.params.id);
  const bin = await withTransaction((conn) => restoreFromBin(conn, req, id));
  res.json({ id, table_name: bin.table_name, record_id: bin.record_id });
});

const LOG_ACTIONS = ['update', 'delete', 'disable', 'cancel', 'restore', 'approve', 'approve_failed', 'reject', 'stock_reverse',
  'request_update', 'request_delete'];

router.get('/logs', async (req, res) => {
  const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
  const [rows] = await pool.query(
    `SELECT a.id, a.user_id, u.name AS user_name, a.action, a.table_name, a.record_id,
            a.old_values, a.new_values, a.ip_address, a.created_at
     FROM audit_logs a JOIN users u ON u.id = a.user_id
     WHERE a.action IN (?)
     ORDER BY a.id DESC LIMIT ?`,
    [LOG_ACTIONS, limit],
  );
  res.json(rows.map((r) => ({ ...r, old_values: parseJson(r.old_values), new_values: parseJson(r.new_values) })));
});

myRequestsRouter.get('/mine', async (req, res) => {
  const [rows] = await pool.query(`${REQUEST_SELECT} WHERE cr.requested_by = ? ORDER BY cr.id DESC LIMIT 200`, [req.user.id]);
  res.json(rows.map(presentRequest));
});

export default router;
