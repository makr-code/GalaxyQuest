# GalaxyQuest Database ALTER Migrations & Data Manipulation

This document summarizes the new comprehensive migration resources that have been added to support ALTER TABLE operations and data manipulation patterns.

## 📋 Problem Statement

**Original Request (German):**
> "Wir müssen auch Datenbank ALTER Migrationen Skripte vorsehen, bzw. Daten manipulieren vorsehen."

**Translation:**
> "We need to provide database ALTER migration scripts, i.e., provide for data manipulation."

## ✅ Solution Provided

A complete suite of documentation, examples, and templates for database migrations that include:
- ALTER TABLE operations (adding, modifying, removing columns)
- Index management (creating, dropping indexes)
- Constraint management (foreign keys, unique constraints)
- Data backfilling and transformation
- Data cleanup and validation
- Safe migration patterns and best practices

---

## 📁 New Files Added

### Documentation Files (in `docs/technical/`)

#### 1. **ALTER_MIGRATIONS_GUIDE.md** (16 KB)
Comprehensive guide covering all aspects of ALTER TABLE migrations and data manipulation.

**Contents:**
- Pattern 1: Adding new columns
- Pattern 2: Modifying existing columns
- Pattern 3: Managing indexes
- Pattern 4: Removing columns
- Pattern 5: Foreign key constraints
- Pattern 6: Data backfilling
- Pattern 7: Data cleanup and validation
- Pattern 8: Data migration (normalization/denormalization)
- Pattern 9: JSON columns (MySQL 5.7+)
- Pattern 10: Handling transactions and rollback
- Best practices checklist
- Common pitfalls and solutions
- Development workflow

**Use this when:** You need detailed explanations and examples of how to write specific types of ALTER migrations.

---

#### 2. **MIGRATION_QUICK_REFERENCE.md** (8.6 KB)
Quick lookup guide with common migration snippets and patterns.

**Contents:**
- File naming conventions
- CLI commands
- 12 common ALTER patterns (copy-paste ready)
- 8 common data manipulation patterns
- Best practices checklist
- Migration template
- Troubleshooting guide
- Common gotchas table

**Use this when:** You need quick syntax references or common pattern snippets.

---

### Example/Reference Files (in `sql/`)

#### 1. **migrate_alter_examples_v1.sql** (19 KB)
Reference migration with 15 detailed ALTER TABLE patterns.

**Patterns:**
1. Adding new columns with safe defaults
2. Backfilling data before adding constraints
3. Changing column types and constraints
4. Adding indexes for performance
5. Removing obsolete columns
6. Data cleanup (removing invalid/duplicate data)
7. Renaming columns (MySQL 8.0.14+)
8. Adding foreign key constraints safely
9. Making a column NOT NULL
10. Adding ENUM columns with new values
11. Changing default values
12. Complex data transformation
13. Batch operations for large tables
14. Adding JSON columns
15. Removing redundant data (normalization)

**Important Note:** This is a REFERENCE migration for documentation/learning only. Do NOT apply to production. Each pattern includes detailed comments explaining best practices, when to use it, and important caveats.

---

#### 2. **migrate_data_manipulation_patterns_v1.sql** (22 KB)
Reference migration with 15 detailed data manipulation patterns.

**Patterns:**
1. Bulk INSERT with IGNORE (safe insert)
2. Conditional UPDATE statements
3. Safe DELETE with referential integrity checks
4. Data validation and correction
5. Bulk data migration between tables
6. Creating audit trail entries
7. Backfilling calculated/derived data
8. Maintaining referential integrity
9. Deduplication
10. Time-based data archival
11. Conditional batch updates
12. Data transformation with string manipulation
13. Numeric transformations
14. Ensuring data consistency
15. Using temporary variables for complex logic

**Important Note:** Like the ALTER examples, this is a REFERENCE migration. Do NOT apply to production. It demonstrates patterns that can be incorporated into your actual migrations.

---

