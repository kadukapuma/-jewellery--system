-- Day End: close a day after counting the cash. A closed day is locked - nothing can be added,
-- back-dated or cancelled on it until an Admin re-opens it.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-09-day-end.sql

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

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('day_end.view',  'day_end', 'view',  'See the day end summary and closed days', 300),
  ('day_end.close', 'day_end', 'close', 'Count the cash and close (lock) a day',   301);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Manager' AND p.module = 'day_end';
