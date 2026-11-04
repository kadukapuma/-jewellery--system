-- Brings an existing database up to date for giving saved items to a craftsman
-- (make a saved item / repair or rework a saved item). New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-04-craft-job-saved-items.sql

ALTER TABLE craft_jobs
  ADD COLUMN job_type ENUM('new','make_item','rework') NOT NULL DEFAULT 'new' AFTER job_no,
  ADD COLUMN item_weight_g DECIMAL(10,3) NULL AFTER issued_weight_g;
