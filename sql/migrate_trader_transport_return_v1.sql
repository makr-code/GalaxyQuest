-- Real trader transports retain their ships in a timed, empty return fleet.
-- Append after historical fleet ENUM migrations; never rewrite their checksums.
USE galaxyquest;

ALTER TABLE fleets
    MODIFY COLUMN mission ENUM('attack','transport','colonize','harvest','spy','recall','survey','return')
        NOT NULL DEFAULT 'transport';
