-- GalaxyQuest Database Schema
-- Run this once to set up the database

CREATE DATABASE IF NOT EXISTS galaxyquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE galaxyquest;

-- Users
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
) ENGINE=InnoDB;

-- Planets
CREATE TABLE IF NOT EXISTS planets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    name VARCHAR(64) NOT NULL,
    galaxy INT NOT NULL DEFAULT 1,
    system INT NOT NULL DEFAULT 1,
    position INT NOT NULL DEFAULT 1,
    type ENUM('terrestrial','gas_giant','ice','desert','volcanic') NOT NULL DEFAULT 'terrestrial',
    diameter INT NOT NULL DEFAULT 10000,
    temp_min INT NOT NULL DEFAULT -20,
    temp_max INT NOT NULL DEFAULT 40,
    metal DECIMAL(20,4) NOT NULL DEFAULT 500,
    crystal DECIMAL(20,4) NOT NULL DEFAULT 300,
    deuterium DECIMAL(20,4) NOT NULL DEFAULT 100,
    energy INT NOT NULL DEFAULT 0,
    is_homeworld TINYINT(1) NOT NULL DEFAULT 0,
    last_update DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_position (galaxy, system, position)
) ENGINE=InnoDB;

-- Buildings on planets
CREATE TABLE IF NOT EXISTS buildings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    upgrade_end DATETIME DEFAULT NULL,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
    UNIQUE KEY unique_building (planet_id, type)
) ENGINE=InnoDB;

-- Research / technologies per user
CREATE TABLE IF NOT EXISTS research (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    level INT NOT NULL DEFAULT 0,
    research_end DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_research (user_id, type)
) ENGINE=InnoDB;

-- Ships on planets
CREATE TABLE IF NOT EXISTS ships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    planet_id INT NOT NULL,
    type VARCHAR(64) NOT NULL,
    count INT NOT NULL DEFAULT 0,
    FOREIGN KEY (planet_id) REFERENCES planets(id) ON DELETE CASCADE,
    UNIQUE KEY unique_ship (planet_id, type)
) ENGINE=InnoDB;

-- Fleets in motion
CREATE TABLE IF NOT EXISTS fleets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    origin_planet_id INT NOT NULL,
    target_galaxy INT NOT NULL,
    target_system INT NOT NULL,
    target_position INT NOT NULL,
    mission ENUM('attack','transport','colonize','harvest','spy','recall') NOT NULL DEFAULT 'transport',
    ships_json TEXT NOT NULL DEFAULT '{}',
    cargo_metal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_crystal DECIMAL(20,4) NOT NULL DEFAULT 0,
    cargo_deuterium DECIMAL(20,4) NOT NULL DEFAULT 0,
    departure_time DATETIME NOT NULL,
    arrival_time DATETIME NOT NULL,
    return_time DATETIME,
    returning TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    sender_id INT DEFAULT NULL,
    receiver_id INT NOT NULL,
    subject VARCHAR(255) NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    is_read TINYINT(1) NOT NULL DEFAULT 0,
    sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Battle reports
CREATE TABLE IF NOT EXISTS battle_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    attacker_id INT NOT NULL,
    defender_id INT NOT NULL,
    planet_id INT NOT NULL,
    report_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attacker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (defender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Spy reports
CREATE TABLE IF NOT EXISTS spy_reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    owner_id INT NOT NULL,
    target_user_id INT DEFAULT NULL,
    target_planet_id INT DEFAULT NULL,
    report_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Galaxy map cache (populated from planets)
-- (No extra table needed; we query planets directly)
