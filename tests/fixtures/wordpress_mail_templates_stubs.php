<?php

declare(strict_types=1);

require_once __DIR__ . '/wordpress_game_news_stubs.php';

class WP_Post
{
    public function __construct(
        public int $ID = 42,
        public string $post_type = 'gq_mail_template',
        public string $post_status = 'publish',
        public string $post_title = 'Hallo &amp; willkommen',
        public string $post_content = '<p>Willkommen!</p>',
        public int $post_author = 99,
    ) {
    }
}

class WP_REST_Response
{
    public array $headers = [];

    public function __construct(public array $data)
    {
    }

    public function header(string $name, string $value): void
    {
        $this->headers[$name] = $value;
    }
}

function register_post_type(string $name, array $args): void
{
    $GLOBALS['gq_mail_test_post_types'][$name] = $args;
}

function register_rest_route(string $namespace, string $route, array $args): void
{
    $GLOBALS['gq_mail_test_routes'][$namespace . $route] = $args;
}

function is_user_logged_in(): bool
{
    return $GLOBALS['gq_mail_test_authenticated'] ?? false;
}

function current_user_can(string $capability, int $postId): bool
{
    $GLOBALS['gq_mail_test_capability_checks'][] = [$capability, $postId];
    return $GLOBALS['gq_mail_test_editable'][$postId] ?? false;
}

function get_post(int $postId): ?WP_Post
{
    return $GLOBALS['gq_mail_test_posts'][$postId] ?? null;
}

function wp_strip_all_tags(string $text): string
{
    return strip_tags(preg_replace('@<(script|style)[^>]*?>.*?</\\1>@si', '', $text) ?? '');
}

function wp_json_encode(mixed $value): string|false
{
    return json_encode($value);
}

function esc_html(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

function apply_filters(string $hook, mixed $value, mixed ...$args): mixed
{
    $GLOBALS['gq_mail_test_filter_calls'][] = $hook;
    return $value;
}

// Contract tests observe the sanitizer boundary. The real-KSES test loads core
// before this fixture, exercising sanitization without booting/installing WP.
if (!function_exists('wp_kses')) {
    function wp_kses(string $content, array $allowed, array $protocols): string
    {
        $GLOBALS['gq_mail_test_kses_calls'][] = [$content, $allowed, $protocols];
        return $GLOBALS['gq_mail_test_sanitized_html'] ?? $content;
    }
}

function do_shortcode(string $content): string
{
    throw new LogicException('Shortcodes must never execute');
}

function do_blocks(string $content): string
{
    throw new LogicException('Blocks must never execute');
}

function wp_mail(mixed ...$args): bool
{
    throw new LogicException('Mail must never be sent by this plugin');
}
