# Database Migration Quick Reference

Quick snippets for common migration patterns. For detailed documentation, see [ALTER_MIGRATIONS_GUIDE.md](./ALTER_MIGRATIONS_GUIDE.md).

---

## Creating New Migrations

### File Naming
```
migrate_<feature>_v<N>.sql       — Forward migration
migrate_<feature>_v<N>_down.sql  — Rollback (optional)
```

### Manifest
Add your migration to `config/migrations_manifest.php`:
```php
return [
    // ... existing migrations ...
    'migrate_my_feature_v1.sql',  // <- Add new migrations here at the END
];
```

### CLI Commands
```bash
# Show status
php scripts/migrate.php status

# Apply all pending (dry-run first!)
php scripts/migrate.php up --dry-run
php scripts/migrate.php up

# Apply only next 3
php scripts/migrate.php up --step=3

# Rollback last migration
php scripts/migrate.php rollback
```

---

## Common Patterns

### ✅ Adding a Column

```sql
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS new_field VARCHAR(100) NOT NULL DEFAULT ''
        AFTER existing_field;
```

### ✅ Adding a Column with Backfill

```sql
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS rank VARCHAR(32) NOT NULL DEFAULT 'novice'
        AFTER status;

UPDATE players
SET rank = CASE
    WHEN elo_rating > 2000 THEN 'grandmaster'
    WHEN elo_rating > 1600 THEN 'expert'
    WHEN elo_rating > 1200 THEN 'advanced'
    ELSE 'novice'
END
WHERE rank = 'novice' AND elo_rating > 0;
```

### ✅ Removing a Column

```sql
ALTER TABLE users
    DROP COLUMN IF EXISTS deprecated_field;
```

### ✅ Renaming a Column (MySQL 8.0.14+)

```sql
ALTER TABLE users
    RENAME COLUMN old_name TO new_name;
```

### ✅ Changing Column Type

```sql
ALTER TABLE products
    MODIFY COLUMN price DECIMAL(12, 4) NOT NULL;
```

### ✅ Adding an Index

```sql
ALTER TABLE orders
    ADD INDEX idx_customer_date (customer_id, created_at);
```

### ✅ Adding a Composite Unique Index

```sql
ALTER TABLE user_preferences
    ADD UNIQUE KEY uq_user_pref (user_id, preference_name);
```

### ✅ Removing an Index

```sql
ALTER TABLE users
    DROP INDEX idx_old_index;
```

### ✅ Making a Column NOT NULL

```sql
-- Step 1: Backfill NULLs first
UPDATE products
SET status = 'inactive'
WHERE status IS NULL;

-- Step 2: Add the NOT NULL constraint
ALTER TABLE products
    MODIFY COLUMN status VARCHAR(32) NOT NULL;
```

### ✅ Adding a Foreign Key (Safe)

```sql
-- Step 1: Remove rows that would violate the constraint
DELETE FROM orders
WHERE customer_id NOT IN (
    SELECT id FROM customers WHERE is_active = 1
);

-- Step 2: Add the foreign key
ALTER TABLE orders
    ADD CONSTRAINT fk_orders_customer
        FOREIGN KEY (customer_id) REFERENCES customers(id)
        ON DELETE RESTRICT;
```

---

## Data Manipulation

### ✅ Bulk Insert from Another Table

```sql
INSERT INTO archive (id, name, created_at)
SELECT id, name, created_at
FROM records
WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

### ✅ Bulk Insert with Ignore Duplicates

```sql
INSERT IGNORE INTO settings (key, value)
VALUES
    ('theme', 'dark'),
    ('language', 'en'),
    ('notifications', 'enabled');
```

### ✅ Update with Conditional Logic

```sql
UPDATE employees
SET department = CASE
    WHEN salary > 100000 THEN 'executive'
    WHEN salary > 50000 THEN 'management'
    ELSE 'staff'
END
WHERE department IS NULL;
```

### ✅ Update from Related Table

```sql
UPDATE orders
SET customer_name = (
    SELECT name FROM customers
    WHERE customers.id = orders.customer_id
)
WHERE customer_name IS NULL;
```

### ✅ Delete Duplicates (Keep Oldest)

```sql
DELETE FROM sessions
WHERE id NOT IN (
    SELECT MIN(id)
    FROM sessions
    GROUP BY user_id, session_hash
);
```

### ✅ Soft Delete (Mark as Deleted)

```sql
UPDATE users
SET is_deleted = 1,
    deleted_at = CURRENT_TIMESTAMP