#### 3. **MIGRATION_TEMPLATE.sql** (8.8 KB)
Template for creating new production migrations.

**Sections:**
- Migration metadata (description, issue number, author, etc.)
- Phase 1: DDL Changes
- Phase 2: Data Validation & Cleanup
- Phase 3: Data Backfill
- Phase 4: Constraint Additions
- Phase 5: Index Creation
- Phase 6: Cleanup & Validation
- Testing instructions
- Verification queries

**Use this:** As a starting point when creating a new production migration. Copy it, rename it, and fill in your specific SQL.

---

## 🚀 Quick Start

### For Learning Migration Patterns

1. **Start with:** `docs/technical/MIGRATION_QUICK_REFERENCE.md`
   - Get familiar with common patterns
   - Copy-paste snippets for your use case

2. **For details:** `docs/technical/ALTER_MIGRATIONS_GUIDE.md`
   - Understand best practices and why patterns matter
   - Learn about performance considerations
   - See common pitfalls and solutions

3. **For examples:** 
   - `sql/migrate_alter_examples_v1.sql` (for schema changes)
   - `sql/migrate_data_manipulation_patterns_v1.sql` (for data changes)
   - Browse the detailed comments in each pattern

---

### For Writing a New Migration

1. **Copy the template:**
   ```bash
   cp sql/MIGRATION_TEMPLATE.sql sql/migrate_my_feature_v1.sql
   ```

2. **Edit the file:**
   - Replace UPPERCASE placeholders with your values
   - Delete unused sections
   - Fill in the six phases (DDL → Validation → Backfill → Constraints → Indexes → Cleanup)

3. **Test with dry-run:**
   ```bash
   php scripts/migrate.php status
   php scripts/migrate.php up --dry-run
   ```

4. **Add to manifest:**
   - Edit `config/migrations_manifest.php`
   - Append your migration filename to the END of the array

5. **Create rollback (optional):**
   - Create `sql/migrate_my_feature_v1_down.sql` with undo SQL
   - Ensures migration can be rolled back if needed

6. **Test locally, then production:**
   - Test on a production-like copy first
   - Use `GQ_ENV=PROD php scripts/migrate.php up`

---

## 📚 Documentation Map

```
docs/technical/
├── DATABASE_MIGRATIONS.md           ← Main migration docs (updated with links)
├── ALTER_MIGRATIONS_GUIDE.md        ← Detailed patterns & best practices
└── MIGRATION_QUICK_REFERENCE.md     ← Quick lookup snippets

sql/
├── migrate_alter_examples_v1.sql           ← 15 ALTER patterns (reference only)
├── migrate_data_manipulation_patterns_v1.sql ← 15 data manipulation patterns (reference only)
├── MIGRATION_TEMPLATE.sql                   ← Template for new migrations
└── schema_migrations.sql                    ← Migration tracking table DDL
```

---

## 🎯 Use Cases

### Scenario 1: "I need to add a new column and backfill it"
1. Check: `MIGRATION_QUICK_REFERENCE.md` → "Adding a Column with Backfill"
2. Deep dive: `ALTER_MIGRATIONS_GUIDE.md` → "Pattern 1" & "Pattern 6"
3. Example: `migrate_alter_examples_v1.sql` → Pattern 1 & 2
4. Create: Use `MIGRATION_TEMPLATE.sql` as starting point

### Scenario 2: "How do I safely add a foreign key constraint?"
1. Quick ref: `MIGRATION_QUICK_REFERENCE.md` → "Adding a Foreign Key (Safe)"
2. Details: `ALTER_MIGRATIONS_GUIDE.md` → "Pattern 5: Foreign Key Constraints"
3. Example: `migrate_alter_examples_v1.sql` → Pattern 8
4. See also: `migrate_data_manipulation_patterns_v1.sql` → Pattern 8

