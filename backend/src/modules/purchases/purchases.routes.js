import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { HttpError, parseId } from '../../utils/httpError.js';
import { PAYMENT_METHODS, checkPriceRange, dateSchema, gramsSchema, optionalText, priceRangeFields } from '../../utils/validation.js';
import { writeAudit } from '../../utils/audit.js';
import { nextDocumentNumber } from '../../utils/sequences.js';
import { allocatePayment, applyAdvances, recomputePurchase } from '../supplier-payments/supplier-payments.service.js';

const router = Router();

const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000;

// A line is either a NEW item (name, category, karat, weight) or more stock of an EXISTING item (item_id).
const lineSchema = z
  .object({
    item_id: z.coerce.number().int().positive().optional().nullable(),
    name: optionalText(150),
    item_code: optionalText(30),
    category_id: z.coerce.number().int().positive().optional().nullable(),
    karat_id: z.coerce.number().int().positive().optional().nullable(),
    net_weight_g: gramsSchema('weight').optional().nullable(),
    wastage_g: gramsSchema('wastage').refine((v) => v >= 0, 'Cannot be negative').default(0),
    making_charge: z.coerce.number().min(0, 'Cannot be negative').max(1e10).default(0),
    ...priceRangeFields,
    qty: z.coerce.number({ error: 'Enter the quantity' }).int('Whole number only').min(1, 'At least 1').max(100000),
    purchase_price: z.coerce.number({ error: 'Enter the price paid' }).positive('Price must be above 0').max(1e12),
  })
  .superRefine((l, ctx) => {
    if (l.item_id) return;
    checkPriceRange(l, ctx);
    if (!l.name) ctx.addIssue({ code: 'custom', path: ['name'], message: 'Item name is required' });
    if (!l.category_id) ctx.addIssue({ code: 'custom', path: ['category_id'], message: 'Choose a category' });
    if (!l.karat_id) ctx.addIssue({ code: 'custom', path: ['karat_id'], message: 'Choose a karat' });
    if (!(l.net_weight_g > 0)) ctx.addIssue({ code: 'custom', path: ['net_weight_g'], message: 'Weight must be above 0' });
  });

const createSchema = z.object({
  supplier_id: z.coerce.number({ error: 'Choose a supplier' }).int().positive('Choose a supplier'),
  purchase_date: dateSchema,
  supplier_invoice_no: optionalText(50),
  notes: optionalText(255),
  lines: z.array(lineSchema).min(1, 'Add at least one line').max(200),
  payment: z
    .object({
      amount: z.coerce.number().positive('Amount must be above 0').max(1e12),
      method: z.enum(PAYMENT_METHODS),
      reference_no: optionalText(50),
    })
    .optional()
    .nullable(),
});

const listSchema = z.object({
  search: z.string().trim().max(50).default(''),
  supplier_id: z.coerce.number().int().positive().optional(),
  payment_status: z.enum(['unpaid', 'partial', 'paid', 'all']).default('all'),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  page: z.coerce.number().int().min(0).default(0),
  page_size: z.coerce.number().int().min(1).max(200).default(25),
});

async function findPurchase(db, id) {
  const [[purchase]] = await db.query(
    `SELECT p.*, s.name AS supplier_name, s.phone AS supplier_phone, u.name AS created_by_name
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id JOIN users u ON u.id = p.created_by
     WHERE p.id = ?`,
    [id],
  );
  if (!purchase) throw new HttpError(404, 'Purchase not found');
  const [lines] = await db.query(
    `SELECT pl.*, i.item_code, i.barcode, i.name AS item_name, i.net_weight_g, i.status AS item_status,
            c.name AS category_name, k.name AS karat_name,
            (SELECT MIN(pl2.purchase_id) FROM purchase_lines pl2 WHERE pl2.item_id = pl.item_id) = pl.purchase_id
              AND i.source = 'purchase' AS created_item
     FROM purchase_lines pl
     JOIN items i ON i.id = pl.item_id
     JOIN categories c ON c.id = i.category_id
     JOIN karats k ON k.id = pl.karat_id
     WHERE pl.purchase_id = ? ORDER BY pl.id`,
    [id],
  );
  const [payments] = await db.query(
    `SELECT a.amount, sp.id AS payment_id, sp.payment_no, sp.payment_date, sp.method, sp.reference_no
     FROM supplier_payment_allocations a JOIN supplier_payments sp ON sp.id = a.payment_id
     WHERE a.purchase_id = ? AND sp.status = 'active' ORDER BY sp.payment_date, sp.id`,
    [id],
  );
  return { ...purchase, lines: lines.map((l) => ({ ...l, created_item: !!l.created_item })), payments };
}

