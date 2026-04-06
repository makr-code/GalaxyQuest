<?php
/**
 * Build optimized JavaScript assets from all JS files under js/ (recursive).
 *
 * Usage:
 *   php scripts/build_minified_js.php
 *
 * Optional:
 *   php scripts/build_minified_js.php --source=js --clean
 *   php scripts/build_minified_js.php --source=js --no-recursive
 *   php scripts/build_minified_js.php --minify
 *   php scripts/build_minified_js.php --uglify --compress=gzip
 *   php scripts/build_minified_js.php --package-boot --package-name=js/packages/game.boot.bundle.js
 *   php scripts/build_minified_js.php --package-include='^(js\\/game|js\\/api)'
 *   php scripts/build_minified_js.php --package-exclude='^js\\/engine\\/'
 *   php scripts/build_minified_js.php --package-extra='js/engine/fx/*.js,js/engine/post-effects/passes/*.js'
 *   php scripts/build_minified_js.php --compress=gzip
 *   php scripts/build_minified_js.php --keep-uncompressed
 */

declare(strict_types=1);

$root = realpath(__DIR__ . '/..');
if ($root === false) {
    fwrite(STDERR, "Could not resolve project root.\n");
    exit(1);
}

$options = parse_options($argv);
if (!$options['minify'] && !$options['uglify']) {
    fwrite(STDERR, "Nothing to build. Enable at least one of: minify, uglify.\n");
    exit(1);
}

$sourceDir = $options['source'];
if (!str_starts_with($sourceDir, DIRECTORY_SEPARATOR) && !preg_match('/^[A-Za-z]:\\\\/', $sourceDir)) {
    $sourceDir = $root . DIRECTORY_SEPARATOR . $sourceDir;
}
$sourceDir = realpath($sourceDir) ?: $sourceDir;

if (!is_dir($sourceDir)) {
    fwrite(STDERR, "Source directory not found: {$sourceDir}\n");
    exit(1);
}

$jsFiles = collect_js_files($sourceDir, (bool) $options['recursive']);
if (!$jsFiles) {
    fwrite(STDOUT, "No source JS files found in {$sourceDir}.\n");
    exit(0);
}

if ($options['clean']) {
    clean_old_generated_files($jsFiles);
}

$totalIn = 0;
$totalComparableIn = 0;
$totalOut = 0;
$totalCompressedOut = 0;
$written = 0;
$compressedWritten = 0;

fwrite(
    STDOUT,
    sprintf(
        "Building JS assets from %s (minify=%s, uglify=%s, compress=%s)\n",
        $sourceDir,
        $options['minify'] ? 'on' : 'off',
        $options['uglify'] ? 'on' : 'off',
        $options['compress']
    )
);

foreach ($jsFiles as $file) {
    $src = file_get_contents($file);
    if ($src === false) {
        fwrite(STDERR, "Failed reading {$file}\n");
        continue;
    }

    $totalIn += strlen($src);

    $builtTargets = [];
    if ($options['minify']) {
        $builtTargets[] = build_asset($file, $src, 'min', minify_js_safe($src));
    }
    if ($options['uglify']) {
        $builtTargets[] = build_asset($file, $src, 'ugl', uglify_js_aggressive($src, $file));
    }

    foreach ($builtTargets as $built) {
        if (!$built['ok']) {
            fwrite(STDERR, "Failed writing {$built['target']}\n");
            continue;
        }

        $written += 1;
        $totalComparableIn += $built['in_bytes'];
        $totalOut += $built['out_bytes'];

        $ratio = $built['in_bytes'] > 0 ? round((1 - ($built['out_bytes'] / $built['in_bytes'])) * 100, 2) : 0.0;
        fwrite(
            STDOUT,
            sprintf(
                " - [%s] %s -> %s (%d -> %d bytes, %s%%)\n",
                strtoupper($built['mode']),
                basename($file),
                basename($built['target']),
                $built['in_bytes'],
                $built['out_bytes'],
                $ratio
            )
        );

        $compressed = compress_asset($built['target'], $options['compress']);
        foreach ($compressed as $entry) {
            $compressedWritten += 1;
            $totalCompressedOut += $entry['bytes'];
            $cratio = $built['out_bytes'] > 0 ? round((1 - ($entry['bytes'] / $built['out_bytes'])) * 100, 2) : 0.0;
            fwrite(
                STDOUT,
                sprintf(
                    "   -> %s (%d bytes, %s%% vs asset)\n",
                    basename($entry['target']),
                    $entry['bytes'],
                    $cratio
                )
            );
        }

        if ($options['compressed_only'] && !empty($compressed)) {
            @unlink($built['target']);
        }
    }
}

