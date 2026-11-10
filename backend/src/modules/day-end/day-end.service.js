// Everything that happened in the shop on one day: sales, money in / out, purchases, expenses,
// craftsman work, stock movements, cash & bank, and the day's profit and loss.
import { MONEY_FLOW_SQL, OWNER_KINDS, TRANSFER_KINDS } from '../finance/finance.service.js';

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
const num2 = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, round2(r[k])])) }));
const num3 = (rows, keys) => rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, round3(r[k])])) }));
const sum = (rows, key) => rows.reduce((s, r) => s + Number(r[key] || 0), 0);

// DATETIME columns that fall on the day.
const ON_DAY = (col) => `${col} >= ? AND ${col} < DATE_ADD(?, INTERVAL 1 DAY)`;

async function salesSection(db, d) {
  const day = [d, d];
  const [[totals]] = await db.query(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(s.subtotal), 0) AS subtotal, COALESCE(SUM(s.discount), 0) AS discount,
            COALESCE(SUM(s.total), 0) AS total, COALESCE(SUM(s.paid_amount), 0) AS paid, COALESCE(SUM(s.balance), 0) AS on_credit
     FROM sales s WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')}`,
    day,
  );
  const [[cancelled]] = await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(s.total), 0) AS amount FROM sales s WHERE s.status = 'cancelled' AND ${ON_DAY('s.sale_date')}`,
    day,
  );
  const [[weights]] = await db.query(
    `SELECT COALESCE(SUM(sl.qty), 0) AS pieces, COALESCE(SUM(sl.net_weight_g), 0) AS net_g,
            COALESCE(SUM(sl.wastage_g), 0) AS wastage_g, COALESCE(SUM(sl.billed_weight_g), 0) AS billed_g,
            COALESCE(SUM(sl.gold_value), 0) AS gold_value, COALESCE(SUM(sl.making_charge), 0) AS making
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')}`,
    day,
  );
  const [byKarat] = await db.query(
    `SELECT k.name AS label, SUM(sl.qty) AS pieces, SUM(sl.billed_weight_g) AS weight_g, SUM(sl.line_total) AS amount
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN karats k ON k.id = sl.karat_id
     WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')} GROUP BY k.id ORDER BY amount DESC`,
    day,
  );
  const [byCategory] = await db.query(
    `SELECT c.name AS label, SUM(sl.qty) AS pieces, SUM(sl.billed_weight_g) AS weight_g, SUM(sl.line_total) AS amount
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN items i ON i.id = sl.item_id JOIN categories c ON c.id = i.category_id
     WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')} GROUP BY c.id ORDER BY amount DESC`,
    day,
  );
  const [byCashier] = await db.query(
    `SELECT u.name AS label, COUNT(*) AS bills, SUM(s.total) AS amount
     FROM sales s JOIN users u ON u.id = s.created_by
     WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')} GROUP BY u.id ORDER BY amount DESC`,
    day,
  );
  const [bills] = await db.query(
    `SELECT s.id, s.invoice_no, s.sale_date, COALESCE(c.name, 'Walk-in') AS customer, u.name AS cashier,
            (SELECT COALESCE(SUM(sl.qty), 0) FROM sale_lines sl WHERE sl.sale_id = s.id) AS pieces,
            s.subtotal, s.discount, s.total, s.paid_amount, s.balance, s.payment_status, s.status
     FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.created_by
     WHERE ${ON_DAY('s.sale_date')} ORDER BY s.sale_date, s.id`,
    day,
  );
  return {
    totals: {
      bills: Number(totals.bills), subtotal: round2(totals.subtotal), discount: round2(totals.discount), total: round2(totals.total),
      paid: round2(totals.paid), on_credit: round2(totals.on_credit),
      cancelled: Number(cancelled.n), cancelled_amount: round2(cancelled.amount),
      pieces: Number(weights.pieces), net_g: round3(weights.net_g), wastage_g: round3(weights.wastage_g), billed_g: round3(weights.billed_g),
      gold_value: round2(weights.gold_value), making: round2(weights.making),
    },
    by_karat: num3(num2(byKarat, ['amount']), ['weight_g']).map((r) => ({ ...r, pieces: Number(r.pieces) })),
    by_category: num3(num2(byCategory, ['amount']), ['weight_g']).map((r) => ({ ...r, pieces: Number(r.pieces) })),
    by_cashier: num2(byCashier, ['amount']),
    bills: num2(bills, ['subtotal', 'discount', 'total', 'paid_amount', 'balance']).map((b) => ({ ...b, pieces: Number(b.pieces) })),
  };
}

