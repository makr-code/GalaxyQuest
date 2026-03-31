-- RBAC v1
-- Linux-style groups + profile inheritance for access control.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS rbac_groups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    group_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    description VARCHAR(255) NOT NULL DEFAULT '',
    system_group TINYINT(1) NOT NULL DEFAULT 1,
    priority INT NOT NULL DEFAULT 100,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rbac_group_key (group_key)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_profiles (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    profile_key VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    description VARCHAR(255) NOT NULL DEFAULT '',
    parent_profile_id BIGINT NULL,
    profile_json JSON NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_rbac_profile_key (profile_key),
    KEY idx_rbac_profile_parent (parent_profile_id),
    CONSTRAINT fk_rbac_profile_parent
        FOREIGN KEY (parent_profile_id) REFERENCES rbac_profiles(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_group_profiles (
    group_id BIGINT NOT NULL,
    profile_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, profile_id),
    KEY idx_rbac_group_profiles_profile (profile_id),
    CONSTRAINT fk_rbac_group_profiles_group
        FOREIGN KEY (group_id) REFERENCES rbac_groups(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rbac_group_profiles_profile
        FOREIGN KEY (profile_id) REFERENCES rbac_profiles(id)
        ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rbac_user_groups (
    user_id INT NOT NULL,
    group_id BIGINT NOT NULL,
    assigned_by INT NULL,
    assigned_reason VARCHAR(120) NOT NULL DEFAULT 'manual',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, group_id),
    KEY idx_rbac_user_groups_group (group_id),
    KEY idx_rbac_user_groups_assigned_by (assigned_by),
    CONSTRAINT fk_rbac_user_groups_user
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rbac_user_groups_group
        FOREIGN KEY (group_id) REFERENCES rbac_groups(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_rbac_user_groups_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id)
        ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO rbac_groups (group_key, display_name, description, system_group, priority)
VALUES
    ('root', 'root', 'Unrestricted superuser group.', 1, 0),
    ('sudo', 'sudo', 'Administrative operators with elevated rights.', 1, 10),
    ('users', 'users', 'Default interactive users.', 1, 100),
    ('guests', 'guests', 'Restricted guest users.', 1, 200),
    ('service', 'service', 'Engine and service accounts.', 1, 50)
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    description = VALUES(description),
    system_group = VALUES(system_group),
    priority = VALUES(priority);

INSERT INTO rbac_profiles (profile_key, display_name, description, parent_profile_id, profile_json)
VALUES
    ('base', 'Base Profile', 'Minimal inherited baseline for all profiles.', NULL,
        JSON_OBJECT('can_login', false, 'can_admin', false, 'ui_scope', 'minimal')),
    ('user', 'User Profile', 'Default player profile.', NULL,
        JSON_OBJECT('can_login', true, 'can_admin', false, 'ui_scope', 'player')),
    ('admin', 'Admin Profile', 'Administrative profile.', NULL,
        JSON_OBJECT('can_login', true, 'can_admin', true, 'ui_scope', 'admin')),
    ('root', 'Root Profile', 'Full root profile.', NULL,
        JSON_OBJECT('can_login', true, 'can_admin', true, 'ui_scope', 'root')),
    ('guest', 'Guest Profile', 'Guest profile with reduced rights.', NULL,
        JSON_OBJECT('can_login', true, 'can_admin', false, 'ui_scope', 'guest')),
    ('service', 'Service Profile', 'Non-interactive service profile.', NULL,
        JSON_OBJECT('can_login', false, 'can_admin', false, 'ui_scope', 'service'))
ON DUPLICATE KEY UPDATE
    display_name = VALUES(display_name),
    description = VALUES(description),
    profile_json = VALUES(profile_json);

UPDATE rbac_profiles p
LEFT JOIN rbac_profiles parent ON parent.profile_key = CASE p.profile_key
    WHEN 'user' THEN 'base'
    WHEN 'admin' THEN 'user'
    WHEN 'root' THEN 'admin'
    WHEN 'guest' THEN 'base'
    WHEN 'service' THEN 'base'
    ELSE NULL
END
SET p.parent_profile_id = parent.id
WHERE p.profile_key IN ('base', 'user', 'admin', 'root', 'guest', 'service');

INSERT IGNORE INTO rbac_group_profiles (group_id, profile_id)
SELECT g.id, p.id
  FROM rbac_groups g
  JOIN rbac_profiles p ON p.profile_key = CASE g.group_key
    WHEN 'root' THEN 'root'
    WHEN 'sudo' THEN 'admin'
    WHEN 'users' THEN 'user'
    WHEN 'guests' THEN 'guest'
    WHEN 'service' THEN 'service'
    ELSE 'base'
  END
 WHERE g.group_key IN ('root', 'sudo', 'users', 'guests', 'service');
