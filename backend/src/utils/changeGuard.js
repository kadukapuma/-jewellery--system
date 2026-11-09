import { pool } from '../config/db.js';
import { HttpError, parseId } from './httpError.js';
import { writeAudit } from './audit.js';
import { getSetting } from './settings.js';

// Route handlers that can be replayed when Admin approves a request, keyed like 'customers.update'.
const handlers = new Map();

const LABEL_FIELDS = ['invoice_no', 'receipt_no', 'payment_no', 'purchase_no', 'job_no', 'expense_no', 'entry_no', 'item_code', 'name'];

export function recordLabel(row) {
  const field = LABEL_FIELDS.find((f) => row?.[f]);
  return field ? String(row[field]).slice(0, 150) : null;
}

export function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

export async function adminOnlyChanges() {
  return (await getSetting('admin_only_changes', '1')) !== '0';
}

function changeReason(req) {
  const raw = req.get('x-change-reason') || '';
  try {
    return decodeURIComponent(raw).trim().slice(0, 255) || null;
  } catch {
    return raw.trim().slice(0, 255) || null;
  }
}

// Wraps an edit / delete handler. Admin (or anyone, when the Danger Zone lock is off) runs it
// directly; everyone else gets a pending change request that Admin approves or rejects.
// `check(row)` can refuse a request up front (e.g. deleting a bill that is not cancelled).
export function adminApproval(routeKey, { table, action, check }, handler) {
  handlers.set(routeKey, handler);
  return async (req, res) => {
    if (req.user.is_super_admin || !(await adminOnlyChanges())) return handler(req, res);

    const id = parseId(req.params.id);
    const [[row]] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    if (!row) throw new HttpError(404, 'Record not found');
    if (check) check(row);
    const [[waiting]] = await pool.query(
      "SELECT id FROM change_requests WHERE route_key = ? AND record_id = ? AND requested_by = ? AND status = 'pending'",
      [routeKey, id, req.user.id],
    );
    if (waiting) throw new HttpError(409, 'You already sent this request. Wait for Admin to answer it.');

    const reason = changeReason(req);
    const payload = req.body && Object.keys(req.body).length ? req.body : null;
    const [result] = await pool.query(
      `INSERT INTO change_requests
         (action, route_key, table_name, record_id, record_label, params, payload, old_values, reason, requested_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [action, routeKey, table, id, recordLabel(row), JSON.stringify(req.params), payload ? JSON.stringify(payload) : null,
        JSON.stringify(row), reason, req.user.id],
    );
    await writeAudit(pool, req, {
      action: `request_${action}`,
      table,
      recordId: id,
      oldValues: row,
      newValues: { request_id: result.insertId, reason, changes: payload },
    });
    res.status(202).json({
      change_request: { id: result.insertId, status: 'pending' },
      message: 'Sent to Admin for approval',
    });
  };
}

// Runs a stored request through its original handler as the approving Admin.
export async function replayChange(request, adminReq) {
  const handler = handlers.get(request.route_key);
  if (!handler) throw new HttpError(400, 'This kind of change can no longer be applied');
  const req = {
    params: parseJson(request.params),
    body: parseJson(request.payload) ?? {},
    query: {},
    headers: {},
    get: () => undefined,
    user: adminReq.user,
    ip: adminReq.ip,
    changeRequestId: request.id,
  };
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return res;
}
