import { Router } from 'express';
import { assertDayOpen, dbToday as dbTodayOf } from '../../utils/dayLock.js';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { hasPermission, requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, dateSchema, idSchema, optionalText } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { cancelReason, grams, money, runCancel, sendCancel } from '../../utils/cancelEffects.js';
import { cancelledRecordRoutes } from '../../utils/cancelledRecords.js';
import { snapshot } from '../../utils/recycleBin.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { calcItemPrice, calcPriceRange } from '../../services/pricing.js';
import { getCurrentPrice } from '../gold-prices/gold-prices.service.js';
import { findCustomer } from '../customers/customers.routes.js';
import {
  allocateCustomerPayment, applyCustomerAdvances, buildSchedule, recomputeSale,
} from '../customer-payments/customer-payments.service.js';
import {
  cancelOldGoldReceipt, createOldGoldReceipt, oldGoldLinesSchema, priceOldGoldLines,
} from '../old-gold/old-gold.service.js';

import { BANK_JOIN_SQL, BANK_LABEL_SQL, bankAccountIdField, resolveBankAccount } from '../../utils/bankAccount.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;
const METHOD_NAMES = { cash: 'cash', card: 'card', bank_transfer: 'bank transfer', cheque: 'cheque' };

const createSchema = z.object({
  customer_id: z.coerce.number().int().positive().optional().nullable(),
  salesman_id: z.coerce.number().int().positive().optional().nullable(),
  lines: z
    .array(z.object({
      item_id: idSchema,
      qty: z.coerce.number().int('Whole number only').min(1).max(100000).default(1),
      // Price for ONE unit. Leave out to sell at the item's max price.
      unit_price: z.coerce.number().positive('Price must be above 0').max(1e12).optional().nullable(),
    }))
    .min(1, 'Add at least one item')
    .max(100),
  // Extra discount on the whole bill - Admin only, because it can go below the min prices.
  discount: z.coerce.number().min(0, 'Cannot be negative').max(1e12).default(0),
  payments: z
    .array(z.object({
      method: z.enum(PAYMENT_METHODS),
      bank_account_id: bankAccountIdField,
      amount: z.coerce.number().positive('Amount must be above 0').max(1e12),
      reference_no: optionalText(50),
    }))
    .max(5)
    .default([]),
  due_date: dateSchema.optional().nullable(),
  instalments: z
    .object({
      count: z.coerce.number().int().min(2, 'At least 2 instalments').max(60),
      frequency: z.enum(['weekly', 'monthly']),
      start_date: dateSchema,
    })
    .optional()
    .nullable(),
  notes: optionalText(255),
  // Total the counter showed. If the gold price changed since, the bill is not saved.
  expected_total: z.coerce.number().optional().nullable(),
  // Use the customer's advance (unallocated payments) on this bill.
  use_advance: z.boolean().default(true),
  // Customer's old gold taken in exchange: its value comes off this bill.
  old_gold: z.object({ lines: oldGoldLinesSchema }).optional().nullable(),
});

