# Database ALTER Migrations and Data Manipulation Guide

> **Note:** This guide complements the main migration documentation in `DATABASE_MIGRATIONS.md`.
> For basic migration concepts, see that file first.

## Overview

ALTER TABLE migrations are used to modify existing database schema:
- Adding, modifying, or removing columns
- Adding or removing indexes
- Changing constraints and defaults
- Altering table options (ENGINE, charset, etc.)

Data manipulation migrations are used to:
- Backfill new columns with calculated or transformed data
- Clean up invalid or obsolete data
- Move data between tables (normalization/denormalization)
- Maintain referential integrity during structural changes

---

## Pattern 1: Adding New Columns

### Safe Pattern
```sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS new_column_name DATA_TYPE NOT NULL DEFAULT value
        AFTER existing_column_name;
```

### Key Points
- Always use `IF NOT EXISTS` to make the migration idempotent
- Always provide a `DEFAULT` value for existing rows
- Use `AFTER column_name` to control column position (readability)
- For `NOT NULL` columns, provide a default that makes business sense

### Example: Adding a Feature Flag
```sql
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS enable_experimental_features TINYINT(1) NOT NULL DEFAULT 0
        AFTER settings_updated_at;
```

### With Backfill
```sql
-- Add with default value
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS play_style VARCHAR(32) NOT NULL DEFAULT 'balanced'
        AFTER preferences;

-- Update existing rows based on logic
UPDATE players
SET play_style = CASE
    WHEN aggressive_rating > defensive_rating THEN 'aggressive'
    WHEN defensive_rating > aggressive_rating THEN 'defensive'
    ELSE 'balanced'
END
WHERE play_style = 'balanced'
    AND (aggressive_rating > 0 OR defensive_rating > 0);
```

---

## Pattern 2: Modifying Existing Columns

### Changing Column Type
```sql
-- Always test with production data first!
ALTER TABLE products
    MODIFY COLUMN price DECIMAL(10, 4) NOT NULL;  -- Increased precision
```

### Adding/Removing NOT NULL Constraint

#### Adding NOT NULL to nullable column:
```sql
-- Step 1: Backfill NULLs
UPDATE products
SET status = 'inactive'
WHERE status IS NULL;

-- Step 2: Add constraint
ALTER TABLE products
    MODIFY COLUMN status VARCHAR(32) NOT NULL;
```

#### Removing NOT NULL:
```sql
ALTER TABLE products
    MODIFY COLUMN optional_field VARCHAR(100) NULL;
```

### Changing Default Values
```sql
-- Only affects NEW inserts, doesn't change existing rows
ALTER TABLE configurations
    MODIFY COLUMN max_retries INT NOT NULL DEFAULT 5;  -- was 3
```

### Renaming a Column (MySQL 8.0.14+)
```sql
ALTER TABLE users
    RENAME COLUMN old_phone_number TO phone_number_primary;
```

---

## Pattern 3: Managing Indexes

### Adding Indexes
```sql
-- Single index
ALTER TABLE orders
    ADD INDEX idx_customer_created (customer_id, created_at);

-- Multiple indexes in one statement
ALTER TABLE orders
    ADD INDEX idx_customer (customer_id),
    ADD INDEX idx_status (status),
    ADD UNIQUE KEY uq_order_number (order_number);
```

### Removing Indexes
```sql
ALTER TABLE orders
    DROP INDEX idx_old_index,
    DROP INDEX idx_unused;
```

### Key Considerations
- Add indexes **AFTER** backfilling large datasets (indexes slow down inserts/updates)
- Use composite indexes for queries filtering on multiple columns
- Order columns in composite index: most selective first
- Use `UNIQUE` for natural uniqueness constraints

---

## Pattern 4: Removing Columns

```sql
ALTER TABLE users
    DROP COLUMN IF EXISTS deprecated_field;
```

### Important Precautions
- Verify no application code references the column
- Check for indexes or foreign keys using the column
- Consider backing up the data first (or archiving)
- Make this a separate migration after confirming the change

---

## Pattern 5: Foreign Key Constraints

### Adding a Foreign Key (safely)

