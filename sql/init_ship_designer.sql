-- Retired destructive initializer.
-- Do not run this file: the old schema conflicts with current ship-designer APIs
-- and the former version dropped existing user data. No schema changes are made.
SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'init_ship_designer.sql is retired; no database changes were made';
