<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\TestCase;

#[RunTestsInSeparateProcesses]
#[PreserveGlobalState(false)]
final class WordPressMailTemplatesTest extends TestCase
{
    private function loadPlugin(): WP_REST_Request
    {
        require_once __DIR__ . '/../fixtures/wordpress_mail_templates_stubs.php';
        require_once __DIR__ . '/../../wordpress-integration/gq-game-news.php';
        $GLOBALS['gq_mail_test_posts'] = [42 => new WP_Post()];
        $GLOBALS['gq_mail_test_authenticated'] = true;
        $GLOBALS['gq_mail_test_editable'] = [42 => true];
        return new WP_REST_Request(['id' => 42]);
    }

    public function testAdminTypeAndCustomGetRouteHaveNoPublicExposure(): void
    {
        $this->loadPlugin();
        self::assertContains('gq_mail_templates_register_post_type', $GLOBALS['gq_news_test_actions']['init']);
        self::assertContains('gq_mail_templates_register_rest_route', $GLOBALS['gq_news_test_actions']['rest_api_init']);
        self::assertContains('gq_mail_templates_validate_approval', $GLOBALS['gq_news_test_filters']['wp_insert_post_data']);
        gq_mail_templates_register_post_type();
        $type = $GLOBALS['gq_mail_test_post_types']['gq_mail_template'];
        foreach (['public', 'publicly_queryable', 'show_in_rest', 'rewrite', 'query_var',
            'has_archive', 'show_in_nav_menus'] as $flag) {
            self::assertFalse($type[$flag], $flag);
        }
        self::assertTrue($type['show_ui']);
        self::assertTrue($type['exclude_from_search']);
        self::assertTrue($type['map_meta_cap']);
        self::assertSame(['title', 'editor', 'revisions'], $type['supports']);
        gq_mail_templates_register_rest_route();
        $route = $GLOBALS['gq_mail_test_routes']['gq/v1/mail-templates/(?P<id>[1-9][0-9]*)'];
        self::assertSame('GET', $route['methods']);
        self::assertSame('gq_mail_templates_permissions', $route['permission_callback']);
        self::assertSame('gq_mail_templates_get', $route['callback']);
        self::assertSame(['type' => 'integer', 'required' => true, 'minimum' => 1], $route['args']['id']);
    }

    public function testAnonymousAndUsersWithoutTheConcretePostPermissionAreDenied(): void
    {
        $request = $this->loadPlugin();
        $GLOBALS['gq_mail_test_authenticated'] = false;
        foreach (['gq_mail_templates_permissions', 'gq_mail_templates_get'] as $callback) {
            self::assertSame(401, $callback($request)->data['status']);
        }
        self::assertArrayNotHasKey('gq_mail_test_capability_checks', $GLOBALS);
        $GLOBALS['gq_mail_test_authenticated'] = true;
        $GLOBALS['gq_mail_test_editable'] = [43 => true];
        foreach (['gq_mail_templates_permissions', 'gq_mail_templates_get'] as $callback) {
            self::assertSame(403, $callback($request)->data['status']);
        }
        self::assertSame([['edit_post', 42], ['edit_post', 42]], $GLOBALS['gq_mail_test_capability_checks']);
    }

    public function testMissingAndOtherPostTypesAreNotMailTemplates(): void
    {
        $request = $this->loadPlugin();
        foreach (['post', 'page', 'revision'] as $type) {
            $GLOBALS['gq_mail_test_posts'][42]->post_type = $type;
            self::assertSame(404, gq_mail_templates_get($request)->data['status']);
        }
        unset($GLOBALS['gq_mail_test_posts'][42]);
        self::assertSame(404, gq_mail_templates_get($request)->data['status']);
    }

    public function testOnlyExplicitlyApprovedTemplatesAreReturned(): void
    {
        $request = $this->loadPlugin();
        foreach (['draft', 'pending', 'private', 'future', 'trash', 'auto-draft', 'inherit'] as $status) {
            $GLOBALS['gq_mail_test_posts'][42]->post_status = $status;
            self::assertSame(404, gq_mail_templates_get($request)->data['status'], $status);
        }
        $GLOBALS['gq_mail_test_posts'][42]->post_status = 'publish';
        self::assertInstanceOf(WP_REST_Response::class, gq_mail_templates_get($request));
    }

    public function testExactContractAndRevisionHashTheExportedSubjectAndHtmlOnly(): void
    {
        $request = $this->loadPlugin();
        $GLOBALS['gq_mail_test_sanitized_html'] = '<p>Sicher &amp; statisch.</p>';
        $response = gq_mail_templates_get($request);
        $expectedRevision = hash('sha256', json_encode([
            'subject' => 'Hallo & willkommen', 'html' => '<p>Sicher &amp; statisch.</p>',
        ]));
        self::assertSame([
            'id' => 42, 'revision' => $expectedRevision, 'subject' => 'Hallo & willkommen',
            'html' => '<p>Sicher &amp; statisch.</p>',
        ], $response->data);
        self::assertSame('private, no-store', $response->headers['Cache-Control']);
        $GLOBALS['gq_mail_test_posts'][42]->post_author = 123;
        self::assertSame($expectedRevision, gq_mail_templates_get($request)->data['revision']);
        $GLOBALS['gq_mail_test_posts'][42]->post_title = 'Anderer Betreff';
        $subjectRevision = gq_mail_templates_get($request)->data['revision'];
        self::assertNotSame($expectedRevision, $subjectRevision);
        $GLOBALS['gq_mail_test_sanitized_html'] = '<p>Anderer Inhalt.</p>';
        self::assertNotSame($subjectRevision, gq_mail_templates_get($request)->data['revision']);
    }

