import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Dedicated disposable fixtures only. Nothing connects to the configured Plesk host.
const suffix = randomBytes(8).toString('hex');
const network = `gq-native-db-${suffix}`;
const database = `${network}-mariadb`;
const image = `${network}-php:fixture`;
const root = mkdtempSync(path.join(os.tmpdir(), 'gq-native-db-'));
const password = randomBytes(24).toString('hex');
const restorePassword = randomBytes(24).toString('hex');
const env = { ...process.env, DB_PASS: password, MYSQL_PWD: password };
let networkCreated = false;
let dbCreated = false;
let imageCreated = false;

function docker(args, options = {}) {
  return execFileSync('docker', args, {
    env, encoding: 'utf8', timeout: 900000, maxBuffer: 8 * 1024 * 1024, ...options,
  });
}
function admin(sql) {
  return docker(['exec', '-i', database, 'sh', '-ec',
    'MYSQL_PWD="$MARIADB_ROOT_PASSWORD" exec mariadb -uroot --batch --skip-column-names'],
  { input: sql });
}
function php(args, dbName = 'gq_staging', dbUser = 'gq_staging', dbPassword = password) {
  return docker(['run', '--rm', '--network', network, '-e', 'APP_ENV=production',
    '-e', 'DB_HOST=db', '-e', 'DB_NAME=' + dbName, '-e', 'DB_USER=' + dbUser,
    '-e', 'DB_PASS', '--mount', `type=bind,source=${process.cwd()},target=/app,readonly`,
    '-w', '/app', image, 'php', ...args], { env: { ...env, DB_PASS: dbPassword } });
}
function client(user, passwordForUser, sql, dbName) {
  return docker(['exec', '-i', '-e', 'MYSQL_PWD', database, 'mariadb',
    '--protocol=TCP', '-h', '127.0.0.1', '-u', user, '--batch', '--skip-column-names', dbName],
  { env: { ...env, MYSQL_PWD: passwordForUser }, input: sql });
}
function cleanup(args) {
  const result = spawnSync('docker', args, { env, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) throw new Error(`Docker cleanup failed: ${result.stderr}`);
}

try {
  writeFileSync(path.join(root, 'Dockerfile'),
    'FROM php:8.4-cli\nRUN docker-php-ext-install pdo_mysql\n');
  docker(['build', '--tag', image, root]);
  imageCreated = true;
  docker(['network', 'create', network]);
  networkCreated = true;
  docker(['run', '-d', '--name', database, '--network', network, '--network-alias', 'db',
    '-e', 'MARIADB_ROOT_PASSWORD', 'mariadb:11.8.6'], {
    env: { ...env, MARIADB_ROOT_PASSWORD: password },
  });
  dbCreated = true;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = spawnSync('docker', ['exec', database, 'healthcheck.sh', '--connect', '--innodb_initialized'],
      { env, encoding: 'utf8', timeout: 10000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.ok(ready, 'Disposable MariaDB did not become ready');
  const version = admin('SELECT VERSION();').trim();
  assert.match(version, /^11\.8\.6-MariaDB/);
  admin(`
    CREATE DATABASE gq_staging CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE DATABASE gq_production CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE DATABASE gq_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE DATABASE galaxyquest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE TABLE gq_production.sentinel (value INT NOT NULL);
    INSERT INTO gq_production.sentinel VALUES (101);
    CREATE TABLE galaxyquest.sentinel (value INT NOT NULL);
    INSERT INTO galaxyquest.sentinel VALUES (202);
    CREATE USER 'gq_staging'@'%' IDENTIFIED BY '${password}';
    GRANT ALL PRIVILEGES ON gq_staging.* TO 'gq_staging'@'%';
    CREATE USER 'gq_restore'@'%' IDENTIFIED BY '${restorePassword}';
    GRANT ALL PRIVILEGES ON gq_restore.* TO 'gq_restore'@'%';
    CREATE USER 'gq_engine_reader'@'%' IDENTIFIED BY '${password}';
  `);
  const schemaCheck = `
    require 'config/db.php';
    require 'lib/MigrationRunner.php';
    require 'lib/NativeBaseSchema.php';
    $db = get_db();
    if ($db->query('SELECT DATABASE()')->fetchColumn() !== 'gq_staging') { throw new RuntimeException('Unexpected fixture database'); }
    $runner = new MigrationRunner($db, __DIR__ . '/sql', 'TEST');
    $sql = file_get_contents('sql/schema.sql');
    if ($sql === false) { throw new RuntimeException('Missing schema'); }
    $statements = GalaxyQuest\\Deployment\\NativeBaseSchema::statements($runner, $sql);
    foreach ($statements as $statement) { $db->exec($statement); }
    echo count($statements), " schema statements applied\\n";
  `;
  const phpVersion = php(['-r', 'echo PHP_VERSION;']).trim();
  assert.match(phpVersion, /^8\.4\./);
  const inspection = ['scripts/native_db_inspect.php', '--database=gq_staging', '--user=gq_staging'];
  const before = JSON.parse(php(inspection));
  assert.equal(before.database, 'gq_staging');
  assert.equal(before.empty_visible, true);
  assert.deepEqual(before.visible_objects, { tables_and_views: 0, routines: 0, events: 0, triggers: 0 });
  assert.deepEqual(before.visible_base_table_engines, []);
  assert.throws(() => php(['scripts/native_db_inspect.php', '--database=gq_production', '--user=gq_staging']));
  assert.throws(() => php(['scripts/native_db_inspect.php', '--database=gq_staging', '--user=gq_restore']));
  admin(`
    CREATE TABLE gq_staging.fixture_engine_innodb (id INT) ENGINE=InnoDB;
    CREATE TABLE gq_staging.fixture_engine_myisam (id INT) ENGINE=MyISAM;
    CREATE VIEW gq_staging.fixture_engine_view AS SELECT id FROM gq_staging.fixture_engine_innodb;
    GRANT SELECT ON gq_staging.fixture_engine_innodb TO 'gq_engine_reader'@'%';
  `);
  const mixed = JSON.parse(php(inspection));
  assert.deepEqual(mixed.visible_base_table_engines, [
    { engine: 'InnoDB', table_count: 1 },
    { engine: 'MyISAM', table_count: 1 },
  ]);
  assert.equal(mixed.visible_objects.tables_and_views, 3);
  const partial = JSON.parse(php(
    ['scripts/native_db_inspect.php', '--database=gq_staging', '--user=gq_engine_reader'],
    'gq_staging', 'gq_engine_reader'
  ));
  assert.deepEqual(partial.visible_base_table_engines, [{ engine: 'InnoDB', table_count: 1 }]);
  assert.equal(partial.visible_objects.tables_and_views, 1);
  admin(`
    DROP VIEW gq_staging.fixture_engine_view;
    DROP TABLE gq_staging.fixture_engine_innodb, gq_staging.fixture_engine_myisam;
  `);
  console.log(php(['-r', schemaCheck]));
  const after = JSON.parse(php(inspection));
  assert.equal(after.empty_visible, false);
  assert.ok(after.visible_objects.tables_and_views > 0);
  console.log(php(['scripts/migrate.php', 'up', '--env=TEST']));
  console.log(php(['scripts/migrate.php', 'verify', '--env=TEST']));
  console.log(php(['scripts/migrate.php', 'up', '--env=TEST']));
  console.log(php(['setup.php', '--skip-migrations', '--skip-bootstrap', '--skip-npc-seed']));
  console.log(php(['-r', `
    require 'config/db.php';
    $db = get_db();
    $db->query('SELECT \`returning\`, mission FROM fleets WHERE id=0 FOR UPDATE')->fetchAll();
    $db->query('SELECT f.\`returning\` FROM fleets f WHERE f.\`returning\`=0')->fetchAll();
    $row = $db->query('SELECT SUM(\`returning\` = 1) AS \`returning\` FROM fleets')->fetch();
    if (!array_key_exists('returning', $row)) { throw new RuntimeException('Unexpected fleet alias'); }
    $db->exec('UPDATE fleets SET \`returning\`=1 WHERE id=0 AND \`returning\`=0');
    echo "Fleet SQL accepted\\n";
  `]));
  assert.equal(admin('SELECT value FROM gq_production.sentinel; SELECT value FROM galaxyquest.sentinel;').trim(), '101\n202');
  const denial = spawnSync('docker', ['run', '--rm', '--network', network,
    '-e', 'APP_ENV=production', '-e', 'DB_HOST=db', '-e', 'DB_NAME=gq_production',
    '-e', 'DB_USER=gq_staging', '-e', 'DB_PASS',
    '--mount', `type=bind,source=${process.cwd()},target=/app,readonly`, '-w', '/app', image,
    'php', 'scripts/migrate.php', 'verify', '--env=TEST'],
  { env, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(denial.status, 0, 'Staging credentials must not access production');
  assert.match(denial.stderr + denial.stdout, /access denied/i);

  const dump = docker(['exec', '-e', 'MYSQL_PWD', database, 'mariadb-dump',
    '--protocol=TCP', '-h', '127.0.0.1', '-u', 'gq_staging', '--single-transaction',
    '--routines', '--events', '--triggers', '--hex-blob', '--skip-dump-date',
    '--no-create-db', 'gq_staging'], { maxBuffer: 64 * 1024 * 1024 });
  assert.match(dump, /CREATE TABLE `schema_migrations`/);
  assert.doesNotMatch(dump, /^\s*(?:USE\s|CREATE\s+DATABASE\b)/im, 'Dump must not select or create a database');
  const restoreEmpty = client('gq_restore', restorePassword,
    'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE();', 'gq_restore').trim();
  assert.equal(restoreEmpty, '0', 'Restore fixture must be empty');
  client('gq_restore', restorePassword, dump, 'gq_restore');
  const tableNames = (name, user, key) => client(user, key,
    'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\' ORDER BY TABLE_NAME;',
    name).trim().split('\n');
  const sourceTables = tableNames('gq_staging', 'gq_staging', password);
  assert.ok(sourceTables.length > 0, 'Backup must contain tables');
  assert.deepEqual(tableNames('gq_restore', 'gq_restore', restorePassword), sourceTables);
  const checks = sourceTables.map((name) => {
    assert.match(name, /^[A-Za-z0-9_]+$/, 'Unexpected fixture table identifier');
    return `CHECK TABLE \`${name}\`;`;
  }).join('\n');
  const checked = client('gq_restore', restorePassword, checks, 'gq_restore').trim().split('\n');
  assert.equal(checked.length, sourceTables.length);
  assert.ok(checked.every((line) => {
    const fields = line.split('\t');
    return fields.length === 4 && fields[2] === 'status' && fields[3] === 'OK';
  }), 'Restored table integrity check failed');
  const historySql = 'SELECT migration_name, checksum, environment FROM schema_migrations ORDER BY migration_name;';
  assert.equal(client('gq_restore', restorePassword, historySql, 'gq_restore'),
    client('gq_staging', password, historySql, 'gq_staging'), 'Restored migration history differs');
  const countsSql = sourceTables.map((name) => `SELECT '${name}', COUNT(*) FROM \`${name}\``).join(' UNION ALL ') + ';';
  assert.equal(client('gq_restore', restorePassword, countsSql, 'gq_restore'),
    client('gq_staging', password, countsSql, 'gq_staging'), 'Restored table row counts differ');
  console.log(php(['scripts/migrate.php', 'verify', '--env=TEST'], 'gq_restore', 'gq_restore', restorePassword));
  assert.equal(admin('SELECT value FROM gq_production.sentinel; SELECT value FROM galaxyquest.sentinel;').trim(), '101\n202');
  console.log(`Native database fixture passed on MariaDB ${version}, PHP ${phpVersion}: migrations, seeds, fleet SQL, isolation and scoped restore.`);
} finally {
  try {
    if (dbCreated) cleanup(['rm', '-f', '-v', database]);
  } finally {
    try {
      if (networkCreated) cleanup(['network', 'rm', network]);
    } finally {
      try {
        if (imageCreated) cleanup(['image', 'rm', image]);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
}
