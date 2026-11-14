<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit(1);
}

require_once __DIR__ . '/../config/config.php';
require_once __DIR__ . '/../config/db.php';
require_once __DIR__ . '/../lib/WordPressNewsPublisher.php';
require_once __DIR__ . '/../lib/WordPressTemplateMail.php';

$options = getopt('', ['user:', 'template:', 'key:']);
$userId = filter_var($options['user'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$templateId = filter_var($options['template'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
$key = $options['key'] ?? null;
if ($userId === false || $templateId === false || !is_string($key)
    || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $key)) {
    fwrite(STDERR, "Usage: php scripts/queue_wordpress_mail.php --user=ID --template=ID --key=EVENT_KEY\n");
    exit(1);
}
try {
    $publisher = new WordPressNewsPublisher(BLOG_WORDPRESS_REST_URL, BLOG_WORDPRESS_USER, BLOG_WORDPRESS_APP_PASSWORD);
    $created = mail_template_enqueue(get_db(), $userId, $publisher->mailTemplate($templateId), $key, time());
    echo $created ? "Mailauftrag angelegt.\n" : "Mailauftrag existiert bereits.\n";
} catch (InvalidArgumentException | RuntimeException | PDOException $error) {
    fwrite(STDERR, "Mailauftrag fehlgeschlagen: " . $error->getMessage() . "\n");
    exit(1);
}