// Customer receipts: taken with today's bills, or against older bills / as an advance.
async function receiptsSection(db, d) {
  const [rows] = await db.query(
    `SELECT p.id, p.receipt_no, p.payment_date, COALESCE(c.name, 'Walk-in') AS customer, p.method, p.reference_no, p.amount,
            s.invoice_no, rp.repair_no,
            (s.id IS NOT NULL AND s.sale_date >= ? AND s.sale_date < DATE_ADD(?, INTERVAL 1 DAY)) AS with_todays_bill
     FROM customer_payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN sales s ON s.id = p.sale_id
     LEFT JOIN repair_orders rp ON rp.id = p.repair_id
     WHERE p.status = 'active' AND p.method <> 'old_gold' AND ${ON_DAY('p.payment_date')}
     ORDER BY p.payment_date, p.id`,
    [d, d, d, d],
  );
  const list = num2(rows, ['amount']).map((r) => ({ ...r, with_todays_bill: !!r.with_todays_bill }));
  const byMethod = new Map();
  for (const r of list) {
    const m = byMethod.get(r.method) || { label: r.method, count: 0, amount: 0 };
    m.count += 1;
    m.amount = round2(m.amount + r.amount);
    byMethod.set(r.method, m);
  }
  const withBills = round2(sum(list.filter((r) => r.with_todays_bill), 'amount'));
  const total = round2(sum(list, 'amount'));
  return {
    totals: { count: list.length, total, with_todays_bills: withBills, old_bills_and_advances: round2(total - withBills) },
    by_method: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
    list,
  };
}

async function purchasesSection(db, d) {
  const [rows] = await db.query(
    `SELECT pu.id, pu.purchase_no, pu.supplier_invoice_no, sp.name AS supplier, pu.total_weight_g, pu.total_amount,
            pu.paid_amount, pu.balance, pu.payment_status,
            (SELECT COALESCE(SUM(pl.qty), 0) FROM purchase_lines pl WHERE pl.purchase_id = pu.id) AS pieces
     FROM purchases pu JOIN suppliers sp ON sp.id = pu.supplier_id
     WHERE pu.purchase_date = ? ORDER BY pu.id`,
    [d],
  );
  const [payments] = await db.query(
    `SELECT p.id, p.payment_no, s.name AS supplier, p.method, p.reference_no, p.amount, p.notes
     FROM supplier_payments p JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.status = 'active' AND p.payment_date = ? ORDER BY p.id`,
    [d],
  );
  const list = num3(num2(rows, ['total_amount', 'paid_amount', 'balance']), ['total_weight_g']).map((r) => ({ ...r, pieces: Number(r.pieces) }));
  const pay = num2(payments, ['amount']);
  return {
    totals: {
      count: list.length, pieces: sum(list, 'pieces'), weight_g: round3(sum(list, 'total_weight_g')),
      total: round2(sum(list, 'total_amount')), on_credit: round2(sum(list, 'balance')),
      supplier_payments: round2(sum(pay, 'amount')), supplier_payment_count: pay.length,
    },
    list,
    supplier_payments: pay,
  };
}

async function expensesSection(db, d) {
  const [rows] = await db.query(
    `SELECT e.id, e.expense_no, ec.name AS category, e.paid_to, e.method, e.amount, e.notes
     FROM expenses e JOIN expense_categories ec ON ec.id = e.category_id
     WHERE e.status = 'active' AND e.expense_date = ? ORDER BY e.id`,
    [d],
  );
  const list = num2(rows, ['amount']);
  const byCategory = new Map();
  for (const r of list) {
    const c = byCategory.get(r.category) || { label: r.category, count: 0, amount: 0 };
    c.count += 1;
    c.amount = round2(c.amount + r.amount);
    byCategory.set(r.category, c);
  }
  return {
    totals: { count: list.length, total: round2(sum(list, 'amount')) },
    by_category: [...byCategory.values()].sort((a, b) => b.amount - a.amount),
    list,
  };
}

