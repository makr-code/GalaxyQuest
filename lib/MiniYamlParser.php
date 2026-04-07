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
    /** @var string[] */
    private array $lines = [];
    private int $pos = 0;

    /**
     * Parse a YAML string and return the top-level mapping as an associative
     * PHP array. Values can be scalars, nested arrays (mappings), or lists.
     *
     * @return array<string, mixed>
     * @throws \InvalidArgumentException on unsupported YAML features.
     */
    public function parse(string $yaml): array
    {
        $this->lines = preg_split('/\r?\n/', $yaml) ?: [];
        $this->pos   = 0;

        $result = $this->parseBlock(-1);
        return is_array($result) ? $result : [];
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /**
     * Peek at the next non-empty, non-comment line without consuming it.
     * Returns ['indent' => int, 'content' => string] or null at EOF.
     *
     * @return array{indent:int,content:string}|null
     */
    private function peekNext(): ?array
    {
        $i = $this->pos;
        while ($i < count($this->lines)) {
            $raw     = $this->lines[$i];
            $stripped = rtrim($raw);

            if ($stripped === '' || ltrim($stripped) === '') {
                $i++;
                continue;
            }

            $trimmed = ltrim($stripped);

            // Skip comment lines
            if (str_starts_with($trimmed, '#')) {
                $i++;
                continue;
            }

            // Skip document markers
            if ($trimmed === '---' || $trimmed === '...') {
                $i++;
                continue;
            }

            $indent = strlen($stripped) - strlen($trimmed);
            return ['indent' => $indent, 'content' => $trimmed];
        }

        return null;
    }

    /**
     * Consume the next non-empty, non-comment, non-marker line (and any
     * leading blank/comment/marker lines before it).
     */
    private function consumeNext(): void
    {
        while ($this->pos < count($this->lines)) {
            $raw      = $this->lines[$this->pos];
            $stripped = rtrim($raw);
            $this->pos++;

            if ($stripped === '' || ltrim($stripped) === '') {
                continue;
            }

            $trimmed = ltrim($stripped);
            if (str_starts_with($trimmed, '#') || $trimmed === '---' || $trimmed === '...') {
                continue;
            }

            // Consumed a real content line – done.
            return;
        }
    }

    /**
     * Parse a block whose lines have indentation strictly greater than
     * $parentIndent. Determines automatically whether the block is a
     * mapping or a sequence.
     *
     * @return array<string|int, mixed>
     */
    private function parseBlock(int $parentIndent): array
    {
        $next = $this->peekNext();
        if ($next === null || $next['indent'] <= $parentIndent) {
            return [];
        }

        $blockIndent = $next['indent'];

        // Decide: sequence or mapping?
        if (str_starts_with($next['content'], '- ') || $next['content'] === '-') {
            return $this->parseSequence($blockIndent);
        }

        return $this->parseMapping($blockIndent);
    }

    /**
     * Parse a block sequence where every item starts with "- " at $indent.
     *
     * @return list<mixed>
     */
    private function parseSequence(int $indent): array
    {
        $result = [];

        while (true) {
            $next = $this->peekNext();
            if ($next === null || $next['indent'] !== $indent) {
                break;
            }
            if (!str_starts_with($next['content'], '- ') && $next['content'] !== '-') {
                break;
            }

            $this->consumeNext();
            $value = trim(substr($next['content'], 2));

            if ($value === '') {
                // Nested block follows
                $result[] = $this->parseBlock($indent);
            } else {
                $this->guardUnsupported($value, $next['content']);
                $result[] = $this->parseScalar($value);
            }
        }

        return $result;
    }

    /**
     * Parse a block mapping where every entry is "key: value" at $indent.
     *
     * @return array<string, mixed>
     */
    private function parseMapping(int $indent): array
    {
        $result = [];

        while (true) {
            $next = $this->peekNext();
            if ($next === null || $next['indent'] !== $indent) {
                break;
            }

            $line = $next['content'];

            // Guard against anchors/aliases/tags/flow-style at line start
            $this->guardUnsupported($line, $line);

            // Must match "key: ..." or "key:"
            if (!preg_match('/^([a-zA-Z_][a-zA-Z0-9_\- ]*):\s*(.*)$/', $line, $m)) {
                // Unrecognised line at this indent – skip
                $this->consumeNext();
                continue;
            }

            $key      = rtrim($m[1]); // keep the key as-is (spaces are valid in YAML keys)
            $valueStr = trim($m[2]);

            // Guard against unsupported features in the value portion
            $this->guardUnsupported($valueStr, $line);

            $this->consumeNext();

            if ($valueStr === '') {
                // Check whether a nested block follows at a deeper indent
                $childNext = $this->peekNext();
                if ($childNext !== null && $childNext['indent'] > $indent) {
                    $result[$key] = $this->parseBlock($indent);
                } else {
                    $result[$key] = null;
                }
            } else {
                $result[$key] = $this->parseScalar($valueStr);
            }
        }

        return $result;
    }

    /**
     * Convert a raw scalar string to its PHP equivalent.
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

    /**
     * Throw on YAML features that are outside our supported subset.
     */
    private function guardUnsupported(string $value, string $lineContext): void
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
