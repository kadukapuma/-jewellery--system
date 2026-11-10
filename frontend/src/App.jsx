import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAdmin, RequireAuth, RequirePermission } from './auth/guards';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/users/UsersPage';
import RolesPage from './pages/roles/RolesPage';
import ActivityPage from './pages/activity/ActivityPage';
import GoldPricesPage from './pages/pricing/GoldPricesPage';
import KaratsPage from './pages/pricing/KaratsPage';
import ItemsPage from './pages/stock/ItemsPage';
import CategoriesPage from './pages/stock/CategoriesPage';
import StockMovementsPage from './pages/stock/StockMovementsPage';
import TagTemplatesPage from './pages/tags/TagTemplatesPage';
import SuppliersPage from './pages/purchasing/SuppliersPage';
import PurchasesPage from './pages/purchasing/PurchasesPage';
import PurchaseFormPage from './pages/purchasing/PurchaseFormPage';
import PurchaseDetailPage from './pages/purchasing/PurchaseDetailPage';
import SupplierPaymentsPage from './pages/purchasing/SupplierPaymentsPage';
import CraftJobsPage from './pages/workshop/CraftJobsPage';
import CraftsmenPage from './pages/workshop/CraftsmenPage';
import RepairsPage from './pages/repairs/RepairsPage';
import RepairSlipPage from './pages/repairs/RepairSlipPage';
import PosPage from './pages/sales/PosPage';
import SalesPage from './pages/sales/SalesPage';
import InvoicePage from './pages/sales/InvoicePage';
import CustomersPage from './pages/sales/CustomersPage';
import CustomerPaymentsPage from './pages/sales/CustomerPaymentsPage';
import SettingsPage from './pages/admin/SettingsPage';
import ReportsPage from './pages/reports/ReportsPage';
import FinanceOverviewPage from './pages/finance/FinanceOverviewPage';
import ExpensesPage from './pages/finance/ExpensesPage';
import CashBankPage from './pages/finance/CashBankPage';
import DangerZonePage from './pages/admin/DangerZonePage';
import DayEndPage from './pages/day-end/DayEndPage';
import MyRequestsPage from './pages/MyRequestsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route element={<Layout />}>
          <Route index element={<DashboardPage />} />
          <Route path="gold-prices" element={<RequirePermission perm="gold_prices.view"><GoldPricesPage /></RequirePermission>} />
          <Route path="karats" element={<RequirePermission perm="karats.view"><KaratsPage /></RequirePermission>} />
          <Route path="items" element={<RequirePermission perm="items.view"><ItemsPage /></RequirePermission>} />
          <Route path="stock-history" element={<RequirePermission perm="items.view"><StockMovementsPage /></RequirePermission>} />
          <Route path="categories"element={<RequirePermission perm="categories.view"><CategoriesPage /></RequirePermission>} />
          <Route path="tag-templates" element={<RequirePermission perm="tag_templates.edit"><TagTemplatesPage /></RequirePermission>} />
          <Route path="suppliers" element={<RequirePermission perm="suppliers.view"><SuppliersPage /></RequirePermission>} />
          <Route path="purchases" element={<RequirePermission perm="purchases.view"><PurchasesPage /></RequirePermission>} />
          <Route path="purchases/new" element={<RequirePermission perm="purchases.create"><PurchaseFormPage /></RequirePermission>} />
          <Route path="purchases/:id" element={<RequirePermission perm="purchases.view"><PurchaseDetailPage /></RequirePermission>} />
          <Route path="supplier-payments" element={<RequirePermission perm="supplier_payments.view"><SupplierPaymentsPage /></RequirePermission>} />
          <Route path="craft-jobs" element={<RequirePermission perm="craft_jobs.view"><CraftJobsPage /></RequirePermission>} />
          <Route path="repairs" element={<RequirePermission perm="repairs.view"><RepairsPage /></RequirePermission>} />
          <Route path="repairs/:id" element={<RequirePermission perm="repairs.view"><RepairSlipPage /></RequirePermission>} />
          <Route path="craftsmen" element={<RequirePermission perm="craftsmen.view"><CraftsmenPage /></RequirePermission>} />
          <Route path="pos" element={<RequirePermission perm="sales.create"><PosPage /></RequirePermission>} />
          <Route path="sales" element={<RequirePermission perm="sales.view"><SalesPage /></RequirePermission>} />
          <Route path="sales/:id" element={<RequirePermission perm={['sales.view', 'sales.reprint']}><InvoicePage /></RequirePermission>} />
          <Route path="customers" element={<RequirePermission perm="customers.view"><CustomersPage /></RequirePermission>} />
          <Route path="customer-payments" element={<RequirePermission perm="customer_payments.view"><CustomerPaymentsPage /></RequirePermission>} />
          <Route path="reports" element={<RequirePermission perm={['reports.sales', 'reports.profit', 'reports.stock', 'reports.wastage', 'reports.customer_balances', 'reports.supplier_balances', 'reports.craftsman_balances']}><ReportsPage /></RequirePermission>} />
          <Route path="finance" element={<RequirePermission perm="finance.view"><FinanceOverviewPage /></RequirePermission>} />
          <Route path="expenses" element={<RequirePermission perm="expenses.view"><ExpensesPage /></RequirePermission>} />
          <Route path="day-end" element={<RequirePermission perm="day_end.view"><DayEndPage /></RequirePermission>} />
          <Route path="cash-bank"element={<RequirePermission perm="finance.view"><CashBankPage /></RequirePermission>} />
          <Route path="settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          <Route path="users" element={<RequirePermission perm="users.view"><UsersPage /></RequirePermission>} />
          <Route path="roles" element={<RequirePermission perm="roles.view"><RolesPage /></RequirePermission>} />
          <Route path="activity" element={<RequirePermission perm="audit_logs.view"><ActivityPage /></RequirePermission>} />
          <Route path="danger-zone" element={<RequireAdmin><DangerZonePage /></RequireAdmin>} />
          <Route path="my-requests" element={<MyRequestsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