async function craftsmenSection(db, d) {
  const [issued] = await db.query(
    `SELECT j.id, j.job_no, j.job_type, c.name AS craftsman, cat.name AS category, k.name AS karat, j.description,
            j.issued_weight_g, j.craftsman_fee, j.status
     FROM craft_jobs j JOIN craftsmen c ON c.id = j.craftsman_id JOIN categories cat ON cat.id = j.category_id JOIN karats k ON k.id = j.karat_id
     WHERE j.issue_date = ? ORDER BY j.id`,
    [d],
  );
  const [completed] = await db.query(
    `SELECT j.id, j.job_no, c.name AS craftsman, cat.name AS category, k.name AS karat, j.description,
            j.issued_weight_g, j.returned_weight_g, j.wastage_g, j.craftsman_fee, i.item_code
     FROM craft_jobs j JOIN craftsmen c ON c.id = j.craftsman_id JOIN categories cat ON cat.id = j.category_id
     JOIN karats k ON k.id = j.karat_id LEFT JOIN items i ON i.id = j.item_id
     WHERE j.status = 'completed' AND j.completed_date = ? ORDER BY j.id`,
    [d],
  );
  const [payments] = await db.query(
    `SELECT p.id, p.payment_no, c.name AS craftsman, j.job_no, p.method, p.amount, p.notes
     FROM craftsman_payments p JOIN craftsmen c ON c.id = p.craftsman_id LEFT JOIN craft_jobs j ON j.id = p.craft_job_id
     WHERE p.status = 'active' AND p.payment_date = ? ORDER BY p.id`,
    [d],
  );
  // Gold given / taken back outside the normal issue -> return -> wastage of a job.
  const [adjustments] = await db.query(
    `SELECT l.id, c.name AS craftsman, k.name AS karat, l.txn_type, l.weight_g, l.notes, j.job_no
     FROM craftsman_gold_ledger l JOIN craftsmen c ON c.id = l.craftsman_id JOIN karats k ON k.id = l.karat_id
     LEFT JOIN craft_jobs j ON j.id = l.craft_job_id
     WHERE l.txn_date = ? AND l.txn_type IN ('extra_issue', 'gold_returned', 'adjustment') ORDER BY l.id`,
    [d],
  );
  const [[now]] = await db.query(
    `SELECT (SELECT COALESCE(SUM(gold_held_g), 0) FROM v_craftsman_balances) AS gold_held_g,
            (SELECT COALESCE(SUM(cash_due), 0) FROM v_craftsman_balances WHERE cash_due > 0) AS cash_due,
            (SELECT COUNT(*) FROM craft_jobs WHERE status = 'issued') AS open_jobs`,
  );
  const iss = num3(num2(issued, ['craftsman_fee']), ['issued_weight_g']);
  const done = num3(num2(completed, ['craftsman_fee']), ['issued_weight_g', 'returned_weight_g', 'wastage_g']);
  const pay = num2(payments, ['amount']);
  const issuedG = sum(done, 'issued_weight_g');
  const wastageG = sum(done, 'wastage_g');
  return {
    totals: {
      jobs_issued: iss.length, issued_g: round3(sum(iss.filter((j) => j.status !== 'cancelled'), 'issued_weight_g')),
      jobs_completed: done.length, returned_g: round3(sum(done, 'returned_weight_g')), wastage_g: round3(wastageG),
      wastage_percent: issuedG > 0 ? round2((wastageG / issuedG) * 100) : null,
      fees_earned: round2(sum(done, 'craftsman_fee')),
      payments: round2(sum(pay, 'amount')), payment_count: pay.length,
      gold_held_now_g: round3(now.gold_held_g), cash_due_now: round2(now.cash_due), open_jobs_now: Number(now.open_jobs),
    },
    issued: iss,
    completed: done,
    payments: pay,
    adjustments: num3(adjustments, ['weight_g']),
  };
}

