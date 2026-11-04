// What customers owe: sales.paid_amount / balance / payment_status and the instalment schedule
// are always recomputed from the allocations of active payments, never edited directly.

const round2 = (n) => Math.round(n * 100) / 100;

export async function recomputeSale(conn, saleId) {
  await conn.query(
    `UPDATE sales s
     SET s.paid_amount = (SELECT COALESCE(SUM(a.amount), 0)
                          FROM customer_payment_allocations a
                          JOIN customer_payments p ON p.id = a.payment_id
                          WHERE a.sale_id = s.id AND p.status = 'active'),
         s.balance = s.total - s.paid_amount,
         s.payment_status = CASE WHEN s.balance <= 0 THEN 'paid'
                                 WHEN s.paid_amount <= 0 THEN 'unpaid'
                                 ELSE 'partial' END
     WHERE s.id = ?`,
    [saleId],
  );

  // Instalments: whatever was paid beyond the down payment fills the schedule in order.
  const [[plan]] = await conn.query(
    `SELECT ip.id, ip.financed_amount, s.total, s.paid_amount
     FROM instalment_plans ip JOIN sales s ON s.id = ip.sale_id
     WHERE ip.sale_id = ? AND ip.status <> 'cancelled'`,
    [saleId],
  );
  if (!plan) return;
  let available = round2(Number(plan.paid_amount) - (Number(plan.total) - Number(plan.financed_amount)));
  const [rows] = await conn.query('SELECT id, amount_due FROM instalment_schedule WHERE plan_id = ? ORDER BY instalment_no', [plan.id]);
  let allPaid = true;
  for (const row of rows) {
    const due = Number(row.amount_due);
    const paid = round2(Math.max(0, Math.min(available, due)));
    available = round2(available - paid);
    const status = paid >= due ? 'paid' : paid > 0 ? 'partial' : 'pending';
    if (status !== 'paid') allPaid = false;
    await conn.query('UPDATE instalment_schedule SET amount_paid = ?, status = ? WHERE id = ?', [paid, status, row.id]);
  }
  await conn.query('UPDATE instalment_plans SET status = ? WHERE id = ?', [allPaid ? 'completed' : 'active', plan.id]);
}

// Spreads a payment over the customer's unpaid bills, `firstSaleId` first then oldest.
// Returns the amount allocated; the rest stays with the shop as the customer's advance.
export async function allocateCustomerPayment(conn, { paymentId, customerId, amount, firstSaleId = null }) {
  let remaining = round2(amount);
  if (remaining <= 0) return 0;
  const [open] = await conn.query(
    `SELECT id, balance FROM sales
     WHERE ${customerId ? 'customer_id = ?' : 'id = ?'} AND status = 'completed' AND balance > 0
     ORDER BY (id = ?) DESC, sale_date, id
     FOR UPDATE`,
    [customerId ?? firstSaleId, firstSaleId ?? 0],
  );
  for (const s of open) {
    if (remaining <= 0) break;
    const share = round2(Math.min(remaining, Number(s.balance)));
    await conn.query('INSERT INTO customer_payment_allocations (payment_id, sale_id, amount) VALUES (?, ?, ?)', [paymentId, s.id, share]);
    remaining = round2(remaining - share);
    await recomputeSale(conn, s.id);
  }
  return round2(amount - remaining);
}

// Money the customer already has with the shop (advances) is used on unpaid bills.
export async function applyCustomerAdvances(conn, customerId) {
  if (!customerId) return;
  const [payments] = await conn.query(
    `SELECT p.id, p.amount - COALESCE((SELECT SUM(a.amount) FROM customer_payment_allocations a WHERE a.payment_id = p.id), 0) AS unallocated
     FROM customer_payments p
     WHERE p.customer_id = ? AND p.status = 'active'
     HAVING unallocated > 0
     ORDER BY p.payment_date, p.id`,
    [customerId],
  );
  for (const p of payments) {
    await allocateCustomerPayment(conn, { paymentId: p.id, customerId, amount: Number(p.unallocated) });
  }
}

// Even split of the financed amount; the last instalment takes the rounding difference.
export function buildSchedule(financed, count, frequency, startDate) {
  const base = Math.floor((financed / count) * 100) / 100;
  const rows = [];
  const [y, m, d] = startDate.split('-').map(Number);
  for (let i = 0; i < count; i++) {
    let due;
    if (frequency === 'weekly') {
      due = new Date(Date.UTC(y, m - 1, d + 7 * i));
    } else {
      // Same day each month, or the month's last day (31 Jan -> 28 Feb -> 31 Mar).
      const lastDay = new Date(Date.UTC(y, m - 1 + i + 1, 0)).getUTCDate();
      due = new Date(Date.UTC(y, m - 1 + i, Math.min(d, lastDay)));
    }
    const amount = i === count - 1 ? round2(financed - base * (count - 1)) : base;
    rows.push({ instalment_no: i + 1, due_date: due.toISOString().slice(0, 10), amount_due: amount });
  }
  return rows;
}
