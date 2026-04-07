<?php

declare(strict_types=1);

/**
 * Minimal, strict YAML-subset parser for GalaxyQuest mini-faction specs.
 *
 * Supported subset:
 *  - Scalars: unquoted strings, double-quoted strings, integers
 *  - Block mappings  (key: value, indented with spaces)
 *  - Block sequences (- item, indented with spaces)
 *
 * Deliberately NOT supported (throws on detection):
 *  - Anchors & aliases  (&anchor, *alias)
 *  - Tags              (!! prefix)
 *  - Flow style        ({ }, [ ])
 *  - Multi-line scalars (| or > block scalars)
 *
 * No eval(), no unserialize(), no object instantiation.
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
     * Parse a block mapping starting at (and including) line $i with the
     * given base indentation.
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
     * Parse a single scalar value from the inline portion of a YAML line.
     */
    private function parseScalar(string $raw): string
    {
        $raw = trim($raw);

        // Inline comment — strip it (only outside quotes).
        $raw = $this->stripInlineComment($raw);

        // Double-quoted string.
        if (str_starts_with($raw, '"')) {
            return $this->parseDoubleQuoted($raw);
        }

        // Single-quoted string.
        if (str_starts_with($raw, "'")) {
            return $this->parseSingleQuoted($raw);
        }

        // Reject YAML aliases (*) used as values.
        if (str_starts_with($raw, '*')) {
            throw new \RuntimeException(
                "YAML anchors and aliases are not supported (value: {$raw})"
            );
        }

        // Reject inline flow mappings and sequences.
        if (str_starts_with($raw, '{') || str_starts_with($raw, '[')) {
            throw new \RuntimeException(
                "YAML flow style is not supported (value: {$raw})"
            );
        }

        // Bare scalar — return as-is (string).
        return $raw;
    }

    private function parseDoubleQuoted(string $raw): string
    {
        if (!str_ends_with($raw, '"') || strlen($raw) < 2) {
            throw new \RuntimeException("Unterminated double-quoted string: {$raw}");
        }
        $inner = substr($raw, 1, -1);
        // Basic escape sequences only.
        $inner = str_replace(['\\n', '\\t', '\\"', '\\\\'], ["\n", "\t", '"', '\\'], $inner);
        return $inner;
    }

    private function parseSingleQuoted(string $raw): string
    {
        if (!str_ends_with($raw, "'") || strlen($raw) < 2) {
            throw new \RuntimeException("Unterminated single-quoted string: {$raw}");
        }
        $inner = substr($raw, 1, -1);
        // Single-quoted YAML only escapes '' → '
        return str_replace("''", "'", $inner);
    }

    /**
     * Strip a trailing # comment from an unquoted scalar.
     * Handles only simple cases (no string-embedded hashes).
     */
    private function stripInlineComment(string $raw): string
    {
        // Only strip if there's a ' #' outside of quotes.
        if (!str_starts_with($raw, '"') && !str_starts_with($raw, "'")) {
            $pos = strpos($raw, ' #');
            if ($pos !== false) {
                $raw = rtrim(substr($raw, 0, $pos));
            }
        }
        return $raw;
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
