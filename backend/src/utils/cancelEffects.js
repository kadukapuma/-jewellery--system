import { pool, withTransaction } from '../config/db.js';
import { accountBalances } from '../modules/finance/finance.service.js';
import { goldByKarat } from '../modules/craftsmen/craftsmen.gold.js';
import { writeAudit } from './audit.js';
import { HttpError } from './httpError.js';

// What a cancel changes besides the record itself: stock, refunds, advances, bills owed again,
// craftsman gold, cash and bank. Every cancel route runs inside runCancel():
//   - the route adds its own lines with fx.add() and says which customers / bills / suppliers ... to watch;
//   - runCancel() compares cash & bank and every watched balance before and after, and adds those lines;
//   - with { preview: true } in the body the whole cancel is run and then rolled back, so the list shown
//     before confirming is exactly what the real cancel does (and any "cannot cancel" error shows first).

const PREVIEW = Symbol('cancel-preview');
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;
export const money = (n) => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const grams = (n) => `${round3(n).toFixed(3)} g`;
const signed = (n) => `${n > 0 ? '+' : '−'}${money(Math.abs(n))}`;

export const isPreview = (req) => req.body?.preview === true;

// The cancel reason. A preview has none yet, so it is never required there.
export function cancelReason(req, { required = false } = {}) {
  const raw = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (raw.length > 255) throw new HttpError(400, 'Reason is too long (255 characters at most)');
  if (!raw && required && !isPreview(req)) throw new HttpError(400, 'Give a reason');
  return raw || null;
}

async function customerState(conn, id) {
  const [[c]] = await conn.query(
    `SELECT c.name, b.balance,
            (SELECT COALESCE(SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM customer_payment_allocations a WHERE a.payment_id = p.id), 0)), 0)
             FROM customer_payments p WHERE p.customer_id = c.id AND p.status = 'active'
               AND (p.repair_id IS NULL OR EXISTS (SELECT 1 FROM repair_orders ro WHERE ro.id = p.repair_id AND ro.status = 'cancelled'))) AS advance
     FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id WHERE c.id = ?`,
    [id],
  );
  return c ? { name: c.name, owes: round2(Math.max(0, Number(c.balance))), advance: round2(c.advance) } : null;
}

async function craftsmanState(conn, id) {
  const [[c]] = await conn.query('SELECT name, cash_due FROM v_craftsman_balances WHERE craftsman_id = ?', [id]);
  if (!c) return null;
  const gold = (await goldByKarat(conn, [id])).get(id) || [];
  return { name: c.name, cash_due: round2(c.cash_due), gold: new Map(gold.map((g) => [g.karat_name, g.gold_g])) };
}

export class Effects {
  constructor() {
    this.list = [];
    this.customers = new Map();
    this.suppliers = new Map();
    this.craftsmen = new Map();
    this.sales = new Map();
    this.purchases = new Map();
  }

  // area: stock | money | customer | supplier | craftsman | bill | receipt | old_gold | gold
  add(area, text, link = null) {
    this.list.push({ area, text, link });
  }

  async watchCustomer(conn, id) {
    if (!id || this.customers.has(id)) return;
    this.customers.set(id, await customerState(conn, id));
  }

  async watchSupplier(conn, id) {
    if (!id || this.suppliers.has(id)) return;
    const [[s]] = await conn.query('SELECT name, balance FROM v_supplier_balances WHERE supplier_id = ?', [id]);
    this.suppliers.set(id, s ? { name: s.name, balance: round2(s.balance) } : null);
  }

  async watchCraftsman(conn, id) {
    if (!id || this.craftsmen.has(id)) return;
    this.craftsmen.set(id, await craftsmanState(conn, id));
  }

  async watchSales(conn, ids) {
    for (const id of ids) {
      if (!id || this.sales.has(id)) continue;
      const [[s]] = await conn.query('SELECT invoice_no, balance, status FROM sales WHERE id = ?', [id]);
      if (s) this.sales.set(id, { ...s, balance: round2(s.balance) });
    }
  }

  async watchPurchases(conn, ids) {
    for (const id of ids) {
      if (!id || this.purchases.has(id)) continue;
      const [[p]] = await conn.query('SELECT purchase_no, balance FROM purchases WHERE id = ?', [id]);
      if (p) this.purchases.set(id, { ...p, balance: round2(p.balance) });
    }
  }