### Scenario 3: "I need to migrate data from one table to another"
1. Quick ref: `MIGRATION_QUICK_REFERENCE.md` → "Bulk Insert from Another Table"
2. Details: `ALTER_MIGRATIONS_GUIDE.md` → "Pattern 8: Data Migration"
3. Examples: `migrate_data_manipulation_patterns_v1.sql` → Patterns 1, 5
4. Template: `MIGRATION_TEMPLATE.sql` → Phase 3: Data Backfill

### Scenario 4: "I need to clean up invalid data before adding a constraint"
1. Quick ref: `MIGRATION_QUICK_REFERENCE.md` → "Clean Up Invalid Data"
2. Details: `ALTER_MIGRATIONS_GUIDE.md` → "Pattern 7: Data Cleanup"
3. Examples: `migrate_data_manipulation_patterns_v1.sql` → Patterns 3, 4
4. Template: `MIGRATION_TEMPLATE.sql` → Phase 2: Data Validation & Cleanup

---

## ⚠️ Important Notes

### Reference vs. Production Migrations

**DO NOT apply these migrations to production:**
- `sql/migrate_alter_examples_v1.sql`
- `sql/migrate_data_manipulation_patterns_v1.sql`

These are **REFERENCE** migrations for learning and documentation only. They exist to show patterns and best practices, not to be deployed. They reference tables that may not exist in your schema, and the data they manipulate is just for example purposes.

### Creating Your Own Migrations

When creating production migrations:
1. **Split by feature:** One logical feature per migration file
2. **Keep it focused:** Don't mix unrelated schema + data changes
3. **Follow the template:** Use `MIGRATION_TEMPLATE.sql` as a starting point
4. **Test thoroughly:** Use `--dry-run` and test on production data copies
5. **Create rollback:** Always create `*_down.sql` for reversibility
6. **Document well:** Explain WHY in migration comments, not just WHAT

---

## 🔗 Related Files

- `lib/MigrationRunner.php` — Core migration execution engine
- `scripts/migrate.php` — CLI tool for applying/rolling back migrations
- `config/migrations_manifest.php` — Canonical list of all migrations
- `sql/schema_migrations.sql` — Tracking table for applied migrations

---

## 📖 Learning Path

### For New Developers
1. Read: `docs/technical/DATABASE_MIGRATIONS.md` (basics)
2. Read: `docs/technical/MIGRATION_QUICK_REFERENCE.md` (common patterns)
3. Browse: `sql/migrate_alter_examples_v1.sql` (see patterns in action)
4. Practice: Create your first migration using `MIGRATION_TEMPLATE.sql`

### For Advanced Users
1. Reference: `docs/technical/ALTER_MIGRATIONS_GUIDE.md` (deep dive)
2. Patterns: Review both reference migrations for complex scenarios
3. Optimization: Review "Performance Considerations" section in the guide
4. Tools: Consider Percona Toolkit for large table migrations

---

## ✨ Summary

This comprehensive suite of resources provides:

✅ **Documentation:** 2 detailed guides + 1 quick reference  
✅ **Examples:** 30 patterns across 2 reference migrations  
✅ **Templates:** Ready-to-use template for new migrations  
✅ **Best Practices:** Security, performance, and consistency patterns  
✅ **Troubleshooting:** Common gotchas and solutions  

All of this is designed to make it **easy and safe** to write database migrations that include:
- ALTER TABLE operations
- Data backfilling and transformation
- Validation and cleanup
- Proper constraint management
- Safe rollback strategies

---

## 🤔 Questions?

Refer to:
- **Quick answers:** `MIGRATION_QUICK_REFERENCE.md`
- **Detailed help:** `ALTER_MIGRATIONS_GUIDE.md`
- **Pattern examples:** `migrate_alter_examples_v1.sql`, `migrate_data_manipulation_patterns_v1.sql`
- **Getting started:** `MIGRATION_TEMPLATE.sql`
- **Original docs:** `DATABASE_MIGRATIONS.md`

---

**Last Updated:** 2026-07-31  
**Files Created:** 5 documentation/template files, 2 example migrations  
**Total Content:** ~80 KB of comprehensive migration guidance
