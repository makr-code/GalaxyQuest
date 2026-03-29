-- GalaxyQuest migration v7: add Phase-5.1 research types for existing users

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'nano_materials', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'genetic_engineering', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'quantum_computing', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'dark_energy_tap', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'wormhole_theory', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'terraforming_tech', 0 FROM users;

INSERT IGNORE INTO research (user_id, type, level)
SELECT id, 'stealth_tech', 0 FROM users;