router.get('/', requirePermission('purchases.view'), async (req, res) => {
  const q = listSchema.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    where.push('(p.purchase_no LIKE ? OR p.supplier_invoice_no LIKE ?)');
    params.push(`%${q.search}%`, `%${q.search}%`);
  }
  if (q.supplier_id) { where.push('p.supplier_id = ?'); params.push(q.supplier_id); }
  if (q.payment_status !== 'all') { where.push('p.payment_status = ?'); params.push(q.payment_status); }
  if (q.from) { where.push('p.purchase_date >= ?'); params.push(q.from); }
  if (q.to) { where.push('p.purchase_date <= ?'); params.push(q.to); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [[totals]] = await pool.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(p.total_amount), 0) AS amount, COALESCE(SUM(p.balance), 0) AS balance,
            COALESCE(SUM(p.total_weight_g), 0) AS weight
     FROM purchases p ${whereSql}`,
    params,
  );
  const [rows] = await pool.query(
    `SELECT p.*, s.name AS supplier_name,
            (SELECT COUNT(*) FROM purchase_lines pl WHERE pl.purchase_id = p.id) AS line_count,
            p.balance > 0 AND p.due_date < CURDATE() AS is_overdue
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     ${whereSql} ORDER BY p.purchase_date DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, q.page_size, q.page * q.page_size],
  );
  res.json({
    total: totals.total,
    sums: { amount: Number(totals.amount), balance: Number(totals.balance), weight_g: Number(totals.weight) },
    purchases: rows.map((r) => ({ ...r, is_overdue: !!r.is_overdue })),
  });
});

router.get('/:id', requirePermission('purchases.view'), async (req, res) => {
  res.json(await findPurchase(pool, parseId(req.params.id)));
});