if (!empty($options['package_boot_bundle'])) {
    build_boot_bundles_gzip($root, $options);
}

$overall = $totalComparableIn > 0 ? round((1 - ($totalOut / $totalComparableIn)) * 100, 2) : 0.0;
fwrite(
    STDOUT,
    sprintf(
        "Done. %d assets, source-bytes=%d, comparable-input=%d, output=%d, %s%% saved.\n",
        $written,
        $totalIn,
        $totalComparableIn,
        $totalOut,
        $overall
    )
);
$assetRatio = $totalComparableIn > 0 ? round($totalOut / $totalComparableIn, 4) : 0.0;
fwrite(STDOUT, sprintf("Ratio assets (output/input): %0.4f\n", $assetRatio));
if ($compressedWritten > 0) {
    fwrite(STDOUT, sprintf("Compressed artifacts: %d, total bytes: %d\n", $compressedWritten, $totalCompressedOut));

    $compressedToAssetRatio = $totalOut > 0 ? round($totalCompressedOut / $totalOut, 4) : 0.0;
    $compressedToInputRatio = $totalComparableIn > 0 ? round($totalCompressedOut / $totalComparableIn, 4) : 0.0;
    fwrite(STDOUT, sprintf("Ratio compressed (gz/output): %0.4f\n", $compressedToAssetRatio));
    fwrite(STDOUT, sprintf("Ratio compressed (gz/input): %0.4f\n", $compressedToInputRatio));
}

function parse_options(array $argv): array {
    $opts = [
        'source' => 'js',
        'clean' => false,
        'minify' => false,
        'uglify' => true,
        'recursive' => true,
        'compress' => 'gzip',
        'compressed_only' => true,
        'package_boot_bundle' => false,
        'package_name' => 'js/packages/game.boot.bundle.js',
        'package_index' => 'index.html',
        'package_chunk_files' => 12,
        'package_include' => '',
        'package_exclude' => '',
        'package_extra' => 'js/engine/fx/*.js,js/engine/post-effects/passes/*.js',
    ];

    foreach ($argv as $arg) {
        if (!is_string($arg) || $arg === '' || $arg === $argv[0]) {
            continue;
        }

        if (str_starts_with($arg, '--source=')) {
            $opts['source'] = trim(substr($arg, 9));
            continue;
        }
        if ($arg === '--clean') {
            $opts['clean'] = true;
            continue;
        }
        if ($arg === '--uglify') {
            $opts['uglify'] = true;
            continue;
        }
        if ($arg === '--recursive') {
            $opts['recursive'] = true;
            continue;
        }
        if ($arg === '--no-recursive') {
            $opts['recursive'] = false;
            continue;
        }
        if ($arg === '--minify') {
            $opts['minify'] = true;
            continue;
        }
        if ($arg === '--no-minify') {
            $opts['minify'] = false;
            continue;
        }
        if ($arg === '--all') {
            $opts['minify'] = true;
            $opts['uglify'] = true;
            $opts['compress'] = 'both';
            $opts['compressed_only'] = true;
            continue;
        }
        if ($arg === '--package-boot') {
            $opts['package_boot_bundle'] = true;
            continue;
        }
        if (str_starts_with($arg, '--package-name=')) {
            $opts['package_name'] = trim(substr($arg, 15));
            continue;
        }
        if (str_starts_with($arg, '--package-index=')) {
            $opts['package_index'] = trim(substr($arg, 16));
            continue;
        }
        if (str_starts_with($arg, '--package-chunk-files=')) {
            $opts['package_chunk_files'] = max(1, (int) trim(substr($arg, 22)));
            continue;
        }
        if (str_starts_with($arg, '--package-include=')) {
            $opts['package_include'] = trim(substr($arg, 18));
            continue;
        }
        if (str_starts_with($arg, '--package-exclude=')) {
            $opts['package_exclude'] = trim(substr($arg, 18));
            continue;
        }
        if (str_starts_with($arg, '--package-extra=')) {
            $opts['package_extra'] = trim(substr($arg, 16));
            continue;
        }
        if ($arg === '--keep-uncompressed') {
            $opts['compressed_only'] = false;
            continue;
        }
        if (str_starts_with($arg, '--compress=')) {
            $mode = strtolower(trim(substr($arg, 11)));
            if (in_array($mode, ['none', 'gzip', 'brotli', 'both'], true)) {
                $opts['compress'] = $mode;
            }
            continue;
        }
    }

    if ($opts['compress'] === 'none') {
        $opts['compressed_only'] = false;
    }

    return $opts;
}

