// Every rupee that moved in or out of the shop, one row per movement, from all the tables that hold money:
//   txn_date, kind, ref_id, ref_no, party, method, account ('cash' | 'bank'), direction (+1 in / -1 out), amount
// Paid in cash -> Cash account; card, bank transfer and cheque -> Bank account.
// Old gold taken as credit / exchange (method 'old_gold') is not money and is left out; old gold bought for cash is money out.
// A cash <-> bank transfer is two rows (out of one account, into the other).
const ACCOUNT_OF = (col) => `CASE ${col} WHEN 'cash' THEN 'cash' ELSE 'bank' END`;

export const MONEY_FLOW_SQL = `
  SELECT DATE(p.payment_date) AS txn_date, 'receipt' AS kind, p.id AS ref_id, p.receipt_no AS ref_no,
         COALESCE(c.name, 'Walk-in') AS party, p.method, ${ACCOUNT_OF('p.method')} AS account, 1 AS direction, p.amount
  FROM customer_payments p LEFT JOIN customers c ON c.id = p.customer_id
  WHERE p.status = 'active' AND p.method <> 'old_gold'
  UNION ALL
  SELECT g.receipt_date, 'old_gold', g.id, g.receipt_no, COALESCE(c.name, 'Walk-in'), g.payout_method, ${ACCOUNT_OF('g.payout_method')}, -1, g.total_value
  FROM old_gold_receipts g LEFT JOIN customers c ON c.id = g.customer_id
  WHERE g.status = 'active' AND g.mode = 'cash'
  UNION ALL
  SELECT p.payment_date, 'supplier_payment', p.id, p.payment_no, s.name, p.method, ${ACCOUNT_OF('p.method')}, -1, p.amount
  FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.status = 'active'
  UNION ALL
  SELECT p.payment_date, 'craftsman_payment', p.id, p.payment_no, c.name, p.method, ${ACCOUNT_OF('p.method')}, -1, p.amount
  FROM craftsman_payments p JOIN craftsmen c ON c.id = p.craftsman_id
  WHERE p.status = 'active'
  UNION ALL
  SELECT e.expense_date, 'expense', e.id, e.expense_no, CONCAT_WS(' · ', ec.name, e.paid_to), e.method, ${ACCOUNT_OF('e.method')}, -1, e.amount
  FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
  WHERE e.status = 'active'
  UNION ALL
  SELECT ce.entry_date, ce.entry_type, ce.id, ce.entry_no, ce.notes, NULL,
         CASE ce.entry_type WHEN 'deposit' THEN 'cash' WHEN 'withdrawal' THEN 'bank' ELSE ce.account END,
         CASE WHEN ce.entry_type IN ('opening', 'capital_in') THEN 1 ELSE -1 END, ce.amount
  FROM cash_entries ce
  WHERE ce.status = 'active'
  UNION ALL
  SELECT ce.entry_date, ce.entry_type, ce.id, ce.entry_no, ce.notes, NULL,
         CASE ce.entry_type WHEN 'deposit' THEN 'bank' ELSE 'cash' END, 1, ce.amount
  FROM cash_entries ce
  WHERE ce.status = 'active' AND ce.entry_type IN ('deposit', 'withdrawal')`;

// Money that only moves between the shop's own accounts, or comes from / goes to the owner:
// shown separately, not counted as trading money in / out.
export const TRANSFER_KINDS = ['deposit', 'withdrawal'];
export const OWNER_KINDS = ['opening', 'capital_in', 'drawing'];

const round2 = (n) => Math.round(Number(n) * 100) / 100;

// Current balance of each account: { cash, bank }. `db` can be the pool or a transaction connection.
export async function accountBalances(db) {
  const [rows] = await db.query(
    `SELECT f.account, SUM(f.direction * f.amount) AS balance FROM (${MONEY_FLOW_SQL}) f GROUP BY f.account`,
  );
  const out = { cash: 0, bank: 0 };
  for (const r of rows) out[r.account] = round2(r.balance);
  return out;
}
