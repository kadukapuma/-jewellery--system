// Money owed to suppliers: purchases.paid_amount / balance / payment_status are always
// recomputed from the allocations of active payments, never edited directly.

const round2 = (n) => Math.round(n * 100) / 100;

export async function recomputePurchase(conn, purchaseId) {
  await conn.query(
    `UPDATE purchases p
     SET p.paid_amount = (SELECT COALESCE(SUM(a.amount), 0)
                          FROM supplier_payment_allocations a
                          JOIN supplier_payments sp ON sp.id = a.payment_id
                          WHERE a.purchase_id = p.id AND sp.status = 'active'),
         p.balance = p.total_amount - p.paid_amount,
         p.payment_status = CASE WHEN p.paid_amount <= 0 THEN 'unpaid'
                                 WHEN p.balance <= 0 THEN 'paid'
                                 ELSE 'partial' END
     WHERE p.id = ?`,
    [purchaseId],
  );
}

// Spreads `amount` of a payment over the supplier's unpaid purchases, oldest first
// (or `firstPurchaseId` first). Returns how much was allocated; the rest stays as an advance.
export async function allocatePayment(conn, { paymentId, supplierId, amount, firstPurchaseId = null }) {
  let remaining = round2(amount);
  if (remaining <= 0) return 0;
  const [open] = await conn.query(
    `SELECT id, balance FROM purchases
     WHERE supplier_id = ? AND balance > 0
     ORDER BY (id = ?) DESC, purchase_date, id
     FOR UPDATE`,
    [supplierId, firstPurchaseId ?? 0],
  );
  for (const p of open) {
    if (remaining <= 0) break;
    const share = round2(Math.min(remaining, Number(p.balance)));
    await conn.query('INSERT INTO supplier_payment_allocations (payment_id, purchase_id, amount) VALUES (?, ?, ?)', [
      paymentId, p.id, share,
    ]);
    remaining = round2(remaining - share);
    await recomputePurchase(conn, p.id);
  }
  return round2(amount - remaining);
}

// Uses money already paid but not yet matched to a purchase (advances) on unpaid purchases.
export async function applyAdvances(conn, supplierId) {
  const [payments] = await conn.query(
    `SELECT sp.id, sp.amount - COALESCE((SELECT SUM(a.amount) FROM supplier_payment_allocations a WHERE a.payment_id = sp.id), 0) AS unallocated
     FROM supplier_payments sp
     WHERE sp.supplier_id = ? AND sp.status = 'active'
     HAVING unallocated > 0
     ORDER BY sp.payment_date, sp.id`,
    [supplierId],
  );
  for (const p of payments) {
    await allocatePayment(conn, { paymentId: p.id, supplierId, amount: Number(p.unallocated) });
  }
}
