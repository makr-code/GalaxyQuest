-- Purchase records cannot be represented by the previous schema.
CREATE TABLE IF NOT EXISTS economy_request_purchase_rollback_guard (remaining BIGINT CHECK (remaining = 0));
DELETE FROM economy_request_purchase_rollback_guard;
INSERT INTO economy_request_purchase_rollback_guard
    SELECT COUNT(*) FROM economy_requests WHERE request_type='purchase';
DROP TABLE economy_request_purchase_rollback_guard;
ALTER TABLE economy_requests
    DROP CHECK request_terms,
    DROP COLUMN request_type,
    ADD CONSTRAINT request_terms CHECK (
        quantity BETWEEN 1 AND 100 AND price_cents BETWEEN 1 AND 100000000
        AND npc_price_cents = price_cents + 1 AND expires_at > created_at
    );
