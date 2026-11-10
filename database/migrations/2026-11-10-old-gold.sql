-- Old gold: a customer's old jewellery is bought by the shop, for cash, as credit on the customer's
-- account (works like an advance), or in exchange on a new bill. Each piece becomes a stock item
-- (source 'old_gold') that can be sold as it is or given to a craftsman to melt / remake.
-- Credit and exchange are customer receipts with method 'old_gold': not money, so the cash and
-- bank accounts leave them out. A cash buy is money out of the shop.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-10-old-gold.sql

CREATE TABLE old_gold_receipts (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  receipt_no           VARCHAR(30) NOT NULL UNIQUE,     -- OGR-000001
  receipt_date         DATE NOT NULL,
  customer_id          INT UNSIGNED NULL,               -- NULL only for a walk-in exchange or cash buy
  mode                 ENUM('cash','credit','exchange') NOT NULL,
  payout_method        ENUM('cash','bank_transfer') NULL, -- only for mode = cash
  payout_reference     VARCHAR(50) NULL,
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

-- Credit / exchange value is a receipt in the customer's account.
ALTER TABLE customer_payments
  MODIFY COLUMN method ENUM('cash','card','bank_transfer','cheque','old_gold') NOT NULL DEFAULT 'cash',
  ADD COLUMN old_gold_id INT UNSIGNED NULL AFTER repair_id,
  ADD CONSTRAINT fk_cp_old_gold FOREIGN KEY (old_gold_id) REFERENCES old_gold_receipts(id);

ALTER TABLE items
  MODIFY COLUMN source ENUM('purchase','craft','opening','old_gold') NOT NULL DEFAULT 'purchase';

ALTER TABLE stock_movements
  MODIFY COLUMN movement_type ENUM('purchase','sale','craft_issue','craft_return','adjustment','old_gold_in') NOT NULL;

INSERT INTO settings (setting_key, setting_value) VALUES ('old_gold_deduction_percent', '0');

INSERT INTO document_sequences (code, prefix) VALUES ('OGR', 'OGR-');

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('old_gold.view',   'old_gold', 'view',   'See old gold taken from customers',            320),
  ('old_gold.create', 'old_gold', 'create', 'Buy / exchange a customer''s old gold',          321),
  ('old_gold.cancel', 'old_gold', 'cancel', 'Cancel an old gold receipt',                     322);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (r.name = 'Manager' AND p.module = 'old_gold')
   OR (r.name = 'Cashier' AND p.code IN ('old_gold.view', 'old_gold.create'));