const listSchema = z.object({
  search: z.string().trim().max(50).default(''),
  customer_id: z.coerce.number().int().positive().optional(),
  salesman_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['completed', 'cancelled', 'all']).default('completed'),
  payment_status: z.enum(['unpaid', 'partial', 'paid', 'all']).default('all'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

export async function findSale(db, id) {
  const [[sale]] = await db.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, c.nic AS customer_nic,
            sm.name AS salesman_name, sm.code AS salesman_code,
            u.name AS created_by_name
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     LEFT JOIN salesmen sm ON sm.id = s.salesman_id
     JOIN users u ON u.id = s.created_by
     WHERE s.id = ?`,
    [id],
  );
  if (!sale) throw new HttpError(404, 'Bill not found');
  const [lines] = await db.query(
    `SELECT sl.*, i.item_code, i.barcode, i.name AS item_name, k.name AS karat_name, cat.name AS category_name
     FROM sale_lines sl JOIN items i ON i.id = sl.item_id JOIN karats k ON k.id = sl.karat_id
     JOIN categories cat ON cat.id = i.category_id
     WHERE sl.sale_id = ? ORDER BY sl.id`,
    [id],
  );
  const [payments] = await db.query(
    `SELECT a.amount, p.id AS payment_id, p.receipt_no, p.payment_date, p.method, p.reference_no, p.sale_id = ? AS at_counter,
            ${BANK_LABEL_SQL()} AS bank_account_label
     FROM customer_payment_allocations a JOIN customer_payments p ON p.id = a.payment_id
     ${BANK_JOIN_SQL('p')}
     WHERE a.sale_id = ? AND p.status = 'active' ORDER BY p.payment_date, p.id`,
    [id, id],
  );
  const [oldGold] = await db.query(
    `SELECT id, receipt_no, total_net_weight_g, total_value, status FROM old_gold_receipts WHERE sale_id = ? ORDER BY id`,
    [id],
  );
  const [[plan]] = await db.query('SELECT * FROM instalment_plans WHERE sale_id = ?', [id]);
  let schedule = [];
  if (plan) {
    [schedule] = await db.query(
      `SELECT *, status <> 'paid' AND due_date < CURDATE() AS is_overdue FROM instalment_schedule WHERE plan_id = ? ORDER BY instalment_no`,
      [plan.id],
    );
  }
  return {
    ...sale,
    lines,
    payments: payments.map((p) => ({ ...p, at_counter: !!p.at_counter })),
    old_gold: oldGold.map((g) => ({ ...g, total_net_weight_g: Number(g.total_net_weight_g), total_value: Number(g.total_value) })),
    instalment_plan: plan ? { ...plan, schedule: schedule.map((r) => ({ ...r, is_overdue: !!r.is_overdue })) } : null,
  };
}

router.get('/', requirePermission('sales.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) { where.push('(s.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ? OR sm.name LIKE ?)'); params.push(`%${q.search}%`, `%${q.search}%`, `%${q.search}%`, `%${q.search}%`); }
  if (q.customer_id) { where.push('s.customer_id = ?'); params.push(q.customer_id); }
  if (q.salesman_id) { where.push('s.salesman_id = ?'); params.push(q.salesman_id); }
  if (q.status !== 'all') { where.push('s.status = ?'); params.push(q.status); }
  if (q.payment_status !== 'all') { where.push('s.payment_status = ?'); params.push(q.payment_status); }
  if (q.from) { where.push('s.sale_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('s.sale_date < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN salesmen sm ON sm.id = s.salesman_id';
  const [[sums]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(s.total), 0) AS amount, COALESCE(SUM(s.balance), 0) AS balance ${from} ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, sm.name AS salesman_name, sm.code AS salesman_code,
            (SELECT COUNT(*) FROM sale_lines sl WHERE sl.sale_id = s.id) AS line_count,
            s.status = 'completed' AND s.balance > 0 AND s.due_date < CURDATE() AS is_overdue
     ${from} ${whereSql} ORDER BY s.sale_date DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, q.page_size, q.page * q.page_size],
  );
  res.json({
    total: sums.total,
    sums: { amount: Number(sums.amount), balance: Number(sums.balance) },
    sales: rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue })),
  });
});

// Cost is only for people allowed to see what the shop paid.
function presentSale(sale, req) {
  if (hasPermission(req, 'items.view_cost')) return sale;
  return { ...sale, lines: sale.lines.map(({ unit_cost, ...line }) => line) };
}

router.get('/:id', requirePermission('sales.view', 'sales.reprint'), async (req, res) => {
  res.json(presentSale(await findSale(pool, parseId(req.params.id)), req));
});

// Make a bill. Every line is priced at the gold price in force right now, and that price
// is stored on the line so the bill never changes when the price is updated later.
router.post('/', requirePermission('sales.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.discount > 0 && !req.user.is_super_admin) throw new HttpError(403, 'Only an Admin can give a discount on the whole bill');
  if (data.old_gold?.lines?.length && !hasPermission(req, 'old_gold.create')) throw new HttpError(403, 'You do not have permission to take old gold');
  const ids = data.lines.map((l) => l.item_id);
  if (new Set(ids).size !== ids.length) throw new HttpError(400, 'The same item is on the bill twice');

  const result = await withTransaction(async (conn) => {
    await assertDayOpen(conn); // bills are always dated now
    let customer = null;
    if (data.customer_id) customer = await findCustomer(conn, data.customer_id);

    // 1. Price every line.
    const priceByKarat = new Map();
    const lines = [];
    for (const [index, line] of data.lines.entries()) {
      const [[item]] = await conn.query(
        'SELECT i.*, k.name AS karat_name FROM items i JOIN karats k ON k.id = i.karat_id WHERE i.id = ? FOR UPDATE',
        [line.item_id],
      );
      if (!item) throw new HttpError(400, `Line ${index + 1}: item not found`);
      if (item.status !== 'in_stock' || item.stock_qty < line.qty) {
        throw new HttpError(400, `${item.item_code} is not in stock${item.stock_qty > 0 ? ` (only ${item.stock_qty} left)` : ''}`);
      }
      if (!priceByKarat.has(item.karat_id)) priceByKarat.set(item.karat_id, await getCurrentPrice(conn, item.karat_id));
      const price = priceByKarat.get(item.karat_id);
      if (!price) throw new HttpError(400, `No gold price entered for ${item.karat_name}. Update gold prices first.`);

      const unit = calcItemPrice(item, Number(price.gram_price));
      const range = calcPriceRange(item, Number(price.gram_price));

      // Selling price: the max price unless lowered. Discount permission goes down to the min price;
      // only an Admin can go below the min price. Nobody goes above the max price.
      const sold = line.unit_price ?? range.max;
      const fmt = (n) => n.toFixed(2);
      if (sold > range.max + 0.009) throw new HttpError(400, `${item.item_code}: price cannot be above the max price ${fmt(range.max)}`);
      if (sold < range.max - 0.009 && !hasPermission(req, 'sales.discount')) {
        throw new HttpError(403, `You cannot give discounts. Sell ${item.item_code} at ${fmt(range.max)}.`);
      }
      if (sold < range.min - 0.009 && !req.user.is_super_admin) {
        throw new HttpError(403, `${item.item_code}: the lowest price is ${fmt(range.min)}. Only an Admin can go lower.`);
      }

      lines.push({
        item,
        qty: line.qty,
        gold_price_id: price.id,
        pound_price_used: Number(price.pound_price),
        gram_price_used: Number(price.gram_price),
        net_weight_g: round3(Number(item.net_weight_g) * line.qty),
        wastage_g: round3(Number(item.wastage_g) * line.qty),
        billed_weight_g: round3(unit.billed_weight_g * line.qty),
        gold_value: round2(unit.gold_value * line.qty),
        // The shop's margin above the final price is shown as part of the making charge,
        // so gold value + making = the max price printed on the bill.
        making_charge: round2((range.max - unit.gold_value) * line.qty),
        price_final: round2(range.final * line.qty),
        price_min: round2(range.min * line.qty),
        price_max: round2(range.max * line.qty),
        line_total: round2(sold * line.qty),
      });
    }

    // 2. Totals: subtotal at max prices, discount = what was taken off the lines + any Admin bill discount.
    const subtotal = round2(lines.reduce((s, l) => s + l.price_max, 0));
    const afterLines = round2(lines.reduce((s, l) => s + l.line_total, 0));
    if (data.discount > afterLines) throw new HttpError(400, 'Discount cannot be more than the bill');
    const total = round2(afterLines - data.discount);
    const discount = round2(subtotal - total);
    if (data.expected_total !== null && data.expected_total !== undefined && Math.abs(data.expected_total - total) > 0.009) {
      throw new HttpError(409, `The gold price changed while you were billing. New total is ${total.toFixed(2)} — please check and save again.`, 'PRICE_CHANGED');
    }

    // 3. Old gold taken in exchange comes off first. A walk-in cannot get more than the bill;
    //    a customer's extra value stays with the shop as their advance.
    let oldGoldValue = 0;
    if (data.old_gold?.lines?.length) {
      oldGoldValue = (await priceOldGoldLines(conn, data.old_gold.lines, req)).total_value;
      if (!customer && oldGoldValue > total + 0.009) {
        throw new HttpError(400, `The old gold (${oldGoldValue.toFixed(2)}) is worth more than the bill. Choose the customer to keep the rest as an advance, or buy it for cash from Old Gold.`);
      }
    }
    const oldGoldUsed = round2(Math.min(oldGoldValue, total));
    const oldGoldExtra = round2(oldGoldValue - oldGoldUsed);

    // Then the advance (if chosen): money the customer already left with the shop comes off the bill.
    const advanceUsed = customer && data.use_advance
      ? round2(Math.max(0, Math.min(Number(customer.advance_available) || 0, total - oldGoldUsed)))
      : 0;
    const due = round2(total - oldGoldUsed - advanceUsed); // what the customer pays now

    // Payments: anything over what is due is change, given back from the cash.
    const payments = data.payments.map((p) => ({ ...p }));
    for (const p of payments) p.bank_account_id = await resolveBankAccount(conn, p.method, p.bank_account_id);
    const received = round2(payments.reduce((s, p) => s + p.amount, 0));
    let change = 0;
    if (received > due) {
      change = round2(received - due);
      const cash = payments.find((p) => p.method === 'cash');
      if (!cash || cash.amount < change) throw new HttpError(400, 'Card, bank or cheque payments cannot be more than the amount to pay');
      cash.amount = round2(cash.amount - change);
    }
    const paid = round2(Math.min(received, due));
    const balance = round2(total - oldGoldUsed - paid); // left after the old gold and counter payments
    const creditNeeded = round2(due - paid);

    // 4. Credit rules (only for what the advance doesn't cover).
    if (creditNeeded > 0) {
      if (!customer) throw new HttpError(400, 'Choose a customer to give credit (the bill is not fully paid)');
      if (!hasPermission(req, 'sales.credit')) throw new HttpError(403, 'You do not have permission to give credit. Take the full amount.');
      const newBalance = round2(customer.balance + balance); // customer.balance already nets the advance
      if (Number(customer.credit_limit) <= 0) {
        throw new HttpError(400, `${customer.name} has no credit limit. Set one on the customer to allow credit.`);
      }
      if (newBalance > Number(customer.credit_limit)) {
        throw new HttpError(400, `Over ${customer.name}'s credit limit of ${Number(customer.credit_limit).toFixed(2)} (would owe ${newBalance.toFixed(2)}).`);
      }
      if (data.instalments && !hasPermission(req, 'instalments.create')) throw new HttpError(403, 'You do not have permission to set up instalments');
    }

    // 5. Save the bill.
    const invoiceNo = await nextDocumentNumber(conn, 'INV');
    const [saleResult] = await conn.query(
      `INSERT INTO sales (invoice_no, customer_id, salesman_id, sale_date, subtotal, discount, total, paid_amount, balance, payment_status, due_date, notes, status, created_by)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, 0, ?, 'unpaid', ?, ?, 'completed', ?)`,
      [invoiceNo, customer?.id ?? null, data.salesman_id ?? null, subtotal, discount, total, total, creditNeeded > 0 ? data.due_date ?? null : null, data.notes, req.user.id],
    );
    const saleId = saleResult.insertId;

    for (const l of lines) {
      await conn.query(
        `INSERT INTO sale_lines (sale_id, item_id, karat_id, gold_price_id, qty, net_weight_g, wastage_g, billed_weight_g,
                                 pound_price_used, gram_price_used, gold_value, making_charge, line_total,
                                 price_final, price_min, price_max, unit_cost)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleId, l.item.id, l.item.karat_id, l.gold_price_id, l.qty, l.net_weight_g, l.wastage_g, l.billed_weight_g,
          l.pound_price_used, l.gram_price_used, l.gold_value, l.making_charge, l.line_total,
          l.price_final, l.price_min, l.price_max, Number(l.item.cost_price)],
      );
      await conn.query(
        "UPDATE items SET stock_qty = stock_qty - ?, status = IF(stock_qty = 0, 'sold', status) WHERE id = ?",
        [l.qty, l.item.id],
      );
      await conn.query(
        `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
         VALUES (?, 'sale', ?, ?, 'sales', ?, ?)`,
        [l.item.id, -l.qty, -l.net_weight_g, saleId, req.user.id],
      );
    }

    let oldGoldReceipt = null;
    if (oldGoldValue > 0) {
      oldGoldReceipt = await createOldGoldReceipt(conn, req, {
        date: await dbTodayOf(conn), customerId: customer?.id ?? null, mode: 'exchange', saleId, lines: data.old_gold.lines,
        notes: `Exchanged on bill ${invoiceNo}`,
      });
      if (oldGoldUsed > 0) {
        await conn.query('INSERT INTO customer_payment_allocations (payment_id, sale_id, amount) VALUES (?, ?, ?)', [oldGoldReceipt.payment_id, saleId, oldGoldUsed]);
      }
    }

    for (const p of payments.filter((x) => x.amount > 0)) {
      const receiptNo = await nextDocumentNumber(conn, 'RCP');
      const [pay] = await conn.query(
        `INSERT INTO customer_payments (receipt_no, customer_id, sale_id, payment_date, amount, method, bank_account_id, reference_no, created_by)
         VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
        [receiptNo, customer?.id ?? null, saleId, p.amount, p.method, p.bank_account_id, p.reference_no, req.user.id],
      );
      await conn.query('INSERT INTO customer_payment_allocations (payment_id, sale_id, amount) VALUES (?, ?, ?)', [pay.insertId, saleId, p.amount]);
    }

    if (creditNeeded > 0 && data.instalments) {
      const [plan] = await conn.query(
        `INSERT INTO instalment_plans (sale_id, customer_id, financed_amount, number_of_instalments, frequency, start_date, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [saleId, customer.id, creditNeeded, data.instalments.count, data.instalments.frequency, data.instalments.start_date, req.user.id],
      );
      const schedule = buildSchedule(creditNeeded, data.instalments.count, data.instalments.frequency, data.instalments.start_date);
      await conn.query('INSERT INTO instalment_schedule (plan_id, instalment_no, due_date, amount_due) VALUES ?', [
        schedule.map((r) => [plan.insertId, r.instalment_no, r.due_date, r.amount_due]),
      ]);
      const last = schedule[schedule.length - 1].due_date;
      await conn.query('UPDATE sales SET due_date = ? WHERE id = ?', [last, saleId]);
    }

    await recomputeSale(conn, saleId);
    // Money the customer left with the shop earlier now pays this bill (unless the cashier chose not to).
    if (advanceUsed > 0 || oldGoldExtra > 0) await applyCustomerAdvances(conn, customer.id);

    await writeAudit(conn, req, {
      action: 'create',
      table: 'sales',
      recordId: saleId,
      newValues: {
        invoice_no: invoiceNo, customer_id: customer?.id ?? null, total, discount, bill_discount: data.discount, paid, change, advance_used: advanceUsed,
        old_gold: oldGoldReceipt ? { receipt_no: oldGoldReceipt.receipt_no, value: oldGoldValue, used: oldGoldUsed } : null,
        lines: lines.map((l) => ({ item: l.item.item_code, min: l.price_min, max: l.price_max, sold: l.line_total })),
      },
    });
    return { saleId, change };
  });

  res.status(201).json({ ...presentSale(await findSale(pool, result.saleId), req), change: result.change });
});

// Cancel a bill: items go back into stock, money taken with this bill is refunded (cancelled),
// later payments that were put on it become the customer's advance again.
router.post('/:id/cancel', requirePermission('sales.cancel'), async (req, res) => {
  const id = parseId(req.params.id);
  const reason = cancelReason(req, { required: true });
  const outcome = await runCancel(req, { table: 'sales', recordId: id }, async (conn, fx) => {
    const sale = await findSale(conn, id);
    if (sale.status === 'cancelled') throw new HttpError(400, 'This bill is already cancelled');
    await assertDayOpen(conn, sale.sale_date);
    // Receipts taken with this bill are refunded too, so their days must be open as well.
    const [payDays] = await conn.query(
      "SELECT DISTINCT DATE(payment_date) AS d FROM customer_payments WHERE sale_id = ? AND status = 'active'",
      [id],
    );
    for (const p of payDays) await assertDayOpen(conn, p.d);
    // Money freed from this bill may pay the customer's other open bills.
    await fx.watchCustomer(conn, sale.customer_id);
    if (sale.customer_id) {
      const [open] = await conn.query("SELECT id FROM sales WHERE customer_id = ? AND status = 'completed' AND id <> ?", [sale.customer_id, id]);
      await fx.watchSales(conn, open.map((s) => s.id));
    }

    for (const l of sale.lines) {
      await conn.query("UPDATE items SET stock_qty = stock_qty + ?, status = 'in_stock' WHERE id = ?", [l.qty, l.item_id]);
      await conn.query(
        `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
         VALUES (?, 'adjustment', ?, ?, 'sales', ?, ?)`,
        [l.item_id, l.qty, l.net_weight_g, id, req.user.id],
      );
      fx.add('stock', `${l.item_code} ${l.item_name}${l.qty > 1 ? ` × ${l.qty}` : ''} goes back into stock (${grams(l.net_weight_g)})`, '/items');
    }
    // Old gold taken in exchange: a customer keeps its value as an advance; a walk-in gets the gold back.
    const [oldGold] = await conn.query("SELECT * FROM old_gold_receipts WHERE sale_id = ? AND status = 'active' FOR UPDATE", [id]);
    if (!sale.customer_id) {
      for (const g of oldGold) await cancelOldGoldReceipt(conn, req, g, `Bill ${sale.invoice_no} cancelled`, fx);
    } else {
      for (const g of oldGold) fx.add('old_gold', `Old gold ${g.receipt_no} (${money(g.total_value)}) stays with the shop as the customer's advance`, `/old-gold/${g.id}`);
    }
    const [refunds] = await conn.query(
      "SELECT receipt_no, amount, method FROM customer_payments WHERE sale_id = ? AND status = 'active' AND method <> 'old_gold' ORDER BY id",
      [id],
    );
    for (const p of refunds) fx.add('receipt', `Receipt ${p.receipt_no} is cancelled: give back ${money(p.amount)} (${METHOD_NAMES[p.method] || p.method})`, '/customer-payments');
    for (const p of sale.payments.filter((x) => !x.at_counter)) {
      fx.add('receipt', `Receipt ${p.receipt_no}: ${money(p.amount)} paid on this bill later is no longer on it and becomes the customer's advance`, '/customer-payments');
    }
    if (sale.instalment_plan && sale.instalment_plan.status !== 'cancelled') fx.add('bill', 'The instalment plan of this bill is cancelled');
    await conn.query(
      "UPDATE customer_payments SET status = 'cancelled', notes = CONCAT_WS(' · ', notes, ?) WHERE sale_id = ? AND status = 'active' AND method <> 'old_gold'",
      [`Refunded: bill ${sale.invoice_no} cancelled`, id],
    );
    await conn.query('DELETE FROM customer_payment_allocations WHERE sale_id = ?', [id]);
    await conn.query("UPDATE instalment_plans SET status = 'cancelled' WHERE sale_id = ?", [id]);
    await conn.query("UPDATE sales SET status = 'cancelled' WHERE id = ?", [id]);
    await recomputeSale(conn, id);
    await applyCustomerAdvances(conn, sale.customer_id);
    await writeAudit(conn, req, { action: 'cancel', table: 'sales', recordId: id, oldValues: { invoice_no: sale.invoice_no, total: sale.total }, newValues: { reason } });
  });
  await sendCancel(res, outcome, async () => presentSale(await findSale(pool, id), req));
});

