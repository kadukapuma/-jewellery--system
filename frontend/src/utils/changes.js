// Labels for change requests, the recycle bin and the danger log.

export const TABLE_LABELS = {
  customers: 'Customer',
  suppliers: 'Supplier',
  craftsmen: 'Craftsman',
  categories: 'Category',
  karats: 'Karat',
  items: 'Item',
  purchases: 'Purchase',
  craft_jobs: 'Craft job',
  tag_templates: 'Tag template',
  expense_categories: 'Expense category',
  roles: 'Role',
  users: 'User',
  settings: 'Setting',
  sales: 'Bill',
  customer_payments: 'Receipt',
  supplier_payments: 'Supplier payment',
  craftsman_payments: 'Craftsman payment',
  expenses: 'Expense',
  cash_entries: 'Cash / bank entry',
  gold_prices: 'Gold price',
  stock_movements: 'Stock adjustment',
};

export const REQUEST_STATUS = {
  pending: { label: 'Waiting', color: 'warning' },
  approved: { label: 'Approved', color: 'success' },
  rejected: { label: 'Rejected', color: 'default' },
  failed: { label: 'Could not apply', color: 'error' },
};

export const LOG_ACTIONS = {
  update: { label: 'Edited', color: 'info' },
  delete: { label: 'Deleted', color: 'error' },
  disable: { label: 'Disabled', color: 'warning' },
  cancel: { label: 'Cancelled', color: 'warning' },
  restore: { label: 'Restored', color: 'success' },
  approve: { label: 'Approved', color: 'success' },
  approve_failed: { label: 'Approval failed', color: 'error' },
  reject: { label: 'Rejected', color: 'default' },
  stock_reverse: { label: 'Stock undone', color: 'info' },
  request_update: { label: 'Asked to edit', color: 'default' },
  request_delete: { label: 'Asked to delete', color: 'default' },
};

export function tableLabel(table) {
  return TABLE_LABELS[table] || table;
}

// What a request asks for, in words: "Edit Customer Kamal" / "Delete Bill INV-000012".
export function requestTitle(r) {
  const what = r.route_key === 'items.reverse_stock' ? 'Undo' : r.action === 'delete' ? 'Delete' : 'Edit';
  return `${what} ${tableLabel(r.table_name)} ${r.record_label || `#${r.record_id}`}`;
}

export function showValue(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const HIDDEN = new Set(['password', 'password_hash', 'created_at', 'updated_at']);

// 1/0 from the database and true/false from a form mean the same thing.
function same(v) {
  return typeof v === 'boolean' ? String(Number(v)) : showValue(v);
}

// [{ field, before, after, changed }] for the fields a change touches.
export function diffRows(before, after) {
  const b = before || {};
  const a = after || {};
  const keys = after ? Object.keys(a) : Object.keys(b);
  return keys
    .filter((k) => !HIDDEN.has(k))
    .map((k) => ({
      field: k.replace(/_/g, ' '),
      before: b[k],
      after: a[k],
      changed: !!after && same(b[k]) !== same(a[k]),
    }));
}
