<?php

declare(strict_types=1);

/**
 * MiniYamlParser
 *
 * A small, dependency-free parser for a strict YAML subset used by GalaxyQuest.
 *
 * Supported:
 *  - Top-level block mapping
 *  - Nested block mappings and block sequences
 *  - Scalar types: unquoted strings, double-quoted strings (with \"-escapes),
 *    single-quoted strings (with ''-escape), integers, floats,
 *    booleans (true/false/yes/no/on/off), and null (~, null, empty)
 *  - Inline comment stripping (# outside quotes)
 *  - Comment lines (#) and blank lines (skipped)
 *  - Document start/end markers (--- / ...) skipped
 *
 * Explicitly NOT supported (throws \InvalidArgumentException):
 *  - Anchors (&) and aliases (*)
 *  - YAML tags (!)
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
    private int $count = 0;

    /**
     * Parse a YAML string and return the top-level mapping as an associative
     * PHP array. Values can be scalars, nested arrays (mappings), or lists.
     *
     * @return array<string, mixed>
     * @throws \InvalidArgumentException on unsupported YAML features
     * @throws \RuntimeException on parse errors
     */
    public function parse(string $yaml): array
    {
        $this->lines = explode("\n", str_replace("\r\n", "\n", $yaml));
        $this->lines = array_map(static fn(string $l) => rtrim($l), $this->lines);
        $this->count = count($this->lines);

        $i = 0;
        $result = $this->parseMap($i, 0);

        // Drain remaining blank/comment lines; error on anything else
        while ($i < $this->count) {
            $line = $this->lines[$i];
            if ($line === '' || $this->isComment($line)) {
                $i++;
                continue;
            }
            $trimmed = ltrim($line);
            if ($trimmed === '---' || $trimmed === '...') {
                $i++;
                continue;
            }
            throw new \RuntimeException(
                'Unexpected content after top-level mapping at line ' . ($i + 1) . ': ' . $line
            );
        }

        return $result;
    }

    // ── Recursive block parsers ───────────────────────────────────────────────

    /**
     * Parse a block mapping starting at line $i with the given base indentation.
     *
     * @param  int   &$i     Current line index (mutated as lines are consumed)
     * @param  int   $indent Indentation level of the mapping's keys
     * @return array<string, mixed>
     */
    private function parseMap(int &$i, int $indent): array
    {
        $map = [];

        while ($i < $this->count) {
            $line = $this->lines[$i];

            // Skip blank and comment lines
            if ($line === '' || $this->isComment($line)) {
                $i++;
                continue;
            }

            $lineIndent = $this->indentOf($line);

            // Dedent — return to caller
            if ($lineIndent < $indent) {
                break;
            }

            if ($lineIndent > $indent && !empty($map)) {
                // Unexpected deeper indent inside a map
                throw new \RuntimeException(
                    'Unexpected indent at line ' . ($i + 1) . ': expected ' . $indent . ', got ' . $lineIndent
                );
            }

            $stripped = ltrim($line);

            // Skip document markers
            if ($stripped === '---' || $stripped === '...') {
                $i++;
                continue;
            }

            $this->guardUnsupported($stripped, $i + 1);

            // Sequence item at map level is an error
            if (str_starts_with($stripped, '- ') || $stripped === '-') {
                throw new \RuntimeException(
                    'Unexpected sequence item in mapping context at line ' . ($i + 1)
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
                    "Expected 'key: value' at line " . ($i + 1) . ': ' . $stripped
                );
            }

            $key  = trim(substr($stripped, 0, $colonPos));
            $rest = substr($stripped, $colonPos + 1);

            if ($key === '') {
                throw new \RuntimeException('Empty key at line ' . ($i + 1));
            }

            $i++; // consume current line

            if (ltrim($rest) !== '') {
                // Inline scalar value
                $map[$key] = $this->parseScalar(ltrim($rest));
            } else {
                // Value is a nested block (map or sequence) on following lines
                $nextIndent = $this->peekIndent($i);
                if ($nextIndent === null || $nextIndent <= $indent) {
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
     * @param  int         &$i    Current line index (mutated)
     * @param  int         $indent Indentation level of the '-' items
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
                break; // dedent — return to caller
            }

            if ($lineIndent > $indent) {
                throw new \RuntimeException(
                    'Unexpected indent in sequence at line ' . ($i + 1)
                );
            }

            $stripped = ltrim($line);
            $this->guardUnsupported($stripped, $i + 1);

            if (!str_starts_with($stripped, '- ') && $stripped !== '-') {
                break; // No longer a sequence item — return to caller
            }

            $itemText = ltrim(substr($stripped, 1)); // strip leading '-'
            $i++;

            if ($itemText !== '') {
                // Support common YAML pattern "- key: value" (sequence of maps).
                $colonPos = strpos($itemText, ':');
                if ($colonPos !== false) {
                    $firstKey = trim(substr($itemText, 0, $colonPos));
                    if ($firstKey !== '' && preg_match('/^[A-Za-z0-9_\-]+$/', $firstKey)) {
                        $item = [];
                        $rest = ltrim(substr($itemText, $colonPos + 1));
                        $item[$firstKey] = ($rest !== '') ? $this->parseScalar($rest) : null;

                        // Merge additional nested key/value lines belonging to this item.
                        $nextIndent = $this->peekIndent($i);
                        if ($nextIndent !== null && $nextIndent > $indent) {
                            $tail = $this->parseMap($i, $nextIndent);
                            foreach ($tail as $k => $v) {
                                $item[$k] = $v;
                            }
                        }

                        $seq[] = $item;
                        continue;
                    }
                }

                $seq[] = $this->parseScalar($itemText);
            } else {
                // Nested block under sequence item
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

    // ── Scalar parsing ────────────────────────────────────────────────────────

    /**
     * Convert a raw scalar string to its PHP equivalent (string, int, float, bool, null).
     */
    private function parseScalar(string $raw): mixed
    {
        $v = trim($raw);

        // Allow explicit empty sequence literal used in some scenario files.
        if ($v === '[]') {
            return [];
        }

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

    // ── Helpers ───────────────────────────────────────────────────────────────

    private function indentOf(string $line): int
    {
        return strlen($line) - strlen(ltrim($line));
    }

    private function isComment(string $line): bool
    {
        $trimmed = ltrim($line);
        return str_starts_with($trimmed, '#');
    }

    /**
     * Return the indentation of the next non-blank, non-comment line, or null.
     */
    private function peekIndent(int $i): ?int
    {
        while ($i < $this->count) {
            $line = $this->lines[$i];
            if ($line !== '' && !$this->isComment($line)) {
                $trimmed = ltrim($line);
                if ($trimmed === '---' || $trimmed === '...') {
                    $i++;
                    continue;
                }
                return $this->indentOf($line);
            }
            $i++;
        }
        return null;
    }

    /**
     * Return the content of the next non-blank, non-comment line, or ''.
     */
    private function peekLine(int $i): string
    {
        while ($i < $this->count) {
            $line = $this->lines[$i];
            if ($line !== '' && !$this->isComment($line)) {
                $trimmed = ltrim($line);
                if ($trimmed === '---' || $trimmed === '...') {
                    $i++;
                    continue;
                }
                return $line;
            }
            $i++;
        }
        return '';
    }

    /**
     * Throw on syntax this parser deliberately does not support.
     *
     * @throws \InvalidArgumentException
     */
    private function guardUnsupported(string $value, string|int $lineContext): void
    {
        $stripped = $value;
        $lineNumber = (string) $lineContext;
        // Anchors (& at line start or inline as value).
        if (str_starts_with($stripped, '&') || preg_match('/:\s*&/', $stripped)) {
            throw new \InvalidArgumentException(
                "YAML anchors are not supported (line {$lineNumber})"
            );
        }
        // Aliases (* at line start or inline as value).
        if (str_starts_with($stripped, '*') || preg_match('/:\s*\*/', $stripped)) {
            throw new \InvalidArgumentException(
                "YAML aliases are not supported (line {$lineNumber})"
            );
        }
        // Tags (! at line start or inline as value).
        if (str_starts_with($stripped, '!') || preg_match('/:\s*!/', $stripped)) {
            throw new \InvalidArgumentException(
                "YAML tags are not supported (line {$lineNumber})"
            );
        }
        // Flow mappings / sequences (at line start or inline as value).
        $hasInlineFlow = preg_match('/:\s*[{[]/', $stripped) === 1;
        $isExplicitEmptySeq = preg_match('/:\s*\[\s*\]\s*$/', $stripped) === 1;
        if (str_starts_with($stripped, '{') || str_starts_with($stripped, '[')
            || ($hasInlineFlow && !$isExplicitEmptySeq)) {
            throw new \InvalidArgumentException(
                "YAML flow style is not supported (line {$lineNumber})"
            );
        }
        // Block-scalars.
        if (preg_match('/^[^:]+:\s*[|>]/', $stripped)) {
            throw new \InvalidArgumentException(
                "YAML block-scalars (| and >) are not supported (line {$lineNumber})"
            );
        }
    }
}
