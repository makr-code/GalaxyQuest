<?php

declare(strict_types=1);

/**
 * MiniYamlParser
 *
 * A small, dependency-free parser for a strict YAML subset:
 *  - Top-level is always a block mapping.
 *  - Values may be scalars, nested block-mappings, or block-sequences.
 *  - Indentation is significant (spaces only, no tabs).
 *  - Supported scalar types: double-quoted strings, single-quoted strings,
 *    unquoted strings, integers, floats, booleans (true/false/yes/no/on/off),
 *    and null (~, null, empty).
 *
 * Explicitly NOT supported (throws InvalidArgumentException):
 *  - Anchors (&), aliases (*), YAML tags (!)
 *  - Flow-style mappings ({ }) and flow-style sequences ([ ])
 *  - Block scalars (| and >)
 *
 * Silently skipped:
 *  - Empty lines, lines containing only whitespace
 *  - Comment lines (# at the start of the trimmed content)
 *  - Document start/end markers (--- / ...)
 */
final class MiniYamlParser
{
    /** @var list<string> */
    private array $lines = [];
    private int $count  = 0;

    /**
     * Parse a YAML string into a nested PHP array.
     *
     * @return array<string, mixed>
     * @throws \RuntimeException on unsupported syntax or parse error
     */
    public function parse(string $yaml): array
    {
        $this->lines = explode("\n", str_replace("\r\n", "\n", $yaml));
        $this->lines = array_map(static fn(string $l) => rtrim($l), $this->lines);
        $this->count = count($this->lines);

        $i = 0;
        $result = $this->parseMap($i, 0);

        // Drain any remaining blank/comment lines; error on anything else.
        while ($i < $this->count) {
            $line = $this->lines[$i];
            if ($line === '' || $this->isComment($line)) {
                $i++;
                continue;
            }
            throw new \RuntimeException("Unexpected content after top-level mapping at line " . ($i + 1) . ": {$line}");
        }

        return $result;
    }

    // -------------------------------------------------------------------------
    // Recursive block parsers
    // -------------------------------------------------------------------------

    /**
     * Parse a block mapping starting at line $i with the given base indentation.
     *
     * @return array<string, mixed>
     */
    private function parseMap(int &$i, int $indent): array
    {
        $map = [];

        while ($i < $this->count) {
            $line = $this->lines[$i];

            if ($line === '' || $this->isComment($line)) {
                $i++;
                continue;
            }

            $lineIndent = $this->indentOf($line);

            // Dedent — caller handles it.
            if ($lineIndent < $indent) {
                break;
            }

            if ($lineIndent > $indent) {
                throw new \RuntimeException(
                    "Unexpected indent at line " . ($i + 1) . ": expected {$indent}, got {$lineIndent}"
                );
            }

            $stripped = ltrim($line);
            $this->guardUnsupported($stripped, $i + 1);

            // A sequence item at map level is a parse error.
            if (str_starts_with($stripped, '- ') || $stripped === '-') {
                throw new \RuntimeException(
                    "Unexpected sequence item in mapping context at line " . ($i + 1)
                );
            }

            // Skip document markers.
            if ($stripped === '---' || $stripped === '...') {
                $i++;
                continue;
            }

            // Parse key: [value]
            $colonPos = strpos($stripped, ':');
            if ($colonPos === false) {
                throw new \RuntimeException(
                    "Expected 'key: value' at line " . ($i + 1) . ": {$stripped}"
                );
            }

            $key  = trim(substr($stripped, 0, $colonPos));
            $rest = substr($stripped, $colonPos + 1);

            if ($key === '') {
                throw new \RuntimeException("Empty key at line " . ($i + 1));
            }

            $i++; // consumed current line

            if (ltrim($rest) !== '') {
                // Inline scalar value.
                $map[$key] = $this->parseScalar(ltrim($rest));
            } else {
                // Value is a nested block (map or sequence) on following lines.
                $nextIndent = $this->peekIndent($i);
                if ($nextIndent === null || $nextIndent <= $indent) {
                    // Empty / null value.
                    $map[$key] = null;
                } else {
                    $nextStripped = ltrim($this->peekLine($i));
                    if (str_starts_with($nextStripped, '- ') || $nextStripped === '-') {
                        $map[$key] = $this->parseSequence($i, $nextIndent);
                    } else {
                        $map[$key] = $this->parseMap($i, $nextIndent);
                    }
                }
            }
        }

        return $map;
    }

