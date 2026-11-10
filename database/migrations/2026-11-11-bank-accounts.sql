-- Brings an existing database up to date for multiple bank accounts:
--   banks + bank_accounts, the account a card / bank transfer / cheque payment went to or came from,
--   and transfers between two bank accounts. Rows recorded before this stay with no account ("Unassigned").
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-11-bank-accounts.sql

CREATE TABLE IF NOT EXISTS banks (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(100) NOT NULL UNIQUE,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bank_accounts (
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
) ENGINE=InnoDB;

-- Adds bank_account_id (and its FK) to a table, once.
DROP PROCEDURE IF EXISTS add_bank_account_col;
DELIMITER //
CREATE PROCEDURE add_bank_account_col(IN tbl VARCHAR(64), IN col VARCHAR(64), IN fk VARCHAR(64))
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col) THEN
    SET @sql = CONCAT('ALTER TABLE ', tbl, ' ADD COLUMN ', col, ' INT UNSIGNED NULL, ',
                      'ADD CONSTRAINT ', fk, ' FOREIGN KEY (', col, ') REFERENCES bank_accounts(id)');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_bank_account_col('customer_payments',  'bank_account_id',    'fk_cp_bank_account');
CALL add_bank_account_col('supplier_payments',  'bank_account_id',    'fk_spy_bank_account');
CALL add_bank_account_col('craftsman_payments', 'bank_account_id',    'fk_cpy_bank_account');
CALL add_bank_account_col('expenses',           'bank_account_id',    'fk_exp_bank_account');
CALL add_bank_account_col('old_gold_receipts',  'bank_account_id',    'fk_ogr_bank_account');
CALL add_bank_account_col('cash_entries',       'bank_account_id',    'fk_ce_bank_account');
CALL add_bank_account_col('cash_entries',       'to_bank_account_id', 'fk_ce_to_bank_account');
DROP PROCEDURE add_bank_account_col;

ALTER TABLE cash_entries
  MODIFY COLUMN entry_type ENUM('opening','capital_in','drawing','deposit','withdrawal','bank_to_bank') NOT NULL;

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('bank_accounts.view',   'bank_accounts', 'view',   'See the shop''s banks and bank accounts', 286),
  ('bank_accounts.manage', 'bank_accounts', 'manage', 'Add and change banks and bank accounts',  287)
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Manager' AND p.module = 'bank_accounts';

-- Cashiers pick the account a card / transfer / cheque went to.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Cashier' AND p.code = 'bank_accounts.view';
