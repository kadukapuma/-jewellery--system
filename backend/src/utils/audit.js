// Records who changed what. `db` can be the pool or a transaction connection.
export async function writeAudit(db, req, { action, table, recordId = null, oldValues = null, newValues = null }) {
  await db.query(
    `INSERT INTO audit_logs (user_id, action, table_name, record_id, old_values, new_values, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      action,
      table,
      recordId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      req.ip,
    ],
  );
}