```sql
-- Step 1: Remove rows that would violate the FK
DELETE FROM orders
WHERE customer_id NOT IN (
    SELECT id FROM customers WHERE is_active = 1
);

-- Step 2: Add the constraint
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE;
```

### Common Actions
- `ON DELETE RESTRICT`: Don't allow delete if children exist (default)
- `ON DELETE CASCADE`: Delete children when parent is deleted
- `ON UPDATE CASCADE`: Update children when parent ID changes
- `ON DELETE SET NULL`: Set child FK to NULL when parent is deleted

### Removing a Foreign Key
```sql
ALTER TABLE orders
    DROP FOREIGN KEY fk_orders_customer;
```

---

## Pattern 6: Data Backfilling

### Simple Constant Fill
```sql
UPDATE new_table
SET required_column = 'default_value'
WHERE required_column IS NULL;
```

### Conditional Fill
```sql
UPDATE employees
SET department = CASE
    WHEN salary > 100000 THEN 'executive'
    WHEN salary > 50000 THEN 'management'
    ELSE 'staff'
END
WHERE department IS NULL;
```

### Fill from Related Table
```sql
UPDATE orders
SET customer_name = (
    SELECT name FROM customers
    WHERE customers.id = orders.customer_id
)
WHERE customer_name IS NULL;
```

### Bulk Insert from Another Table
```sql
INSERT INTO archive_orders (id, customer_id, amount, order_date)
SELECT id, customer_id, amount, order_date
FROM orders
WHERE order_date < DATE_SUB(NOW(), INTERVAL 2 YEAR)
    AND NOT EXISTS (
        SELECT 1 FROM archive_orders
        WHERE archive_orders.id = orders.id
    );
```

---

## Pattern 7: Data Cleanup and Validation

### Remove Duplicates (Keep Oldest)
```sql
DELETE FROM user_sessions
WHERE id NOT IN (
    SELECT MIN(id)
    FROM user_sessions
    GROUP BY user_id, session_token
);
```

### Fix Inconsistent Data
```sql
-- Normalize enum values
UPDATE status_log
SET status = 'completed'
WHERE status IN ('done', 'finished', 'complete');

-- Clean up whitespace
UPDATE profiles
SET bio = TRIM(bio)
WHERE bio LIKE ' %' OR bio LIKE '% ';

-- Remove invalid values
DELETE FROM settings
WHERE value NOT IN ('on', 'off', 'auto');
```

### Soft Delete (Preferred for Audit Trails)
```sql
-- Instead of DELETE, mark as deleted
UPDATE users
SET is_deleted = 1,
    deleted_at = CURRENT_TIMESTAMP
WHERE user_id IN (/* ...list of IDs... */);
```

---

## Pattern 8: Data Migration (Normalization/Denormalization)

### Denormalize: Flatten nested structure
```sql
-- Scenario: Breaking out comma-separated values
INSERT INTO user_preferences (user_id, preference_name, preference_value)
SELECT 
    id,
    'theme',
    SUBSTRING_INDEX(SUBSTRING_INDEX(preferences, ',', 1), ',', -1)
FROM users
WHERE preferences IS NOT NULL;
```

### Normalize: Create separate table
```sql
-- Create normalized table
CREATE TABLE IF NOT EXISTS player_faction_memberships (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_id INT NOT NULL,
    faction_id INT NOT NULL,
    join_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_player_faction (player_id, faction_id),
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Populate from denormalized data
INSERT INTO player_faction_memberships (player_id, faction_id)
SELECT 
    players.id,
    primary_faction_id
FROM players
WHERE primary_faction_id IS NOT NULL;
```

---

## Pattern 9: JSON Columns (MySQL 5.7+)

### Adding JSON Column
```sql
ALTER TABLE products
    ADD COLUMN IF NOT EXISTS metadata JSON NULL
        AFTER description;

-- Initialize with empty object
UPDATE products
SET metadata = '{}'
WHERE metadata IS NULL;
```

### Querying JSON Data
```sql
-- Extract JSON value
SELECT id, JSON_EXTRACT(metadata, '$.color') as color
FROM products;

-- Set JSON value
UPDATE products
SET metadata = JSON_SET(metadata, '$.color', 'blue')
WHERE id = 123;
```

