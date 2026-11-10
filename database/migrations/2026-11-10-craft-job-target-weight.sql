-- The exact weight wanted for the finished piece, compared with what comes back.
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-10-craft-job-target-weight.sql

ALTER TABLE craft_jobs
  ADD COLUMN target_weight_g DECIMAL(10,3) NULL AFTER description;
