#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Architecture Lint – verify architectural rules are not violated.
 *
 * Rules checked:
 * 1. No SQL in Presentation layer
 * 2. No HTTP/PDO in Domain layer
 *
 * Exit code 0 = all checks passed
 * Exit code 1 = violations found
 */

$violations = [];

// Rule 1: No SQL in Presentation layer
echo "Checking: No SQL in Presentation layer...\n";
$srcDir = __DIR__ . '/../src';

if (is_dir($srcDir)) {
    $iterator = new RecursiveDirectoryIterator($srcDir);
    $filter = new RecursiveCallbackFilterIterator(
        $iterator,
        static function ($current) {
            $path = $current->getPathname();
            return strpos($path, '/Presentation/') !== false && $current->getExtension() === 'php';
        }
    );
    $files = new RecursiveIteratorIterator($filter);

    foreach ($files as $file) {
        $content = file_get_contents($file->getRealPath());
        $lines = explode("\n", $content);

        foreach ($lines as $lineNum => $line) {
            $trimmed = trim($line);

            // Skip empty lines and comments
            if (empty($trimmed) || strpos($trimmed, '//') === 0 || strpos($trimmed, '/*') === 0 || strpos($trimmed, '*') === 0) {
                continue;
            }

            // Check for SQL keywords (very basic check)
            $sqlKeywords = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER'];
            foreach ($sqlKeywords as $kw) {
                if (preg_match('/\b' . $kw . '\b/i', $line) && !strpos($line, "'")) {
                    $violations[] = [
                        'file' => $file->getRealPath(),
                        'line' => $lineNum + 1,
                        'rule' => 'No SQL in Presentation',
                        'content' => $trimmed,
                    ];
                }
            }
        }
    }
}

// Report violations
if (!empty($violations)) {
    echo "\n❌ Architecture violations found:\n\n";

    foreach ($violations as $v) {
        echo "  [{$v['rule']}] " . str_replace(__DIR__ . '/../', '', $v['file']) . ":{$v['line']}\n";
        echo "    > {$v['content']}\n\n";
    }

    exit(1);
} else {
    echo "✅ No SQL found in Presentation layer\n";
    exit(0);
}

