<?php
/**
 * Plugin Name: GalaxyQuest Game News
 * Description: Publishes explicit game summaries and flight targets through the WordPress REST API.
 * Version: 1.0.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

function gq_game_news_register_meta(): void
{
    $canEditPost = static function ($allowed, $metaKey, $postId): bool {
        return current_user_can('edit_post', (int)$postId);
    };

    register_post_meta('post', 'gq_summary', [
        'type' => 'string',
        'single' => true,
        'show_in_rest' => [
            'schema' => [
                'type' => 'string',
                'context' => ['view', 'edit'],
                'maxLength' => 3000,
            ],
        ],
        'sanitize_callback' => 'sanitize_textarea_field',
        'auth_callback' => $canEditPost,
    ]);
    register_post_meta('post', 'gq_target_faction_code', [
        'type' => 'string',
        'single' => true,
        'show_in_rest' => [
            'schema' => [
                'type' => 'string',
                'context' => ['view', 'edit'],
                'maxLength' => 32,
                'pattern' => '^[a-z0-9][a-z0-9_-]{0,31}$',
            ],
        ],
        'sanitize_callback' => 'sanitize_key',
        'auth_callback' => $canEditPost,
    ]);
}
add_action('init', 'gq_game_news_register_meta');

function gq_game_news_add_meta_box(): void
{
    add_meta_box(
        'gq-game-news',
        __('GalaxyQuest-Nachricht', 'gq-game-news'),
        'gq_game_news_render_meta_box',
        'post',
        'normal',
        'high'
    );
}
add_action('add_meta_boxes_post', 'gq_game_news_add_meta_box');

function gq_game_news_render_meta_box(WP_Post $post): void
{
    wp_nonce_field('gq_game_news_save', 'gq_game_news_nonce');
    $summary = get_post_meta($post->ID, 'gq_summary', true);
    $target = get_post_meta($post->ID, 'gq_target_faction_code', true);
    ?>
    <p>
        <label for="gq_summary"><strong><?php esc_html_e('Spiel-Kurzfassung', 'gq-game-news'); ?></strong></label>
        <textarea id="gq_summary" name="gq_summary" rows="5" maxlength="3000" class="widefat"><?php
            echo esc_textarea(is_string($summary) ? $summary : '');
        ?></textarea>
        <span><?php esc_html_e('Pflicht für veröffentlichte Beiträge mit dem Tag „game-start“. Reiner Text, max. 3.000 Zeichen.', 'gq-game-news'); ?></span>
    </p>
    <p>
        <label for="gq_target_faction_code"><strong><?php esc_html_e('Flugziel-Fraktionscode (optional)', 'gq-game-news'); ?></strong></label>
        <input id="gq_target_faction_code" name="gq_target_faction_code" type="text" maxlength="32"
            pattern="[a-z0-9][a-z0-9_-]{0,31}" class="regular-text"
            value="<?php echo esc_attr(is_string($target) ? $target : ''); ?>">
    </p>
    <?php
}

function gq_game_news_validation_error($summary, $target): ?string
{
    if (
        !is_string($summary)
        || trim($summary) === ''
        || strip_tags($summary) !== $summary
        || mb_strlen($summary, 'UTF-8') > 3000
    ) {
        return __('Die Spiel-Kurzfassung muss reiner Text mit 1 bis 3.000 Zeichen sein.', 'gq-game-news');
    }
    if (
        !is_string($target)
        || ($target !== '' && !preg_match('/^[a-z0-9][a-z0-9_-]{0,31}$/D', $target))
    ) {
        return __('Der Fraktionscode des Flugziels ist ungültig.', 'gq-game-news');
    }
    return null;
}

function gq_game_news_post_has_start_tag(int $postId, $requestedTags = null): bool
{
    if ($requestedTags === null) {
        return $postId > 0 && has_tag('game-start', $postId);
    }
    if (is_string($requestedTags)) {
        $requestedTags = explode(',', $requestedTags);
    }
    if (!is_array($requestedTags)) {
        return false;
    }

    $term = get_term_by('slug', 'game-start', 'post_tag');
    if (!$term instanceof WP_Term) {
        return false;
    }
    foreach ($requestedTags as $requestedTag) {
        if (is_int($requestedTag) || (is_string($requestedTag) && ctype_digit($requestedTag))) {
            if ((int)$requestedTag === $term->term_id) {
                return true;
            }
        } elseif (is_string($requestedTag) && sanitize_title(trim($requestedTag)) === 'game-start') {
            return true;
        }
    }
    return false;
}

function gq_game_news_validate_admin_publish($data, $postarr): array
{
    if (
        ($data['post_type'] ?? '') !== 'post'
        || ($data['post_status'] ?? '') !== 'publish'
        || (defined('REST_REQUEST') && REST_REQUEST)
        || !gq_game_news_post_has_start_tag(
            (int)($postarr['ID'] ?? 0),
            $_POST['tax_input']['post_tag'] ?? null
        )
    ) {
        return $data;
    }

    $summary = isset($_POST['gq_summary']) && is_string($_POST['gq_summary'])
        ? wp_unslash($_POST['gq_summary'])
        : get_post_meta((int)($postarr['ID'] ?? 0), 'gq_summary', true);
    $target = isset($_POST['gq_target_faction_code']) && is_string($_POST['gq_target_faction_code'])
        ? wp_unslash($_POST['gq_target_faction_code'])
        : get_post_meta((int)($postarr['ID'] ?? 0), 'gq_target_faction_code', true);
    $error = gq_game_news_validation_error($summary, $target);
    if ($error !== null) {
        wp_die(esc_html($error), esc_html__('Beitrag nicht veröffentlicht', 'gq-game-news'), [
            'response' => 400,
            'back_link' => true,
        ]);
    }
    return $data;
}
add_filter('wp_insert_post_data', 'gq_game_news_validate_admin_publish', 10, 2);

function gq_game_news_save_meta(int $postId): void
{
    if (
        !isset($_POST['gq_game_news_nonce'])
        || !is_string($_POST['gq_game_news_nonce'])
        || !wp_verify_nonce(wp_unslash($_POST['gq_game_news_nonce']), 'gq_game_news_save')
        || (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE)
        || !current_user_can('edit_post', $postId)
    ) {
        return;
    }

    if (isset($_POST['gq_summary']) && is_string($_POST['gq_summary'])) {
        update_post_meta($postId, 'gq_summary', sanitize_textarea_field(wp_unslash($_POST['gq_summary'])));
    }
    if (isset($_POST['gq_target_faction_code']) && is_string($_POST['gq_target_faction_code'])) {
        update_post_meta($postId, 'gq_target_faction_code', sanitize_key(wp_unslash($_POST['gq_target_faction_code'])));
    }
}
add_action('save_post_post', 'gq_game_news_save_meta');

function gq_game_news_validate_rest_publish($preparedPost, WP_REST_Request $request)
{
    if (is_wp_error($preparedPost) || ($request['status'] ?? $preparedPost->post_status) !== 'publish') {
        return $preparedPost;
    }

    $postId = (int)($preparedPost->ID ?? 0);
    if (!gq_game_news_post_has_start_tag($postId, $request->get_param('tags'))) {
        return $preparedPost;
    }
    $meta = $request->get_param('meta');
    $summary = is_array($meta) && array_key_exists('gq_summary', $meta)
        ? $meta['gq_summary']
        : get_post_meta($postId, 'gq_summary', true);
    $target = is_array($meta) && array_key_exists('gq_target_faction_code', $meta)
        ? $meta['gq_target_faction_code']
        : get_post_meta($postId, 'gq_target_faction_code', true);
    $error = gq_game_news_validation_error($summary, $target);
    return $error === null
        ? $preparedPost
        : new WP_Error('gq_game_news_invalid', $error, ['status' => 400]);
}
add_filter('rest_pre_insert_post', 'gq_game_news_validate_rest_publish', 10, 2);
