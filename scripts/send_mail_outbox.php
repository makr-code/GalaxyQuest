#!/usr/bin/env php
<?php

declare(strict_types=1);

// Manually flush due mail_outbox rows (the hourly global tick does this too).
// Usage: php scripts/send_mail_outbox.php [--batch=N]

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "This script must be run from the CLI.\n");
    exit(1);
}

$repoRoot = dirname(__DIR__);
require_once $repoRoot . '/config/config.php';
require_once $repoRoot . '/config/db.php';
require_once $repoRoot . '/lib/Mailer.php';
require_once $repoRoot . '/lib/mail_outbox.php';

$batch = (int)MAIL_OUTBOX_BATCH;
foreach (array_slice($argv ?? [], 1) as $argument) {
    if (preg_match('/^--batch=([1-9][0-9]{0,4})$/D', $argument, $match)) {
        $batch = (int)$match[1];
        continue;
    }
    fwrite(STDERR, "Usage: php scripts/send_mail_outbox.php [--batch=N]\n");
    exit(1);
}

try {
    $db = get_db();
} catch (PDOException $error) {
    fwrite(STDERR, '[mail_outbox] DB connection failed: ' . $error->getMessage() . PHP_EOL);
    exit(1);
}

$transport = mailer_default_transport();
if ($transport === null) {
    fwrite(STDERR, "[mail_outbox] no mail transport configured (SMTP_* or REGISTRATION_MAILPIT_URL); "
        . "due mails are skipped.\n");
}
$result = mail_outbox_flush($db, time(), max(1, $batch), max(1, (int)MAIL_OUTBOX_MAX_ATTEMPTS), $transport);
echo json_encode($result, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . PHP_EOL;
exit(0);
