START TRANSACTION;

SET @has_ss_radius := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'star_systems'
      AND COLUMN_NAME = 'galactic_radius_ly'
);
SET @sql_add_ss_radius := IF(
    @has_ss_radius = 0,
    'ALTER TABLE star_systems ADD COLUMN galactic_radius_ly DOUBLE DEFAULT NULL AFTER z_ly',
    'SELECT 1'
);
PREPARE stmt_add_ss_radius FROM @sql_add_ss_radius;
EXECUTE stmt_add_ss_radius;
DEALLOCATE PREPARE stmt_add_ss_radius;

SET @has_ss_theta := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'star_systems'
      AND COLUMN_NAME = 'galactic_theta_rad'
);
SET @sql_add_ss_theta := IF(
    @has_ss_theta = 0,
    'ALTER TABLE star_systems ADD COLUMN galactic_theta_rad DOUBLE DEFAULT NULL AFTER galactic_radius_ly',
    'SELECT 1'
);
PREPARE stmt_add_ss_theta FROM @sql_add_ss_theta;
EXECUTE stmt_add_ss_theta;
DEALLOCATE PREPARE stmt_add_ss_theta;

SET @has_ss_height := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'star_systems'
      AND COLUMN_NAME = 'galactic_height_ly'
);
SET @sql_add_ss_height := IF(
    @has_ss_height = 0,
    'ALTER TABLE star_systems ADD COLUMN galactic_height_ly DOUBLE DEFAULT NULL AFTER galactic_theta_rad',
    'SELECT 1'
);
PREPARE stmt_add_ss_height FROM @sql_add_ss_height;
EXECUTE stmt_add_ss_height;
DEALLOCATE PREPARE stmt_add_ss_height;

SET @has_f_origin_radius := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'origin_radius_ly'
);
SET @sql_add_f_origin_radius := IF(
    @has_f_origin_radius = 0,
    'ALTER TABLE fleets ADD COLUMN origin_radius_ly DOUBLE DEFAULT NULL AFTER origin_z_ly',
    'SELECT 1'
);
PREPARE stmt_add_f_origin_radius FROM @sql_add_f_origin_radius;
EXECUTE stmt_add_f_origin_radius;
DEALLOCATE PREPARE stmt_add_f_origin_radius;

SET @has_f_origin_theta := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'origin_theta_rad'
);
SET @sql_add_f_origin_theta := IF(
    @has_f_origin_theta = 0,
    'ALTER TABLE fleets ADD COLUMN origin_theta_rad DOUBLE DEFAULT NULL AFTER origin_radius_ly',
    'SELECT 1'
);
PREPARE stmt_add_f_origin_theta FROM @sql_add_f_origin_theta;
EXECUTE stmt_add_f_origin_theta;
DEALLOCATE PREPARE stmt_add_f_origin_theta;

SET @has_f_origin_height := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'origin_height_ly'
);
SET @sql_add_f_origin_height := IF(
    @has_f_origin_height = 0,
    'ALTER TABLE fleets ADD COLUMN origin_height_ly DOUBLE DEFAULT NULL AFTER origin_theta_rad',
    'SELECT 1'
);
PREPARE stmt_add_f_origin_height FROM @sql_add_f_origin_height;
EXECUTE stmt_add_f_origin_height;
DEALLOCATE PREPARE stmt_add_f_origin_height;

SET @has_f_target_radius := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'target_radius_ly'
);
SET @sql_add_f_target_radius := IF(
    @has_f_target_radius = 0,
    'ALTER TABLE fleets ADD COLUMN target_radius_ly DOUBLE DEFAULT NULL AFTER target_z_ly',
    'SELECT 1'
);
PREPARE stmt_add_f_target_radius FROM @sql_add_f_target_radius;
EXECUTE stmt_add_f_target_radius;
DEALLOCATE PREPARE stmt_add_f_target_radius;

SET @has_f_target_theta := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'target_theta_rad'
);
SET @sql_add_f_target_theta := IF(
    @has_f_target_theta = 0,
    'ALTER TABLE fleets ADD COLUMN target_theta_rad DOUBLE DEFAULT NULL AFTER target_radius_ly',
    'SELECT 1'
);
PREPARE stmt_add_f_target_theta FROM @sql_add_f_target_theta;
EXECUTE stmt_add_f_target_theta;
DEALLOCATE PREPARE stmt_add_f_target_theta;

