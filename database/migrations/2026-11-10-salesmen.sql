-- Migration: Add Salesmen Master and integrate with Sales
-- Run once: mysql -u root -p jewellery_system < database/migrations/2026-11-10-salesmen.sql

CREATE TABLE IF NOT EXISTS salesmen (
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
) ENGINE=InnoDB;

-- Add salesman_id to sales table
SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS 
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sales' AND COLUMN_NAME = 'salesman_id'
);

SET @sql = IF(@col_exists = 0, 
  'ALTER TABLE sales ADD COLUMN salesman_id INT UNSIGNED NULL AFTER customer_id, ADD CONSTRAINT fk_sale_salesman FOREIGN KEY (salesman_id) REFERENCES salesmen(id) ON DELETE SET NULL', 
  'SELECT "Column salesman_id already exists"'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Sequence for salesman codes (e.g. SM-000001)
INSERT INTO document_sequences (code, prefix, next_number, pad_length) 
VALUES ('SM', 'SM-', 1, 6)
ON DUPLICATE KEY UPDATE prefix = 'SM-';

-- Permissions
INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('salesmen.view',   'salesmen', 'view',   'View salesmen',   280),
  ('salesmen.create', 'salesmen', 'create', 'Add salesmen',    281),
  ('salesmen.edit',   'salesmen', 'edit',   'Edit salesmen',   282),
  ('salesmen.delete', 'salesmen', 'delete', 'Delete salesmen', 283)
ON DUPLICATE KEY UPDATE description = VALUES(description);

-- Grant to Manager
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Manager' AND p.module = 'salesmen';

-- Grant view to Cashier
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name = 'Cashier' AND p.code = 'salesmen.view';

