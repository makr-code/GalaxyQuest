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
    register_post_meta('post', 'gq_event_date', [
        'type' => 'string',
        'single' => true,
        'show_in_rest' => true,
        'auth_callback' => $canEditPost,
    ]);
    register_post_meta('post', 'gq_event_origin', [
        'type' => 'string',
        'single' => true,
        'show_in_rest' => true,
        'auth_callback' => $canEditPost,
    ]);
    register_post_meta('post', 'gq_is_correction', [
        'type' => 'boolean',
        'single' => true,
        'show_in_rest' => true,
        'auth_callback' => $canEditPost,
    ]);
}
add_action('init', 'gq_game_news_register_meta');

/**
 * Mail templates are editorial documents, never public posts. "publish" is
 * internal approval only; the custom authenticated endpoint is their only API.
 */
function gq_mail_templates_register_post_type(): void
{
    register_post_type('gq_mail_template', [
        'labels' => [
            'name' => __('Mailvorlagen', 'gq-game-news'),
            'singular_name' => __('Mailvorlage', 'gq-game-news'),
            'add_new_item' => __('Mailvorlage hinzufügen', 'gq-game-news'),
            'edit_item' => __('Mailvorlage bearbeiten (Titel = Betreff)', 'gq-game-news'),
        ],
        'description' => __('Veröffentlichen gibt die Vorlage nur intern für GalaxyQuest frei.', 'gq-game-news'),
        'public' => false,
        'publicly_queryable' => false,
        'exclude_from_search' => true,
        'show_ui' => true,
        'show_in_menu' => true,
        'show_in_rest' => false,
        'show_in_nav_menus' => false,
        'has_archive' => false,
        'rewrite' => false,
        'query_var' => false,
        'supports' => ['title', 'editor', 'revisions'],
        'capability_type' => 'post',
        'map_meta_cap' => true,
    ]);
}
add_action('init', 'gq_mail_templates_register_post_type');

