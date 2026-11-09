<?php

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../lib/DeveloperBlogRepository.php';
require_once __DIR__ . '/../lib/WordPressBlogSource.php';

header('Cache-Control: no-store');
$action = $_GET['action'] ?? 'list';
$repository = new DeveloperBlogRepository(get_db());
$source = null;
if (!in_array(BLOG_SOURCE, ['local', 'wordpress', 'wordpress-simulation'], true)) {
    json_error('Ungültige Blogquelle.', 503);
}
if (BLOG_SOURCE === 'wordpress-simulation' && !app_is_development()) {
    json_error('Blogsimulation ist nur im Entwicklungsmodus verfügbar.', 503);
}
if (BLOG_SOURCE !== 'local') {
    try {
        $apiUrl = BLOG_SOURCE === 'wordpress-simulation'
            ? 'http://127.0.0.1:8080/api/wordpress_sim.php'
            : BLOG_WORDPRESS_REST_URL;
        $siteUrl = BLOG_SOURCE === 'wordpress-simulation'
            ? REGISTRATION_PUBLIC_URL
            : BLOG_WORDPRESS_SITE_URL;
        $source = new WordPressBlogSource(
            $apiUrl,
            $siteUrl
        );
    } catch (InvalidArgumentException $error) {
        error_log('[developer_blog] ' . $error->getMessage());
        json_error('Blogquelle ist nicht korrekt konfiguriert.', 503);
    }
}

if ($action === 'list') {
    only_method('GET');
    try {
        $targets = $repository->flightTargets();
        json_ok(['posts' => $source ? $source->latest($targets) : $repository->latest(), 'flight_targets' => $targets,
            'source' => BLOG_SOURCE, 'editor_url' => $source
                ? (BLOG_SOURCE === 'wordpress-simulation' ? 'api/wordpress_sim.php' : BLOG_WORDPRESS_SITE_URL)
                : 'developer-blog-admin.php']);
    } catch (RuntimeException $error) {
        error_log('[developer_blog] ' . $error->getMessage());
        json_error('Blog derzeit nicht verfügbar. Bitte erneut versuchen.', 503);
    }
}
if ($action === 'narration') {
    only_method('POST');
    verify_csrf();
    $body = get_json_body();
    try {
        $id = positive_int($body['id'] ?? null);
        $post = $source ? $source->published($id, $repository->flightTargets()) : $repository->published($id);
    } catch (RuntimeException $error) {
        error_log('[developer_blog_narration] ' . $error->getMessage());
        json_error('Blog derzeit nicht verfügbar. Vorlesen wurde nicht gestartet.', 503);
    }
    if ($post === null) {
        json_error('Beitrag nicht gefunden.', 404);
    }
    if (($body['revision'] ?? null) !== $post['revision']) {
        json_error('Beitrag wurde aktualisiert. Bitte Beiträge neu laden.', 409);
    }
    $chunks = DeveloperBlogRepository::speechChunks($post);
    $index = $body['chunk'] ?? null;
    if (!is_int($index) || !isset($chunks[$index])) {
        json_error('Ungültiger Sprachabschnitt.', 422);
    }
    require_once __DIR__ . '/tts_client.php';
    $result = tts_synthesise($chunks[$index], ['lang' => 'de']);
    if (!$result['ok']) {
        error_log('developer_blog_narration_failed id=' . $post['id'] . ' error=' . ($result['error'] ?? 'unknown'));
        json_error('Sprachausgabe derzeit nicht verfügbar.', 503);
    }
    json_ok(['audio_url' => $result['audio_url'], 'chunks' => count($chunks), 'chunk' => $index]);
}
if (!in_array($action, ['admin_list', 'save'], true)) {
    json_error('Unknown action.', 400);
}
only_method($action === 'save' ? 'POST' : 'GET');
$uid = require_auth();
if (!is_admin_user(get_db(), $uid)) {
    json_error('Admin access required.', 403);
}
if ($source !== null) {
    json_error('Externe Blogquelle aktiv. Beiträge bitte im führenden Blog bearbeiten.', 409);
}
if ($action === 'admin_list') {
    $page = min(100000, positive_int($_GET['page'] ?? null, 1));
    $posts = $repository->administration($page);
    json_ok(['posts' => array_slice($posts, 0, 20), 'has_more' => count($posts) > 20,
        'flight_targets' => $repository->flightTargets()]);
}
verify_csrf();
try {
    $input = get_json_body();
    $id = $repository->save($input, $uid);
    json_ok(['id' => $id, 'revision' => ($input['id'] ?? 0) === 0 ? 1 : $input['revision'] + 1]);
} catch (InvalidArgumentException $error) {
    json_error($error->getMessage(), 422);
} catch (OutOfBoundsException $error) {
    json_error($error->getMessage(), 404);
} catch (UnexpectedValueException $error) {
    json_error($error->getMessage(), 409);
}
