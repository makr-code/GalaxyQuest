<?php

declare(strict_types=1);

namespace GalaxyQuest\WordPress;

use WP_Error;
use ZipArchive;

/* phpcs:disable PSR1.Files.SideEffects.FoundWithSymbols -- Each independent plugin bundles the same compatible engine. */
// Bump the class revision for engine changes: independently updated plugins may bundle older copies.
if (!class_exists(GitHubPluginUpdaterV1::class, false)) {
    final class GitHubPluginUpdaterV1
    {
        private const REPOSITORY = 'makr-code/GalaxyQuest';

        public function __construct(
            private readonly string $file,
            private readonly string $slug,
            private readonly string $name,
            private readonly string $version,
            private readonly string $updateUri,
            private readonly string $cacheKey,
            private readonly string $tokenConstant
        ) {
        }

        public function register(): void
        {
            add_filter('update_plugins_github.com', [$this, 'update'], 10, 4);
            add_filter('plugins_api', [$this, 'information'], 10, 3);
            add_filter('upgrader_pre_download', [$this, 'download'], 20, 4);
            add_action('admin_notices', [$this, 'notice']);
            add_action('upgrader_process_complete', [$this, 'updated'], 10, 2);
        }

        /** @return array<string,mixed> */
        public function apiGet(string $endpoint): array
        {
            $headers = [
            'Accept' => 'application/vnd.github+json',
            'X-GitHub-Api-Version' => '2022-11-28',
            'User-Agent' => 'GalaxyQuest-WordPress-Plugin',
            ];
            if (defined($this->tokenConstant)) {
                $token = constant($this->tokenConstant);
                if (is_string($token) && $token !== '') {
                    $headers['Authorization'] = 'Bearer ' . $token;
                }
            }
            $response = wp_remote_get('https://api.github.com/repos/' . self::REPOSITORY . '/' . $endpoint, [
            'timeout' => 10, 'redirection' => 0, 'sslverify' => true,
            'limit_response_size' => 2097152, 'headers' => $headers,
            ]);
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
                return ['error' => __(
                    'Could not read GitHub data; check connectivity, credentials or API limits.',
                    $this->slug
                )];
            }
            $data = json_decode(wp_remote_retrieve_body($response), true);
            return is_array($data) ? $data : ['error' => __('GitHub returned invalid JSON.', $this->slug)];
        }

        public function tagVersion(string $tag): ?string
        {
            $number = '(?:0|[1-9][0-9]*)';
            return preg_match(
                '/\A' . preg_quote($this->slug, '/') . '-v(' . $number . '\.' . $number . '\.' . $number . ')\z/D',
                $tag,
                $match
            ) === 1 ? $match[1] : null;
        }

        public function releaseData(array $release): array|WP_Error
        {
            $tag = $release['tag_name'] ?? '';
            $version = is_string($tag) ? $this->tagVersion($tag) : null;
            if (
                $version === null || ($release['draft'] ?? null) !== false
                || ($release['prerelease'] ?? null) !== false || !is_array($release['assets'] ?? null)
            ) {
                return new WP_Error('gq_plugin_release', __('Invalid published plugin release.', $this->slug));
            }
            $name = $this->slug . '-' . $version . '.zip';
            $package = 'https://github.com/' . self::REPOSITORY . '/releases/download/' . $tag . '/' . $name;
            $assets = array_values(array_filter(
                $release['assets'],
                static fn($asset): bool => is_array($asset) && ($asset['name'] ?? null) === $name
            ));
            $asset = count($assets) === 1 ? $assets[0] : [];
            if (
                ($asset['state'] ?? null) !== 'uploaded' || ($asset['browser_download_url'] ?? null) !== $package
                || !is_int($asset['size'] ?? null) || $asset['size'] < 1 || $asset['size'] > 5242880
                || !is_string($asset['digest'] ?? null)
                || preg_match('/\Asha256:[a-f0-9]{64}\z/D', $asset['digest']) !== 1
            ) {
                return new WP_Error(
                    'gq_plugin_asset',
                    __('Plugin ZIP or GitHub SHA-256 metadata is missing or invalid.', $this->slug)
                );
            }
            return [
            'tag' => $tag, 'version' => $version, 'package' => $package,
            'digest' => substr($asset['digest'], 7), 'size' => $asset['size'],
            'url' => 'https://github.com/' . self::REPOSITORY . '/releases/tag/' . $tag,
            ];
        }

        public function findRelease(): array|WP_Error|null
        {
            $selected = null;
            for ($page = 1; $page <= 10; $page++) {
                $releases = $this->apiGet('releases?per_page=100&page=' . $page);
                if (isset($releases['error']) || !array_is_list($releases)) {
                    return new WP_Error(
                        'gq_plugin_discovery',
                        $releases['error'] ?? __('Invalid GitHub release list.', $this->slug)
                    );
                }
                foreach ($releases as $release) {
                    if (!is_array($release) || !is_string($release['tag_name'] ?? null)) {
                        return new WP_Error('gq_plugin_discovery', __('Invalid GitHub release entry.', $this->slug));
                    }
                    $version = $this->tagVersion($release['tag_name']);
                    if ($version === null) {
                        continue;
                    }
                    if (!is_bool($release['draft'] ?? null) || !is_bool($release['prerelease'] ?? null)) {
                        return new WP_Error(
                            'gq_plugin_discovery',
                            __('Invalid plugin publication state.', $this->slug)
                        );
                    }
                    if ($release['draft'] || $release['prerelease']) {
                        continue;
                    }
                    if ($selected === null || version_compare($version, $selected['version'], '>')) {
                        $selected = ['version' => $version, 'release' => $release];
                    }
                }
                if (count($releases) < 100) {
                    return $selected === null ? null : $this->releaseData($selected['release']);
                }
            }
            return new WP_Error(
                'gq_plugin_discovery_limit',
                __('Plugin update discovery exceeded its release pagination limit.', $this->slug)
            );
        }

        public function getRelease(): array|WP_Error|null
        {
            $cached = get_transient($this->cacheKey);
            if (is_array($cached) && array_key_exists('release', $cached)) {
                return $cached['release'];
            }
            $release = $this->findRelease();
            set_transient($this->cacheKey, ['release' => $release], is_wp_error($release) ? 300 : 3600);
            return $release;
        }

        public function blocker(): ?string
        {
            $installed = plugin_dir_path($this->file) . basename($this->file);
            if (
                plugin_basename($this->file) !== $this->slug . '/' . $this->slug . '.php'
                || is_link($installed) || is_link(dirname($installed))
                || (stat($installed)['nlink'] ?? 1) > 1
            ) {
                return sprintf(__(
                    'Plugin self-updates are disabled for flat-file, linked or development installations.'
                    . ' Install the release ZIP in its own %s directory first.',
                    $this->slug
                ), $this->slug);
            }
            return null;
        }

        public function update(mixed $update, array $pluginData, string $pluginFile, array $locales): mixed
        {
            if ($pluginFile !== plugin_basename($this->file)) {
                return $update;
            }
            if ($this->blocker() !== null) {
                return false;
            }
            $release = $this->getRelease();
            if ($release === null || is_wp_error($release)) {
                return false;
            }
            return [
            'id' => $this->updateUri, 'slug' => $this->slug, 'version' => $release['version'],
            'url' => $release['url'], 'package' => $release['package'], 'requires' => '6.5', 'requires_php' => '8.2',
            ];
        }

        public function information(mixed $result, string $action, object $args): mixed
        {
            if ($action !== 'plugin_information' || ($args->slug ?? null) !== $this->slug) {
                return $result;
            }
            $release = $this->getRelease();
            if (is_wp_error($release)) {
                return $release;
            }
            if ($release === null) {
                return new WP_Error(
                    'gq_plugin_unreleased',
                    __('No published plugin release is available.', $this->slug)
                );
            }
            return (object)[
            'name' => $this->name, 'slug' => $this->slug, 'version' => $release['version'],
            'homepage' => $release['url'], 'requires' => '6.5', 'requires_php' => '8.2',
            'download_link' => $release['package'],
            'sections' => ['description' => esc_html__(
                'WordPress plugin updates only. This does not install or promote the GalaxyQuest game.',
                $this->slug
            )],
            ];
        }

        public function zipError(string $file, string $version): ?string
        {
            if (!class_exists(ZipArchive::class)) {
                return __('PHP ext-zip is required to verify plugin updates.', $this->slug);
            }
            $zip = new ZipArchive();
            if ($zip->open($file) !== true) {
                return __('Plugin package is not a readable ZIP.', $this->slug);
            }
            try {
                $seen = [];
                $size = 0;
                if ($zip->numFiles < 1 || $zip->numFiles > 100) {
                    return __('Unexpected plugin ZIP entry count.', $this->slug);
                }
                for ($index = 0; $index < $zip->numFiles; $index++) {
                    $entry = $zip->statIndex($index);
                    $name = $entry['name'] ?? '';
                    $parts = explode('/', rtrim($name, '/'));
                    $attributes = 0;
                    $system = 0;
                    $zip->getExternalAttributesIndex($index, $system, $attributes);
                    $type = ($attributes >> 16) & 0170000;
                    $size += $entry['size'] ?? 10485761;
                    if (
                        $parts[0] !== $this->slug || in_array('', $parts, true)
                        || in_array('..', $parts, true) || in_array('.', $parts, true)
                        || str_contains($name, '\\') || preg_match('/[\x00-\x1f]/', $name)
                        || isset($seen[rtrim($name, '/')]) || $size > 10485760
                        || !in_array($type, [0, 0100000, 0040000], true)
                    ) {
                        return __('Unsafe plugin ZIP paths, links or expanded size.', $this->slug);
                    }
                    $seen[rtrim($name, '/')] = true;
                }
                $main = $zip->getFromName($this->slug . '/' . $this->slug . '.php');
                if (
                    !is_string($main)
                    || preg_match('/^[ \t*]*Version:[ \t]*([^\r\n]+)/m', $main, $match) !== 1
                    || trim($match[1]) !== $version || !str_contains($main, 'Plugin Name: ' . $this->name)
                    || $zip->locateName($this->slug . '/gq-github-plugin-updater.php') === false
                ) {
                    return __('Plugin ZIP entrypoint, updater or version does not match the release.', $this->slug);
                }
                return null;
            } finally {
                $zip->close();
            }
        }

        public function download(mixed $reply, string $package, object $upgrader, array $extra): mixed
        {
            if (($extra['type'] ?? 'plugin') !== 'plugin') {
                return $reply;
            }
            $prefix = 'https://github.com/' . self::REPOSITORY . '/releases/download/' . $this->slug . '-v';
            if (($extra['plugin'] ?? null) !== plugin_basename($this->file) && !str_starts_with($package, $prefix)) {
                return $reply;
            }
            if (is_wp_error($reply)) {
                return $reply;
            }
            $blocker = $this->blocker();
            if ($blocker !== null || $reply !== false) {
                return new WP_Error(
                    'gq_plugin_update_blocked',
                    $blocker ?? __('Conflicting plugin download filter.', $this->slug)
                );
            }
            if (preg_match('~\A' . preg_quote($prefix, '~') . '([^/]+)/[^/]+\z~D', $package, $match) !== 1) {
                return new WP_Error('gq_plugin_package', __('Untrusted plugin package URL.', $this->slug));
            }
            $tag = $this->slug . '-v' . $match[1];
            if ($this->tagVersion($tag) === null) {
                return new WP_Error('gq_plugin_package', __('Invalid plugin release tag.', $this->slug));
            }
            // Never trust cached metadata at the installation boundary.
            $release = $this->releaseData($this->apiGet('releases/tags/' . rawurlencode($tag)));
            if (is_wp_error($release)) {
                return $release;
            }
            if (
                $release['package'] !== $package || $release['tag'] !== $tag
                || !version_compare($release['version'], $this->version, '>')
            ) {
                return new WP_Error(
                    'gq_plugin_package',
                    __('Plugin package identity or upgrade version changed.', $this->slug)
                );
            }
            $file = wp_tempnam($this->slug . '.zip');
            if ($file === false) {
                return new WP_Error('gq_plugin_tempfile', __('Could not create plugin download file.', $this->slug));
            }
            $keep = false;
            try {
                // Public downloads: do not forward API credentials to GitHub's CDN.
                $response = wp_safe_remote_get($package, [
                'timeout' => 60, 'redirection' => 3, 'sslverify' => true,
                'stream' => true, 'filename' => $file, 'limit_response_size' => $release['size'] + 1,
                ]);
                if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) {
                    return new WP_Error('gq_plugin_download', __('Plugin ZIP download failed.', $this->slug));
                }
                if (
                    filesize($file) !== $release['size']
                    || !hash_equals($release['digest'], (string)hash_file('sha256', $file))
                ) {
                    return new WP_Error(
                        'gq_plugin_digest',
                        __('Plugin ZIP size or SHA-256 verification failed.', $this->slug)
                    );
                }
                $error = $this->zipError($file, $release['version']);
                if ($error !== null) {
                    return new WP_Error('gq_plugin_zip', $error);
                }
                $keep = true;
                return $file;
            } finally {
                if (!$keep) {
                    wp_delete_file($file);
                }
            }
        }

        public function updated(object $upgrader, array $options): void
        {
            if (
                ($options['type'] ?? null) === 'plugin' && ($options['action'] ?? null) === 'update'
                && in_array(plugin_basename($this->file), $options['plugins'] ?? [], true)
            ) {
                delete_transient($this->cacheKey);
            }
        }

        public function notice(): void
        {
            if (!current_user_can('update_plugins')) {
                return;
            }
            $cached = get_transient($this->cacheKey);
            if (is_array($cached) && is_wp_error($cached['release'] ?? null)) {
                echo '<div class="notice notice-error"><p>' . esc_html($this->name) . ': '
                . esc_html($cached['release']->get_error_message()) . '</p></div>';
            }
        }
    }
}
