<?php
/**
 * Build optimized JavaScript assets from js/*.js.
 *
 * Usage:
 *   php scripts/build_minified_js.php
 *
 * Optional:
 *   php scripts/build_minified_js.php --source=js --clean
 *   php scripts/build_minified_js.php --minify
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

$jsFiles = collect_js_files($sourceDir);
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
        $builtTargets[] = build_asset($file, $src, 'ugl', uglify_js_aggressive($src));
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
if ($compressedWritten > 0) {
    fwrite(STDOUT, sprintf("Compressed artifacts: %d, total bytes: %d\n", $compressedWritten, $totalCompressedOut));
}

function parse_options(array $argv): array {
    $opts = [
        'source' => 'js',
        'clean' => false,
        'minify' => false,
        'uglify' => true,
        'compress' => 'gzip',
        'compressed_only' => true,
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
            $opts['compressed_only'] = false;
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

function collect_js_files(string $dir): array {
    $files = [];
    $iter = new DirectoryIterator($dir);
    foreach ($iter as $entry) {
        if ($entry->isDot() || !$entry->isFile()) {
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
function uglify_js_aggressive(string $code): string {
    return minify_js_safe($code);
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