function collect_js_files(string $dir, bool $recursive = true): array {
    $files = [];
    if ($recursive) {
        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
        );
    } else {
        $iter = new DirectoryIterator($dir);
    }

    foreach ($iter as $entry) {
        if (!$entry->isFile()) {
            continue;
        }
        $name = $entry->getFilename();
        if (!preg_match('/\.js$/i', $name)) {
            continue;
        }
        if (preg_match('/\.(min|ugl)\.js$/i', $name)) {
            continue;
        }
        $files[] = $entry->getPathname();
    }
    sort($files);
    return $files;
}

function clean_old_generated_files(array $sourceFiles): void {
    foreach ($sourceFiles as $source) {
        $targets = [
            preg_replace('/\.js$/i', '.min.js', $source),
            preg_replace('/\.js$/i', '.ugl.js', $source),
        ];
        foreach ($targets as $target) {
            if (!$target) {
                continue;
            }
            $files = [$target, $target . '.gz', $target . '.br'];
            foreach ($files as $generated) {
                if (is_file($generated)) {
                    @unlink($generated);
                }
            }
        }
    }
}

function build_asset(string $sourceFile, string $sourceContent, string $mode, string $processedContent): array {
    $suffix = $mode === 'ugl' ? '.ugl.js' : '.min.js';
    $target = preg_replace('/\.js$/i', $suffix, $sourceFile);
    if (!$target) {
        return ['ok' => false, 'target' => ''];
    }

    $header = sprintf(
        "/* auto-generated by scripts/build_minified_js.php; source=%s; mode=%s */\n",
        basename($sourceFile),
        $mode
    );
    $payload = $header . $processedContent;
    $ok = file_put_contents($target, $payload) !== false;

    return [
        'ok' => $ok,
        'mode' => $mode,
        'target' => $target,
        'in_bytes' => strlen($sourceContent),
        'out_bytes' => strlen($payload),
    ];
}

function compress_asset(string $target, string $mode): array {
    if ($mode === 'none') {
        return [];
    }

    $content = file_get_contents($target);
    if ($content === false) {
        return [];
    }

    $result = [];
    if ($mode === 'gzip' || $mode === 'both') {
        $gzip = gzencode($content, 9);
        if ($gzip !== false) {
            $gzipTarget = $target . '.gz';
            if (file_put_contents($gzipTarget, $gzip) !== false) {
                $result[] = ['target' => $gzipTarget, 'bytes' => strlen($gzip)];
            }
        }
    }

    if ($mode === 'brotli' || $mode === 'both') {
        if (function_exists('brotli_compress')) {
            $brotli = brotli_compress($content, 11, BROTLI_TEXT);
            if ($brotli !== false) {
                $brotliTarget = $target . '.br';
                if (file_put_contents($brotliTarget, $brotli) !== false) {
                    $result[] = ['target' => $brotliTarget, 'bytes' => strlen($brotli)];
                }
            }
        } else {
            fwrite(STDOUT, "   -> skipped .br (brotli extension not available)\n");
        }
    }

    return $result;
}

/**
 * Conservative minifier for production safety.
 *
 * IMPORTANT:
 * Previous regex-based transforms corrupted complex JS (template literals,
 * shader sources, embedded comment markers inside strings/regex), which led to
 * runtime SyntaxError in compressed assets.
 *
 * To preserve semantics we keep source content byte-stable except EOL
 * normalization and trailing newline.
 */
function minify_js_safe(string $code): string {
    $normalized = str_replace(["\r\n", "\r"], "\n", $code);
    return rtrim($normalized) . "\n";
}

/**
 * Uglify mode currently uses the same semantics-preserving transform as minify.
 * Compression gains are achieved via gzip/brotli artifacts, not syntax rewriting.
 */
