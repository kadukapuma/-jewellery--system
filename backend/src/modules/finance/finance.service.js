// Every rupee that moved in or out of the shop, one row per movement, from all the tables that hold money:
//   txn_date, kind, ref_id, ref_no, party, method, account ('cash' | 'bank'), bank_account_id, direction (+1 in / -1 out), amount
// Paid in cash -> Cash account; card, bank transfer and cheque -> Bank, in the bank account the payment names
// (bank_account_id NULL = recorded before bank accounts existed: "Unassigned").
// Old gold taken as credit / exchange (method 'old_gold') is not money and is left out; old gold bought for cash is money out.
// A transfer (cash <-> bank, bank <-> bank) is two rows (out of one account, into the other).
const ACCOUNT_OF = (col) => `CASE ${col} WHEN 'cash' THEN 'cash' ELSE 'bank' END`;
const BANK_OF = (methodCol, idCol) => `CASE ${methodCol} WHEN 'cash' THEN NULL ELSE ${idCol} END`;

export const MONEY_FLOW_SQL = `
  SELECT DATE(p.payment_date) AS txn_date, 'receipt' AS kind, p.id AS ref_id, p.receipt_no AS ref_no,
         COALESCE(c.name, 'Walk-in') AS party, p.method, ${ACCOUNT_OF('p.method')} AS account,
         ${BANK_OF('p.method', 'p.bank_account_id')} AS bank_account_id, 1 AS direction, p.amount
  FROM customer_payments p LEFT JOIN customers c ON c.id = p.customer_id
  WHERE p.status = 'active' AND p.method <> 'old_gold'
  UNION ALL
  SELECT g.receipt_date, 'old_gold', g.id, g.receipt_no, COALESCE(c.name, 'Walk-in'), g.payout_method, ${ACCOUNT_OF('g.payout_method')},
         ${BANK_OF('g.payout_method', 'g.bank_account_id')}, -1, g.total_value
  FROM old_gold_receipts g LEFT JOIN customers c ON c.id = g.customer_id
  WHERE g.status = 'active' AND g.mode = 'cash'
  UNION ALL
  SELECT p.payment_date, 'supplier_payment', p.id, p.payment_no, s.name, p.method, ${ACCOUNT_OF('p.method')},
         ${BANK_OF('p.method', 'p.bank_account_id')}, -1, p.amount
  FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.status = 'active'
  UNION ALL
  SELECT p.payment_date, 'craftsman_payment', p.id, p.payment_no, c.name, p.method, ${ACCOUNT_OF('p.method')},
         ${BANK_OF('p.method', 'p.bank_account_id')}, -1, p.amount
  FROM craftsman_payments p JOIN craftsmen c ON c.id = p.craftsman_id
  WHERE p.status = 'active'
  UNION ALL
  SELECT e.expense_date, 'expense', e.id, e.expense_no, CONCAT_WS(' · ', ec.name, e.paid_to), e.method, ${ACCOUNT_OF('e.method')},
         ${BANK_OF('e.method', 'e.bank_account_id')}, -1, e.amount
  FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
  WHERE e.status = 'active'
  UNION ALL
  SELECT ce.entry_date, ce.entry_type, ce.id, ce.entry_no, ce.notes, NULL,
         CASE ce.entry_type WHEN 'deposit' THEN 'cash' WHEN 'withdrawal' THEN 'bank' WHEN 'bank_to_bank' THEN 'bank' ELSE ce.account END,
         CASE WHEN ce.entry_type = 'deposit' THEN NULL
              WHEN ce.entry_type IN ('withdrawal', 'bank_to_bank') OR ce.account = 'bank' THEN ce.bank_account_id
              ELSE NULL END,
         CASE WHEN ce.entry_type IN ('opening', 'capital_in') THEN 1 ELSE -1 END, ce.amount
  FROM cash_entries ce
  WHERE ce.status = 'active'
  UNION ALL
  SELECT ce.entry_date, ce.entry_type, ce.id, ce.entry_no, ce.notes, NULL,
         CASE ce.entry_type WHEN 'withdrawal' THEN 'cash' ELSE 'bank' END,
         CASE ce.entry_type WHEN 'deposit' THEN ce.bank_account_id WHEN 'bank_to_bank' THEN ce.to_bank_account_id ELSE NULL END,
         1, ce.amount
  FROM cash_entries ce
  WHERE ce.status = 'active' AND ce.entry_type IN ('deposit', 'withdrawal', 'bank_to_bank')`;

// Money that only moves between the shop's own accounts, or comes from / goes to the owner:
// shown separately, not counted as trading money in / out.
export const TRANSFER_KINDS = ['deposit', 'withdrawal', 'bank_to_bank'];
export const OWNER_KINDS = ['opening', 'capital_in', 'drawing'];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

// The shop's bank accounts with their bank's name, oldest first.
export async function listBankAccounts(db, { activeOnly = false } = {}) {
  const [rows] = await db.query(
    `SELECT ba.id, ba.bank_id, b.name AS bank_name, ba.account_name, ba.account_no, ba.branch,
            (ba.is_active = 1 AND b.is_active = 1) AS is_active
     FROM bank_accounts ba JOIN banks b ON b.id = ba.bank_id
     ${activeOnly ? 'WHERE ba.is_active = 1 AND b.is_active = 1' : ''}
     ORDER BY b.name, ba.account_name, ba.id`,
  );
  return rows.map((r) => ({ ...r, is_active: !!Number(r.is_active) }));
}

// Current balance of each account. `db` can be the pool or a transaction connection.
//   { cash, bank (all bank money), unassigned (bank money with no account), accounts: [{ id, bank_name, ..., balance }] }
export async function accountBalances(db) {
  const [rows] = await db.query(
    `SELECT f.account, f.bank_account_id, SUM(f.direction * f.amount) AS balance
     FROM (${MONEY_FLOW_SQL}) f GROUP BY f.account, f.bank_account_id`,
  );
  const out = { cash: 0, bank: 0, unassigned: 0, accounts: [] };
  const byId = new Map();
  for (const r of rows) {
    const bal = round2(r.balance);
    if (r.account === 'cash') { out.cash = round2(out.cash + bal); continue; }
    out.bank = round2(out.bank + bal);
    if (r.bank_account_id == null) out.unassigned = round2(out.unassigned + bal);
    else byId.set(Number(r.bank_account_id), round2((byId.get(Number(r.bank_account_id)) || 0) + bal));
  }
  out.accounts = (await listBankAccounts(db)).map((a) => ({ ...a, balance: byId.get(a.id) || 0 }));
  return out;
}

// Balance of one bank account right now.
export async function bankAccountBalance(db, id) {
  const [[row]] = await db.query(
    `SELECT COALESCE(SUM(f.direction * f.amount), 0) AS balance FROM (${MONEY_FLOW_SQL}) f
     WHERE f.account = 'bank' AND f.bank_account_id = ?`,
    [id],
  );
  return round2(row.balance);
}
