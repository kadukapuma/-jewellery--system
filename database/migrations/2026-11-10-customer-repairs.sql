-- Customer repairs: a customer's own item is taken in, given to a craftsman, and handed back for a charge.
-- The item is never shop stock. Only shop gold added to it goes through the craftsman's gold account.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-10-customer-repairs.sql

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

-- Advance and collection money are ordinary receipts that point at the repair.
ALTER TABLE customer_payments
  ADD COLUMN repair_id INT UNSIGNED NULL AFTER sale_id,
  ADD CONSTRAINT fk_cp_repair FOREIGN KEY (repair_id) REFERENCES repair_orders(id);

-- Shop gold added during a repair.
ALTER TABLE craftsman_gold_ledger
  ADD COLUMN repair_id INT UNSIGNED NULL AFTER craft_job_id,
  ADD CONSTRAINT fk_cgl_repair FOREIGN KEY (repair_id) REFERENCES repair_orders(id);

INSERT INTO document_sequences (code, prefix) VALUES ('REP', 'REP-');

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('repairs.view',    'repairs', 'view',    'See customer repairs',                                310),
  ('repairs.create',  'repairs', 'create',  'Take in a customer item for repair',                  311),
  ('repairs.edit',    'repairs', 'edit',    'Give to a craftsman, receive back, change details',   312),
  ('repairs.deliver', 'repairs', 'deliver', 'Hand the item back and take payment',                 313),
  ('repairs.cancel',  'repairs', 'cancel',  'Cancel a repair',                                     314);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE (r.name = 'Manager' AND p.module = 'repairs')
   OR (r.name = 'Cashier' AND p.code IN ('repairs.view', 'repairs.create', 'repairs.deliver'));

-- A collected repair is owed by the customer like a bill.
CREATE OR REPLACE VIEW v_customer_balances AS
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

-- A repair fee is owed to the craftsman once the piece is back.
CREATE OR REPLACE VIEW v_craftsman_balances AS
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
