import { z } from 'zod';
import { HttpError } from './httpError.js';

// The bank account a card / bank transfer / cheque payment went to or came from.
export const bankAccountIdField = z.coerce.number().int().positive().optional().nullable()
  .or(z.literal('').transform(() => null));

// Methods that are money in hand (or not money at all) have no bank account.
const NO_ACCOUNT_METHODS = ['cash', 'old_gold'];

// Checks the account for a payment and returns the id to store (null for cash).
export async function resolveBankAccount(conn, method, id, label = 'bank account') {
  if (!method || NO_ACCOUNT_METHODS.includes(method)) return null;
  if (!id) throw new HttpError(400, `Choose the ${label}`);
  const [[acc]] = await conn.query(
    `SELECT ba.id, ba.is_active, b.is_active AS bank_active
     FROM bank_accounts ba JOIN banks b ON b.id = ba.bank_id WHERE ba.id = ?`,
    [id],
  );
  if (!acc) throw new HttpError(400, 'That bank account was not found');
  if (!acc.is_active || !acc.bank_active) throw new HttpError(400, 'That bank account is not active');
  return acc.id;
}

// "BOC · Main 1234" for a SELECT that joins bank_accounts `ba` and banks `bk`.
export const BANK_LABEL_SQL = (ba = 'ba', bk = 'bk') =>
  `CASE WHEN ${ba}.id IS NULL THEN NULL ELSE CONCAT(${bk}.name, ' · ', ${ba}.account_name, ' ', ${ba}.account_no) END`;

// LEFT JOINs that go with BANK_LABEL_SQL, for a table alias whose bank_account_id is used.
export const BANK_JOIN_SQL = (alias, ba = 'ba', bk = 'bk') =>
  `LEFT JOIN bank_accounts ${ba} ON ${ba}.id = ${alias}.bank_account_id LEFT JOIN banks ${bk} ON ${bk}.id = ${ba}.bank_id`;
