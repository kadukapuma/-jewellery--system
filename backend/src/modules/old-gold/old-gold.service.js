import { z } from 'zod';
import { HttpError } from '../../utils/httpError.js';
import { gramsSchema, optionalText } from '../../utils/validation.js';
import { assertDayOpen } from '../../utils/dayLock.js';
import { writeAudit } from '../../utils/audit.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { calcOldGoldValue } from '../../services/pricing.js';
import { getCurrentPrice } from '../gold-prices/gold-prices.service.js';
import { grams, money } from '../../utils/cancelEffects.js';
import { resolveBankAccount } from '../../utils/bankAccount.js';

// Old gold: a customer's old jewellery taken in by the shop. Every piece is priced at the day's
// gram price less the deduction % (setting old_gold_deduction_percent) and becomes a stock item
// (source 'old_gold') that can be sold as it is or given to a craftsman as "a piece from stock".
//   cash     -> the shop pays the customer (money out, see MONEY_FLOW_SQL)
//   credit   -> a customer receipt with method 'old_gold': pays open bills, the rest is an advance
//   exchange -> the same receipt, put on the bill it was taken with

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

export const oldGoldLineSchema = z
  .object({
    description: z.string({ error: 'Describe the piece' }).trim().min(1, 'Describe the piece').max(150),
    category_id: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
    karat_id: z.coerce.number({ error: 'Choose a karat' }).int().positive('Choose a karat'),
    gross_weight_g: gramsSchema('weight').refine((v) => v > 0, 'Weight must be above 0'),
    stone_weight_g: gramsSchema('stone weight').refine((v) => v >= 0, 'Cannot be negative').default(0),
    // What the customer gets. Leave out to use the calculated value.
    value: z.coerce.number().positive('Value must be above 0').max(1e10).optional().nullable(),
  })
  .refine((l) => l.stone_weight_g < l.gross_weight_g, { path: ['stone_weight_g'], message: 'Stones cannot weigh as much as the piece' });

export const oldGoldLinesSchema = z.array(oldGoldLineSchema).min(1, 'Add at least one piece').max(50);

export const oldGoldNotes = optionalText(255);

export async function getDeductionPercent(db) {
  const [[row]] = await db.query("SELECT setting_value FROM settings WHERE setting_key = 'old_gold_deduction_percent'");
  const value = Number(row?.setting_value ?? 0);
  return Number.isFinite(value) && value >= 0 && value < 100 ? value : 0;
}

// Prices every piece at the gold price in force now. With `req`, also checks the value each
// piece is given: lower is fine, above the calculated value only an Admin.
export async function priceOldGoldLines(db, lines, req = null) {
  const deduction = await getDeductionPercent(db);
  const priceByKarat = new Map();
  const out = [];
  for (const [index, line] of lines.entries()) {
    const [[cat]] = await db.query('SELECT name, is_active FROM categories WHERE id = ?', [line.category_id]);
    if (!cat?.is_active) throw new HttpError(400, `Piece ${index + 1}: choose an active category`);
    const [[karat]] = await db.query('SELECT name, is_active FROM karats WHERE id = ?', [line.karat_id]);
    if (!karat?.is_active) throw new HttpError(400, `Piece ${index + 1}: choose an active karat`);
    if (!priceByKarat.has(line.karat_id)) priceByKarat.set(line.karat_id, await getCurrentPrice(db, line.karat_id));
    const price = priceByKarat.get(line.karat_id);
    if (!price) throw new HttpError(400, `No gold price entered for ${karat.name}. Update gold prices first.`);
    const gram = Number(price.gram_price);
    const { net_weight_g, value: calc } = calcOldGoldValue(line, gram, deduction);
    const value = round2(line.value ?? calc);
    if (req && value > calc + 0.009 && !req.user.is_super_admin) {
      throw new HttpError(403, `Piece ${index + 1}: the value cannot be above ${calc.toFixed(2)}. Only an Admin can give more.`);
    }
    out.push({
      ...line,
      stone_weight_g: line.stone_weight_g ?? 0,
      karat_name: karat.name,
      category_name: cat.name,
      net_weight_g,
      gold_price_id: price.id,
      gram_rate: gram,
      deduction_percent: deduction,
      calc_value: calc,
      value,
    });
  }
  return {
    deduction_percent: deduction,
    lines: out,
    total_net_weight_g: round3(out.reduce((s, l) => s + l.net_weight_g, 0)),
    total_value: round2(out.reduce((s, l) => s + l.value, 0)),
  };
}

