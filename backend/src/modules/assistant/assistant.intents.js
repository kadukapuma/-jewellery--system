import { hasPermission } from '../../middleware/auth.js';
import { dbToday, prettyDate } from '../../utils/dayLock.js';
import { getCurrentPrices } from '../gold-prices/gold-prices.service.js';
import { ITEM_SELECT, presentItem } from '../items/items.service.js';
import { buildDaySummary } from '../day-end/day-end.service.js';
import { periodRange } from './assistant.matcher.js';

// What the robot can answer. Each intent is read-only and lists the permissions that guard the
// same data on its normal screen; having ANY of them is enough. `null` = every logged-in user.

const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const grams = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} g`;
const count = (v) => Number(v || 0).toLocaleString('en-US');
const statusText = (s) => String(s || '').replace(/_/g, ' ');

export const INTENTS = {
  sales: {
    label: 'Sales totals',
    examples: ['Today sales', 'Sales this month', 'Yesterday sales'],
    permissions: ['sales.view', 'reports.sales'],
    async run({ db, args }) {
      const today = await dbToday(db);
      const r = periodRange(args.period, today);
      const [[t]] = await db.query(
        `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS total, COALESCE(SUM(paid_amount), 0) AS paid,
                COALESCE(SUM(balance), 0) AS credit, COALESCE(SUM(discount), 0) AS discount
         FROM sales WHERE status = 'completed' AND sale_date >= ? AND sale_date < DATE_ADD(?, INTERVAL 1 DAY)`,
        [r.from, r.to],
      );
      if (!Number(t.bills)) return { reply: `No sales ${r.label} yet.`, suggestions: ['Sales this month', 'Gold price'] };
      return {
        reply: `Sales ${r.label}: ${count(t.bills)} bill(s) worth ${money(t.total)}.`,
        cards: [
          ['Bills', count(t.bills)], ['Total', money(t.total)], ['Paid', money(t.paid)],
          ['On credit', money(t.credit)], ['Discount', money(t.discount)],
          ...(r.from === r.to ? [] : [['Period', `${r.from} → ${r.to}`]]),
        ],
        suggestions: ['Customer dues', 'Stock summary'],
      };
    },
  },

  dues: {
    label: 'Customer dues',
    examples: ['Customer dues', 'Overdue bills'],
    permissions: ['sales.view', 'customers.view', 'reports.customer_balances'],
    async run({ db }) {
      const [[o]] = await db.query(
        `SELECT COALESCE(SUM(balance), 0) AS amount, COUNT(*) AS bills,
                COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue,
                SUM(due_date < CURDATE()) AS overdue_bills
         FROM sales WHERE status = 'completed' AND balance > 0`,
      );
      if (!Number(o.bills)) return { reply: 'Good news — no bills are waiting for payment. 🎉' };
      return {
        reply: `Customers owe ${money(o.amount)} on ${count(o.bills)} bill(s)${Number(o.overdue) > 0 ? `, ${money(o.overdue)} of it overdue` : ''}.`,
        cards: [['Unpaid bills', count(o.bills)], ['Owed', money(o.amount)], ['Overdue bills', count(o.overdue_bills)], ['Overdue', money(o.overdue)]],
        suggestions: ['Balance of <customer name>'],
      };
    },
  },

  gold_price: {
    label: 'Gold prices',
    examples: ['Gold price', '22k gold rate'],
    permissions: ['gold_prices.view'],
    async run({ db, args }) {
      let prices = (await getCurrentPrices(db)).filter((p) => p.pound_price !== null);
      if (!prices.length) return { reply: 'No gold prices have been entered yet.' };
      if (args.karat) {
        const match = prices.filter((p) => String(p.karat).replace(/\D/g, '') === args.karat);
        if (!match.length) return { reply: `I couldn't find a price for ${args.karat}K. Here are all prices.`, cards: priceCards(prices) };
        prices = match;
      }
      const stale = prices.some((p) => !p.is_today);
      return {
        reply: prices.length === 1
          ? `${prices[0].karat}: ${money(prices[0].pound_price)} per pound, ${money(prices[0].gram_price)} per gram.`
          : 'Current gold prices (per pound / per gram):',
        cards: priceCards(prices),
        ...(stale ? { note: "⚠️ Some prices were not updated today." } : {}),
      };
    },
  },

  stock: {
    label: 'Stock summary',
    examples: ['Stock summary', 'How many items in stock'],
    permissions: ['items.view'],
    async run({ db, req }) {
      const [[s]] = await db.query(
        `SELECT COUNT(*) AS lines_, COALESCE(SUM(i.stock_qty), 0) AS pieces,
                COALESCE(SUM(i.net_weight_g * i.stock_qty), 0) AS weight,
                COALESCE(SUM(((i.net_weight_g + i.wastage_g) * cp.gram_price + i.making_charge) * i.stock_qty), 0) AS value_now,
                COALESCE(SUM(i.cost_price * i.stock_qty), 0) AS cost
         FROM items i LEFT JOIN v_current_gold_prices cp ON cp.karat_id = i.karat_id
         WHERE i.status = 'in_stock' AND i.stock_qty > 0`,
      );
      const [[w]] = await db.query("SELECT COUNT(*) AS n FROM items WHERE status = 'with_craftsman'");
      const cards = [
        ['Items', count(s.lines_)], ['Pieces', count(s.pieces)], ['Gold weight', grams(s.weight)],
        ['Value today', money(s.value_now)],
      ];
      if (hasPermission(req, 'items.view_cost')) cards.push(['Cost', money(s.cost)]);
      cards.push(['With craftsman', count(w.n)]);
      return {
        reply: `You have ${count(s.pieces)} piece(s) in stock, ${grams(s.weight)} of gold, worth about ${money(s.value_now)} at today's price.`,
        cards,
        suggestions: ['Item <code>'],
      };
    },
  },

  item: {
    label: 'Find an item',
    examples: ['Item RNG-000123', 'Find item chain'],
    permissions: ['items.view'],
    async run({ db, req, args }) {
      if (args.code) {
        const [rows] = await db.query(`${ITEM_SELECT} WHERE i.barcode = ? OR i.item_code = ? LIMIT 1`, [args.code, args.code]);
        if (rows.length) return { reply: 'Found it:', cards: itemCards(presentItem(rows[0], req)) };
      }
      const term = args.code || args.name;
      if (!term) return { reply: 'Tell me the item code, barcode or name, e.g. "item RNG-000123".' };
      const [rows] = await db.query(
        `${ITEM_SELECT} WHERE i.item_code LIKE ? OR i.name LIKE ? ORDER BY i.status = 'in_stock' DESC, i.id DESC LIMIT 6`,
        [`%${term}%`, `%${term}%`],
      );
      if (!rows.length) return { reply: `No item matches "${term}".` };
      if (rows.length === 1) return { reply: 'Found it:', cards: itemCards(presentItem(rows[0], req)) };
      return {
        reply: `I found ${rows.length === 6 ? 'many' : rows.length} items for "${term}"${rows.length === 6 ? ' (first 6)' : ''}:`,
        list: rows.map((r) => ({
          title: `${r.item_code} · ${r.name}`,
          subtitle: `${r.karat_name} · ${grams(r.net_weight_g)} · ${statusText(r.status)} · qty ${r.stock_qty}`,
          ask: `item ${r.item_code}`,
        })),
      };
    },
  },

  customer: {
    label: 'Customer balance',
    examples: ['Balance of <customer name>', 'Customer 0771234567'],
    permissions: ['customers.view', 'customer_payments.view'],
    async run({ db, args }) {
      if (!args.name) return { reply: 'Which customer? Type a name or phone number, e.g. "customer Nimal".' };
      const like = `%${args.name}%`;
      const [rows] = await db.query(
        `SELECT c.id, c.name, c.phone, b.balance,
                (SELECT COALESCE(SUM(s.balance), 0) FROM sales s
                 WHERE s.customer_id = c.id AND s.status = 'completed' AND s.balance > 0 AND s.due_date < CURDATE()) AS overdue,
                (SELECT MAX(s.sale_date) FROM sales s WHERE s.customer_id = c.id AND s.status = 'completed') AS last_sale
         FROM customers c JOIN v_customer_balances b ON b.customer_id = c.id
         WHERE c.name LIKE ? OR c.phone LIKE ? OR c.nic LIKE ?
         ORDER BY c.name LIMIT 6`,
        [like, like, like],
      );
      if (!rows.length) return { reply: `No customer matches "${args.name}".` };
      if (rows.length === 1) {
        const c = rows[0];
        const bal = Number(c.balance);
        return {
          reply: bal > 0 ? `${c.name} owes ${money(bal)}.` : bal < 0 ? `${c.name} has an advance of ${money(-bal)} with the shop.` : `${c.name} has no balance. ✅`,
          cards: [
            ['Name', c.name], ['Phone', c.phone || '—'], ['Balance', money(bal)], ['Overdue', money(c.overdue)],
            ['Last sale', c.last_sale ? String(c.last_sale).slice(0, 10) : '—'],
          ],
        };
      }
      return {
        reply: `${rows.length === 6 ? 'Many' : rows.length} customers match "${args.name}". Tap one:`,
        list: rows.map((c) => ({ title: c.name, subtitle: `${c.phone || 'no phone'} · balance ${money(c.balance)}`, ask: `customer ${c.phone || c.name}` })),
      };
    },
  },

  repairs: {
    label: 'Repairs',
    examples: ['Repairs ready to collect', 'Open repairs'],
    permissions: ['repairs.view'],
    async run({ db, args }) {
      const select = `SELECT r.repair_no, r.item_description, r.status, r.received_date, r.promised_date, c.name AS customer_name, c.phone
                      FROM repair_orders r JOIN customers c ON c.id = r.customer_id`;
      if (args.code) {
        const [rows] = await db.query(`${select} WHERE r.repair_no LIKE ? LIMIT 1`, [`%${args.code}%`]);
        if (rows.length) {
          const r = rows[0];
          return {
            reply: `${r.repair_no} is ${statusText(r.status)}.`,
            cards: [['Customer', r.customer_name], ['Item', r.item_description], ['Received', r.received_date], ['Promised', r.promised_date || '—']],
          };
        }
      }
      const [counts] = await db.query('SELECT status, COUNT(*) AS n FROM repair_orders GROUP BY status');
      const c = Object.fromEntries(counts.map((x) => [x.status, Number(x.n)]));
      const where = args.status === 'ready' ? "r.status = 'ready'"
        : args.status === 'with_craftsman' ? "r.status = 'with_craftsman'"
          : "r.status IN ('received', 'with_craftsman', 'ready')";
      const [rows] = await db.query(`${select} WHERE ${where} ORDER BY FIELD(r.status, 'ready', 'with_craftsman', 'received'), r.promised_date IS NULL, r.promised_date LIMIT 8`);
      return {
        reply: `Repairs: ${c.received || 0} received, ${c.with_craftsman || 0} with craftsman, ${c.ready || 0} ready to collect.`,
        list: rows.map((r) => ({
          title: `${r.repair_no} · ${r.customer_name}`,
          subtitle: `${r.item_description} · ${statusText(r.status)}${r.promised_date ? ` · promised ${r.promised_date}` : ''}`,
          ask: `repair ${r.repair_no}`,
        })),
      };
    },
  },

  day_end: {
    label: 'Day end',
    examples: ['Day end status', 'Cash in hand'],
    permissions: ['day_end.view'],
    async run({ db, req }) {
      const today = await dbToday(db);
      const showCost = hasPermission(req, 'reports.profit');
      const summary = await buildDaySummary(db, today, { showCost });
      const [[closing]] = await db.query('SELECT status, closed_at FROM day_closings WHERE close_date = ?', [today]);
      const h = summary.headline;
      const closed = closing?.status === 'closed';
      const cards = [
        ['Status', closed ? 'Closed ✅' : 'Not closed yet'], ['Sales', money(h.sales)], ['Bills', count(h.bills)],
        ['Money in', money(h.money_in)], ['Money out', money(h.money_out)], ['Expected cash', money(h.expected_cash)],
      ];
      if (showCost && h.net_profit !== null) cards.push(['Net profit', money(h.net_profit)]);
      return { reply: `Day end for ${prettyDate(today)}: ${closed ? 'already closed.' : 'not done yet.'}`, cards };
    },
  },

  workshop: {
    label: 'Workshop jobs',
    examples: ['Workshop jobs'],
    permissions: ['craft_jobs.view'],
    async run({ db }) {
      const [[w]] = await db.query(
        "SELECT COUNT(*) AS active, COALESCE(SUM(issued_weight_g), 0) AS weight FROM craft_jobs WHERE status = 'issued'",
      );
      const [[d]] = await db.query("SELECT COUNT(*) AS n FROM craft_jobs WHERE status = 'completed' AND completed_date = CURDATE()");
      return {
        reply: `${count(w.active)} job(s) are with craftsmen, holding ${grams(w.weight)} of gold. ${count(d.n)} finished today.`,
        cards: [['Active jobs', count(w.active)], ['Gold issued', grams(w.weight)], ['Completed today', count(d.n)]],
      };
    },
  },

  supplier_dues: {
    label: 'Supplier dues',
    examples: ['Supplier dues'],
    permissions: ['purchases.view', 'reports.supplier_balances'],
    async run({ db }) {
      const [[p]] = await db.query(
        `SELECT COUNT(*) AS n, COALESCE(SUM(balance), 0) AS amount, COALESCE(SUM(total_weight_g), 0) AS weight
         FROM purchases WHERE balance > 0`,
      );
      if (!Number(p.n)) return { reply: 'All purchases are paid. ✅' };
      return {
        reply: `You owe suppliers ${money(p.amount)} on ${count(p.n)} purchase(s).`,
        cards: [['Unpaid purchases', count(p.n)], ['Amount', money(p.amount)], ['Weight', grams(p.weight)]],
      };
    },
  },

  whoami: {
    label: 'My account',
    examples: ['Who am I'],
    permissions: null,
    async run({ req }) {
      const u = req.user;
      const allowed = allowedIntents(req).filter((id) => id !== 'whoami').map((id) => INTENTS[id].label);
      return {
        reply: `You are ${u.name || u.username} (${u.username}), role ${u.role_name || '—'}${u.is_super_admin ? ' — full access' : ''}.`,
        cards: [
          ['Role', u.role_name || '—'],
          ['Permissions', u.is_super_admin ? 'All' : count(u.permissionSet?.size ?? 0)],
          ['I can tell you', allowed.length ? allowed.join(', ') : 'nothing yet — ask your admin'],
        ],
      };
    },
  },

  help: {
    label: 'Help',
    examples: ['What can you do?'],
    permissions: null,
    async run({ req }) {
      const ids = allowedIntents(req).filter((id) => id !== 'help');
      return {
        reply: ids.length > 1
          ? 'You can ask me things like:'
          : "Your role doesn't give access to shop data yet, so there's not much I can look up for you.",
        suggestions: ids.flatMap((id) => INTENTS[id].examples.slice(0, 1)),
      };
    },
  },
};

function priceCards(prices) {
  return prices.map((p) => [p.karat, `${money(p.pound_price)} / ${money(p.gram_price)}`]);
}

function itemCards(i) {
  const cards = [
    ['Code', i.item_code], ['Name', i.name], ['Category', i.category_name], ['Karat', i.karat_name],
    ['Weight', grams(i.net_weight_g)], ['Status', statusText(i.status)], ['Qty', count(i.stock_qty)],
    ['Price today', i.price_now === null ? 'No gold price' : money(i.price_now)],
  ];
  if (i.price_min_now !== null && i.price_max_now !== null && i.price_max_now !== i.price_min_now) {
    cards.push(['Price range', `${money(i.price_min_now)} – ${money(i.price_max_now)}`]);
  }
  if (i.cost_price !== undefined) cards.push(['Cost', money(i.cost_price)]);
  return cards;
}

export function canUse(req, id) {
  const perms = INTENTS[id]?.permissions;
  if (perms === undefined) return false;
  return perms === null || perms.some((p) => hasPermission(req, p));
}

export function allowedIntents(req) {
  return Object.keys(INTENTS).filter((id) => canUse(req, id));
}
