-- Brings an existing database up to date for manual stock in / out with history.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-04-stock-adjustments.sql

ALTER TABLE stock_movements
  ADD COLUMN reason VARCHAR(30) NULL AFTER ref_id,
  ADD COLUMN note VARCHAR(255) NULL AFTER reason,
  ADD INDEX idx_sm_created (created_at);

INSERT INTO permissions (code, module, action, description, sort_order) VALUES
  ('items.adjust_stock', 'items', 'adjust_stock', 'Add or remove stock of an item', 56);

-- Same roles that get it on a new database: Manager and Stock Keeper (Admin has everything).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p
WHERE r.name IN ('Manager', 'Stock Keeper') AND p.code = 'items.adjust_stock';