// Customer repairs moved today. Their money is already in receipts (customer_payments.repair_id).
async function repairsSection(db, d) {
  const [rows] = await db.query(
    `SELECT r.id, r.repair_no, c.name AS customer, r.item_description, r.status, cm.name AS craftsman,
            r.received_date = ? AS received_today, r.given_date = ? AS given_today,
            r.back_date = ? AS back_today, r.delivered_date = ? AS delivered_today,
            r.weight_in_g, r.weight_out_g, r.repair_charge, r.gold_charge, r.total_charge, r.craftsman_fee
     FROM repair_orders r JOIN customers c ON c.id = r.customer_id LEFT JOIN craftsmen cm ON cm.id = r.craftsman_id
     WHERE r.received_date = ? OR r.given_date = ? OR r.back_date = ? OR r.delivered_date = ?
     ORDER BY r.id`,
    [d, d, d, d, d, d, d, d],
  );
  const list = num3(num2(rows, ['repair_charge', 'gold_charge', 'total_charge', 'craftsman_fee']), ['weight_in_g', 'weight_out_g'])
    .map((r) => ({ ...r, received_today: !!r.received_today, given_today: !!r.given_today, back_today: !!r.back_today, delivered_today: !!r.delivered_today }));
  const delivered = list.filter((r) => r.delivered_today && r.status === 'delivered');
  const [[open]] = await db.query("SELECT COUNT(*) AS n FROM repair_orders WHERE status IN ('received', 'with_craftsman', 'ready')");
  return {
    totals: {
      received: list.filter((r) => r.received_today).length,
      given: list.filter((r) => r.given_today).length,
      back: list.filter((r) => r.back_today).length,
      delivered: delivered.length,
      charged: round2(sum(delivered, 'total_charge')),
      open_now: Number(open.n),
    },
    list,
  };
}

// Customers' old gold taken in on the day: bought for cash, kept as credit, or exchanged on a bill.
async function oldGoldSection(db, d) {
  const [rows] = await db.query(
    `SELECT g.id, g.receipt_no, g.mode, g.payout_method, COALESCE(c.name, 'Walk-in') AS customer, s.invoice_no,
            g.total_net_weight_g, g.total_value,
            (SELECT COUNT(*) FROM old_gold_lines l WHERE l.receipt_id = g.id) AS pieces
     FROM old_gold_receipts g LEFT JOIN customers c ON c.id = g.customer_id LEFT JOIN sales s ON s.id = g.sale_id
     WHERE g.status = 'active' AND g.receipt_date = ?
     ORDER BY g.id`,
    [d],
  );
  const [byKarat] = await db.query(
    `SELECT k.name AS label, COUNT(*) AS pieces, SUM(l.net_weight_g) AS weight_g, SUM(l.value) AS amount
     FROM old_gold_lines l JOIN old_gold_receipts g ON g.id = l.receipt_id JOIN karats k ON k.id = l.karat_id
     WHERE g.status = 'active' AND g.receipt_date = ?
     GROUP BY k.id ORDER BY k.sort_order, k.id`,
    [d],
  );
  const list = num3(num2(rows, ['total_value']), ['total_net_weight_g']).map((r) => ({ ...r, pieces: Number(r.pieces) }));
  const ofMode = (m) => round2(sum(list.filter((r) => r.mode === m), 'total_value'));
  return {
    totals: {
      receipts: list.length,
      pieces: sum(list, 'pieces'),
      weight_g: round3(sum(list, 'total_net_weight_g')),
      value: round2(sum(list, 'total_value')),
      cash: ofMode('cash'), credit: ofMode('credit'), exchange: ofMode('exchange'),
    },
    by_karat: num3(num2(byKarat, ['amount']), ['weight_g']).map((r) => ({ ...r, pieces: Number(r.pieces) })),
    list,
  };
}