// Saves the receipt, makes a stock item from every piece and, for credit / exchange, the customer
// receipt (method 'old_gold'). Allocation of that receipt is left to the caller.
// Call inside a transaction. Returns { id, receipt_no, total_value, payment_id }.
export async function createOldGoldReceipt(conn, req, {
  date, customerId = null, mode, payoutMethod = null, payoutReference = null, payoutBankAccountId = null, saleId = null, lines, notes = null,
}) {
  if (mode === 'credit' && !customerId) throw new HttpError(400, 'Choose the customer to give the credit to');
  await assertDayOpen(conn, date);
  const priced = await priceOldGoldLines(conn, lines, req);

  const payout = mode === 'cash' ? payoutMethod || 'cash' : null;
  const bankAccountId = payout ? await resolveBankAccount(conn, payout, payoutBankAccountId, 'bank account to pay from') : null;
  const receiptNo = await nextDocumentNumber(conn, 'OGR');
  const [result] = await conn.query(
    `INSERT INTO old_gold_receipts (receipt_no, receipt_date, customer_id, mode, payout_method, payout_reference, bank_account_id, sale_id,
                                    total_net_weight_g, total_value, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [receiptNo, date, customerId, mode, payout, mode === 'cash' ? payoutReference : null, bankAccountId,
      saleId, priced.total_net_weight_g, priced.total_value, notes, req.user.id],
  );
  const receiptId = result.insertId;

  for (const l of priced.lines) {
    const barcode = await nextDocumentNumber(conn, 'ITEM');
    const [item] = await conn.query(
      `INSERT INTO items (item_code, barcode, name, category_id, karat_id, source, net_weight_g, wastage_g,
                          making_charge, price_min_percent, price_max_percent, cost_price, stock_qty, status, description)
       VALUES (?, ?, ?, ?, ?, 'old_gold', ?, 0, 0, 0, 0, ?, 1, 'in_stock', ?)`,
      [barcode, barcode, l.description, l.category_id, l.karat_id, l.net_weight_g, l.value, `Old gold ${receiptNo}`],
    );
    await conn.query(
      `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
       VALUES (?, 'old_gold_in', 1, ?, 'old_gold_receipts', ?, ?)`,
      [item.insertId, l.net_weight_g, receiptId, req.user.id],
    );
    await conn.query(
      `INSERT INTO old_gold_lines (receipt_id, description, category_id, karat_id, gross_weight_g, stone_weight_g, net_weight_g,
                                   gold_price_id, gram_rate, deduction_percent, calc_value, value, item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, l.description, l.category_id, l.karat_id, l.gross_weight_g, l.stone_weight_g, l.net_weight_g,
        l.gold_price_id, l.gram_rate, l.deduction_percent, l.calc_value, l.value, item.insertId],
    );
  }

  let paymentId = null;
  if (mode !== 'cash') {
    const rcp = await nextDocumentNumber(conn, 'RCP');
    const [pay] = await conn.query(
      `INSERT INTO customer_payments (receipt_no, customer_id, sale_id, old_gold_id, payment_date, amount, method, reference_no, notes, created_by)
       VALUES (?, ?, ?, ?, ${mode === 'exchange' ? 'NOW()' : '?'}, ?, 'old_gold', ?, ?, ?)`,
      [rcp, customerId, saleId, receiptId, ...(mode === 'exchange' ? [] : [date]), priced.total_value, receiptNo,
        `Old gold ${receiptNo} (${priced.total_net_weight_g.toFixed(3)} g)`, req.user.id],
    );
    paymentId = pay.insertId;
  }

  await writeAudit(conn, req, {
    action: 'create',
    table: 'old_gold_receipts',
    recordId: receiptId,
    newValues: {
      receipt_no: receiptNo, mode, customer_id: customerId, sale_id: saleId, total_value: priced.total_value,
      lines: priced.lines.map((l) => ({ description: l.description, net: l.net_weight_g, rate: l.gram_rate, calc: l.calc_value, value: l.value })),
    },
  });
  return { id: receiptId, receipt_no: receiptNo, total_value: priced.total_value, total_net_weight_g: priced.total_net_weight_g, payment_id: paymentId };
}