---

## Pattern 10: Handling Transactions and Rollback

### All migrations run in a single transaction
```sql
-- This entire file is wrapped in:
-- BEGIN;
-- ... your migration SQL ...
-- COMMIT;  (on success)
-- ROLLBACK; (on error)
```

### Creating Rollback (Down) Migrations

For `migrate_add_feature_v1.sql`:
```sql
-- migrate_add_feature_v1.sql
ALTER TABLE products ADD COLUMN feature_flag TINYINT(1) NOT NULL DEFAULT 0;
INSERT INTO features (name, enabled) VALUES ('new_feature', 1);
```

Create the companion `migrate_add_feature_v1_down.sql`:
```sql
-- migrate_add_feature_v1_down.sql
DELETE FROM features WHERE name = 'new_feature';
ALTER TABLE products DROP COLUMN feature_flag;
```

### Important Notes
- Not all changes are easily reversible (e.g., `DROP COLUMN`)
- For destructive operations, consider soft delete instead
- Many production systems require down migrations for safety
- Test down migrations in development environments

---

## Best Practices

### 1. **Split Complex Changes Into Multiple Migrations**

❌ Bad:
```sql
-- migrate_complex_refactor_v1.sql (all in one)
ALTER TABLE products ADD COLUMN id_v2 INT;
UPDATE products SET id_v2 = id;
ALTER TABLE orders MODIFY COLUMN product_id INT;
-- ... 100 more lines ...
DROP TABLE products_old;
```

✅ Good:
```sql
-- migrate_products_v1_add_id_v2.sql
ALTER TABLE products ADD COLUMN id_v2 INT;

-- migrate_products_v2_backfill_id.sql
UPDATE products SET id_v2 = id;

-- migrate_products_v3_update_references.sql
ALTER TABLE orders MODIFY COLUMN product_id INT;
-- ... etc ...

-- migrate_products_v4_cleanup.sql
DROP TABLE products_old;
```

### 2. **Remove Dependencies Before Adding Constraints**

```sql
-- ✅ Correct: Remove constraint violations FIRST
DELETE FROM orphaned_orders WHERE customer_id NOT IN (SELECT id FROM customers);
ALTER TABLE orders ADD FOREIGN KEY (customer_id) REFERENCES customers(id);

-- ❌ Wrong: Adding constraint that will fail
ALTER TABLE orders ADD FOREIGN KEY (customer_id) REFERENCES customers(id);
```

### 3. **Test Migrations on Production-Like Data**

```bash
# Clone production database to test environment
# Run migration in dry-run mode
php scripts/migrate.php up --dry-run

# Check row counts and data
SELECT COUNT(*) FROM table_name;
```

### 4. **Document Your Changes**

```sql
-- migrate_player_level_system_v1.sql
-- Adds support for player progression levels
--
-- Changes:
--   • Adds players.level column (default 1)
--   • Backfills level from experience points
--   • Adds composite index for level-based queries
--
-- Rollback: See migrate_player_level_system_v1_down.sql
-- Issue: #1234

ALTER TABLE players ADD COLUMN IF NOT EXISTS level INT UNSIGNED NOT NULL DEFAULT 1;
UPDATE players SET level = (experience_points / 1000) + 1;
ALTER TABLE players ADD INDEX idx_level_created (level, created_at);
```

### 5. **Make Migrations Idempotent**

```sql
-- ✅ Safe: Can run multiple times
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login DATETIME NULL;
INSERT IGNORE INTO settings (key, value) VALUES ('feature_x', 'enabled');

-- ❌ Unsafe: Second run will fail
ALTER TABLE users ADD COLUMN last_login DATETIME NULL;
INSERT INTO settings (key, value) VALUES ('feature_x', 'enabled');
```

### 6. **Use Descriptive Names**

```
✅ migrate_players_add_level_system_v1.sql
✅ migrate_economy_backfill_prices_v2.sql
❌ migrate_fix_v1.sql
❌ migration_123.sql
```

### 7. **Handle Large Tables Carefully**