SET @has_f_target_height := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'fleets'
      AND COLUMN_NAME = 'target_height_ly'
);
SET @sql_add_f_target_height := IF(
    @has_f_target_height = 0,
    'ALTER TABLE fleets ADD COLUMN target_height_ly DOUBLE DEFAULT NULL AFTER target_theta_rad',
    'SELECT 1'
);
PREPARE stmt_add_f_target_height FROM @sql_add_f_target_height;
EXECUTE stmt_add_f_target_height;
DEALLOCATE PREPARE stmt_add_f_target_height;

SET @has_cb_local_x := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'local_x'
);
SET @sql_add_cb_local_x := IF(
    @has_cb_local_x = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN local_x DOUBLE DEFAULT NULL AFTER semi_major_axis_parent_r',
    'SELECT 1'
);
PREPARE stmt_add_cb_local_x FROM @sql_add_cb_local_x;
EXECUTE stmt_add_cb_local_x;
DEALLOCATE PREPARE stmt_add_cb_local_x;

SET @has_cb_local_y := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'local_y'
);
SET @sql_add_cb_local_y := IF(
    @has_cb_local_y = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN local_y DOUBLE DEFAULT NULL AFTER local_x',
    'SELECT 1'
);
PREPARE stmt_add_cb_local_y FROM @sql_add_cb_local_y;
EXECUTE stmt_add_cb_local_y;
DEALLOCATE PREPARE stmt_add_cb_local_y;

SET @has_cb_local_z := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'local_z'
);
SET @sql_add_cb_local_z := IF(
    @has_cb_local_z = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN local_z DOUBLE DEFAULT NULL AFTER local_y',
    'SELECT 1'
);
PREPARE stmt_add_cb_local_z FROM @sql_add_cb_local_z;
EXECUTE stmt_add_cb_local_z;
DEALLOCATE PREPARE stmt_add_cb_local_z;

SET @has_cb_polar_radius := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'polar_radius'
);
SET @sql_add_cb_polar_radius := IF(
    @has_cb_polar_radius = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN polar_radius DOUBLE DEFAULT NULL AFTER local_z',
    'SELECT 1'
);
PREPARE stmt_add_cb_polar_radius FROM @sql_add_cb_polar_radius;
EXECUTE stmt_add_cb_polar_radius;
DEALLOCATE PREPARE stmt_add_cb_polar_radius;

SET @has_cb_polar_theta := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'polar_theta_rad'
);
SET @sql_add_cb_polar_theta := IF(
    @has_cb_polar_theta = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN polar_theta_rad DOUBLE DEFAULT NULL AFTER polar_radius',
    'SELECT 1'
);
PREPARE stmt_add_cb_polar_theta FROM @sql_add_cb_polar_theta;
EXECUTE stmt_add_cb_polar_theta;
DEALLOCATE PREPARE stmt_add_cb_polar_theta;

SET @has_cb_polar_height := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'polar_height'
);
SET @sql_add_cb_polar_height := IF(
    @has_cb_polar_height = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN polar_height DOUBLE DEFAULT NULL AFTER polar_theta_rad',
    'SELECT 1'
);
PREPARE stmt_add_cb_polar_height FROM @sql_add_cb_polar_height;
EXECUTE stmt_add_cb_polar_height;
DEALLOCATE PREPARE stmt_add_cb_polar_height;

SET @has_cb_ang_vel := (
    SELECT COUNT(*)
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'celestial_bodies'
      AND COLUMN_NAME = 'angular_velocity_rad_day'
);
SET @sql_add_cb_ang_vel := IF(
    @has_cb_ang_vel = 0,
    'ALTER TABLE celestial_bodies ADD COLUMN angular_velocity_rad_day DOUBLE DEFAULT NULL AFTER polar_height',
    'SELECT 1'
);
PREPARE stmt_add_cb_ang_vel FROM @sql_add_cb_ang_vel;
EXECUTE stmt_add_cb_ang_vel;
DEALLOCATE PREPARE stmt_add_cb_ang_vel;