async function stockSection(db, d, showCost) {
  const [byType] = await db.query(
    `SELECT sm.movement_type AS label, COUNT(*) AS entries,
            SUM(CASE WHEN sm.qty_change > 0 THEN sm.qty_change ELSE 0 END) AS pieces_in,
            SUM(CASE WHEN sm.qty_change < 0 THEN -sm.qty_change ELSE 0 END) AS pieces_out,
            SUM(CASE WHEN sm.weight_change_g > 0 THEN sm.weight_change_g ELSE 0 END) AS weight_in_g,
            SUM(CASE WHEN sm.weight_change_g < 0 THEN -sm.weight_change_g ELSE 0 END) AS weight_out_g
     FROM stock_movements sm WHERE ${ON_DAY('sm.created_at')}
     GROUP BY sm.movement_type ORDER BY sm.movement_type`,
    [d, d],
  );
  const [added] = await db.query(
    `SELECT i.id, i.item_code, i.name, c.name AS category, k.name AS karat, i.source, i.net_weight_g, i.stock_qty, i.cost_price, i.status
     FROM items i JOIN categories c ON c.id = i.category_id JOIN karats k ON k.id = i.karat_id
     WHERE ${ON_DAY('i.created_at')} ORDER BY i.id`,
    [d, d],
  );
  const [[inStock]] = await db.query(
    `SELECT COALESCE(SUM(stock_qty), 0) AS pieces, COALESCE(SUM(net_weight_g * stock_qty), 0) AS net_g
     FROM items WHERE status = 'in_stock' AND stock_qty > 0`,
  );
  const types = num3(byType, ['weight_in_g', 'weight_out_g']).map((r) => ({ ...r, pieces_in: Number(r.pieces_in), pieces_out: Number(r.pieces_out) }));
  return {
    totals: {
      pieces_in: sum(types, 'pieces_in'), pieces_out: sum(types, 'pieces_out'),
      weight_in_g: round3(sum(types, 'weight_in_g')), weight_out_g: round3(sum(types, 'weight_out_g')),
      items_added: added.length, in_stock_now_pieces: Number(inStock.pieces), in_stock_now_g: round3(inStock.net_g),
    },
    by_type: types,
    items_added: num3(added, ['net_weight_g']).map(({ cost_price, ...r }) => (showCost ? { ...r, cost_price: round2(cost_price) } : r)),
  };
}

// Opening balance of each account (everything before the day), what moved on the day, and the expected closing.
async function cashSection(db, d) {
  const [opening] = await db.query(
    `SELECT f.account, SUM(f.direction * f.amount) AS balance FROM (${MONEY_FLOW_SQL}) f WHERE f.txn_date < ? GROUP BY f.account`,
    [d],
  );
  const [moves] = await db.query(
    `SELECT f.account, f.kind, f.direction, COUNT(*) AS count, SUM(f.amount) AS amount
     FROM (${MONEY_FLOW_SQL}) f WHERE f.txn_date = ? GROUP BY f.account, f.kind, f.direction ORDER BY f.account, f.direction DESC, f.kind`,
    [d],
  );
  const [owner] = await db.query(
    `SELECT ce.id, ce.entry_no, ce.entry_type, ce.account, ce.amount, ce.notes
     FROM cash_entries ce WHERE ce.status = 'active' AND ce.entry_date = ? ORDER BY ce.id`,
    [d],
  );
  const accounts = {};
  for (const acc of ['cash', 'bank']) {
    const open = round2(opening.find((r) => r.account === acc)?.balance);
    const rows = moves.filter((m) => m.account === acc);
    const moneyIn = round2(sum(rows.filter((r) => r.direction > 0), 'amount'));
    const moneyOut = round2(sum(rows.filter((r) => r.direction < 0), 'amount'));
    accounts[acc] = { opening: open, money_in: moneyIn, money_out: moneyOut, closing: round2(open + moneyIn - moneyOut) };
  }
  const nonTrading = [...TRANSFER_KINDS, ...OWNER_KINDS];
  const trading = moves.filter((m) => !nonTrading.includes(m.kind));
  return {
    accounts,
    movements: num2(moves, ['amount']).map((m) => ({ ...m, key: `${m.account}-${m.kind}-${m.direction}` })),
    trading_in: round2(sum(trading.filter((m) => m.direction > 0), 'amount')),
    trading_out: round2(sum(trading.filter((m) => m.direction < 0), 'amount')),
    owner_entries: num2(owner, ['amount']),
  };
}

