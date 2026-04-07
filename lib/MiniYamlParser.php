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
 * No eval(), no unserialize(), no object instantiation.
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

            // Parse  key: [value]
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
     * Parse a single scalar value from the inline portion of a YAML line.
     *
     * @return string|int|float|bool|null
     */
    private function parseScalar(string $raw): mixed
    {
        $raw = trim($raw);

        // Inline comment — strip it (only outside quotes)
        $raw = $this->stripInlineComment($raw);

        // Check for unsupported constructs in the value
        $this->guardUnsupported($raw, '(scalar)');

        // Double-quoted string
        if (str_starts_with($raw, '"')) {
            return $this->parseDoubleQuoted($raw);
        }

        // Single-quoted string
        if (str_starts_with($raw, "'")) {
            return $this->parseSingleQuoted($raw);
        }

        // Null
        if ($raw === '~' || strtolower($raw) === 'null') {
            return null;
        }

        // Boolean
        $lower = strtolower($raw);
        if (in_array($lower, ['true', 'yes', 'on'], true)) {
            return true;
        }
        if (in_array($lower, ['false', 'no', 'off'], true)) {
            return false;
        }

        // Integer
        if (preg_match('/^-?\d+$/', $raw)) {
            return (int) $raw;
        }

        // Float
        if (preg_match('/^-?\d+\.\d+$/', $raw)) {
            return (float) $raw;
        }

        return $raw;
    }

    private function parseDoubleQuoted(string $raw): string
    {
        // Strip surrounding "
        if (!str_ends_with($raw, '"') || strlen($raw) < 2) {
            return $raw;
        }
        $inner = substr($raw, 1, -1);
        // Handle common escape sequences
        $inner = str_replace(['\\"', '\\n', '\\t', '\\\\'], ['"', "\n", "\t", '\\'], $inner);
        return $inner;
    }

    private function parseSingleQuoted(string $raw): string
    {
        if (!str_ends_with($raw, "'") || strlen($raw) < 2) {
            return $raw;
        }
        $inner = substr($raw, 1, -1);
        // Only escape is '' → '
        return str_replace("''", "'", $inner);
    }

    /**
     * Strip a trailing inline comment (# ...) from a raw scalar string.
     * Does not strip inside single- or double-quoted strings.
     */
    private function stripInlineComment(string $raw): string
    {
        if (str_starts_with($raw, '"') || str_starts_with($raw, "'")) {
            return $raw; // quoted — don't strip
        }
        $pos = strpos($raw, ' #');
        if ($pos !== false) {
            return rtrim(substr($raw, 0, $pos));
        }
        return $raw;
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
     * Throw \InvalidArgumentException if the value uses an unsupported YAML feature.
     *
     * @param string     $value       The trimmed/raw value string to inspect
     * @param string|int $lineContext  For error messages (line number or label)
     */
    private function guardUnsupported(string $value, string|int $lineContext): void
    {
        $trimmed = ltrim($value);

        if (str_starts_with($trimmed, '&') || str_starts_with($trimmed, '*')) {
            throw new \InvalidArgumentException(
                "MiniYamlParser: anchors and aliases are not supported. Line: {$lineContext}"
            );
        }

        if (str_starts_with($trimmed, '!')) {
            throw new \InvalidArgumentException(
                "MiniYamlParser: YAML tags are not supported. Line: {$lineContext}"
            );
        }

        if (str_starts_with($trimmed, '{') || str_starts_with($trimmed, '[')) {
            throw new \InvalidArgumentException(
                "MiniYamlParser: flow-style collections are not supported. Line: {$lineContext}"
            );
        }

        if (preg_match('/^[|>]/', $trimmed)) {
            throw new \InvalidArgumentException(
                "MiniYamlParser: block-scalar styles (| and >) are not supported. Line: {$lineContext}"
            );
        }
    }
}