// Cancel: the gold goes back to the customer, so every piece must still be in stock untouched.
// The items become inactive, the credit receipt (if any) is cancelled, a cash payout no longer counts.
// Returns the sale ids whose payments changed, for the caller to recompute.
// fx (optional): the cancel's Effects, to list what this changes.
export async function cancelOldGoldReceipt(conn, req, receipt, reason, fx = null) {
  if (receipt.status === 'cancelled') throw new HttpError(400, 'This old gold receipt is already cancelled');
  await assertDayOpen(conn, receipt.receipt_date);
  const [items] = await conn.query(
    `SELECT i.id, i.item_code, i.name, i.status, i.stock_qty, l.net_weight_g
     FROM old_gold_lines l JOIN items i ON i.id = l.item_id WHERE l.receipt_id = ? FOR UPDATE`,
    [receipt.id],
  );
  for (const i of items) {
    if (i.status !== 'in_stock' || i.stock_qty !== 1) {
      throw new HttpError(400, `${i.item_code} is no longer in stock (sold or with a craftsman), so this old gold cannot be given back.`);
    }
  }
  if (fx) {
    await fx.watchCustomer(conn, receipt.customer_id);
    if (receipt.mode === 'cash') fx.add('old_gold', `${receipt.customer_name || 'The customer'} gives back the ${money(receipt.total_value)} paid for this gold`);
  }
  for (const i of items) {
    fx?.add('stock', `${i.item_code} ${i.name} (${grams(i.net_weight_g)}) leaves stock: give the gold back to the customer`, '/items');
    await conn.query("UPDATE items SET stock_qty = 0, status = 'inactive' WHERE id = ?", [i.id]);
    await conn.query(
      `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, reason, note, created_by)
       VALUES (?, 'adjustment', -1, ?, 'old_gold_receipts', ?, 'old_gold_cancel', ?, ?)`,
      [i.id, -Number(i.net_weight_g), receipt.id, `Old gold ${receipt.receipt_no} cancelled`, req.user.id],
    );
  }

  const [payments] = await conn.query("SELECT id, receipt_no, amount, payment_date FROM customer_payments WHERE old_gold_id = ? AND status = 'active'", [receipt.id]);
  const saleIds = new Set();
  for (const p of payments) {
    await assertDayOpen(conn, p.payment_date);
    const [allocs] = await conn.query('SELECT sale_id FROM customer_payment_allocations WHERE payment_id = ?', [p.id]);
    allocs.forEach((a) => saleIds.add(a.sale_id));
    if (fx) {
      await fx.watchSales(conn, allocs.map((a) => a.sale_id));
      fx.add('receipt', `Credit receipt ${p.receipt_no} (${money(p.amount)}) for this gold is cancelled`, '/customer-payments');
    }
    await conn.query(
      "UPDATE customer_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE id = ?",
      [`Old gold ${receipt.receipt_no} cancelled`, p.id],
    );
    await conn.query('DELETE FROM customer_payment_allocations WHERE payment_id = ?', [p.id]);
  }

  await conn.query("UPDATE old_gold_receipts SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, receipt.id]);
  await writeAudit(conn, req, {
    action: 'cancel', table: 'old_gold_receipts', recordId: receipt.id,
    oldValues: { receipt_no: receipt.receipt_no, total_value: receipt.total_value }, newValues: { reason },
  });
  return [...saleIds];
}
