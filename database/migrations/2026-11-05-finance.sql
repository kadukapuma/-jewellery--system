-- Brings an existing database up to date for the Finance section: shop expenses and
-- cash / bank accounts (opening balances, owner capital and drawings, cash <-> bank transfers).
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-05-finance.sql

CREATE TABLE expense_categories (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE expenses (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_no           VARCHAR(30) NOT NULL UNIQUE,     -- EXP-000001
  expense_date         DATE NOT NULL,
  category_id          INT UNSIGNED NOT NULL,
  paid_to              VARCHAR(150) NULL,
  amount               DECIMAL(14,2) NOT NULL,
  method               ENUM('cash','card','bank_transfer','cheque') NOT NULL DEFAULT 'cash',
  reference_no         VARCHAR(50) NULL,
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exp_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_exp_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT chk_exp_amount  CHECK (amount > 0),
  INDEX idx_exp_date (expense_date)
);

CREATE TABLE cash_entries (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_no             VARCHAR(30) NOT NULL UNIQUE,     -- CSH-000001
  entry_date           DATE NOT NULL,
  entry_type           ENUM('opening','capital_in','drawing','deposit','withdrawal') NOT NULL,
  account              ENUM('cash','bank') NOT NULL DEFAULT 'cash',
  amount               DECIMAL(14,2) NOT NULL,
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ce_user    FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT chk_ce_amount CHECK (amount > 0),
  INDEX idx_ce_date (entry_date)
);

INSERT INTO expense_categories (name) VALUES
  ('Rent'), ('Salaries'), ('Electricity'), ('Water'), ('Telephone & Internet'), ('Transport'),
  ('Repairs & Maintenance'), ('Stationery'), ('Bank Charges'), ('Other');

INSERT INTO document_sequences (code, prefix) VALUES
  ('EXP', 'EXP-'),
  ('CSH', 'CSH-');

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('finance.view',         'finance',      'view',   'See money in / out and cash & bank balances', 290),
  ('expenses.view',        'expenses',     'view',   'See shop expenses',                           291),
  ('expenses.create',      'expenses',     'create', 'Record a shop expense',                       292),
  ('expenses.cancel',      'expenses',     'cancel', 'Cancel a shop expense',                       293),
  ('cash_entries.create',  'cash_entries', 'create', 'Opening balance, capital, drawings, transfers', 294),
  ('cash_entries.cancel',  'cash_entries', 'cancel', 'Cancel a cash / bank entry',                  295);

-- Same roles that get them on a new database: Manager (Admin has everything).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Manager' AND p.module IN ('finance', 'expenses', 'cash_entries');