router.post('/', requirePermission('purchases.create'), async (req, res) => {
  const data = createSchema.parse(req.body);
  if (data.payment && !req.user.is_super_admin && !req.user.permissionSet.has('supplier_payments.create')) {
    throw new HttpError(403, 'You do not have permission to record supplier payments');
  }

  const id = await withTransaction(async (conn) => {
    const [[supplier]] = await conn.query('SELECT id, is_active, credit_days FROM suppliers WHERE id = ?', [data.supplier_id]);
    if (!supplier?.is_active) throw new HttpError(400, 'Choose an active supplier');

    const purchaseNo = await nextDocumentNumber(conn, 'PUR');
    const [result] = await conn.query(
      `INSERT INTO purchases (purchase_no, supplier_id, supplier_invoice_no, purchase_date, due_date, notes, created_by)
       VALUES (?, ?, ?, ?, DATE_ADD(?, INTERVAL ? DAY), ?, ?)`,
      [purchaseNo, supplier.id, data.supplier_invoice_no, data.purchase_date, data.purchase_date, supplier.credit_days, data.notes, req.user.id],
    );
    const purchaseId = result.insertId;

    let totalWeight = 0;
    let totalAmount = 0;
    for (const [index, line] of data.lines.entries()) {
      let itemId;
      let karatId;
      let unitWeight;
      const unitCost = round2(line.purchase_price / line.qty);

      if (line.item_id) {
        // More stock of an item we already have (e.g. the same gold biscuit).
        const [[item]] = await conn.query('SELECT id, karat_id, net_weight_g, status FROM items WHERE id = ? FOR UPDATE', [line.item_id]);
        if (!item) throw new HttpError(400, `Line ${index + 1}: item not found`);
        if (item.status === 'with_craftsman') throw new HttpError(400, `Line ${index + 1}: this item is with a craftsman`);
        await conn.query(
          "UPDATE items SET stock_qty = stock_qty + ?, status = 'in_stock', cost_price = ? WHERE id = ?",
          [line.qty, unitCost, item.id],
        );
        itemId = item.id;
        karatId = item.karat_id;
        unitWeight = Number(item.net_weight_g);
      } else {
        const [[cat]] = await conn.query('SELECT is_active FROM categories WHERE id = ?', [line.category_id]);
        if (!cat?.is_active) throw new HttpError(400, `Line ${index + 1}: choose an active category`);
        const [[karat]] = await conn.query('SELECT is_active FROM karats WHERE id = ?', [line.karat_id]);
        if (!karat?.is_active) throw new HttpError(400, `Line ${index + 1}: choose an active karat`);

        const barcode = await nextDocumentNumber(conn, 'ITEM');
        const [itemResult] = await conn.query(
          `INSERT INTO items (item_code, barcode, name, category_id, karat_id, source, net_weight_g, wastage_g,
                              making_charge, price_min_percent, price_max_percent, cost_price, stock_qty, status)
           VALUES (?, ?, ?, ?, ?, 'purchase', ?, ?, ?, ?, ?, ?, ?, 'in_stock')`,
          [line.item_code || barcode, barcode, line.name, line.category_id, line.karat_id, line.net_weight_g,
            line.wastage_g, line.making_charge, line.price_min_percent, line.price_max_percent, unitCost, line.qty],
        );
        itemId = itemResult.insertId;
        karatId = line.karat_id;
        unitWeight = line.net_weight_g;
      }

      const lineWeight = round3(unitWeight * line.qty);
      await conn.query(
        `INSERT INTO purchase_lines (purchase_id, item_id, karat_id, qty, weight_g, purchase_price, price_per_gram)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, itemId, karatId, line.qty, lineWeight, line.purchase_price, round2(line.purchase_price / lineWeight)],
      );
      await conn.query(
        `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
         VALUES (?, 'purchase', ?, ?, 'purchases', ?, ?)`,
        [itemId, line.qty, lineWeight, purchaseId, req.user.id],
      );
      totalWeight = round3(totalWeight + lineWeight);
      totalAmount = round2(totalAmount + line.purchase_price);
    }

    await conn.query('UPDATE purchases SET total_weight_g = ?, total_amount = ? WHERE id = ?', [totalWeight, totalAmount, purchaseId]);
    await recomputePurchase(conn, purchaseId);

    // Money paid at the counter goes to this purchase first.
    if (data.payment) {
      const paymentNo = await nextDocumentNumber(conn, 'SPY');
      const [pay] = await conn.query(
        `INSERT INTO supplier_payments (payment_no, supplier_id, payment_date, amount, method, reference_no, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [paymentNo, supplier.id, data.purchase_date, data.payment.amount, data.payment.method, data.payment.reference_no,
          `Paid with ${purchaseNo}`, req.user.id],
      );
      await allocatePayment(conn, { paymentId: pay.insertId, supplierId: supplier.id, amount: data.payment.amount, firstPurchaseId: purchaseId });
    }
    // Earlier advances to this supplier now settle what is still open.
    await applyAdvances(conn, supplier.id);

    await writeAudit(conn, req, {
      action: 'create',
      table: 'purchases',
      recordId: purchaseId,
      newValues: { purchase_no: purchaseNo, supplier_id: supplier.id, total_amount: totalAmount, lines: data.lines.length, payment: data.payment },
    });
    return purchaseId;
  });

  res.status(201).json(await findPurchase(pool, id));
});

// A purchase can be removed only while nothing has happened to it yet: no payments,
// and every item it brought in is still untouched in stock.
router.delete('/:id', requirePermission('purchases.delete'), async (req, res) => {
  const id = parseId(req.params.id);
  await withTransaction(async (conn) => {
    const purchase = await findPurchase(conn, id);
    if (purchase.payments.length) {
      throw new HttpError(400, `${purchase.purchase_no} has payments. Cancel the payments first.`);
    }
    for (const line of purchase.lines) {
      const [[item]] = await conn.query('SELECT id, stock_qty, status FROM items WHERE id = ? FOR UPDATE', [line.item_id]);
      const [[used]] = await conn.query(
        `SELECT (SELECT COUNT(*) FROM sale_lines WHERE item_id = ?) + (SELECT COUNT(*) FROM craft_jobs WHERE item_id = ? OR source_item_id = ?)
                + (SELECT COUNT(*) FROM purchase_lines WHERE item_id = ? AND purchase_id <> ?) AS n`,
        [item.id, item.id, item.id, item.id, id],
      );
      if (line.created_item) {
        if (used.n > 0 || item.stock_qty !== line.qty || item.status !== 'in_stock') {
          throw new HttpError(400, `${line.item_code} has been sold, changed or used. This purchase cannot be deleted.`);
        }
        await conn.query('DELETE FROM purchase_lines WHERE id = ?', [line.id]);
        await conn.query('DELETE FROM tag_print_logs WHERE item_id = ?', [item.id]);
        await conn.query('DELETE FROM stock_movements WHERE item_id = ?', [item.id]);
        await conn.query('DELETE FROM items WHERE id = ?', [item.id]);
      } else {
        if (item.stock_qty < line.qty) throw new HttpError(400, `${line.item_code}: not enough stock left to take back.`);
        await conn.query('UPDATE items SET stock_qty = stock_qty - ? WHERE id = ?', [line.qty, item.id]);
        await conn.query(
          `INSERT INTO stock_movements (item_id, movement_type, qty_change, weight_change_g, ref_table, ref_id, created_by)
           VALUES (?, 'adjustment', ?, ?, 'purchases', ?, ?)`,
          [item.id, -line.qty, -line.weight_g, id, req.user.id],
        );
        await conn.query('DELETE FROM purchase_lines WHERE id = ?', [line.id]);
      }
    }
    await conn.query('DELETE FROM purchases WHERE id = ?', [id]);
    await writeAudit(conn, req, {
      action: 'delete',
      table: 'purchases',
      recordId: id,
      oldValues: { purchase_no: purchase.purchase_no, total_amount: purchase.total_amount, supplier_id: purchase.supplier_id },
    });
  });
  res.status(204).end();
});

export default router;
