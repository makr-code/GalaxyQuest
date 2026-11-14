<?php

declare(strict_types=1);

define('ABSPATH', __DIR__);

class WP_Term
{
    public int $term_id = 7;
}

class WP_Error
{
    public function __construct(public string $code, public string $message, public array $data)
    {
    }
    public function get_error_message(): string
    {
        return $this->message;
    }
}

class WP_REST_Request implements ArrayAccess
{
    public function __construct(private array $values)
    {
    }
    public function get_param($key): mixed
    {
        return $this->values[$key] ?? null;
    }
    public function offsetExists(mixed $offset): bool
    {
        return isset($this->values[$offset]);
    }
    public function offsetGet(mixed $offset): mixed
    {
        return $this->values[$offset] ?? null;
    }
    public function offsetSet(mixed $offset, mixed $value): void
    {
        throw new LogicException('Not supported');
    }
    public function offsetUnset(mixed $offset): void
    {
        throw new LogicException('Not supported');
    }
}

function add_action(...$args): void
{
    $GLOBALS['gq_news_test_actions'][$args[0]][] = $args[1];
}
function add_filter(...$args): void
{
    $GLOBALS['gq_news_test_filters'][$args[0]][] = $args[1];
}
function is_wp_error($value): bool
{
    return $value instanceof WP_Error;
}
function get_term_by($field, $value, $taxonomy): WP_Term
{
    return new WP_Term();
}
function get_post_meta($postId, $key, $single): mixed
{
    return $postId === 0 ? false : '';
}
function __($text, $domain): string
{
    return $text;
}
function wp_verify_nonce($nonce, $action): bool
{
    return $nonce === 'valid';
}
function wp_unslash($value): mixed
{
    return $value;
}
function esc_html__($text, $domain): string
{
    return $text;
}
function wp_die($message, $title, $args): void
{
    throw new RuntimeException($message);
}