function gq_mail_templates_subject(string $title): string|WP_Error
{
    $decoded = html_entity_decode($title, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $subject = trim(wp_strip_all_tags($decoded));
    if (strpbrk($title, "\r\n") !== false || strpbrk($decoded, "\r\n") !== false
        || preg_match('/&#(?:0*(?:10|13)(?:;|(?=[^0-9]|$))|x0*[ad](?:;|(?=[^0-9a-f]|$)))/i', $title)
        || $subject === '') {
        return new WP_Error('gq_invalid_mail_subject', 'Der Betreff muss nichtleer und ohne CR/LF sein.', [
            'status' => 400,
        ]);
    }
    return $subject;
}

function gq_mail_templates_validate_approval($data, $postarr): array
{
    if (($data['post_type'] ?? '') === 'gq_mail_template' && ($data['post_status'] ?? '') === 'publish') {
        $subject = gq_mail_templates_subject(wp_unslash((string)($data['post_title'] ?? '')));
        if (is_wp_error($subject)) {
            wp_die(esc_html($subject->get_error_message()), '', ['response' => 400, 'back_link' => true]);
        }
    }
    return $data;
}
add_filter('wp_insert_post_data', 'gq_mail_templates_validate_approval', 10, 2);

function gq_mail_templates_safe_html(string $content): string
{
    $allowed = [
        'a' => ['href' => true, 'title' => true],
        'img' => ['src' => true, 'alt' => true, 'title' => true, 'width' => true, 'height' => true],
        'table' => ['width' => true, 'border' => true, 'cellpadding' => true, 'cellspacing' => true,
            'align' => true, 'bgcolor' => true],
        'thead' => [], 'tbody' => [], 'tfoot' => [], 'caption' => [],
        'tr' => ['align' => true, 'valign' => true, 'bgcolor' => true],
        'td' => ['colspan' => true, 'rowspan' => true, 'width' => true, 'height' => true,
            'align' => true, 'valign' => true, 'bgcolor' => true],
        'th' => ['colspan' => true, 'rowspan' => true, 'scope' => true, 'align' => true, 'valign' => true],
    ];
    foreach (['p', 'br', 'div', 'span', 'strong', 'em', 'b', 'i', 'u', 's', 'h1', 'h2', 'h3',
        'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code'] as $tag) {
        $allowed[$tag] = [];
    }
    // Export stored HTML only: no the_content, shortcode, or block rendering.
    $content = preg_replace('/<!--\s*\/?wp:.*?-->/s', '', $content) ?? '';
    return wp_kses($content, $allowed, ['https', 'http', 'mailto', 'cid']);
}

function gq_mail_templates_register_rest_route(): void
{
    register_rest_route('gq/v1', '/mail-templates/(?P<id>[1-9][0-9]*)', [
        'methods' => 'GET',
        'permission_callback' => 'gq_mail_templates_permissions',
        'callback' => 'gq_mail_templates_get',
        'args' => ['id' => ['type' => 'integer', 'required' => true, 'minimum' => 1]],
    ]);
}
add_action('rest_api_init', 'gq_mail_templates_register_rest_route');

function gq_mail_templates_permissions(WP_REST_Request $request): bool|WP_Error
{
    if (!is_user_logged_in()) {
        return new WP_Error('gq_mail_authentication_required', 'Authentifizierung erforderlich.', ['status' => 401]);
    }
    $post = get_post((int)$request['id']);
    if (!$post instanceof WP_Post || $post->post_type !== 'gq_mail_template') {
        return new WP_Error('gq_mail_template_not_found', 'Mailvorlage nicht verfügbar.', ['status' => 404]);
    }
    if (!current_user_can('edit_post', $post->ID)) {
        return new WP_Error('gq_mail_template_forbidden', 'Keine Berechtigung für diese Mailvorlage.', ['status' => 403]);
    }
    return true;
}

/**
 * GET /gq/v1/mail-templates/{id}: exactly {id, revision, subject, html}.
 * revision = SHA-256(wp_json_encode(["subject" => subject, "html" => html])).
 * No WordPress user/recipient data, rendering, or sending is involved.
 */
function gq_mail_templates_get(WP_REST_Request $request): WP_REST_Response|WP_Error
{
    $permission = gq_mail_templates_permissions($request);
    if (is_wp_error($permission)) {
        return $permission;
    }
    $post = get_post((int)$request['id']);
    if (!$post instanceof WP_Post || $post->post_type !== 'gq_mail_template' || $post->post_status !== 'publish') {
        return new WP_Error('gq_mail_template_not_found', 'Mailvorlage nicht verfügbar.', ['status' => 404]);
    }
    $subject = gq_mail_templates_subject($post->post_title);
    if (is_wp_error($subject)) {
        return $subject;
    }
    $html = gq_mail_templates_safe_html($post->post_content);
    $encoded = wp_json_encode(['subject' => $subject, 'html' => $html]);
    if ($encoded === false) {
        return new WP_Error('gq_mail_template_encoding_failed', 'Mailvorlage kann nicht kodiert werden.', ['status' => 500]);
    }
    $response = new WP_REST_Response([
        'id' => (int)$post->ID,
        'revision' => hash('sha256', $encoded),
        'subject' => $subject,
        'html' => $html,
    ]);
    $response->header('Cache-Control', 'private, no-store');
    return $response;
}

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
    $eventDate = get_post_meta($post->ID, 'gq_event_date', true);
    $origin = get_post_meta($post->ID, 'gq_event_origin', true);
    $correction = get_post_meta($post->ID, 'gq_is_correction', true);
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
    <p>
        <label for="gq_event_date"><strong><?php esc_html_e('Ereignisdatum (UTC, optional)', 'gq-game-news'); ?></strong></label>
        <input id="gq_event_date" name="gq_event_date" type="date"
            value="<?php echo esc_attr(is_string($eventDate) ? $eventDate : ''); ?>">
        <span><?php esc_html_e('Mit game-start und Ereignisdatum erscheint der Beitrag in der Chronik.', 'gq-game-news'); ?></span>
    </p>
    <p>
        <label for="gq_event_origin"><strong><?php esc_html_e('Herkunft', 'gq-game-news'); ?></strong></label>
        <select id="gq_event_origin" name="gq_event_origin">
            <option value="editorial" <?php selected($origin, 'editorial'); ?>>Redaktion / Lore</option>
            <option value="game-event" <?php selected($origin, 'game-event'); ?>>Spielereignis</option>
        </select>
    </p>
    <p>
        <input type="hidden" name="gq_is_correction" value="0">
        <label><input type="checkbox" name="gq_is_correction" value="1" <?php checked((bool)$correction); ?>>
            <?php esc_html_e('Als Korrektur kennzeichnen', 'gq-game-news'); ?></label>
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

function gq_game_news_valid_event_date(string $value): bool
{
    if ($value === '') {
        return true;
    }
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, new DateTimeZone('UTC'));
    return $date !== false && $date->format('Y-m-d') === $value && substr($value, 0, 4) !== '0000';
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
    if (isset($_POST['gq_game_news_nonce']) && is_string($_POST['gq_game_news_nonce'])
        && wp_verify_nonce(wp_unslash($_POST['gq_game_news_nonce']), 'gq_game_news_save')
        && (array_key_exists('gq_event_date', $_POST) || array_key_exists('gq_event_origin', $_POST))) {
        $date = $_POST['gq_event_date'] ?? null;
        $origin = $_POST['gq_event_origin'] ?? null;
        if (!is_string($date) || !is_string($origin)
            || !gq_game_news_valid_event_date(wp_unslash($date))
            || !in_array(wp_unslash($origin), ['editorial', 'game-event'], true)) {
            wp_die(esc_html__('Ungültiges Ereignisdatum oder Herkunft.', 'gq-game-news'), '', ['response' => 400]);
        }
    }
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

    if (isset($_POST['gq_event_date'], $_POST['gq_event_origin'])
        && is_string($_POST['gq_event_date']) && is_string($_POST['gq_event_origin'])) {
        $date = wp_unslash($_POST['gq_event_date']);
        $origin = wp_unslash($_POST['gq_event_origin']);
        if (!gq_game_news_valid_event_date($date) || !in_array($origin, ['editorial', 'game-event'], true)) {
            wp_die(esc_html__('Ungültiges Ereignisdatum oder Herkunft.', 'gq-game-news'), '', ['response' => 400]);
        }
    }

    if (isset($_POST['gq_summary']) && is_string($_POST['gq_summary'])) {
        update_post_meta($postId, 'gq_summary', sanitize_textarea_field(wp_unslash($_POST['gq_summary'])));
    }
    if (isset($_POST['gq_target_faction_code']) && is_string($_POST['gq_target_faction_code'])) {
        update_post_meta($postId, 'gq_target_faction_code', sanitize_key(wp_unslash($_POST['gq_target_faction_code'])));
    }
    if (isset($date, $origin)) {
        update_post_meta($postId, 'gq_event_date', $date);
        update_post_meta($postId, 'gq_event_origin', $origin);
    }
    if (isset($_POST['gq_is_correction']) && in_array($_POST['gq_is_correction'], ['0', '1'], true)) {
        update_post_meta($postId, 'gq_is_correction', $_POST['gq_is_correction'] === '1');
    }
}
add_action('save_post_post', 'gq_game_news_save_meta');