UPDATE star_systems
SET galactic_radius_ly = ROUND(SQRT(POW(x_ly, 2) + POW(y_ly, 2)), 2),
    galactic_theta_rad = ROUND(
        CASE
            WHEN x_ly = 0 AND y_ly = 0 THEN 0
            WHEN ATAN2(y_ly, x_ly) < 0 THEN ATAN2(y_ly, x_ly) + (2 * PI())
            ELSE ATAN2(y_ly, x_ly)
        END,
        6
    ),
    galactic_height_ly = ROUND(z_ly, 2)
WHERE galactic_radius_ly IS NULL
   OR galactic_theta_rad IS NULL
   OR galactic_height_ly IS NULL;

UPDATE fleets
SET origin_radius_ly = ROUND(SQRT(POW(origin_x_ly, 2) + POW(origin_y_ly, 2)), 2),
    origin_theta_rad = ROUND(
        CASE
            WHEN origin_x_ly = 0 AND origin_y_ly = 0 THEN 0
            WHEN ATAN2(origin_y_ly, origin_x_ly) < 0 THEN ATAN2(origin_y_ly, origin_x_ly) + (2 * PI())
            ELSE ATAN2(origin_y_ly, origin_x_ly)
        END,
        6
    ),
    origin_height_ly = ROUND(origin_z_ly, 2),
    target_radius_ly = ROUND(SQRT(POW(target_x_ly, 2) + POW(target_y_ly, 2)), 2),
    target_theta_rad = ROUND(
        CASE
            WHEN target_x_ly = 0 AND target_y_ly = 0 THEN 0
            WHEN ATAN2(target_y_ly, target_x_ly) < 0 THEN ATAN2(target_y_ly, target_x_ly) + (2 * PI())
            ELSE ATAN2(target_y_ly, target_x_ly)
        END,
        6
    ),
    target_height_ly = ROUND(target_z_ly, 2)
WHERE origin_radius_ly IS NULL
   OR origin_theta_rad IS NULL
   OR origin_height_ly IS NULL
   OR target_radius_ly IS NULL
   OR target_theta_rad IS NULL
   OR target_height_ly IS NULL;

UPDATE celestial_bodies
SET polar_radius = COALESCE(
        polar_radius,
        semi_major_axis_au,
        semi_major_axis_parent_r,
        orbit_ref_au,
        CASE
            WHEN ring_inner_radius_planet_r IS NOT NULL OR ring_outer_radius_planet_r IS NOT NULL
                THEN (COALESCE(ring_inner_radius_planet_r, 0) + COALESCE(ring_outer_radius_planet_r, 0)) / NULLIF(
                    (CASE WHEN ring_inner_radius_planet_r IS NOT NULL THEN 1 ELSE 0 END)
                  + (CASE WHEN ring_outer_radius_planet_r IS NOT NULL THEN 1 ELSE 0 END),
                    0
                )
            ELSE NULL
        END
    ),
    polar_theta_rad = COALESCE(
        polar_theta_rad,
        ROUND(MOD(CRC32(body_uid), 628319) / 100000.0, 6)
    ),
    polar_height = COALESCE(polar_height, 0),
    angular_velocity_rad_day = COALESCE(
        angular_velocity_rad_day,
        CASE
            WHEN orbital_period_days IS NOT NULL AND orbital_period_days > 0
                THEN ROUND((2 * PI()) / orbital_period_days, 8)
            ELSE 0
        END
    ),
    local_x = COALESCE(
        local_x,
        ROUND(COALESCE(
            polar_radius,
            semi_major_axis_au,
            semi_major_axis_parent_r,
            orbit_ref_au,
            0
        ) * COS(COALESCE(polar_theta_rad, MOD(CRC32(body_uid), 628319) / 100000.0)), 5)
    ),
    local_y = COALESCE(
        local_y,
        ROUND(COALESCE(
            polar_radius,
            semi_major_axis_au,
            semi_major_axis_parent_r,
            orbit_ref_au,
            0
        ) * SIN(COALESCE(polar_theta_rad, MOD(CRC32(body_uid), 628319) / 100000.0)), 5)
    ),
    local_z = COALESCE(local_z, 0)
WHERE local_x IS NULL
   OR local_y IS NULL
   OR local_z IS NULL
   OR polar_radius IS NULL
   OR polar_theta_rad IS NULL
   OR polar_height IS NULL
   OR angular_velocity_rad_day IS NULL;

COMMIT;