WHERE id IN (
    SELECT id FROM banned_users
);
```

### ✅ Clean Up Invalid Data

```sql
-- Normalize values
UPDATE status_log
SET status = 'completed'
WHERE status IN ('done', 'finished', 'complete');

-- Remove whitespace
UPDATE profiles
SET bio = TRIM(bio)
WHERE bio LIKE ' %' OR bio LIKE '% ';
```

### ✅ Backfill Calculated Data

```sql
UPDATE players
SET total_score = (
    SELECT SUM(points)
    FROM player_scores
    WHERE player_scores.player_id = players.id
)
WHERE total_score IS NULL OR total_score = 0;
```

---

## Best Practices Checklist

- [ ] **Use IF NOT EXISTS** for idempotent migrations
- [ ] **Provide DEFAULT values** when adding columns to existing rows
- [ ] **Remove constraint violations** BEFORE adding new constraints
- [ ] **Test with --dry-run** before applying to production
- [ ] **Create _down.sql** companion for reversibility
- [ ] **Add comments** explaining the change and WHY
- [ ] **Split complex changes** into multiple migrations
- [ ] **Keep migrations focused** — one logical feature per migration
- [ ] **Test on production-like data** before deploying
- [ ] **Backup the database** before running migrations

---

## Migration Template

```sql
-- migrate_my_feature_v1.sql
-- Describe what this migration does and why.
-- 
-- Changes:
--   • Adds columns
--   • Updates data
--   • Adds indexes
--
-- Issue: #1234
-- See also: docs/technical/ALTER_MIGRATIONS_GUIDE.md

USE galaxyquest;

-- ─────────────────────────────────────────────────────────
-- SCHEMA CHANGES
-- ─────────────────────────────────────────────────────────

ALTER TABLE my_table
    ADD COLUMN IF NOT EXISTS new_column VARCHAR(100) NOT NULL DEFAULT '';

-- ─────────────────────────────────────────────────────────
-- DATA BACKFILL
-- ─────────────────────────────────────────────────────────

UPDATE my_table
SET new_column = COALESCE(old_column, 'default')
WHERE new_column = '';

-- ─────────────────────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────────────────────

ALTER TABLE my_table
    ADD INDEX idx_new_column (new_column);
```

---

## Troubleshooting

### Migration Failed: What Happened?

The entire migration rolled back automatically. The database is unchanged.

**Next steps:**
1. Review the error message carefully
2. Fix the SQL (syntax, data conflicts, etc.)
3. Test with `--dry-run` again
4. Re-apply with `php scripts/migrate.php up`

### Can't Roll Back: No _down.sql File

If a migration has no down file, rollback is skipped (tracked as `no_down_file`).

**Solutions:**
1. Manually restore from backup if needed
2. Create and apply a new forward migration to undo the change
3. Add the _down.sql file and re-run `rollback`

### Migration Locked the Table for Too Long

On large tables, ALTER TABLE can lock the entire table.

**Solutions:**
1. Use MySQL 8.0 `ALGORITHM=INPLACE, LOCK=NONE` where possible
2. Run migrations during low-traffic hours
3. Test on a replica first to measure lock time
4. Consider Percona Toolkit `pt-online-schema-change`

### Lost Data During Migration

If data was deleted/modified:
1. Restore from backup
2. Review what went wrong
3. Fix the migration
4. Re-test thoroughly
5. Re-apply

---

## Related Documentation

- [ALTER_MIGRATIONS_GUIDE.md](./ALTER_MIGRATIONS_GUIDE.md) — Complete patterns and best practices
- [DATABASE_MIGRATIONS.md](./DATABASE_MIGRATIONS.md) — Main migration documentation
- `sql/migrate_alter_examples_v1.sql` — 15 ALTER examples
- `sql/migrate_data_manipulation_patterns_v1.sql` — 15 data manipulation examples

---

## Common Gotchas

| Gotcha | Fix |
|--------|-----|
| Added NOT NULL column without DEFAULT | All existing rows will fail; provide a DEFAULT |
| Changed column type; data lost precision | Test with production data volume first |
| Added UNIQUE constraint; duplicates exist | Delete/deduplicate rows BEFORE adding constraint |
| Added FK constraint; orphaned rows exist | Remove orphans BEFORE adding the constraint |
| Migration runs twice; fails second time | Make migrations idempotent with IF NOT EXISTS |
| Forgot to create _down.sql; can't rollback | Create it manually; run rollback again |
| Large table migration locked DB | Split into smaller migrations; use ALGORITHM=INPLACE |