function gq_game_news_validate_rest_publish($preparedPost, WP_REST_Request $request)
{
    if (is_wp_error($preparedPost)) {
        return $preparedPost;
    }
    $meta = $request->get_param('meta');
    if (is_array($meta)) {
        if (array_key_exists('gq_event_date', $meta)
            && (!is_string($meta['gq_event_date']) || !gq_game_news_valid_event_date($meta['gq_event_date']))) {
            return new WP_Error('gq_invalid_event_date', 'Ungültiges Ereignisdatum.', ['status' => 400]);
        }
        if (array_key_exists('gq_event_origin', $meta)
            && (!is_string($meta['gq_event_origin'])
                || !in_array($meta['gq_event_origin'], ['', 'editorial', 'game-event'], true))) {
            return new WP_Error('gq_invalid_event_origin', 'Ungültige Herkunft.', ['status' => 400]);
        }
    }
    if (($request['status'] ?? $preparedPost->post_status) !== 'publish') {
        return $preparedPost;
    }

    $postId = (int)($preparedPost->ID ?? 0);
    if (!gq_game_news_post_has_start_tag($postId, $request->get_param('tags'))) {
        return $preparedPost;
    }
    $summary = is_array($meta) && array_key_exists('gq_summary', $meta)
        ? $meta['gq_summary']
        : ($postId > 0 ? get_post_meta($postId, 'gq_summary', true) : '');
    $target = is_array($meta) && array_key_exists('gq_target_faction_code', $meta)
        ? $meta['gq_target_faction_code']
        : ($postId > 0 ? get_post_meta($postId, 'gq_target_faction_code', true) : '');
    $error = gq_game_news_validation_error($summary, $target);
    return $error === null
        ? $preparedPost
        : new WP_Error('gq_game_news_invalid', $error, ['status' => 400]);
}
add_filter('rest_pre_insert_post', 'gq_game_news_validate_rest_publish', 10, 2);