function uglify_js_aggressive(string $code, ?string $sourceFile = null): string {
    static $engine = null;
    if ($engine === null) {
        $engine = detect_esbuild_minifier();
        if (!$engine['available']) {
            fwrite(STDOUT, "[uglify] esbuild not available, using safe fallback (no syntax minification).\n");
        }
    }

    if (!$engine['available']) {
        return minify_js_safe($code);
    }

    $minified = run_esbuild_minify($code, $engine['command']);
    if ($minified === null) {
        $suffix = $sourceFile ? (' for ' . basename($sourceFile)) : '';
        fwrite(STDOUT, "[uglify] esbuild transform failed{$suffix}, using safe fallback.\n");
        return minify_js_safe($code);
    }

    return rtrim(str_replace(["\r\n", "\r"], "\n", $minified)) . "\n";
}

function detect_esbuild_minifier(): array {
    $nullDevice = strtoupper(substr(PHP_OS_FAMILY, 0, 3)) === 'WIN' ? 'NUL' : '/dev/null';
    $cmd = 'esbuild --version';
    exec($cmd . ' 2>' . $nullDevice, $out, $exitCode);
    if ($exitCode === 0 && !empty($out)) {
        return ['available' => true, 'command' => 'esbuild'];
    }
    return ['available' => false, 'command' => null];
}

function run_esbuild_minify(string $code, ?string $esbuildCommand): ?string {
    if (!$esbuildCommand) {
        return null;
    }

    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];
    $process = proc_open($esbuildCommand . ' --minify --legal-comments=none --target=es2019 --loader=js', $descriptorSpec, $pipes);
    if (!is_resource($process)) {
        return null;
    }

    fwrite($pipes[0], $code);
    fclose($pipes[0]);

    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);

    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);

    $exitCode = proc_close($process);
    if ($exitCode !== 0) {
        if (trim((string) $stderr) !== '') {
            fwrite(STDOUT, "[uglify] " . trim((string) $stderr) . "\n");
        }
        return null;
    }

    return is_string($stdout) ? $stdout : null;
}