    public function testEmptyAndRawOrEncodedCrLfSubjectsCannotBeExportedOrApproved(): void
    {
        $request = $this->loadPlugin();
        foreach (['', '   ', '<b></b>', "\rBetreff", "Betreff\nBcc: x", 'Betreff&#13;Bcc: x',
            'Betreff&#x0a;Bcc: x', '<span title="&#10;">Betreff</span>'] as $title) {
            $GLOBALS['gq_mail_test_posts'][42]->post_title = $title;
            self::assertSame('gq_invalid_mail_subject', gq_mail_templates_get($request)->code);
            try {
                gq_mail_templates_validate_approval([
                    'post_type' => 'gq_mail_template', 'post_status' => 'publish', 'post_title' => $title,
                ], []);
                self::fail('Invalid subject was approved');
            } catch (RuntimeException $error) {
                self::assertStringContainsString('Betreff', $error->getMessage());
            }
        }
        $draft = ['post_type' => 'gq_mail_template', 'post_status' => 'draft', 'post_title' => ''];
        self::assertSame($draft, gq_mail_templates_validate_approval($draft, []));
        $valid = ['post_type' => 'gq_mail_template', 'post_status' => 'publish', 'post_title' => 'Willkommen'];
        self::assertSame($valid, gq_mail_templates_validate_approval($valid, []));
    }

    public function testStaticExportUsesExplicitMailAllowlistAndDoesNotRenderAnything(): void
    {
        $request = $this->loadPlugin();
        $GLOBALS['gq_mail_test_posts'][42]->post_content =
            '<!-- wp:dynamic/example {"secret":true} -->[secret_shortcode]<p>Statisch</p><!-- /wp:dynamic/example -->';
        self::assertSame('[secret_shortcode]<p>Statisch</p>', gq_mail_templates_get($request)->data['html']);
        [$content, $tags, $protocols] = $GLOBALS['gq_mail_test_kses_calls'][0];
        self::assertSame('[secret_shortcode]<p>Statisch</p>', $content);
        self::assertSame(['https', 'http', 'mailto', 'cid'], $protocols);
        self::assertArrayHasKey('table', $tags);
        self::assertArrayHasKey('href', $tags['a']);
        foreach (['script', 'style', 'iframe', 'form', 'input', 'object', 'svg'] as $tag) {
            self::assertArrayNotHasKey($tag, $tags);
        }
        foreach ($tags as $attributes) {
            foreach (array_keys($attributes) as $attribute) {
                self::assertFalse(str_starts_with($attribute, 'on'));
                self::assertNotSame('style', $attribute);
            }
        }
        self::assertArrayNotHasKey('gq_mail_test_filter_calls', $GLOBALS);
    }

    public function testRealWordPressKsesRemovesActiveHtmlAndKeepsMailMarkup(): void
    {
        $core = __DIR__ . '/../../wordpress/wp-includes/kses.php';
        if (!is_file($core)) {
            self::markTestSkipped('Local WordPress core is not present; no installation is created.');
        }
        global $html5_named_character_references;
        require_once dirname($core) . '/compat.php';
        $tokenMap = dirname($core) . '/class-wp-token-map.php';
        if (is_file($tokenMap)) {
            require_once $tokenMap;
        }
        foreach (['html5-named-character-references.php', 'class-wp-html-attribute-token.php',
            'class-wp-html-span.php', 'class-wp-html-doctype-info.php', 'class-wp-html-text-replacement.php',
            'class-wp-html-decoder.php', 'class-wp-html-tag-processor.php'] as $dependency) {
            $path = dirname($core) . '/html-api/' . $dependency;
            if (is_file($path)) {
                require_once $path;
            }
        }
        require_once $core;
        $request = $this->loadPlugin();
        $GLOBALS['gq_mail_test_posts'][42]->post_content =
            '<script>alert(1)</script><style>evil</style><iframe src="https://evil.test"></iframe>'
            . '<form><input value="secret"></form><svg onload="evil"></svg>'
            . '<p style="background:url(https://evil.test)" onclick="evil">Hallo <strong>Welt</strong></p>'
            . '<a href="javascript:alert(1)" onmouseover="evil">Link</a>'
            . '<img src="data:text/html,evil" onerror="evil" alt="Logo">'
            . '<table cellpadding="4"><tr><td colspan="2">Mail</td></tr></table>'
            . '<a href="https://example.test">HTTPS</a><a href="mailto:help@example.test">Mail</a>'
            . '<img src="cid:logo" alt="Logo"><!-- wp:dynamic/example -->[secret_shortcode]<!-- /wp:dynamic/example -->';
        $html = gq_mail_templates_get($request)->data['html'];
        foreach (['<script', '<style', '<iframe', '<form', '<input', '<svg', 'onclick', 'onmouseover',
            'onerror', 'style=', 'javascript:', 'data:', '<!-- wp:'] as $unsafe) {
            self::assertStringNotContainsString($unsafe, $html);
        }
        foreach (['<p>Hallo <strong>Welt</strong></p>', '<table cellpadding="4">',
            '<td colspan="2">Mail</td>', 'href="https://example.test"', 'href="mailto:help@example.test"',
            'src="cid:logo"', '[secret_shortcode]'] as $safe) {
            self::assertStringContainsString($safe, $html);
        }
        self::assertNotContains('the_content', $GLOBALS['gq_mail_test_filter_calls']);
    }
}
