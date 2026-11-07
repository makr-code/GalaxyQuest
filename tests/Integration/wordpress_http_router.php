<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli-server') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../../lib/WordPressSimulation.php';

$fixture = getenv('GQ_WORDPRESS_HTTP_FIXTURE');
if ($fixture === false || $fixture === '') throw new RuntimeException('WordPress HTTP fixture is required.');
$state = json_decode(file_get_contents($fixture), true, 512, JSON_THROW_ON_ERROR);
header('Content-Type: application/json');
$path = (string)parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (preg_match('~^/(?:blog/)?wp-json(/wp/v2/.*)$~D', $path, $route)) {
    $_GET['rest_route'] = $route[1];
}
$mode = $state['mode'] ?? 'normal';
if ($mode === 'redirect') {
    header('Location: /redirect-target', true, 302);
    if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/redirect-target') {
        file_put_contents($fixture . '.redirected', 'followed');
        http_response_code(500);
        header_remove('Location');
    }
    echo '{}';
    return;
}
if ($mode === 'unavailable') {
    http_response_code(503);
    echo '{"code":"service_unavailable"}';
    return;
}
if ($mode === 'invalid-json') {
    echo '<html>Unavailable</html>';
    return;
}
if (in_array($mode, ['missing-route', 'html-404', 'empty-post'], true)
    && str_starts_with((string)($_GET['rest_route'] ?? ''), '/wp/v2/posts/')) {
    http_response_code($mode === 'empty-post' ? 200 : 404);
    echo match ($mode) {
        'missing-route' => '{"code":"rest_no_route","data":{"status":404}}',
        'html-404' => '<html>Page not found</html>',
        'empty-post' => '[]',
    };
    return;
}
if ($mode === 'slow') sleep(8);
if ($mode === 'sized-response') {
    echo '[]' . str_repeat(' ', $state['bytes'] - 2);
    return;
}
if ($mode === 'raw-post') {
    echo json_encode(str_contains((string)($_GET['rest_route'] ?? ''), '/tags')
        ? [['id' => 1, 'slug' => 'game-start']] : $state['post'], JSON_THROW_ON_ERROR);
    return;
}
$simulation = new WordPressSimulation($state['data'], 'http://' . $_SERVER['HTTP_HOST'] . '/blog',
    'http://' . $_SERVER['HTTP_HOST'] . '/index.php');
try {
    $result = $simulation->request((string)($_GET['rest_route'] ?? ''), $_GET, $pagination);
    if ($pagination !== null) {
        header('X-WP-Total: ' . $pagination['total']);
        header('X-WP-TotalPages: ' . $pagination['total_pages']);
    }
    echo json_encode($result, JSON_THROW_ON_ERROR);
} catch (InvalidArgumentException | RangeException $error) {
    http_response_code(400);
    echo json_encode(['code' => $error instanceof RangeException ? 'rest_post_invalid_page_number' : 'rest_invalid_param',
        'message' => $error->getMessage(), 'data' => ['status' => 400]], JSON_THROW_ON_ERROR);
} catch (OutOfBoundsException $error) {
    http_response_code(404);
    echo json_encode(['code' => 'rest_post_invalid_id', 'message' => $error->getMessage()], JSON_THROW_ON_ERROR);
}
