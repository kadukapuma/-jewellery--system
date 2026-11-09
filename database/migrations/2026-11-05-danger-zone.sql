-- Danger Zone: only Admin edits / deletes directly, other users send change requests,
-- and deleted records go to a recycle bin so they can be restored.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-05-danger-zone.sql

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

ALTER TABLE sales ADD COLUMN notes VARCHAR(255) NULL AFTER due_date;

INSERT INTO settings (setting_key, setting_value) VALUES ('admin_only_changes', '1');

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