// Revenue (after discounts) - cost of the pieces sold = gross profit; - shop expenses = net profit.
// Craftsman fees are already inside the cost of items they made, so they are not taken off again.
async function profitSection(db, d, expensesTotal) {
  const [lines] = await db.query(
    `SELECT c.name AS category, sl.qty,
            sl.line_total * s.total / NULLIF((SELECT SUM(x.line_total) FROM sale_lines x WHERE x.sale_id = s.id), 0) AS revenue,
            sl.unit_cost * sl.qty AS cost
     FROM sale_lines sl JOIN sales s ON s.id = sl.sale_id JOIN items i ON i.id = sl.item_id JOIN categories c ON c.id = i.category_id
     WHERE s.status = 'completed' AND ${ON_DAY('s.sale_date')}`,
    [d, d],
  );
  const byCategory = new Map();
  let revenue = 0;
  let cost = 0;
  let noCost = 0;
  for (const l of lines) {
    const r = round2(l.revenue);
    const c = round2(l.cost);
    revenue += r;
    cost += c;
    if (c <= 0) noCost += 1;
    const g = byCategory.get(l.category) || { label: l.category, pieces: 0, revenue: 0, cost: 0, profit: 0 };
    g.pieces += Number(l.qty);
    g.revenue = round2(g.revenue + r);
    g.cost = round2(g.cost + c);
    g.profit = round2(g.revenue - g.cost);
    byCategory.set(l.category, g);
  }
  // Repairs handed over today: the charge is revenue; the craftsman fee and the shop gold
  // (priced at the same rate it was charged) are the cost.
  const [[rep]] = await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total_charge), 0) AS revenue, COALESCE(SUM(craftsman_fee + gold_charge), 0) AS cost
     FROM repair_orders WHERE status = 'delivered' AND delivered_date = ?`,
    [d],
  );
  if (Number(rep.n) > 0) {
    const r = round2(rep.revenue);
    const c = round2(rep.cost);
    revenue += r;
    cost += c;
    byCategory.set('Repairs', { label: 'Repairs', pieces: Number(rep.n), revenue: r, cost: c, profit: round2(r - c) });
  }
  revenue = round2(revenue);
  cost = round2(cost);
  const gross = round2(revenue - cost);
  const net = round2(gross - expensesTotal);
  return {
    revenue, cost_of_sales: cost, gross_profit: gross,
    gross_margin_percent: revenue > 0 ? round2((gross / revenue) * 100) : null,
    expenses: round2(expensesTotal), net_profit: net,
    net_margin_percent: revenue > 0 ? round2((net / revenue) * 100) : null,
    lines_without_cost: noCost,
    by_category: [...byCategory.values()].sort((a, b) => b.profit - a.profit),
  };
}

export async function buildDaySummary(db, date, { showCost = false } = {}) {
  const sales = await salesSection(db, date);
  const receipts = await receiptsSection(db, date);
  const purchases = await purchasesSection(db, date);
  const expenses = await expensesSection(db, date);
  const craftsmen = await craftsmenSection(db, date);
  const repairs = await repairsSection(db, date);
  const oldGold = await oldGoldSection(db, date);
  const stock = await stockSection(db, date, showCost);
  const cash = await cashSection(db, date);
  const profit = showCost ? await profitSection(db, date, expenses.totals.total) : null;
  return {
    date,
    headline: {
      sales: sales.totals.total,
      bills: sales.totals.bills,
      money_in: cash.trading_in,
      money_out: cash.trading_out,
      net_cash_flow: round2(cash.trading_in - cash.trading_out),
      expected_cash: cash.accounts.cash.closing,
      net_profit: profit ? profit.net_profit : null,
    },
    sales, receipts, purchases, expenses, craftsmen, repairs, old_gold: oldGold, stock, cash, profit,
  };
}