function gq_game_news_register_chronology(): void
{
    register_rest_route('gq/v1', '/chronology', [
        'methods' => 'GET',
        'permission_callback' => '__return_true',
        'callback' => 'gq_game_news_chronology',
        'args' => [
            'page' => ['type' => 'integer', 'default' => 1, 'minimum' => 1, 'maximum' => 9999],
            'topic' => ['type' => 'string', 'default' => '', 'enum' => [
                '', 'galaxiegeschichte', 'spielentwicklung', 'diplomatie',
            ]],
            'from' => ['type' => 'string', 'default' => ''],
            'to' => ['type' => 'string', 'default' => ''],
            'order' => ['type' => 'string', 'default' => 'desc', 'enum' => ['desc', 'asc']],
        ],
    ]);
}
add_action('rest_api_init', 'gq_game_news_register_chronology');

function gq_game_news_chronology(WP_REST_Request $request)
{
    $from = $request['from'];
    $to = $request['to'];
    if (!gq_game_news_valid_event_date($from) || !gq_game_news_valid_event_date($to)
        || ($from !== '' && $to !== '' && $from > $to)) {
        return new WP_Error('gq_invalid_date_range', 'Ungültiger Zeitraum.', ['status' => 400]);
    }

    $dateFilter = ['key' => 'gq_event_date', 'value' => '', 'compare' => '>', 'type' => 'CHAR'];
    if ($from !== '' && $to !== '') {
        $dateFilter = ['key' => 'gq_event_date', 'value' => [$from, $to], 'compare' => 'BETWEEN', 'type' => 'CHAR'];
    } elseif ($from !== '' || $to !== '') {
        $dateFilter = ['key' => 'gq_event_date', 'value' => $from !== '' ? $from : $to,
            'compare' => $from !== '' ? '>=' : '<=', 'type' => 'CHAR'];
    }
    $args = [
        'post_type' => 'post',
        'post_status' => 'publish',
        'has_password' => false,
        'tag' => 'game-start',
        'meta_key' => 'gq_event_date',
        'meta_query' => ['relation' => 'AND',
            ['key' => 'gq_event_date', 'value' => '', 'compare' => '>', 'type' => 'CHAR'], $dateFilter],
        'orderby' => $request['order'] === 'asc'
            ? ['meta_value' => 'ASC', 'ID' => 'ASC']
            : ['meta_value' => 'DESC', 'ID' => 'DESC'],
        'posts_per_page' => 11,
        'offset' => ($request['page'] - 1) * 10,
        'no_found_rows' => true,
        'ignore_sticky_posts' => true,
    ];
    if ($request['topic'] !== '') {
        $args['category_name'] = $request['topic'];
    }
    $query = new WP_Query($args);
    $posts = [];
    foreach (array_slice($query->posts, 0, 10) as $post) {
        $date = get_post_meta($post->ID, 'gq_event_date', true);
        $origin = get_post_meta($post->ID, 'gq_event_origin', true);
        $summary = get_post_meta($post->ID, 'gq_summary', true);
        $terms = wp_get_post_terms($post->ID, 'category', ['fields' => 'slugs']);
        if (is_wp_error($terms) || !is_string($date) || $date === '' || !gq_game_news_valid_event_date($date)
            || !is_string($origin) || !in_array($origin, ['', 'editorial', 'game-event'], true)
            || gq_game_news_validation_error($summary, '') !== null) {
            return new WP_Error('gq_invalid_chronology_post', 'Ungültiger Chronikbeitrag.', ['status' => 500]);
        }
        $posts[] = [
            'id' => $post->ID,
            'title' => mb_substr(html_entity_decode(
                wp_strip_all_tags(get_the_title($post)), ENT_QUOTES | ENT_HTML5, 'UTF-8'
            ), 0, 160),
            'summary' => trim($summary),
            'event_date' => $date,
            'origin' => $origin === '' ? 'editorial' : $origin,
            'is_correction' => (bool)get_post_meta($post->ID, 'gq_is_correction', true),
            'published_at' => get_post_time('Y-m-d\TH:i:s', true, $post),
            'categories' => array_map(static fn(string $term): string => mb_substr($term, 0, 32),
                array_slice($terms, 0, 5)),
            'url' => get_permalink($post),
        ];
    }
    return ['posts' => $posts, 'has_more' => count($query->posts) > 10];
}
