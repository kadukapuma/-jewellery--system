import { Router } from 'express';
import { pool } from '../../config/db.js';
import { requirePermission } from '../../middleware/auth.js';
import { getCurrentPrices, getGramsPerPound, getLiveGoldPrice } from '../gold-prices/gold-prices.service.js';

const router = Router();

const has = (req, code) => req.user.is_super_admin || req.user.permissionSet.has(code);

// Each section is only included when the user may see that data.
router.get('/', requirePermission('dashboard.view'), async (req, res) => {
  const result = { gold_prices: null, live_gold: null, sales: null, inventory: null, purchases: null, workshop: null, customers: null };

  if (has(req, 'gold_prices.view')) {
    result.gold_prices = { grams_per_pound: await getGramsPerPound(), prices: await getCurrentPrices() };
    result.live_gold = await getLiveGoldPrice();
  }

  if (has(req, 'sales.view')) {
    const [[today]] = await pool.query(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(total), 0) AS amount, COALESCE(SUM(paid_amount), 0) AS paid
       FROM sales WHERE status = 'completed' AND sale_date >= CURDATE()`,
    );
    const [[owed]] = await pool.query(
      `SELECT COALESCE(SUM(balance), 0) AS amount, COUNT(*) AS bills,
              COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN balance ELSE 0 END), 0) AS overdue
       FROM sales WHERE status = 'completed' AND balance > 0`,
    );
    result.sales = {
      today_bills: today.bills,
      today_amount: Number(today.amount),
      today_paid: Number(today.paid),
      owed_amount: Number(owed.amount),
      owed_bills: owed.bills,
      overdue_amount: Number(owed.overdue),
    };
    const [dailySales] = await pool.query(
      `SELECT DATE(sale_date) AS day, COUNT(*) AS bills, COALESCE(SUM(total), 0) AS amount
       FROM sales
       WHERE status = 'completed' AND sale_date >= CURDATE() - INTERVAL 6 DAY
       GROUP BY DATE(sale_date)
       ORDER BY day`,
    );
    const salesByDay = new Map(dailySales.map((row) => {
      const date = row.day instanceof Date ? row.day : new Date(`${row.day}T00:00:00`);
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return [day, row];
    }));
    result.sales.daily = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const row = salesByDay.get(day);
      return {
        day,
        bills: Number(row?.bills || 0),
        amount: Number(row?.amount || 0),
      };
    });
  }

  if (has(req, 'items.view')) {
    const [[stock]] = await pool.query(
      `SELECT
         SUM(status = 'in_stock') AS item_count,
         COALESCE(SUM(CASE WHEN status = 'in_stock' THEN net_weight_g * stock_qty ELSE 0 END), 0) AS weight_g,
         COALESCE(SUM(CASE WHEN status = 'in_stock' THEN cost_price * stock_qty ELSE 0 END), 0) AS value,
         SUM(status = 'with_craftsman') AS with_craftsman
       FROM items`,
    );
    result.inventory = {
      item_count: Number(stock.item_count || 0),
      weight_g: Number(stock.weight_g || 0),
      value: Number(stock.value || 0),
      with_craftsman: Number(stock.with_craftsman || 0),
    };
  }

  if (has(req, 'purchases.view')) {
    const [[purchases]] = await pool.query(
      `SELECT COUNT(*) AS pending_count, COALESCE(SUM(balance), 0) AS pending_amount,
              COALESCE(SUM(total_weight_g), 0) AS pending_weight_g
       FROM purchases WHERE balance > 0`,
    );
    result.purchases = {
      pending_count: Number(purchases.pending_count || 0),
      pending_amount: Number(purchases.pending_amount || 0),
      pending_weight_g: Number(purchases.pending_weight_g || 0),
    };
  }

  if (has(req, 'craft_jobs.view')) {
    const [[workshop]] = await pool.query(
      `SELECT COUNT(*) AS active_jobs, COALESCE(SUM(issued_weight_g), 0) AS issued_weight_g,
              0 AS completed_today
       FROM craft_jobs WHERE status = 'issued'`,
    );
    const [[completed]] = await pool.query(
      `SELECT COUNT(*) AS completed_today FROM craft_jobs
       WHERE status = 'completed' AND completed_date = CURDATE()`,
    );
    result.workshop = {
      active_jobs: Number(workshop.active_jobs || 0),
      issued_weight_g: Number(workshop.issued_weight_g || 0),
      completed_today: Number(completed.completed_today || 0),
    };
  }

  if (has(req, 'customers.view')) {
    const [[customers]] = await pool.query(
      `SELECT COUNT(*) AS total, COALESCE(SUM(opening_balance), 0) AS opening_balance
       FROM customers`,
    );
    result.customers = {
      total: Number(customers.total || 0),
      opening_balance: Number(customers.opening_balance || 0),
    };
  }

  res.json(result);
});

export default router;