    /**
     * Parse a block sequence starting at line $i with the given base indentation.
     *
     * @return list<mixed>
     */
    private function parseSequence(int &$i, int $indent): array
    {
        $seq = [];

        while ($i < $this->count) {
            $line = $this->lines[$i];

            if ($line === '' || $this->isComment($line)) {
                $i++;
                continue;
            }

            $lineIndent = $this->indentOf($line);

            if ($lineIndent < $indent) {
                break;
            }

            if ($lineIndent > $indent) {
                throw new \RuntimeException(
                    "Unexpected indent in sequence at line " . ($i + 1)
                );
            }

            $stripped = ltrim($line);
            $this->guardUnsupported($stripped, $i + 1);

            if (!str_starts_with($stripped, '- ') && $stripped !== '-') {
                break; // No longer a sequence item.
            }

            $itemText = ltrim(substr($stripped, 1)); // strip leading '-'
            $i++;

            if ($itemText !== '') {
                $seq[] = $this->parseScalar($itemText);
            } else {
                // Block scalar or nested map under sequence item.
                $nextIndent = $this->peekIndent($i);
                if ($nextIndent === null || $nextIndent <= $indent) {
                    $seq[] = null;
                } else {
                    $nextStripped = ltrim($this->peekLine($i));
                    if (str_starts_with($nextStripped, '- ') || $nextStripped === '-') {
                        $seq[] = $this->parseSequence($i, $nextIndent);
                    } else {
                        $seq[] = $this->parseMap($i, $nextIndent);
                    }
                }
            }
        }

        return $seq;
    }

    // -------------------------------------------------------------------------
    // Scalar parsing
    // -------------------------------------------------------------------------

    /**
     * Convert a raw scalar string to its PHP equivalent (string, int, float, bool, null).
     */
    private function parseScalar(string $raw): mixed
    {
        $v = trim($raw);

        // Double-quoted string – handle basic escapes
        if (str_starts_with($v, '"') && str_ends_with($v, '"') && strlen($v) >= 2) {
            $inner = substr($v, 1, -1);
            $inner = str_replace(['\\"', '\\n', '\\t', '\\\\'], ['"', "\n", "\t", '\\'], $inner);
            return $inner;
        }

        // Single-quoted string – only '' escape inside
        if (str_starts_with($v, "'") && str_ends_with($v, "'") && strlen($v) >= 2) {
            return str_replace("''", "'", substr($v, 1, -1));
        }

        // Strip trailing inline comment (must have at least one space before #)
        if (preg_match('/^(.*?)\s+#[^"\']*$/', $v, $cm)) {
            $v = rtrim($cm[1]);
        }

        // Null
        if ($v === '' || strtolower($v) === 'null' || $v === '~') {
            return null;
        }

        // Boolean
        if (in_array(strtolower($v), ['true', 'yes', 'on'], true)) {
            return true;
        }
        if (in_array(strtolower($v), ['false', 'no', 'off'], true)) {
            return false;
        }

        // Integer
        if (preg_match('/^-?\d+$/', $v)) {
            return (int) $v;
        }

        // Float
        if (preg_match('/^-?\d+\.\d+$/', $v)) {
            return (float) $v;
        }

        return $v;
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private function indentOf(string $line): int
    {
        return strlen($line) - strlen(ltrim($line));
    }

    private function isComment(string $line): bool
    {
        return str_starts_with(ltrim($line), '#');
    }

    /**
     * Return the indentation of the next non-blank, non-comment line, or null.
     */
    private function peekIndent(int $i): ?int
    {
        for ($j = $i; $j < $this->count; $j++) {
            $line = $this->lines[$j];
            if ($line !== '' && !$this->isComment($line)) {
                return $this->indentOf($line);
            }
        }
        return null;
    }

    /**
     * Return the first non-blank, non-comment line from position $i onward,
     * or empty string if none.
     */
    private function peekLine(int $i): string
    {
        for ($j = $i; $j < $this->count; $j++) {
            $line = $this->lines[$j];
            if ($line !== '' && !$this->isComment($line)) {
                return $line;
            }
        }
        return '';
    }

    /**
     * Throw on syntax this parser deliberately does not support.
     */
    private function guardUnsupported(string $stripped, int $lineNumber): void
    {
        // Anchors / aliases.
        if (str_starts_with($stripped, '&') || str_starts_with($stripped, '*')) {
            throw new \RuntimeException(
                "YAML anchors and aliases are not supported (line {$lineNumber})"
            );
        }
        // Tags.
        if (str_starts_with($stripped, '!!')) {
            throw new \RuntimeException(
                "YAML tags are not supported (line {$lineNumber})"
            );
        }
        // Flow mappings / sequences.
        if (str_starts_with($stripped, '{') || str_starts_with($stripped, '[')) {
            throw new \RuntimeException(
                "YAML flow style is not supported (line {$lineNumber})"
            );
        }
        // Block scalars.
        if (preg_match('/^[^:]+:\s*[|>]/', $stripped)) {
            throw new \RuntimeException(
                "YAML block scalars (| and >) are not supported (line {$lineNumber})"
            );
        }
    }
}
