-- Refuse to discard a real return flight when reverting its mission type.
CREATE TABLE IF NOT EXISTS trader_transport_return_rollback_guard (remaining BIGINT CHECK (remaining = 0));
DELETE FROM trader_transport_return_rollback_guard;
INSERT INTO trader_transport_return_rollback_guard
    SELECT COUNT(*) FROM fleets WHERE mission='return';
DROP TABLE trader_transport_return_rollback_guard;

ALTER TABLE fleets
    MODIFY COLUMN mission ENUM('attack','transport','colonize','harvest','spy','recall','survey')
        NOT NULL DEFAULT 'transport';
