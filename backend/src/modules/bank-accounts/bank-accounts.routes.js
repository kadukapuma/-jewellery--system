import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { accountBalances } from '../finance/finance.service.js';

// The shop's banks and the accounts it holds at each one. Payments by card / bank transfer / cheque
// name the account the money went to or came from. Accounts are deactivated, never deleted.
const router = Router();

// Everyone who records money needs the list to choose an account.
const CAN_PICK = [
  'bank_accounts.view', 'bank_accounts.manage', 'finance.view', 'sales.create', 'customer_payments.create',
  'supplier_payments.create', 'purchases.create', 'craftsman_payments.create', 'expenses.create',
  'cash_entries.create', 'repairs.deliver', 'repairs.create', 'old_gold.create',
];

const bankSchema = z.object({
  name: z.string().trim().min(1, 'Enter the bank name').max(100),
  is_active: z.boolean().default(true),
});

const accountSchema = z.object({
  bank_id: z.coerce.number({ error: 'Choose the bank' }).int().positive('Choose the bank'),
  account_name: z.string().trim().min(1, 'Enter a name for the account').max(100),
  account_no: z.string().trim().min(1, 'Enter the account number').max(50),
  branch: optionalText(100),
  is_active: z.boolean().default(true),
});

async function findBank(db, id) {
  const [[row]] = await db.query('SELECT * FROM banks WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Bank not found');
  return { ...row, is_active: !!row.is_active };
}

async function findAccount(db, id) {
  const [[row]] = await db.query(
    `SELECT ba.*, b.name AS bank_name FROM bank_accounts ba JOIN banks b ON b.id = ba.bank_id WHERE ba.id = ?`,
    [id],
  );
  if (!row) throw new HttpError(404, 'Bank account not found');
  return { ...row, is_active: !!row.is_active };
}

const dupName = async (db, name, id = 0) => {
  const [[dup]] = await db.query('SELECT id FROM banks WHERE name = ? AND id <> ?', [name, id]);
  if (dup) throw new HttpError(400, `There is already a bank called "${name}"`);
};

const dupAccount = async (db, data, id = 0) => {
  const [[dup]] = await db.query('SELECT id FROM bank_accounts WHERE bank_id = ? AND account_no = ? AND id <> ?', [data.bank_id, data.account_no, id]);
  if (dup) throw new HttpError(400, `Account ${data.account_no} is already set up for this bank`);
};

// ---- Banks -------------------------------------------------------------
router.get('/banks', requirePermission(...CAN_PICK), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*, (SELECT COUNT(*) FROM bank_accounts ba WHERE ba.bank_id = b.id) AS account_count
     FROM banks b ${req.query.active === 'true' ? 'WHERE b.is_active = 1' : ''} ORDER BY b.is_active DESC, b.name`,
  );
  res.json(rows.map((r) => ({ ...r, is_active: !!r.is_active, account_count: Number(r.account_count) })));
});

router.post('/banks', requirePermission('bank_accounts.manage'), async (req, res) => {
  const data = bankSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    await dupName(conn, data.name);
    const [result] = await conn.query('INSERT INTO banks (name, is_active) VALUES (?, ?)', [data.name, data.is_active ? 1 : 0]);
    await writeAudit(conn, req, { action: 'create', table: 'banks', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findBank(pool, id));
});

router.put('/banks/:id', requirePermission('bank_accounts.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = bankSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findBank(conn, id);
    await dupName(conn, data.name, id);
    await conn.query('UPDATE banks SET name = ?, is_active = ? WHERE id = ?', [data.name, data.is_active ? 1 : 0, id]);
    await writeAudit(conn, req, { action: 'update', table: 'banks', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findBank(pool, id));
});

// ---- Accounts ----------------------------------------------------------
// Every account with its bank and current balance. ?active=true -> only accounts that can be used now.
router.get('/', requirePermission(...CAN_PICK), async (req, res) => {
  const balances = await accountBalances(pool);
  const accounts = req.query.active === 'true' ? balances.accounts.filter((a) => a.is_active) : balances.accounts;
  res.json({ accounts, unassigned: balances.unassigned, bank: balances.bank });
});

router.post('/', requirePermission('bank_accounts.manage'), async (req, res) => {
  const data = accountSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    await findBank(conn, data.bank_id);
    await dupAccount(conn, data);
    const [result] = await conn.query(
      'INSERT INTO bank_accounts (bank_id, account_name, account_no, branch, is_active) VALUES (?, ?, ?, ?, ?)',
      [data.bank_id, data.account_name, data.account_no, data.branch, data.is_active ? 1 : 0],
    );
    await writeAudit(conn, req, { action: 'create', table: 'bank_accounts', recordId: result.insertId, newValues: data });
    return result.insertId;
  });
  res.status(201).json(await findAccount(pool, id));
});

router.put('/:id', requirePermission('bank_accounts.manage'), async (req, res) => {
  const id = parseId(req.params.id);
  const data = accountSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const before = await findAccount(conn, id);
    await findBank(conn, data.bank_id);
    if (before.bank_id !== data.bank_id) {
      const [[used]] = await conn.query(
        `SELECT (SELECT COUNT(*) FROM customer_payments WHERE bank_account_id = ?) + (SELECT COUNT(*) FROM supplier_payments WHERE bank_account_id = ?)
              + (SELECT COUNT(*) FROM craftsman_payments WHERE bank_account_id = ?) + (SELECT COUNT(*) FROM expenses WHERE bank_account_id = ?)
              + (SELECT COUNT(*) FROM old_gold_receipts WHERE bank_account_id = ?)
              + (SELECT COUNT(*) FROM cash_entries WHERE bank_account_id = ? OR to_bank_account_id = ?) AS n`,
        [id, id, id, id, id, id, id],
      );
      if (Number(used.n) > 0) throw new HttpError(400, 'This account already has money recorded, so its bank cannot be changed');
    }
    await dupAccount(conn, data, id);
    await conn.query(
      'UPDATE bank_accounts SET bank_id = ?, account_name = ?, account_no = ?, branch = ?, is_active = ? WHERE id = ?',
      [data.bank_id, data.account_name, data.account_no, data.branch, data.is_active ? 1 : 0, id],
    );
    await writeAudit(conn, req, { action: 'update', table: 'bank_accounts', recordId: id, oldValues: before, newValues: data });
  });
  res.json(await findAccount(pool, id));
});

export default router;
