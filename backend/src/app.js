import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { authenticate, requireAdmin, requirePasswordChanged } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import usersRoutes from './modules/users/users.routes.js';
import rolesRoutes from './modules/roles/roles.routes.js';
import permissionsRoutes from './modules/permissions/permissions.routes.js';
import activityRoutes from './modules/activity/activity.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import karatsRoutes from './modules/karats/karats.routes.js';
import goldPricesRoutes from './modules/gold-prices/gold-prices.routes.js';
import categoriesRoutes from './modules/categories/categories.routes.js';
import itemsRoutes from './modules/items/items.routes.js';
import tagsRoutes from './modules/tags/tags.routes.js';
import settingsRoutes from './modules/settings/settings.routes.js';
import suppliersRoutes from './modules/suppliers/suppliers.routes.js';
import purchasesRoutes from './modules/purchases/purchases.routes.js';
import supplierPaymentsRoutes from './modules/supplier-payments/supplier-payments.routes.js';
import craftsmenRoutes from './modules/craftsmen/craftsmen.routes.js';
import craftJobsRoutes from './modules/craft-jobs/craft-jobs.routes.js';
import craftsmanPaymentsRoutes from './modules/craftsman-payments/craftsman-payments.routes.js';
import customersRoutes from './modules/customers/customers.routes.js';
import salesRoutes from './modules/sales/sales.routes.js';
import customerPaymentsRoutes from './modules/customer-payments/customer-payments.routes.js';
import reportsRoutes from './modules/reports/reports.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import expensesRoutes from './modules/expenses/expenses.routes.js';
import dayEndRoutes from './modules/day-end/day-end.routes.js';
import repairsRoutes from './modules/repairs/repairs.routes.js';
import oldGoldRoutes from './modules/old-gold/old-gold.routes.js';
import dangerZoneRoutes, { myRequestsRouter } from './modules/danger-zone/danger-zone.routes.js';

const app = express();

app.set('trust proxy', 'loopback');
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);

// Everything below needs a logged-in user who has finished any forced password change.
const secured = [authenticate, requirePasswordChanged];
app.use('/api/users', secured, usersRoutes);
app.use('/api/roles', secured, rolesRoutes);
app.use('/api/permissions', secured, permissionsRoutes);
app.use('/api/activity', secured, activityRoutes);
app.use('/api/dashboard', secured, dashboardRoutes);
app.use('/api/karats', secured, karatsRoutes);
app.use('/api/gold-prices', secured, goldPricesRoutes);
app.use('/api/categories', secured, categoriesRoutes);
app.use('/api/items', secured, itemsRoutes);
app.use('/api/tags', secured, tagsRoutes);
app.use('/api/settings', secured, settingsRoutes);
app.use('/api/suppliers', secured, suppliersRoutes);
app.use('/api/purchases', secured, purchasesRoutes);
app.use('/api/supplier-payments', secured, supplierPaymentsRoutes);
app.use('/api/craftsmen', secured, craftsmenRoutes);
app.use('/api/craft-jobs', secured, craftJobsRoutes);
app.use('/api/craftsman-payments', secured, craftsmanPaymentsRoutes);
app.use('/api/customers', secured, customersRoutes);
app.use('/api/sales', secured, salesRoutes);
app.use('/api/customer-payments', secured, customerPaymentsRoutes);
app.use('/api/reports', secured, reportsRoutes);
app.use('/api/finance', secured, financeRoutes);
app.use('/api/expenses', secured, expensesRoutes);
app.use('/api/day-end', secured, dayEndRoutes);
app.use('/api/repairs', secured, repairsRoutes);
app.use('/api/old-gold', secured, oldGoldRoutes);
app.use('/api/danger-zone', secured, requireAdmin, dangerZoneRoutes);
app.use('/api/change-requests', secured, myRequestsRouter);

// On the server, the API also serves the built React app (frontend/dist), so one Node app runs everything.
// Any non-API page (e.g. /finance after a refresh) gets index.html and React Router takes over.
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (fs.existsSync(webRoot)) {
  app.use(express.static(webRoot));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(webRoot, 'index.html')));
}

app.use((req, res) => res.status(404).json({ message: 'Not found' }));
app.use(errorHandler);

export default app;