function build_boot_bundles_gzip(string $root, array $options): void {
    $indexPath = $options['package_index'];
    if (!str_starts_with($indexPath, DIRECTORY_SEPARATOR) && !preg_match('/^[A-Za-z]:\\\\/', $indexPath)) {
        $indexPath = $root . DIRECTORY_SEPARATOR . $indexPath;
    }

    if (!is_file($indexPath)) {
        fwrite(STDOUT, "[package] index not found: {$indexPath}\n");
        return;
    }

    $index = file_get_contents($indexPath);
    if ($index === false) {
        fwrite(STDOUT, "[package] failed reading index: {$indexPath}\n");
        return;
    }

    if (!preg_match_all('/\'(js\/[^\'\"]+\.js(?:\?[^\'\"]*)?)\'/i', $index, $matches)) {
        fwrite(STDOUT, "[package] no boot JS references found in index.\n");
        return;
    }

    $relPaths = [];
    $includePattern = trim((string) ($options['package_include'] ?? ''));
    $excludePattern = trim((string) ($options['package_exclude'] ?? ''));

    foreach ($matches[1] as $raw) {
        $path = preg_replace('/\\?.*$/', '', $raw);
        if (!is_string($path) || $path === '' || preg_match('/\\.(min|ugl)\\.js$/i', $path)) {
            continue;
        }
        if ($includePattern !== '' && @preg_match('/' . $includePattern . '/i', $path) !== 1) {
            continue;
        }
        if ($excludePattern !== '' && @preg_match('/' . $excludePattern . '/i', $path) === 1) {
            continue;
        }
        if (!in_array($path, $relPaths, true)) {
            $relPaths[] = $path;
        }
    }

    // Keep selected engine artifacts anchored in bundles, even when they are
    // not listed explicitly in index boot arrays.
    $extraSpec = trim((string) ($options['package_extra'] ?? ''));
    if ($extraSpec !== '') {
        $patterns = array_filter(array_map('trim', explode(',', $extraSpec)), static fn ($v) => $v !== '');
        foreach ($patterns as $pattern) {
            $absolutePattern = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $pattern);
            $found = glob($absolutePattern) ?: [];
            foreach ($found as $absolutePath) {
                if (!is_file($absolutePath)) {
                    continue;
                }
                $relativePath = str_replace(DIRECTORY_SEPARATOR, '/', ltrim(str_replace($root, '', $absolutePath), DIRECTORY_SEPARATOR));
                if ($includePattern !== '' && @preg_match('/' . $includePattern . '/i', $relativePath) !== 1) {
                    continue;
                }
                if ($excludePattern !== '' && @preg_match('/' . $excludePattern . '/i', $relativePath) === 1) {
                    continue;
                }
                if (!in_array($relativePath, $relPaths, true)) {
                    $relPaths[] = $relativePath;
                }
            }
        }
    }

    if (!$relPaths) {
        fwrite(STDOUT, "[package] no source JS paths selected for bundle.\n");
        return;
    }

    $themeGroups = [];
    foreach ($relPaths as $relPath) {
        $theme = determine_package_theme($relPath);
        if (!isset($themeGroups[$theme])) {
            $themeGroups[$theme] = [];
        }
        $themeGroups[$theme][] = $relPath;
    }

    if (!$themeGroups) {
        fwrite(STDOUT, "[package] no thematic groups produced.\n");
        return;
    }

    $packageName = (string) $options['package_name'];
    $packagePath = $packageName;
    if (!str_starts_with($packagePath, DIRECTORY_SEPARATOR) && !preg_match('/^[A-Za-z]:\\\\/', $packagePath)) {
        $packagePath = $root . DIRECTORY_SEPARATOR . $packagePath;
    }

    $packageDir = dirname($packagePath);
    if (!is_dir($packageDir)) {
        @mkdir($packageDir, 0777, true);
    }

    $basePath = preg_replace('/\.js$/i', '', $packagePath) ?: $packagePath;
    foreach (glob($basePath . '.*.js.gz') ?: [] as $oldBundle) {
        if (is_file($oldBundle)) {
            @unlink($oldBundle);
        }
    }
    $themeOrder = ['engine-core', 'engine-game', 'runtime', 'network', 'rendering', 'telemetry', 'ui', 'tests', 'legacy', 'misc'];
    $themeKeys = [];
    foreach ($themeOrder as $key) {
        if (!empty($themeGroups[$key])) {
            $themeKeys[] = $key;
        }
    }
    foreach (array_keys($themeGroups) as $key) {
        if (!in_array($key, $themeKeys, true)) {
            $themeKeys[] = $key;
        }
    }

    $bundleCount = count($themeKeys);
    $totalIncluded = 0;
    $totalGzBytes = 0;

    foreach ($themeKeys as $theme) {
        $themePaths = $themeGroups[$theme] ?? [];
        if (!$themePaths) {
            continue;
        }

        $parts = [
            "/* packaged boot bundle generated by scripts/build_minified_js.php */\n",
            sprintf("/* theme: %s */\n", $theme),
        ];

        $included = 0;
        foreach ($themePaths as $rel) {
            $abs = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
            if (!is_file($abs)) {
                continue;
            }
            $content = file_get_contents($abs);
            if ($content === false) {
                continue;
            }
            $parts[] = "\n/* ---- {$rel} ---- */\n";
            $parts[] = rtrim(str_replace(["\r\n", "\r"], "\n", $content)) . "\n";
            $included++;
        }

        if ($included === 0) {
            continue;
        }

        $bundleContent = implode('', $parts);
        $gzip = gzencode($bundleContent, 9);
        if ($gzip === false) {
            fwrite(STDOUT, sprintf("[package] gzip encoding failed for theme %s.\n", $theme));
            continue;
        }

        $gzipPath = $basePath . '.' . $theme . '.js.gz';
        if (file_put_contents($gzipPath, $gzip) === false) {
            fwrite(STDOUT, "[package] failed writing bundle: {$gzipPath}\n");
            continue;
        }

        $totalIncluded += $included;
        $totalGzBytes += strlen($gzip);
        fwrite(STDOUT, sprintf("[package] wrote %s (%d files, %d bytes gz, theme=%s)\n", $gzipPath, $included, strlen($gzip), $theme));
    }

    fwrite(STDOUT, sprintf("[package] done: %d bundles, %d files total, %d bytes gz\n", $bundleCount, $totalIncluded, $totalGzBytes));
}

