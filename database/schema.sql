-- =====================================================================
-- Jewellery Management System - MySQL 8 schema
-- Weights: DECIMAL(10,3) grams | Money: DECIMAL(14,2)
-- 1 pound (sovereign) = 8 grams  ->  gram_price = pound_price / 8
-- =====================================================================

CREATE DATABASE IF NOT EXISTS jewellery_system
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE jewellery_system;

-- Every table must be InnoDB: saves run in transactions (a failed save leaves nothing half done) and
-- foreign keys are checked. Some MySQL installs default to MyISAM, which silently ignores both.
SET default_storage_engine = InnoDB;

-- =====================================================================
-- USER MANAGEMENT & PERMISSIONS (role-based + per-user overrides)
--   Effective permissions of a user =
--       permissions of their role
--     + user_permissions where is_granted = 1   (extra access)
--     - user_permissions where is_granted = 0   (blocked access)
--   A role with is_super_admin = 1 gets every permission automatically.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1a. ROLES (Admin, Manager, Cashier, Stock Keeper ...)
-- ---------------------------------------------------------------------
CREATE TABLE roles (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(50)  NOT NULL UNIQUE,
  description      VARCHAR(255) NULL,
  is_super_admin   TINYINT(1) NOT NULL DEFAULT 0,       -- bypasses all checks
  is_system        TINYINT(1) NOT NULL DEFAULT 0,       -- cannot be deleted
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 1b. PERMISSIONS (fixed list, seeded - one row per module + action)
--     code = '<module>.<action>'  e.g. 'sales.create', 'gold_prices.update'
-- ---------------------------------------------------------------------
CREATE TABLE permissions (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code             VARCHAR(60)  NOT NULL UNIQUE,
  module           VARCHAR(40)  NOT NULL,               -- grouping on the screen
  action           VARCHAR(30)  NOT NULL,               -- view/create/edit/delete/...
  description      VARCHAR(255) NULL,
  sort_order       INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_perm_module_action (module, action)
);

-- ---------------------------------------------------------------------
-- 1c. ROLE_PERMISSIONS (which role can do what)
-- ---------------------------------------------------------------------
CREATE TABLE role_permissions (
  role_id          INT UNSIGNED NOT NULL,
  permission_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id)       REFERENCES roles(id)       ON DELETE CASCADE,
  CONSTRAINT fk_rp_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 1d. USERS (who logs in and who entered what)
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(100) NOT NULL,
  username              VARCHAR(50)  NOT NULL UNIQUE,
  email                 VARCHAR(150) NULL UNIQUE,
  phone                 VARCHAR(30)  NULL,
  password_hash         VARCHAR(255) NOT NULL,          -- bcrypt
  role_id               INT UNSIGNED NOT NULL,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password  TINYINT(1) NOT NULL DEFAULT 1,  -- force change on first login
  failed_login_count    INT NOT NULL DEFAULT 0,
  locked_until          DATETIME NULL,                  -- lock after too many failures
  last_login_at         DATETIME NULL,
  created_by            INT UNSIGNED NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_user_role    FOREIGN KEY (role_id)    REFERENCES roles(id),
  CONSTRAINT fk_user_creator FOREIGN KEY (created_by) REFERENCES users(id)
);

-- ---------------------------------------------------------------------
-- 1e. USER_PERMISSIONS (per-user exceptions to their role)
--     is_granted = 1 -> give this user an extra permission
--     is_granted = 0 -> take this permission away from this user
-- ---------------------------------------------------------------------
CREATE TABLE user_permissions (
  user_id          INT UNSIGNED NOT NULL,
  permission_id    INT UNSIGNED NOT NULL,
  is_granted       TINYINT(1) NOT NULL,
  PRIMARY KEY (user_id, permission_id),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
  CONSTRAINT fk_up_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------
-- 1f. LOGIN HISTORY (successful and failed logins)
-- ---------------------------------------------------------------------
CREATE TABLE login_logs (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NULL,                   -- NULL if username not found
  username_tried   VARCHAR(50) NOT NULL,
  success          TINYINT(1) NOT NULL,
  ip_address       VARCHAR(45) NULL,
  user_agent       VARCHAR(255) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ll_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ll_user_time (user_id, created_at)
);

-- ---------------------------------------------------------------------
-- 1g. AUDIT LOG (who changed what - prices, items, sales, users ...)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  action           VARCHAR(30) NOT NULL,                -- create/update/delete/cancel/login
  table_name       VARCHAR(50) NOT NULL,
  record_id        INT UNSIGNED NULL,
  old_values       JSON NULL,
  new_values       JSON NULL,
  ip_address       VARCHAR(45) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_al_table_record (table_name, record_id),
  INDEX idx_al_time (created_at)
);

-- ---------------------------------------------------------------------
-- 1h. CHANGE REQUESTS (edits / deletes by non-admins wait for Admin)
--     and DELETED RECORDS (recycle bin - Admin can restore)
-- ---------------------------------------------------------------------
CREATE TABLE change_requests (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  action           ENUM('update','delete') NOT NULL,
  route_key        VARCHAR(60)  NOT NULL,               -- e.g. 'customers.update'
  table_name       VARCHAR(50)  NOT NULL,
  record_id        INT UNSIGNED NOT NULL,
  record_label     VARCHAR(150) NULL,
  params           JSON NOT NULL,                       -- replayed when Admin approves
  payload          JSON NULL,
  old_values       JSON NULL,                           -- the record when the request was made
  reason           VARCHAR(255) NULL,
  status           ENUM('pending','approved','rejected','failed') NOT NULL DEFAULT 'pending',
  requested_by     INT UNSIGNED NOT NULL,
  requested_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by      INT UNSIGNED NULL,
  reviewed_at      DATETIME NULL,
  review_note      VARCHAR(255) NULL,
  CONSTRAINT fk_cr_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_cr_reviewer  FOREIGN KEY (reviewed_by)  REFERENCES users(id),
  INDEX idx_cr_status (status, requested_at),
  INDEX idx_cr_user (requested_by, requested_at)
);

CREATE TABLE deleted_records (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  table_name         VARCHAR(50)  NOT NULL,
  record_id          INT UNSIGNED NOT NULL,
  record_label       VARCHAR(150) NULL,
  data               JSON NOT NULL,                     -- [{ table, rows: [...] }] in re-insert order
  extra              JSON NULL,                         -- side effects to undo on restore
  deleted_by         INT UNSIGNED NOT NULL,
  deleted_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  change_request_id  INT UNSIGNED NULL,
  restored_by        INT UNSIGNED NULL,
  restored_at        DATETIME NULL,
  CONSTRAINT fk_dr_deleter  FOREIGN KEY (deleted_by)  REFERENCES users(id),
  CONSTRAINT fk_dr_restorer FOREIGN KEY (restored_by) REFERENCES users(id),
  INDEX idx_dr_time (deleted_at)
);

-- ---------------------------------------------------------------------
-- 2. SETTINGS (key/value, e.g. grams_per_pound = 8)
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  setting_key    VARCHAR(50) PRIMARY KEY,
  setting_value  VARCHAR(255) NOT NULL,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 3. KARATS (admin-defined list: 24K, 22K, 21K, 18K ...)
