<?php
declare(strict_types=1);
require_once __DIR__ . '/helpers.php';
require_once __DIR__ . '/../lib/WordPressSimulation.php';

if (APP_ENV !== 'dev') json_error('Not found.', 404);
only_method('GET');
header('Cache-Control: no-store');
$fixture = json_decode(file_get_contents(__DIR__ . '/../config/wordpress_simulation.json'), true, 512, JSON_THROW_ON_ERROR);
$publicUrl = rtrim(REGISTRATION_PUBLIC_URL, '/') . '/api/wordpress_sim.php';
$simulation = new WordPressSimulation($fixture, $publicUrl);
try {
    if (isset($_GET['p']) || !isset($_GET['rest_route'])) {
        $posts = isset($_GET['p'])
            ? [$simulation->request('/wp/v2/posts/' . positive_int($_GET['p']), [])]
            : $simulation->request('/wp/v2/posts', ['per_page' => 100]);
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            . '<title>GalaxyQuest – WordPress-Simulation</title><body><main><h1>Entwicklerblog – lokale WordPress-Simulation</h1>'
            . '<p>Kein echtes WordPress. Nur Testinhalte, keine Konten oder Schreibzugriffe.</p>';
        foreach ($posts as $post) {
            echo '<article><h2><a href="?p=' . $post['id'] . '">' . $post['title']['rendered'] . '</a></h2>'
                . $post['content']['rendered'] . '</article>';
        }
        echo '</main></body></html>';
        exit;
    }
    if (!is_string($_GET['rest_route'])) throw new InvalidArgumentException('rest_route: String required.');
    $result = $simulation->request($_GET['rest_route'], $_GET, $pagination);
    header('Content-Type: application/json; charset=utf-8');
    if ($pagination !== null) {
        header('X-WP-Total: ' . $pagination['total']);
        header('X-WP-TotalPages: ' . $pagination['total_pages']);
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
} catch (InvalidArgumentException | RangeException $error) {
    http_response_code(400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['code' => $error instanceof RangeException ? 'rest_post_invalid_page_number' : 'rest_invalid_param',
        'message' => $error->getMessage(), 'data' => ['status' => 400]], JSON_THROW_ON_ERROR);
} catch (OutOfBoundsException $error) {
    http_response_code(404);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['code' => 'rest_post_invalid_id', 'message' => $error->getMessage(), 'data' => ['status' => 404]]);
}
