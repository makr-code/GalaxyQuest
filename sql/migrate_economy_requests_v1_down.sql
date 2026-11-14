-- Refuse to silently publish a still-private commitment.
CREATE TABLE IF NOT EXISTS economy_request_rollback_guard (remaining BIGINT CHECK (remaining = 0));
DELETE FROM economy_request_rollback_guard;
INSERT INTO economy_request_rollback_guard
    SELECT COUNT(*) FROM economy_standing_orders WHERE paired_order_id IS NOT NULL AND status='active';
DROP TABLE economy_request_rollback_guard;
DROP TABLE economy_requests;
ALTER TABLE economy_standing_orders
    DROP FOREIGN KEY standing_pair_order,
    DROP INDEX standing_private_pair,
    DROP COLUMN paired_order_id;
