export const MODULE_LABELS = {
  dashboard: 'Dashboard',
  users: 'Users',
  roles: 'Roles',
  karats: 'Karats',
  gold_prices: 'Gold Prices',
  categories: 'Categories',
  items: 'Items',
  suppliers: 'Suppliers',
  craftsmen: 'Craftsmen',
  customers: 'Customers',
  purchases: 'Purchases',
  craft_jobs: 'Craft Jobs',
  repairs: 'Customer Repairs',
  sales: 'Sales / Billing',
  customer_payments: 'Customer Payments',
  instalments: 'Instalments',
  supplier_payments: 'Supplier Payments',
  craftsman_account: 'Craftsman Account',
  craftsman_payments: 'Craftsman Payments',
  tags: 'Barcode Tags',
  tag_templates: 'Tag Templates',
  reports: 'Reports',
  finance: 'Finance',
  expenses: 'Expenses',
  cash_entries: 'Cash & Bank Entries',
  settings: 'Settings',
  audit_logs: 'Activity Log',
};

export function actionLabel(action) {
  return action
    .split('_')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

// [{ module, label, items: [permission, ...] }] in the order the API returned them.
export function groupPermissions(permissions) {
  const groups = new Map();
  for (const p of permissions) {
    if (!groups.has(p.module)) groups.set(p.module, []);
    groups.get(p.module).push(p);
  }
  return [...groups].map(([module, items]) => ({ module, label: MODULE_LABELS[module] || module, items }));
}
