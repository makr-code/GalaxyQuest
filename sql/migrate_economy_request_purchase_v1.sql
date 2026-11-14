-- Historical invitations remain supply requests; purchase terms reverse the one-cent spread.
ALTER TABLE economy_requests
    DROP CHECK request_terms,
    ADD COLUMN request_type ENUM('supply','purchase') NOT NULL DEFAULT 'supply',
    ADD CONSTRAINT request_terms CHECK (
        quantity BETWEEN 1 AND 100 AND price_cents BETWEEN 1 AND 100000000
        AND ((request_type = 'supply' AND npc_price_cents = price_cents + 1)
            OR (request_type = 'purchase' AND price_cents = npc_price_cents + 1))
        AND expires_at > created_at
    );