// Bills: only the due date and notes can change (items and money: cancel and make a new bill).
// A cancelled bill can be deleted; its lines, refunded receipts and instalment plan go with it.
cancelledRecordRoutes(router, {
  table: 'sales',
  module: 'sales',
  fields: z.object({ due_date: dateSchema.nullable().or(z.literal('').transform(() => null)), notes: optionalText(255) }),
  children: async (conn, sale) => {
    const payments = await snapshot(conn, 'customer_payments', 'sale_id = ?', [sale.id]);
    if (payments.some((p) => p.status !== 'cancelled')) throw new HttpError(400, 'A receipt taken with this bill is still active. Cancel it first.');
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM customer_payment_allocations WHERE sale_id = ? OR payment_id IN (?)',
      [sale.id, [0, ...payments.map((p) => p.id)]],
    );
    if (n > 0) throw new HttpError(400, 'A payment is still applied to this bill. Cancel it first.');
    const oldGold = await snapshot(conn, 'old_gold_receipts', 'sale_id = ?', [sale.id]);
    if (oldGold.some((g) => g.status !== 'cancelled')) throw new HttpError(400, 'Old gold taken on this bill is still active. Cancel it first.');
    const plans = await snapshot(conn, 'instalment_plans', 'sale_id = ?', [sale.id]);
    return [
      { table: 'sale_lines', rows: await snapshot(conn, 'sale_lines', 'sale_id = ?', [sale.id]) },
      { table: 'old_gold_receipts', rows: oldGold },
      { table: 'old_gold_lines', rows: oldGold.length ? await snapshot(conn, 'old_gold_lines', 'receipt_id IN (?)', [oldGold.map((g) => g.id)]) : [] },
      { table: 'customer_payments', rows: payments },
      { table: 'instalment_plans', rows: plans },
      { table: 'instalment_schedule', rows: plans.length ? await snapshot(conn, 'instalment_schedule', 'plan_id IN (?)', [plans.map((p) => p.id)]) : [] },
    ];
  },
});

export default router;