For tables with millions of rows:
- Update `ALGORITHM=INPLACE, LOCK=NONE` (MySQL 5.6+)
- Test execution time on replica
- Run during low-traffic hours
- Monitor disk space and replication lag

```sql
-- Example: Large table, minimal locking
ALTER TABLE huge_table
    ADD COLUMN new_col INT,
    ALGORITHM=INPLACE,
    LOCK=NONE;
```

### 8. **Verify Data Integrity After Changes**

```sql
-- After a complex migration, verify constraints:
SELECT COUNT(*) as orphaned
FROM orders
WHERE customer_id NOT IN (SELECT id FROM customers);

SELECT COUNT(*) as invalid_status
FROM orders
WHERE status NOT IN ('pending', 'shipped', 'delivered');
```

---

## Common Pitfalls and Solutions

| Problem | Solution |
|---------|----------|
| Migration fails; table in inconsistent state | Entire migration rolls back automatically; DB stays clean |
| Forgot to test with production data volume | Use `--dry-run` mode; check execution time on replica |
| Added constraint that conflicts with existing data | Remove/fix conflicting data BEFORE adding constraint |
| Column added but application still expects old name | Add migration for column rename; update app code first |
| Migration too large; risks table locking | Split into multiple smaller migrations by feature |
| Realized migration was wrong; need to roll back | Run `php scripts/migrate.php rollback` (if down file exists) |
| Performance degraded after adding index | Check if index is being used; drop if not needed |
| Foreign key cycle created (A→B→A) | Remove one direction or add intermediary table |

---

## Reference Files

- **Example ALTER migrations:** `sql/migrate_alter_examples_v1.sql`
- **Example Data manipulation:** `sql/migrate_data_manipulation_patterns_v1.sql`
- **Migration runner:** `lib/MigrationRunner.php`
- **Migration CLI:** `scripts/migrate.php`
- **Migration tracking table:** `sql/schema_migrations.sql`
- **Main documentation:** `docs/technical/DATABASE_MIGRATIONS.md`

---

## Further Reading

### MySQL Documentation
- [ALTER TABLE Syntax](https://dev.mysql.com/doc/refman/8.0/en/alter-table.html)
- [Data Type Reference](https://dev.mysql.com/doc/refman/8.0/en/data-types.html)
- [Index Types](https://dev.mysql.com/doc/refman/8.0/en/index-types.html)

### Best Practices
- **Online Schema Changes:** Consider Percona Toolkit's `pt-online-schema-change` for zero-downtime migrations on large tables
- **Backup Strategy:** Always maintain recent backups before applying production migrations
- **Testing:** Run migrations on a production-like copy before deploying

---

## Development Workflow

### Step 1: Design the Change
- Identify what schema/data needs to change
- Sketch out the migration SQL
- Determine rollback strategy

### Step 2: Implement the Migration
```bash
# Create forward migration
# sql/migrate_feature_name_vN.sql

# Create down migration (if reversible)
# sql/migrate_feature_name_vN_down.sql

# Add to manifest (if not reference/example)
# config/migrations_manifest.php
```

### Step 3: Test Locally
```bash
# View pending migrations
php scripts/migrate.php status

# Run with dry-run
php scripts/migrate.php up --dry-run

# Apply one migration
php scripts/migrate.php up --step=1

# Test rollback
php scripts/migrate.php rollback --dry-run
php scripts/migrate.php rollback
```

### Step 4: Test on Production Copy
```bash
# Clone production DB to test env
# Run migration in test environment
# Verify data integrity
# Check for performance issues
```

### Step 5: Deploy to Production
```bash
# Backup production DB
# Review migration dry-run one more time
GQ_ENV=PROD php scripts/migrate.php up
# Verify application works correctly
```

---

## Summary

Database migrations are a critical part of maintaining database consistency as your application evolves. The patterns and best practices in this guide will help you write safe, reversible, well-documented migrations that can be confidently deployed to production environments.

Key takeaways:
1. **Separate structural and data changes** into multiple focused migrations
2. **Always provide a rollback** strategy
3. **Test thoroughly** before production deployment
4. **Document your intentions** in migration comments
5. **Use idempotent patterns** to allow re-runs
6. **Verify data integrity** after complex changes
