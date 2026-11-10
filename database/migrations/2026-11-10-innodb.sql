-- Convert every table to InnoDB.
-- On a MySQL server whose default engine is MyISAM, the tables were created as MyISAM: transactions
-- do nothing there (a save that fails half way leaves the rows already written) and foreign keys are
-- ignored. InnoDB fixes both. Data is kept as it is.
-- Take a backup first, then run once:
--   mysqldump -u root -p jewellery_system > backup-before-innodb.sql
--   mysql -u root -p jewellery_system < database/migrations/2026-11-10-innodb.sql
-- Also set default-storage-engine=InnoDB under [mysqld] in my.ini so new tables are InnoDB too.
--
-- Foreign keys: MyISAM threw them away when the tables were made, so this does not add them back.
-- Converting is still what makes transactions work, which is what the app relies on.

SET @old_fk = @@foreign_key_checks;
SET foreign_key_checks = 0;

ALTER TABLE roles ENGINE = InnoDB;
ALTER TABLE permissions ENGINE = InnoDB;
ALTER TABLE role_permissions ENGINE = InnoDB;
ALTER TABLE users ENGINE = InnoDB;
ALTER TABLE user_permissions ENGINE = InnoDB;
ALTER TABLE login_logs ENGINE = InnoDB;
ALTER TABLE audit_logs ENGINE = InnoDB;
ALTER TABLE change_requests ENGINE = InnoDB;
ALTER TABLE deleted_records ENGINE = InnoDB;
ALTER TABLE settings ENGINE = InnoDB;
ALTER TABLE karats ENGINE = InnoDB;
ALTER TABLE gold_prices ENGINE = InnoDB;
ALTER TABLE categories ENGINE = InnoDB;
ALTER TABLE suppliers ENGINE = InnoDB;
ALTER TABLE craftsmen ENGINE = InnoDB;
ALTER TABLE customers ENGINE = InnoDB;
ALTER TABLE items ENGINE = InnoDB;
ALTER TABLE purchases ENGINE = InnoDB;
ALTER TABLE purchase_lines ENGINE = InnoDB;
ALTER TABLE craft_jobs ENGINE = InnoDB;
ALTER TABLE sales ENGINE = InnoDB;
ALTER TABLE sale_lines ENGINE = InnoDB;
ALTER TABLE stock_movements ENGINE = InnoDB;
ALTER TABLE repair_orders ENGINE = InnoDB;
ALTER TABLE old_gold_receipts ENGINE = InnoDB;
ALTER TABLE old_gold_lines ENGINE = InnoDB;
ALTER TABLE customer_payments ENGINE = InnoDB;
ALTER TABLE instalment_plans ENGINE = InnoDB;
ALTER TABLE instalment_schedule ENGINE = InnoDB;
ALTER TABLE customer_payment_allocations ENGINE = InnoDB;
ALTER TABLE supplier_payments ENGINE = InnoDB;
ALTER TABLE supplier_payment_allocations ENGINE = InnoDB;
ALTER TABLE craftsman_gold_ledger ENGINE = InnoDB;
ALTER TABLE craftsman_payments ENGINE = InnoDB;
ALTER TABLE expense_categories ENGINE = InnoDB;
ALTER TABLE expenses ENGINE = InnoDB;
ALTER TABLE cash_entries ENGINE = InnoDB;
ALTER TABLE day_closings ENGINE = InnoDB;
ALTER TABLE tag_templates ENGINE = InnoDB;
ALTER TABLE tag_print_logs ENGINE = InnoDB;
ALTER TABLE document_sequences ENGINE = InnoDB;

SET foreign_key_checks = @old_fk;