function determine_package_theme(string $relPath): string {
    $path = strtolower(str_replace('\\\\', '/', trim($relPath)));
    $base = basename($path);

    if (str_starts_with($path, 'js/runtime/')) {
        return 'runtime';
    }
    if (str_starts_with($path, 'js/network/')) {
        return 'network';
    }
    if (str_starts_with($path, 'js/rendering/')) {
        return 'rendering';
    }
    if (str_starts_with($path, 'js/telemetry/')) {
        return 'telemetry';
    }
    if (str_starts_with($path, 'js/ui/')) {
        return 'ui';
    }
    if (str_starts_with($path, 'js/tests/')) {
        return 'tests';
    }
    if (str_starts_with($path, 'js/legacy/')) {
        return 'legacy';
    }

    if (str_starts_with($path, 'js/engine/game/')) {
        return 'engine-game';
    }
    if (str_starts_with($path, 'js/engine/')) {
        return 'engine-core';
    }

    // Legacy / compatibility layers that should be isolated.
    if ($base === 'engine-compat.js' || $base === 'galaxy3d.js' || $base === 'galaxy3d-webgpu.js') {
        return 'legacy';
    }

    // Integration and regression test scripts should not be mixed into runtime bundles.
    if (str_starts_with($base, 'regression-') || str_contains($base, 'integration-test') || str_starts_with($base, 'benchmark')) {
        return 'tests';
    }

    // Telemetry / planning / simulation drivers used by runtime systems.
    if (str_contains($base, 'telemetry') || str_contains($base, 'trajectory') || str_contains($base, 'physics') || str_contains($base, 'hud')) {
        return 'telemetry';
    }

    // Visual rendering stack.
    if (str_starts_with($base, 'galaxy') || str_starts_with($base, 'starfield') || str_starts_with($base, 'space-')
        || str_starts_with($base, 'three-') || str_contains($base, 'renderer')
        || str_contains($base, 'shader') || str_contains($base, 'texture') || str_contains($base, 'material') || str_contains($base, 'light')) {
        return 'rendering';
    }

    // Core runtime orchestration.
    if ($base === 'game.js' || str_starts_with($base, 'game-') || $base === 'wm.js' || $base === 'wm-widgets.js' || $base === 'gqwm.js' || $base === 'audio.js' || $base === 'model_registry.js'
        || $base === 'galaxy-model.js' || $base === 'galaxy-db.js') {
        return 'runtime';
    }

    // API / auth and protocol-facing files.
    if (in_array($base, ['api.js', 'api-contracts.js', 'auth.js'], true)
        || str_starts_with($base, 'auth-')
        || str_starts_with($base, 'api-')) {
        return 'network';
    }

    // UI-only helpers and overlays.
    if (in_array($base, ['terminal.js', 'ui-kit.js', 'gq-ui.js', 'glossary.js', 'star-tooltip.js', 'system-info-panel.js', 'hr-diagram.js'], true)) {
        return 'ui';
    }

    return 'misc';
}

/**
 * Split JavaScript into code and literal segments.
 * We only compact code segments so quoted/template strings stay valid.
 */
function split_js_segments(string $code): array {
    $segments = [];
    $len = strlen($code);
    $buffer = '';
    $literal = '';
    $state = 'code';
    $quote = '';

    for ($i = 0; $i < $len; $i++) {
        $ch = $code[$i];

        if ($state === 'code') {
            if ($ch === '\'' || $ch === '"' || $ch === '`') {
                if ($buffer !== '') {
                    $segments[] = ['type' => 'code', 'value' => $buffer];
                    $buffer = '';
                }
                $state = 'literal';
                $quote = $ch;
                $literal = $ch;
                continue;
            }
            $buffer .= $ch;
            continue;
        }

        $literal .= $ch;
        if ($ch === '\\') {
            if ($i + 1 < $len) {
                $i++;
                $literal .= $code[$i];
            }
            continue;
        }

        if ($ch === $quote) {
            $segments[] = ['type' => 'literal', 'value' => $literal];
            $literal = '';
            $state = 'code';
            $quote = '';
        }
    }

    if ($literal !== '') {
        $segments[] = ['type' => 'literal', 'value' => $literal];
    }
    if ($buffer !== '') {
        $segments[] = ['type' => 'code', 'value' => $buffer];
    }

    return $segments;
}