  // Compares everything watched (and cash / bank) with how it was, and adds a line for each change.
  async finish(conn, moneyBefore, moneyAfter) {
    for (const [id, before] of this.sales) {
      const [[s]] = await conn.query('SELECT invoice_no, balance, status FROM sales WHERE id = ?', [id]);
      if (!s || s.status === 'cancelled' || before.status === 'cancelled') continue;
      const after = round2(s.balance);
      if (Math.abs(after - before.balance) < 0.005) continue;
      this.add('bill', after > before.balance
        ? `Bill ${s.invoice_no} is owed again: balance ${money(before.balance)} → ${money(after)}`
        : `Bill ${s.invoice_no} balance ${money(before.balance)} → ${money(after)}`, `/sales/${id}`);
    }
    for (const [id, before] of this.purchases) {
      const [[p]] = await conn.query('SELECT purchase_no, balance FROM purchases WHERE id = ?', [id]);
      const after = round2(p?.balance);
      if (!p || Math.abs(after - before.balance) < 0.005) continue;
      this.add('bill', `Purchase ${p.purchase_no}: still to pay ${money(before.balance)} → ${money(after)}`, `/purchases/${id}`);
    }
    for (const [id, before] of this.customers) {
      if (!before) continue;
      const after = await customerState(conn, id);
      if (Math.abs(after.advance - before.advance) >= 0.005) {
        this.add('customer', `${after.name}'s advance ${money(before.advance)} → ${money(after.advance)}`, '/customers');
      }
      if (Math.abs(after.owes - before.owes) >= 0.005) {
        this.add('customer', `${after.name} owes ${money(before.owes)} → ${money(after.owes)}`, '/customers');
      }
    }
    for (const [id, before] of this.suppliers) {
      if (!before) continue;
      const [[s]] = await conn.query('SELECT balance FROM v_supplier_balances WHERE supplier_id = ?', [id]);
      const after = round2(s?.balance);
      if (Math.abs(after - before.balance) >= 0.005) {
        this.add('supplier', `Owed to ${before.name}: ${money(before.balance)} → ${money(after)}`, '/suppliers');
      }
    }
    for (const [id, before] of this.craftsmen) {
      if (!before) continue;
      const after = await craftsmanState(conn, id);
      for (const karat of new Set([...before.gold.keys(), ...after.gold.keys()])) {
        const a = before.gold.get(karat) || 0;
        const b = after.gold.get(karat) || 0;
        if (Math.abs(b - a) >= 0.0005) this.add('craftsman', `${after.name} holds ${karat}: ${grams(a)} → ${grams(b)}`, '/craftsmen');
      }
      if (Math.abs(after.cash_due - before.cash_due) >= 0.005) {
        this.add('craftsman', `Owed to ${after.name}: ${money(before.cash_due)} → ${money(after.cash_due)}`, '/craftsmen');
      }
    }
    for (const [account, label] of [['cash', 'Cash in hand'], ['bank', 'Bank']]) {
      const d = round2(moneyAfter[account] - moneyBefore[account]);
      if (Math.abs(d) < 0.005) continue;
      const hint = d < 0 ? (account === 'cash' ? 'pay this out of the drawer' : 'pay this from the bank') : 'this money comes back to the shop';
      this.add('money', `${label} ${signed(d)} (${money(moneyBefore[account])} → ${money(moneyAfter[account])}): ${hint}`, '/finance');
    }
  }
}

// A preview is the real cancel rolled back, so it is only safe when every table can roll back (InnoDB).
// On MyISAM a "rollback" does nothing and the preview would really cancel: refuse it instead.
let transactional = null;
async function tablesCanRollBack(db) {
  if (transactional === null) {
    const [[row]] = await db.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND engine <> 'InnoDB'",
    );
    transactional = Number(row.n) === 0;
  }
  return transactional;
}

// Runs a cancel. work(conn, fx) does the cancel and returns the record id or anything the route needs.
// Returns { preview, effects, result }. A preview changes nothing.
export async function runCancel(req, { table, recordId }, work) {
  const fx = new Effects();
  const preview = isPreview(req);
  if (preview && !(await tablesCanRollBack(pool))) {
    throw new HttpError(409, 'The list of changes cannot be shown on this database (its tables are not InnoDB).', 'PREVIEW_UNAVAILABLE');
  }
  let result;
  try {
    await withTransaction(async (conn) => {
      const before = await accountBalances(conn);
      result = await work(conn, fx);
      await fx.finish(conn, before, await accountBalances(conn));
      if (preview) throw PREVIEW;
      if (fx.list.length) {
        await writeAudit(conn, req, { action: 'cancel_effects', table, recordId, newValues: { effects: fx.list.map((e) => e.text) } });
      }
    });
  } catch (err) {
    if (err !== PREVIEW) throw err;
  }
  return { preview, effects: fx.list, result };
}

// Sends the preview, or the record (from load()) with what changed.
export async function sendCancel(res, outcome, load) {
  if (outcome.preview) return res.json({ preview: true, effects: outcome.effects });
  return res.json({ ...(await load()), effects: outcome.effects });
}