-- ---------------------------------------------------------------------
CREATE TABLE karats (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(10)  NOT NULL UNIQUE,          -- '24K'
  purity         DECIMAL(5,4) NOT NULL,                 -- 0.9990, 0.9160
  sort_order     INT NOT NULL DEFAULT 0,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 4. GOLD PRICES (daily price setup - history, never overwritten)
--    Current price of a karat = latest effective_at row for that karat.
-- ---------------------------------------------------------------------
CREATE TABLE gold_prices (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  karat_id       INT UNSIGNED NOT NULL,
  pound_price    DECIMAL(14,2) NOT NULL,                -- entered by admin: 100000.00
  gram_price     DECIMAL(14,2) NOT NULL,                -- calculated: 12500.00
  effective_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  entered_by     INT UNSIGNED NOT NULL,
  notes          VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gp_karat FOREIGN KEY (karat_id)   REFERENCES karats(id),
  CONSTRAINT fk_gp_user  FOREIGN KEY (entered_by) REFERENCES users(id),
  INDEX idx_gp_karat_time (karat_id, effective_at)
);

-- ---------------------------------------------------------------------
-- 5. CATEGORIES (Rings, Chains, Bangles, Gold Biscuits ...)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  category_type  ENUM('jewellery','biscuit','other') NOT NULL DEFAULT 'jewellery',
  description    VARCHAR(255) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 6. SUPPLIERS
-- ---------------------------------------------------------------------
CREATE TABLE suppliers (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  phone          VARCHAR(30)  NULL,
  email          VARCHAR(150) NULL,
  address        VARCHAR(255) NULL,
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,     -- what we owed them when the system started
  credit_days    INT NOT NULL DEFAULT 0,                -- used to set purchases.due_date
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 7. CRAFTSMEN
-- ---------------------------------------------------------------------
CREATE TABLE craftsmen (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  phone          VARCHAR(30)  NULL,
  address        VARCHAR(255) NULL,
  opening_gold_g        DECIMAL(10,3) NOT NULL DEFAULT 0, -- gold they held when the system started
  opening_gold_karat_id INT UNSIGNED NULL,                -- karat of that gold (held gold is kept per karat)
  opening_cash_balance  DECIMAL(14,2) NOT NULL DEFAULT 0, -- fees we owed them (+) or advance given (-)
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_craftsman_opening_karat FOREIGN KEY (opening_gold_karat_id) REFERENCES karats(id)
);

-- ---------------------------------------------------------------------
-- 8. CUSTOMERS
-- ---------------------------------------------------------------------
CREATE TABLE customers (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(150) NOT NULL,
  phone          VARCHAR(30)  NULL,
  nic            VARCHAR(20)  NULL,
  address        VARCHAR(255) NULL,
  credit_limit   DECIMAL(14,2) NOT NULL DEFAULT 0,      -- 0 = no credit allowed
  opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,     -- what they owed when the system started
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customer_phone (phone)
);

-- ---------------------------------------------------------------------
-- 8b. SALESMEN (sales staff)
-- ---------------------------------------------------------------------
CREATE TABLE salesmen (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(30) NOT NULL UNIQUE,
  name                VARCHAR(150) NOT NULL,
  phone               VARCHAR(30) NULL,
  nic                 VARCHAR(30) NULL,
  email               VARCHAR(100) NULL,
  address             VARCHAR(255) NULL,
  commission_percent  DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_salesman_code (code),
  INDEX idx_salesman_name (name)
);

-- ---------------------------------------------------------------------
-- 8c. BANKS and the shop's BANK ACCOUNTS. A card / bank transfer / cheque payment
--     records the account it went to or came from (NULL = recorded before accounts existed).
-- ---------------------------------------------------------------------
CREATE TABLE banks (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE bank_accounts (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bank_id        INT UNSIGNED NOT NULL,
  account_name   VARCHAR(100) NOT NULL,
  account_no     VARCHAR(50) NOT NULL,
  branch         VARCHAR(100) NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ba_bank FOREIGN KEY (bank_id) REFERENCES banks(id),
  UNIQUE KEY uq_ba_bank_no (bank_id, account_no)
);

-- ---------------------------------------------------------------------
-- 9. ITEMS (item master - every piece / biscuit in stock)
--    source = 'purchase' -> came from a supplier (wastage_g = 0)
--    source = 'craft'    -> made by a craftsman (wastage_g from craft job)
-- ---------------------------------------------------------------------
CREATE TABLE items (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_code      VARCHAR(30)  NOT NULL UNIQUE,          -- shop code, e.g. RNG-000123
  barcode        VARCHAR(50)  NOT NULL UNIQUE,          -- printed on the tag and scanned at POS
  tag_print_count INT NOT NULL DEFAULT 0,
  last_tag_printed_at DATETIME NULL,
  name           VARCHAR(150) NOT NULL,
  category_id    INT UNSIGNED NOT NULL,
  karat_id       INT UNSIGNED NOT NULL,
  source         ENUM('purchase','craft','opening','old_gold') NOT NULL DEFAULT 'purchase',
  net_weight_g   DECIMAL(10,3) NOT NULL,                -- actual weight of the piece (7.000)
  wastage_g      DECIMAL(10,3) NOT NULL DEFAULT 0,      -- charged to customer (1.000)
  making_charge  DECIMAL(14,2) NOT NULL DEFAULT 0,      -- labour charged to customer
  -- Selling range as % ABOVE the final price (gold value + making), so it follows the
  -- daily gold price: min price = final x (1 + min%/100), max price = final x (1 + max%/100).
  price_min_percent DECIMAL(7,2) NOT NULL DEFAULT 0,
  price_max_percent DECIMAL(7,2) NOT NULL DEFAULT 0,
  cost_price     DECIMAL(14,2) NOT NULL DEFAULT 0,      -- what the shop paid (purchase or gold+labour)
  stock_qty      INT NOT NULL DEFAULT 0,                -- 1 for single pieces, n for biscuits
  status         ENUM('in_stock','sold','with_craftsman','inactive') NOT NULL DEFAULT 'in_stock',
  description    VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_item_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_item_karat    FOREIGN KEY (karat_id)    REFERENCES karats(id),
  INDEX idx_item_status (status)
);

-- ---------------------------------------------------------------------
-- 10. PURCHASES (header) - buying gold items / biscuits from a supplier
-- ---------------------------------------------------------------------
CREATE TABLE purchases (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_no          VARCHAR(30) NOT NULL UNIQUE,     -- PUR-000001
  supplier_id          INT UNSIGNED NOT NULL,
  supplier_invoice_no  VARCHAR(50) NULL,
  purchase_date        DATE NOT NULL,
  total_weight_g       DECIMAL(12,3) NOT NULL DEFAULT 0,
  total_amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  paid_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,  -- = SUM(supplier_payment_allocations)
  balance              DECIMAL(14,2) NOT NULL DEFAULT 0,  -- total_amount - paid_amount
  payment_status       ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'unpaid',
  due_date             DATE NULL,                         -- purchase_date + supplier credit_days
  notes                VARCHAR(255) NULL,
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pur_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_pur_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  INDEX idx_pur_date (purchase_date)
);

-- ---------------------------------------------------------------------
-- 11. PURCHASE LINES - purchase price entered per line
-- ---------------------------------------------------------------------
CREATE TABLE purchase_lines (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  purchase_id          INT UNSIGNED NOT NULL,
  item_id              INT UNSIGNED NOT NULL,           -- item created/selected at entry
  karat_id             INT UNSIGNED NOT NULL,
  qty                  INT NOT NULL DEFAULT 1,
  weight_g             DECIMAL(10,3) NOT NULL,          -- total weight of this line
  purchase_price       DECIMAL(14,2) NOT NULL,          -- total paid for this line
  price_per_gram       DECIMAL(14,2) NOT NULL,          -- purchase_price / weight_g
  CONSTRAINT fk_pl_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE,
  CONSTRAINT fk_pl_item     FOREIGN KEY (item_id)     REFERENCES items(id),
  CONSTRAINT fk_pl_karat    FOREIGN KEY (karat_id)    REFERENCES karats(id)
);

-- ---------------------------------------------------------------------
-- 12. CRAFT JOBS - gold issued to a craftsman, finished item returned
--     wastage_g = issued_weight_g - returned_weight_g
--     Customer is billed for issued_weight_g (net + wastage) + making_charge
-- ---------------------------------------------------------------------
CREATE TABLE craft_jobs (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_no               VARCHAR(30) NOT NULL UNIQUE,     -- JOB-000001
  -- new: a new piece becomes a new item; make_item: fills in a saved item (stock 0);
  -- rework: a saved piece goes to the craftsman and comes back as the same item
  job_type             ENUM('new','make_item','rework') NOT NULL DEFAULT 'new',
  craftsman_id         INT UNSIGNED NOT NULL,
  category_id          INT UNSIGNED NOT NULL,           -- what is being made (Ring)
  karat_id             INT UNSIGNED NOT NULL,
  customer_id          INT UNSIGNED NULL,               -- set for customer orders
  source_item_id       INT UNSIGNED NULL,               -- biscuit/old gold taken from stock
  description          VARCHAR(255) NULL,
  target_weight_g      DECIMAL(10,3) NULL,              -- exact weight wanted for the finished piece
  issued_weight_g      DECIMAL(10,3) NOT NULL,          -- 8.000 (rework: piece weight + extra gold)
  held_gold_g          DECIMAL(10,3) NOT NULL DEFAULT 0,-- part of the gold the craftsman already held
  item_weight_g        DECIMAL(10,3) NULL,              -- rework: weight of the saved piece when given
  issue_date           DATE NOT NULL,
  returned_weight_g    DECIMAL(10,3) NULL,              -- 7.000 (on completion)
  wastage_g            DECIMAL(10,3) NULL,              -- 1.000 (calculated)
  making_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,-- charged to customer
  craftsman_fee        DECIMAL(14,2) NOT NULL DEFAULT 0,-- earned by craftsman (added to their account on completion)
  completed_date       DATE NULL,
  status               ENUM('issued','completed','cancelled') NOT NULL DEFAULT 'issued',
  item_id              INT UNSIGNED NULL,               -- finished item: created on completion (new) or the saved item (make_item / rework)
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cj_craftsman FOREIGN KEY (craftsman_id)   REFERENCES craftsmen(id),
  CONSTRAINT fk_cj_category  FOREIGN KEY (category_id)    REFERENCES categories(id),
  CONSTRAINT fk_cj_karat     FOREIGN KEY (karat_id)       REFERENCES karats(id),
  CONSTRAINT fk_cj_customer  FOREIGN KEY (customer_id)    REFERENCES customers(id),
  CONSTRAINT fk_cj_source    FOREIGN KEY (source_item_id) REFERENCES items(id),
  CONSTRAINT fk_cj_item      FOREIGN KEY (item_id)        REFERENCES items(id),
  CONSTRAINT fk_cj_user      FOREIGN KEY (created_by)     REFERENCES users(id),
  CONSTRAINT chk_cj_returned CHECK (returned_weight_g IS NULL OR returned_weight_g <= issued_weight_g),
  INDEX idx_cj_status (status)
);

-- ---------------------------------------------------------------------
-- 13. SALES (invoice header)
-- ---------------------------------------------------------------------
CREATE TABLE sales (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_no           VARCHAR(30) NOT NULL UNIQUE,     -- INV-000001
  customer_id          INT UNSIGNED NULL,               -- NULL = walk-in
  salesman_id          INT UNSIGNED NULL,               -- NULL = no salesman assigned
  sale_date            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  subtotal             DECIMAL(14,2) NOT NULL,
  discount             DECIMAL(14,2) NOT NULL DEFAULT 0,
  total                DECIMAL(14,2) NOT NULL,
  paid_amount          DECIMAL(14,2) NOT NULL DEFAULT 0,  -- = SUM(customer_payment_allocations)
  balance              DECIMAL(14,2) NOT NULL DEFAULT 0,  -- total - paid_amount (credit)
  payment_status       ENUM('unpaid','partial','paid') NOT NULL DEFAULT 'paid',
  due_date             DATE NULL,                         -- when the credit must be settled
  notes                VARCHAR(255) NULL,
  status               ENUM('completed','cancelled') NOT NULL DEFAULT 'completed',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sale_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_sale_salesman FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE SET NULL,
  CONSTRAINT fk_sale_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  INDEX idx_sale_date (sale_date)
);

-- ---------------------------------------------------------------------
-- 14. SALE LINES - snapshot of the price used at the time of sale,
--     so old bills never change when the gold price changes.
--     billed_weight_g = net_weight_g + wastage_g
--     gold_value      = billed_weight_g * gram_price_used
--     line_total      = gold_value + making_charge
-- ---------------------------------------------------------------------
CREATE TABLE sale_lines (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id              INT UNSIGNED NOT NULL,
  item_id              INT UNSIGNED NOT NULL,
  karat_id             INT UNSIGNED NOT NULL,
  gold_price_id        INT UNSIGNED NOT NULL,           -- which price row was used
  qty                  INT NOT NULL DEFAULT 1,
  net_weight_g         DECIMAL(10,3) NOT NULL,          -- 7.000
  wastage_g            DECIMAL(10,3) NOT NULL DEFAULT 0,-- 1.000
  billed_weight_g      DECIMAL(10,3) NOT NULL,          -- 8.000
  pound_price_used     DECIMAL(14,2) NOT NULL,          -- 100000.00
  gram_price_used      DECIMAL(14,2) NOT NULL,          -- 12500.00
  gold_value           DECIMAL(14,2) NOT NULL,          -- 100000.00
  making_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,-- 5000.00
  line_total           DECIMAL(14,2) NOT NULL,          -- price actually charged (after any discount)
  price_final          DECIMAL(14,2) NOT NULL DEFAULT 0,-- gold value + making (the floor)
  price_min            DECIMAL(14,2) NOT NULL DEFAULT 0,-- lowest allowed without Admin
  price_max            DECIMAL(14,2) NOT NULL DEFAULT 0,-- normal selling price (shown on the bill)
  unit_cost            DECIMAL(14,2) NOT NULL DEFAULT 0,-- items.cost_price at the time of sale (for profit)
  CONSTRAINT fk_sl_sale  FOREIGN KEY (sale_id)       REFERENCES sales(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_item  FOREIGN KEY (item_id)       REFERENCES items(id),
  CONSTRAINT fk_sl_karat FOREIGN KEY (karat_id)      REFERENCES karats(id),
  CONSTRAINT fk_sl_price FOREIGN KEY (gold_price_id) REFERENCES gold_prices(id)
);

-- ---------------------------------------------------------------------
-- 15. STOCK MOVEMENTS - audit trail for every stock change
-- ---------------------------------------------------------------------
CREATE TABLE stock_movements (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id              INT UNSIGNED NOT NULL,
  movement_type        ENUM('purchase','sale','craft_issue','craft_return','adjustment','old_gold_in') NOT NULL,
  qty_change           INT NOT NULL,                    -- +1 / -1
  weight_change_g      DECIMAL(10,3) NOT NULL,
  ref_table            VARCHAR(30) NULL,                -- 'purchases','sales','craft_jobs'
  ref_id               INT UNSIGNED NULL,
  reason               VARCHAR(30) NULL,                -- manual entries: received, count_correction, damaged ...
  note                 VARCHAR(255) NULL,
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sm_item FOREIGN KEY (item_id)    REFERENCES items(id),
  CONSTRAINT fk_sm_user FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_sm_item (item_id),
  INDEX idx_sm_created (created_at)
);

-- ---------------------------------------------------------------------
-- 15b. CUSTOMER REPAIRS - a customer's own item, never shop stock.
--      received -> with_craftsman -> ready -> delivered (or cancelled)
-- ---------------------------------------------------------------------
CREATE TABLE repair_orders (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  repair_no            VARCHAR(30) NOT NULL UNIQUE,     -- REP-000001
  customer_id          INT UNSIGNED NOT NULL,
  received_date        DATE NOT NULL,
  item_description     VARCHAR(255) NOT NULL,           -- Ladies ring, stone missing
  karat_id             INT UNSIGNED NULL,               -- needed when shop gold is added
  weight_in_g          DECIMAL(10,3) NOT NULL,          -- weighed when the customer hands it in
  work_to_do           VARCHAR(255) NULL,
  promised_date        DATE NULL,
  estimated_charge     DECIMAL(14,2) NOT NULL DEFAULT 0,
  craftsman_id         INT UNSIGNED NULL,
  given_date           DATE NULL,
  extra_gold_g         DECIMAL(10,3) NOT NULL DEFAULT 0,-- shop gold added to the piece
  held_gold_g          DECIMAL(10,3) NOT NULL DEFAULT 0,-- part of it the craftsman already held
  craftsman_fee        DECIMAL(14,2) NOT NULL DEFAULT 0,-- owed to the craftsman once it is back
  back_date            DATE NULL,
  weight_back_g        DECIMAL(10,3) NULL,              -- weighed when back from the craftsman
  delivered_date       DATE NULL,
  weight_out_g         DECIMAL(10,3) NULL,              -- weighed when the customer collects it
  repair_charge        DECIMAL(14,2) NOT NULL DEFAULT 0,
  gold_charge          DECIMAL(14,2) NOT NULL DEFAULT 0,-- extra gold at the day's rate
  total_charge         DECIMAL(14,2) NOT NULL DEFAULT 0,-- what the customer pays (set on collection)
  status               ENUM('received','with_craftsman','ready','delivered','cancelled') NOT NULL DEFAULT 'received',
  notes                VARCHAR(255) NULL,
  cancel_reason        VARCHAR(255) NULL,
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_rep_customer  FOREIGN KEY (customer_id)  REFERENCES customers(id),
  CONSTRAINT fk_rep_karat     FOREIGN KEY (karat_id)     REFERENCES karats(id),
  CONSTRAINT fk_rep_craftsman FOREIGN KEY (craftsman_id) REFERENCES craftsmen(id),
  CONSTRAINT fk_rep_user      FOREIGN KEY (created_by)   REFERENCES users(id),
  INDEX idx_rep_status (status, received_date),
  INDEX idx_rep_customer (customer_id)
);

-- ---------------------------------------------------------------------
-- 15c. OLD GOLD - a customer's old jewellery bought by the shop: for cash, as credit on
--      the customer's account, or in exchange on a bill. Each piece becomes a stock item.
-- ---------------------------------------------------------------------
CREATE TABLE old_gold_receipts (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_no           VARCHAR(30) NOT NULL UNIQUE,     -- OGR-000001
  receipt_date         DATE NOT NULL,
  customer_id          INT UNSIGNED NULL,               -- NULL only for a walk-in exchange or cash buy
  mode                 ENUM('cash','credit','exchange') NOT NULL,
  payout_method        ENUM('cash','bank_transfer') NULL, -- only for mode = cash
  payout_reference     VARCHAR(50) NULL,
  bank_account_id      INT UNSIGNED NULL,               -- account paid from, for a bank transfer payout
  sale_id              INT UNSIGNED NULL,               -- the bill it was exchanged on
  total_net_weight_g   DECIMAL(10,3) NOT NULL DEFAULT 0,
  total_value          DECIMAL(14,2) NOT NULL DEFAULT 0,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  notes                VARCHAR(255) NULL,
  cancel_reason        VARCHAR(255) NULL,
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ogr_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ogr_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_ogr_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT fk_ogr_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
  INDEX idx_ogr_date (receipt_date),
  INDEX idx_ogr_customer (customer_id)
);

CREATE TABLE old_gold_lines (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_id           INT UNSIGNED NOT NULL,
  description          VARCHAR(150) NOT NULL,           -- Old chain, broken bangle ...
  category_id          INT UNSIGNED NOT NULL,
  karat_id             INT UNSIGNED NOT NULL,
  gross_weight_g       DECIMAL(10,3) NOT NULL,
  stone_weight_g       DECIMAL(10,3) NOT NULL DEFAULT 0,
  net_weight_g         DECIMAL(10,3) NOT NULL,          -- gross - stones: the gold that is paid for
  gold_price_id        INT UNSIGNED NOT NULL,
  gram_rate            DECIMAL(14,2) NOT NULL,          -- day's gram price used
  deduction_percent    DECIMAL(6,2) NOT NULL DEFAULT 0,
  calc_value           DECIMAL(14,2) NOT NULL,          -- net x rate x (1 - deduction)
  value                DECIMAL(14,2) NOT NULL,          -- what the customer got
  item_id              INT UNSIGNED NULL,               -- stock item made from this piece
  CONSTRAINT fk_ogl_receipt  FOREIGN KEY (receipt_id)    REFERENCES old_gold_receipts(id),
  CONSTRAINT fk_ogl_category FOREIGN KEY (category_id)   REFERENCES categories(id),
  CONSTRAINT fk_ogl_karat    FOREIGN KEY (karat_id)      REFERENCES karats(id),
  CONSTRAINT fk_ogl_price    FOREIGN KEY (gold_price_id) REFERENCES gold_prices(id),
  CONSTRAINT fk_ogl_item     FOREIGN KEY (item_id)       REFERENCES items(id),
  CONSTRAINT chk_ogl_value   CHECK (value > 0),
  INDEX idx_ogl_receipt (receipt_id)
);

-- =====================================================================
-- PAYMENTS & CUSTOMER CREDIT
--   Every rupee received from a customer is a customer_payments row
--   (one row per method: cash + card on the same bill = 2 rows).
--   Allocations link a payment to one or more bills.
--   Unallocated amount of a payment = customer advance.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 16. CUSTOMER PAYMENTS (receipts)
-- ---------------------------------------------------------------------
CREATE TABLE customer_payments (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_no           VARCHAR(30) NOT NULL UNIQUE,     -- RCP-000001
  customer_id          INT UNSIGNED NULL,               -- NULL only for walk-in paid-in-full bills
  sale_id              INT UNSIGNED NULL,               -- set when taken at the counter with this bill
  repair_id            INT UNSIGNED NULL,               -- advance / payment for a customer repair
  old_gold_id          INT UNSIGNED NULL,               -- credit for old gold taken in
  payment_date         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount               DECIMAL(14,2) NOT NULL,
  method               ENUM('cash','card','bank_transfer','cheque','old_gold') NOT NULL DEFAULT 'cash', -- old_gold = value of gold taken in, not money
  reference_no         VARCHAR(50) NULL,                -- card slip / cheque no / bank ref
  cheque_date          DATE NULL,
  bank_account_id      INT UNSIGNED NULL,               -- account it went to (card / transfer / cheque)
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cp_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_cp_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_cp_repair   FOREIGN KEY (repair_id)   REFERENCES repair_orders(id),
  CONSTRAINT fk_cp_old_gold FOREIGN KEY (old_gold_id) REFERENCES old_gold_receipts(id),
  CONSTRAINT fk_cp_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT fk_cp_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
  CONSTRAINT chk_cp_amount  CHECK (amount > 0),
  INDEX idx_cp_customer (customer_id, payment_date)
);

-- ---------------------------------------------------------------------
-- 17. INSTALMENT PLANS (optional - for bills paid over time)
-- ---------------------------------------------------------------------
CREATE TABLE instalment_plans (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sale_id              INT UNSIGNED NOT NULL UNIQUE,
  customer_id          INT UNSIGNED NOT NULL,
  financed_amount      DECIMAL(14,2) NOT NULL,          -- bill total - down payment
  number_of_instalments INT NOT NULL,
  frequency            ENUM('weekly','monthly') NOT NULL DEFAULT 'monthly',
  start_date           DATE NOT NULL,
  status               ENUM('active','completed','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ip_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_ip_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CONSTRAINT fk_ip_user     FOREIGN KEY (created_by)  REFERENCES users(id)
);

CREATE TABLE instalment_schedule (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id              INT UNSIGNED NOT NULL,
  instalment_no        INT NOT NULL,
  due_date             DATE NOT NULL,
  amount_due           DECIMAL(14,2) NOT NULL,
  amount_paid          DECIMAL(14,2) NOT NULL DEFAULT 0,
  status               ENUM('pending','partial','paid') NOT NULL DEFAULT 'pending', -- overdue = pending/partial AND due_date < today
  CONSTRAINT fk_is_plan FOREIGN KEY (plan_id) REFERENCES instalment_plans(id) ON DELETE CASCADE,
  UNIQUE KEY uq_is_plan_no (plan_id, instalment_no),
  INDEX idx_is_due (due_date, status)
);

-- ---------------------------------------------------------------------
-- 18. CUSTOMER PAYMENT ALLOCATIONS (payment -> bill / instalment)
-- ---------------------------------------------------------------------
CREATE TABLE customer_payment_allocations (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id           INT UNSIGNED NOT NULL,
  sale_id              INT UNSIGNED NOT NULL,
  schedule_id          INT UNSIGNED NULL,               -- set when paying an instalment
  amount               DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_cpa_payment  FOREIGN KEY (payment_id)  REFERENCES customer_payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_cpa_sale     FOREIGN KEY (sale_id)     REFERENCES sales(id),
  CONSTRAINT fk_cpa_schedule FOREIGN KEY (schedule_id) REFERENCES instalment_schedule(id),
  CONSTRAINT chk_cpa_amount  CHECK (amount > 0)
);

-- =====================================================================
-- SUPPLIER BALANCES
-- =====================================================================

-- ---------------------------------------------------------------------
-- 19. SUPPLIER PAYMENTS
-- ---------------------------------------------------------------------
CREATE TABLE supplier_payments (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_no           VARCHAR(30) NOT NULL UNIQUE,     -- SPY-000001
  supplier_id          INT UNSIGNED NOT NULL,
  payment_date         DATE NOT NULL,
  amount               DECIMAL(14,2) NOT NULL,
  method               ENUM('cash','card','bank_transfer','cheque') NOT NULL DEFAULT 'cash',
  reference_no         VARCHAR(50) NULL,
  cheque_date          DATE NULL,
  bank_account_id      INT UNSIGNED NULL,               -- account paid from (card / transfer / cheque)
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_spy_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_spy_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT fk_spy_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
  CONSTRAINT chk_spy_amount  CHECK (amount > 0),
  INDEX idx_spy_supplier (supplier_id, payment_date)
);

-- ---------------------------------------------------------------------
-- 20. SUPPLIER PAYMENT ALLOCATIONS (payment -> purchase)
-- ---------------------------------------------------------------------
CREATE TABLE supplier_payment_allocations (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id           INT UNSIGNED NOT NULL,
  purchase_id          INT UNSIGNED NOT NULL,
  amount               DECIMAL(14,2) NOT NULL,
  CONSTRAINT fk_spa_payment  FOREIGN KEY (payment_id)  REFERENCES supplier_payments(id) ON DELETE CASCADE,
  CONSTRAINT fk_spa_purchase FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  CONSTRAINT chk_spa_amount  CHECK (amount > 0)
);

-- =====================================================================
-- CRAFTSMAN ACCOUNT  (two balances per craftsman)
--   Gold held  = opening_gold_g + SUM(craftsman_gold_ledger.weight_g)
--   Cash due   = opening_cash_balance + SUM(fees of completed jobs)
--                - SUM(craftsman_payments)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 21. CRAFTSMAN GOLD LEDGER
--     +weight = gold went TO the craftsman, -weight = gold came back / written off
--     Job example: issue +8.000, return -7.000, wastage -1.000 -> holds 0
-- ---------------------------------------------------------------------
CREATE TABLE craftsman_gold_ledger (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  craftsman_id         INT UNSIGNED NOT NULL,
  craft_job_id         INT UNSIGNED NULL,
  repair_id            INT UNSIGNED NULL,               -- shop gold added during a customer repair
  karat_id             INT UNSIGNED NOT NULL,
  txn_date             DATE NOT NULL,
  txn_type             ENUM('issue','return','wastage','extra_issue','gold_returned','adjustment','held_used') NOT NULL,
  weight_g             DECIMAL(10,3) NOT NULL,          -- signed
  notes                VARCHAR(255) NULL,
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cgl_craftsman FOREIGN KEY (craftsman_id) REFERENCES craftsmen(id),
  CONSTRAINT fk_cgl_job       FOREIGN KEY (craft_job_id) REFERENCES craft_jobs(id),
  CONSTRAINT fk_cgl_repair    FOREIGN KEY (repair_id)    REFERENCES repair_orders(id),
  CONSTRAINT fk_cgl_karat     FOREIGN KEY (karat_id)     REFERENCES karats(id),
  CONSTRAINT fk_cgl_user      FOREIGN KEY (created_by)   REFERENCES users(id),
  INDEX idx_cgl_craftsman (craftsman_id, txn_date)
);

-- ---------------------------------------------------------------------
-- 22. CRAFTSMAN PAYMENTS (fees paid, or advances before the job is done)
-- ---------------------------------------------------------------------
CREATE TABLE craftsman_payments (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_no           VARCHAR(30) NOT NULL UNIQUE,     -- CPY-000001
  craftsman_id         INT UNSIGNED NOT NULL,
  craft_job_id         INT UNSIGNED NULL,               -- optional: payment for a specific job
  payment_date         DATE NOT NULL,
  amount               DECIMAL(14,2) NOT NULL,
  method               ENUM('cash','bank_transfer','cheque') NOT NULL DEFAULT 'cash',
  reference_no         VARCHAR(50) NULL,
  bank_account_id      INT UNSIGNED NULL,               -- account paid from (transfer / cheque)
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cpy_craftsman FOREIGN KEY (craftsman_id) REFERENCES craftsmen(id),
  CONSTRAINT fk_cpy_job       FOREIGN KEY (craft_job_id) REFERENCES craft_jobs(id),
  CONSTRAINT fk_cpy_user      FOREIGN KEY (created_by)   REFERENCES users(id),
  CONSTRAINT fk_cpy_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
  CONSTRAINT chk_cpy_amount   CHECK (amount > 0),
  INDEX idx_cpy_craftsman (craftsman_id, payment_date)
);

-- =====================================================================
-- FINANCE  (shop expenses + cash / bank accounts)
--   Account of a money movement: method 'cash' -> Cash, anything else -> the bank account it names
--   (bank_account_id; NULL = recorded before bank accounts were set up).
--   Cash balance / Bank balance = every active receipt - every active payment
--   - every active expense +/- cash_entries (opening, capital, drawings, transfers).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 22a. EXPENSE CATEGORIES (Rent, Salaries, Electricity ...)
-- ---------------------------------------------------------------------
CREATE TABLE expense_categories (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 22b. EXPENSES (shop running costs)
-- ---------------------------------------------------------------------
CREATE TABLE expenses (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  expense_no           VARCHAR(30) NOT NULL UNIQUE,     -- EXP-000001
  expense_date         DATE NOT NULL,
  category_id          INT UNSIGNED NOT NULL,
  paid_to              VARCHAR(150) NULL,
  amount               DECIMAL(14,2) NOT NULL,
  method               ENUM('cash','card','bank_transfer','cheque') NOT NULL DEFAULT 'cash',
  reference_no         VARCHAR(50) NULL,
  bank_account_id      INT UNSIGNED NULL,               -- account paid from (card / transfer / cheque)
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_exp_category FOREIGN KEY (category_id) REFERENCES expense_categories(id),
  CONSTRAINT fk_exp_user     FOREIGN KEY (created_by)  REFERENCES users(id),
  CONSTRAINT fk_exp_bank_account FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id),
  CONSTRAINT chk_exp_amount  CHECK (amount > 0),
  INDEX idx_exp_date (expense_date)
);

-- ---------------------------------------------------------------------
-- 22c. CASH ENTRIES (money that is not a sale, purchase or expense)
--      opening / capital_in -> + account   drawing -> - account
--      deposit    = cash -> bank           withdrawal = bank -> cash   (account ignored)
--      bank_to_bank = bank_account_id -> to_bank_account_id
--      bank_account_id = the bank account for account 'bank', deposit, withdrawal and bank_to_bank
-- ---------------------------------------------------------------------
CREATE TABLE cash_entries (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entry_no             VARCHAR(30) NOT NULL UNIQUE,     -- CSH-000001
  entry_date           DATE NOT NULL,
  entry_type           ENUM('opening','capital_in','drawing','deposit','withdrawal','bank_to_bank') NOT NULL,
  account              ENUM('cash','bank') NOT NULL DEFAULT 'cash',
  bank_account_id      INT UNSIGNED NULL,
  to_bank_account_id   INT UNSIGNED NULL,
  amount               DECIMAL(14,2) NOT NULL,
  notes                VARCHAR(255) NULL,
  status               ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  created_by           INT UNSIGNED NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ce_user    FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_ce_bank_account    FOREIGN KEY (bank_account_id)    REFERENCES bank_accounts(id),
  CONSTRAINT fk_ce_to_bank_account FOREIGN KEY (to_bank_account_id) REFERENCES bank_accounts(id),
  CONSTRAINT chk_ce_amount CHECK (amount > 0),
  INDEX idx_ce_date (entry_date)
);

-- ---------------------------------------------------------------------
-- 22d. DAY CLOSINGS (day end: cash count + snapshot; a closed day is locked)
-- ---------------------------------------------------------------------
CREATE TABLE day_closings (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  close_date           DATE NOT NULL UNIQUE,
  opening_cash         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- cash in hand when the day started
  expected_cash        DECIMAL(14,2) NOT NULL DEFAULT 0,  -- what the system says should be in the drawer
  counted_cash         DECIMAL(14,2) NOT NULL DEFAULT 0,  -- what was actually counted
  cash_difference      DECIMAL(14,2) NOT NULL DEFAULT 0,  -- counted - expected (+ excess / - short)
  expected_bank        DECIMAL(14,2) NOT NULL DEFAULT 0,
  summary              JSON NOT NULL,                     -- the whole day summary as it was at closing
  notes                VARCHAR(255) NULL,
  status               ENUM('closed','reopened') NOT NULL DEFAULT 'closed',
  closed_by            INT UNSIGNED NOT NULL,
  closed_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reopened_by          INT UNSIGNED NULL,
  reopened_at          DATETIME NULL,
  reopen_reason        VARCHAR(255) NULL,
  CONSTRAINT fk_dc_closer   FOREIGN KEY (closed_by)   REFERENCES users(id),
  CONSTRAINT fk_dc_reopener FOREIGN KEY (reopened_by) REFERENCES users(id)
);

-- =====================================================================
-- BARCODE / TAG PRINTING
-- =====================================================================

-- ---------------------------------------------------------------------
-- 23. TAG TEMPLATES (label size and what is printed on it)
-- ---------------------------------------------------------------------
CREATE TABLE tag_templates (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                 VARCHAR(50) NOT NULL UNIQUE,
  width_mm             DECIMAL(6,2) NOT NULL,
  height_mm            DECIMAL(6,2) NOT NULL,
  barcode_type         ENUM('CODE128','QR') NOT NULL DEFAULT 'CODE128',
  fields               JSON NOT NULL,                   -- ["shop_name","item_code","karat","net_weight_g","wastage_g"]
  is_default           TINYINT(1) NOT NULL DEFAULT 0,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------
-- 24. TAG PRINT LOG (which tags were printed, by whom)
-- ---------------------------------------------------------------------
CREATE TABLE tag_print_logs (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  item_id              INT UNSIGNED NOT NULL,
  template_id          INT UNSIGNED NOT NULL,
  copies               INT NOT NULL DEFAULT 1,
  printed_by           INT UNSIGNED NOT NULL,
  printed_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tpl_item     FOREIGN KEY (item_id)     REFERENCES items(id),
  CONSTRAINT fk_tpl_template FOREIGN KEY (template_id) REFERENCES tag_templates(id),
  CONSTRAINT fk_tpl_user     FOREIGN KEY (printed_by)  REFERENCES users(id)
);

-- ---------------------------------------------------------------------
-- 25. DOCUMENT SEQUENCES (running numbers for bills, receipts, codes)
--     App reads with SELECT ... FOR UPDATE inside the save transaction.
-- ---------------------------------------------------------------------
CREATE TABLE document_sequences (
  code                 VARCHAR(20) PRIMARY KEY,         -- 'INV','RCP','PUR' ...
  prefix               VARCHAR(10) NOT NULL,            -- 'INV-'
  next_number          INT UNSIGNED NOT NULL DEFAULT 1,
  pad_length           INT NOT NULL DEFAULT 6           -- INV-000001
);

-- ---------------------------------------------------------------------
-- SEED DATA
-- ---------------------------------------------------------------------
INSERT INTO settings (setting_key, setting_value) VALUES
  ('grams_per_pound', '8'),
  ('shop_name', 'Jewellery'),                -- printed on barcode tags and bills
  ('shop_address', ''),
  ('shop_phone', ''),
  ('invoice_footer', 'Thank you! Please keep this bill for exchanges.'),
  ('max_failed_logins', '5'),
  ('lock_minutes', '15'),
  ('admin_only_changes', '1'),
  ('old_gold_deduction_percent', '0');       -- taken off the day's rate when buying old gold               -- Danger Zone: only Admin edits / deletes directly

-- Roles
INSERT INTO roles (name, description, is_super_admin, is_system) VALUES
  ('Admin',        'Full access to everything',                         1, 1),
  ('Manager',      'Daily operations, prices, purchases, reports',       0, 1),
  ('Cashier',      'Sales counter only',                                 0, 1),
  ('Stock Keeper', 'Items, purchases and craftsman jobs',                0, 0);

-- Permissions: standard CRUD for each module
INSERT INTO permissions (code, module, action, description, sort_order)
SELECT CONCAT(m.module, '.', a.action), m.module, a.action,
       CONCAT(UPPER(LEFT(a.action,1)), SUBSTRING(a.action,2), ' ', REPLACE(m.module,'_',' ')),
       m.sort_order * 10 + a.sort_order
FROM (
  SELECT 'users' AS module, 1 AS sort_order UNION ALL SELECT 'roles', 2
  UNION ALL SELECT 'karats', 3       UNION ALL SELECT 'categories', 4
  UNION ALL SELECT 'items', 5        UNION ALL SELECT 'suppliers', 6
  UNION ALL SELECT 'craftsmen', 7    UNION ALL SELECT 'customers', 8
  UNION ALL SELECT 'purchases', 9    UNION ALL SELECT 'craft_jobs', 10
  UNION ALL SELECT 'salesmen', 11
) m
CROSS JOIN (
  SELECT 'view' AS action, 1 AS sort_order UNION ALL SELECT 'create', 2
  UNION ALL SELECT 'edit', 3 UNION ALL SELECT 'delete', 4
) a;

-- Permissions: special actions
INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('dashboard.view',          'dashboard',   'view',         'See the dashboard',                          1),
  ('gold_prices.view',        'gold_prices', 'view',         'See current and past gold prices',         200),
  ('gold_prices.update',      'gold_prices', 'update',       'Enter a new daily gold price',             201),
  ('craft_jobs.complete',     'craft_jobs',  'complete',     'Receive finished item from craftsman',     105),
  ('sales.view',              'sales',       'view',         'See bills',                                210),
  ('sales.create',            'sales',       'create',       'Make a new bill',                          211),
  ('sales.discount',          'sales',       'discount',     'Give a discount on a bill',                212),
  ('sales.cancel',            'sales',       'cancel',       'Cancel a bill',                            213),
  ('sales.reprint',           'sales',       'reprint',      'Reprint an old bill',                      214),
  ('reports.sales',           'reports',     'sales',        'Sales reports',                            220),
  ('reports.stock',           'reports',     'stock',        'Stock reports',                            221),
  ('reports.wastage',         'reports',     'wastage',      'Craftsman wastage reports',                222),
  ('reports.profit',          'reports',     'profit',       'Profit report (shows cost prices)',        223),
  ('items.view_cost',         'items',       'view_cost',    'See purchase / cost price of items',        55),
  ('items.adjust_stock',      'items',       'adjust_stock', 'Add or remove stock of an item',            56),
  ('settings.edit',           'settings',    'edit',         'Change system settings',                   230),
  ('audit_logs.view',         'audit_logs',  'view',         'See audit and login history',              240),
  ('sales.credit',            'sales',       'credit',       'Save a bill with an unpaid balance',       215),
  ('customer_payments.view',  'customer_payments', 'view',   'See customer receipts and balances',       250),
  ('customer_payments.create','customer_payments', 'create', 'Receive a customer payment',               251),
  ('customer_payments.cancel','customer_payments', 'cancel', 'Cancel a customer receipt',                252),
  ('instalments.view',        'instalments', 'view',         'See instalment plans',                     255),
  ('instalments.create',      'instalments', 'create',       'Put a bill on an instalment plan',         256),
  ('supplier_payments.view',  'supplier_payments', 'view',   'See supplier payments and balances',       260),
  ('supplier_payments.create','supplier_payments', 'create', 'Pay a supplier',                           261),
  ('supplier_payments.cancel','supplier_payments', 'cancel', 'Cancel a supplier payment',                262),
  ('craftsman_account.view',  'craftsman_account', 'view',   'See craftsman gold held and cash due',     270),
  ('craftsman_account.adjust','craftsman_account', 'adjust', 'Gold adjustment / gold returned entries',  271),
  ('craftsman_payments.create','craftsman_payments','create','Pay a craftsman',                          272),
  ('craftsman_payments.cancel','craftsman_payments','cancel','Cancel a craftsman payment',               273),
  ('tags.print',              'tags',        'print',        'Print barcode tags',                       280),
  ('tag_templates.edit',      'tag_templates','edit',        'Create and change tag layouts',            281),
  ('reports.customer_balances','reports',    'customer_balances', 'Customer outstanding report',         224),
  ('reports.supplier_balances','reports',    'supplier_balances', 'Supplier outstanding report',         225),
  ('reports.craftsman_balances','reports',   'craftsman_balances','Craftsman gold and cash report',      226),
  ('finance.view',            'finance',     'view',         'See money in / out and cash & bank balances', 290),
  ('expenses.view',           'expenses',    'view',         'See shop expenses',                        291),
  ('expenses.create',         'expenses',    'create',       'Record a shop expense',                    292),
  ('expenses.cancel',         'expenses',    'cancel',       'Cancel a shop expense',                    293),
  ('cash_entries.create',     'cash_entries','create',       'Opening balance, capital, drawings, transfers', 294),
  ('cash_entries.cancel',     'cash_entries','cancel',       'Cancel a cash / bank entry',               295),
  ('bank_accounts.view',      'bank_accounts','view',        'See the shop''s banks and bank accounts',  286),
  ('bank_accounts.manage',    'bank_accounts','manage',      'Add and change banks and bank accounts',   287),
  ('day_end.view',            'day_end',     'view',         'See the day end summary and closed days',  300),
  ('day_end.close',           'day_end',     'close',        'Count the cash and close (lock) a day',    301),
  ('repairs.view',            'repairs',     'view',         'See customer repairs',                     310),
  ('repairs.create',          'repairs',     'create',       'Take in a customer item for repair',       311),
  ('repairs.edit',            'repairs',     'edit',         'Give to a craftsman, receive back, change details', 312),
  ('repairs.deliver',         'repairs',     'deliver',      'Hand the item back and take payment',      313),
  ('repairs.cancel',          'repairs',     'cancel',       'Cancel a repair',                          314),
  ('old_gold.view',           'old_gold',    'view',         'See old gold taken from customers',        320),
  ('old_gold.create',         'old_gold',    'create',       'Buy / exchange a customer''s old gold',      321),
  ('old_gold.cancel',         'old_gold',    'cancel',       'Cancel an old gold receipt',               322);

-- Manager: everything except users, roles, settings and audit
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Manager'
  AND p.module NOT IN ('users','roles','settings','audit_logs');

-- Cashier: sales counter
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Cashier'
  AND p.code IN ('dashboard.view','gold_prices.view','items.view',
                 'customers.view','customers.create','customers.edit',
                 'salesmen.view', 'bank_accounts.view',
                 'sales.view','sales.create','sales.reprint',
                 'customer_payments.view','customer_payments.create',
                 'instalments.view','tags.print',
                 'repairs.view','repairs.create','repairs.deliver',
                 'old_gold.view','old_gold.create');

-- Stock Keeper: items, purchases, craftsmen and jobs
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Stock Keeper'
  AND (p.module IN ('categories','items','suppliers','purchases','craftsmen','craft_jobs')
       OR p.code IN ('dashboard.view','gold_prices.view','karats.view','reports.stock','reports.wastage',
                     'craftsman_account.view','tags.print'))
  AND p.code NOT LIKE '%.delete';

-- Safe edit / delete of money records and gold prices (Danger Zone). Added after the role grants
-- above so only Admin has them until granted in Roles.
INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('sales.edit',                'sales',              'edit',        'Change customer, due date or notes of a bill', 216),
  ('sales.delete',              'sales',              'delete',      'Delete a cancelled bill',                      217),
  ('customer_payments.edit',    'customer_payments',  'edit',        'Change reference or notes of a receipt',      253),
  ('customer_payments.delete',  'customer_payments',  'delete',      'Delete a cancelled receipt',                  254),
  ('supplier_payments.edit',    'supplier_payments',  'edit',        'Change reference or notes of a payment',      263),
  ('supplier_payments.delete',  'supplier_payments',  'delete',      'Delete a cancelled supplier payment',         264),
  ('craftsman_payments.edit',   'craftsman_payments', 'edit',        'Change notes of a craftsman payment',         274),
  ('craftsman_payments.delete', 'craftsman_payments', 'delete',      'Delete a cancelled craftsman payment',        275),
  ('gold_prices.edit',          'gold_prices',        'edit',        'Fix a gold price no bill has used',           202),
  ('gold_prices.delete',        'gold_prices',        'delete',      'Delete a gold price no bill has used',        203),
  ('items.reverse_stock',       'items',              'reverse_stock','Reverse a manual stock adjustment',            57),
  ('expenses.edit',             'expenses',           'edit',        'Change reference or notes of an expense',     296),
  ('expenses.delete',           'expenses',           'delete',      'Delete a cancelled expense',                  297),
  ('cash_entries.edit',         'cash_entries',       'edit',        'Change notes of a cash / bank entry',         298),
  ('cash_entries.delete',       'cash_entries',       'delete',      'Delete a cancelled cash / bank entry',        299);

-- The first Admin user is created by the app's seed script (bcrypt password,
-- must_change_password = 1), because a password hash cannot be written here.

-- Running numbers
INSERT INTO document_sequences (code, prefix) VALUES
  ('INV',  'INV-'),   -- sales bills
  ('RCP',  'RCP-'),   -- customer receipts
  ('PUR',  'PUR-'),   -- purchases
  ('SPY',  'SPY-'),   -- supplier payments
  ('JOB',  'JOB-'),   -- craftsman jobs
  ('CPY',  'CPY-'),   -- craftsman payments
  ('EXP',  'EXP-'),   -- shop expenses
  ('CSH',  'CSH-'),   -- cash / bank entries
  ('REP',  'REP-'),   -- customer repairs
  ('OGR',  'OGR-'),   -- old gold receipts
  ('SM',   'SM-'),    -- salesmen codes
  ('ITEM', 'JW');     -- item barcodes: JW000001

INSERT INTO expense_categories (name) VALUES
  ('Rent'), ('Salaries'), ('Electricity'), ('Water'), ('Telephone & Internet'), ('Transport'),
  ('Repairs & Maintenance'), ('Stationery'), ('Bank Charges'), ('Other');

-- Default jewellery tag (dumbbell / rat-tail label)
INSERT INTO tag_templates (name, width_mm, height_mm, barcode_type, fields, is_default) VALUES
  ('Standard 75x12', 75, 12, 'CODE128',
   JSON_ARRAY('shop_name','barcode','item_code','karat','net_weight_g','wastage_g'), 1);

INSERT INTO karats (name, purity, sort_order) VALUES
  ('24K', 0.9990, 1),
  ('22K', 0.9160, 2);

-- ---------------------------------------------------------------------
-- HANDY VIEW: current price for every karat
-- ---------------------------------------------------------------------
CREATE VIEW v_current_gold_prices AS
SELECT k.id AS karat_id, k.name AS karat, gp.id AS gold_price_id,
       gp.pound_price, gp.gram_price, gp.effective_at
FROM karats k
JOIN gold_prices gp ON gp.id = (
  SELECT g2.id FROM gold_prices g2
  WHERE g2.karat_id = k.id
  ORDER BY g2.effective_at DESC, g2.id DESC
  LIMIT 1
)
WHERE k.is_active = 1;

-- ---------------------------------------------------------------------
-- HANDY VIEW: effective permissions of every user
--   (role permissions + granted overrides - denied overrides;
--    super-admin roles get every permission)
-- ---------------------------------------------------------------------
CREATE VIEW v_user_permissions AS
SELECT u.id AS user_id, p.code
FROM users u
JOIN roles r ON r.id = u.role_id
JOIN permissions p
WHERE u.is_active = 1 AND r.is_active = 1
  AND (
        r.is_super_admin = 1
     OR EXISTS (SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id)
     OR EXISTS (SELECT 1 FROM user_permissions up
                WHERE up.user_id = u.id AND up.permission_id = p.id AND up.is_granted = 1)
  )
  AND NOT EXISTS (SELECT 1 FROM user_permissions up
                  WHERE up.user_id = u.id AND up.permission_id = p.id AND up.is_granted = 0
                    AND r.is_super_admin = 0);

-- ---------------------------------------------------------------------
-- HANDY VIEW: what each customer owes (+) or has in advance (-)
-- ---------------------------------------------------------------------
CREATE VIEW v_customer_balances AS
SELECT c.id AS customer_id, c.name, c.phone, c.credit_limit,
       c.opening_balance
       + COALESCE((SELECT SUM(s.total) FROM sales s
                   WHERE s.customer_id = c.id AND s.status = 'completed'), 0)
       + COALESCE((SELECT SUM(r.total_charge) FROM repair_orders r
                   WHERE r.customer_id = c.id AND r.status = 'delivered'), 0)
       - COALESCE((SELECT SUM(p.amount) FROM customer_payments p
                   WHERE p.customer_id = c.id AND p.status = 'active'), 0)
         AS balance
FROM customers c;

-- ---------------------------------------------------------------------
-- HANDY VIEW: what we owe each supplier
-- ---------------------------------------------------------------------
CREATE VIEW v_supplier_balances AS
SELECT sp.id AS supplier_id, sp.name, sp.phone,
       sp.opening_balance
       + COALESCE((SELECT SUM(pu.total_amount) FROM purchases pu
                   WHERE pu.supplier_id = sp.id), 0)
       - COALESCE((SELECT SUM(py.amount) FROM supplier_payments py
                   WHERE py.supplier_id = sp.id AND py.status = 'active'), 0)
         AS balance
FROM suppliers sp;

-- ---------------------------------------------------------------------
-- HANDY VIEW: craftsman gold held and cash due
-- ---------------------------------------------------------------------
CREATE VIEW v_craftsman_balances AS
SELECT cm.id AS craftsman_id, cm.name, cm.phone,
       cm.opening_gold_g
       + COALESCE((SELECT SUM(l.weight_g) FROM craftsman_gold_ledger l
                   WHERE l.craftsman_id = cm.id), 0)
         AS gold_held_g,
       cm.opening_cash_balance
       + COALESCE((SELECT SUM(j.craftsman_fee) FROM craft_jobs j
                   WHERE j.craftsman_id = cm.id AND j.status = 'completed'), 0)
       + COALESCE((SELECT SUM(r.craftsman_fee) FROM repair_orders r
                   WHERE r.craftsman_id = cm.id AND r.status IN ('ready', 'delivered')), 0)
       - COALESCE((SELECT SUM(p.amount) FROM craftsman_payments p
                   WHERE p.craftsman_id = cm.id AND p.status = 'active'), 0)
         AS cash_due
FROM craftsmen cm;
