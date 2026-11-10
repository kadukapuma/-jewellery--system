-- Lets a job use gold the craftsman already holds (opening gold, extra gold given, ...).
-- New databases made from schema.sql already have this. Run once:
--   mysql -u root -p jewellery_system < database/migrations/2026-11-10-craft-job-held-gold.sql

ALTER TABLE craft_jobs
  ADD COLUMN held_gold_g DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER issued_weight_g;

ALTER TABLE craftsman_gold_ledger
  MODIFY txn_type ENUM('issue','return','wastage','extra_issue','gold_returned','adjustment','held_used') NOT NULL;

-- Gold a craftsman holds is kept per karat, so the opening gold needs a karat too.
ALTER TABLE craftsmen
  ADD COLUMN opening_gold_karat_id INT UNSIGNED NULL AFTER opening_gold_g,
  ADD CONSTRAINT fk_craftsman_opening_karat FOREIGN KEY (opening_gold_karat_id) REFERENCES karats(id);

-- Existing opening gold: the karat the craftsman has worked with most, else the first karat.
UPDATE craftsmen c
SET c.opening_gold_karat_id = COALESCE(
  (SELECT l.karat_id FROM craftsman_gold_ledger l WHERE l.craftsman_id = c.id
   GROUP BY l.karat_id ORDER BY COUNT(*) DESC LIMIT 1),
  (SELECT k.id FROM karats k ORDER BY k.is_active DESC, k.sort_order, k.id LIMIT 1))
WHERE c.opening_gold_g <> 0 AND c.opening_gold_karat_id IS NULL;
