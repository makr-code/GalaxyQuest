<?php

declare(strict_types=1);

/**
 * OllamaSchemaValidator
 *
 * Lightweight JSON-Schema validator for Ollama structured-output responses.
 *
 * Supports a strict subset of JSON Schema sufficient to validate Ollama's
 * structured-output feature (type, properties, required, enum, minLength,
 * maxLength).  Full JSON Schema draft support is intentionally out of scope —
 * use a dedicated library if complex schemas are needed.
 *
 * Usage:
 *   $ok = OllamaSchemaValidator::validate($llmResponseText, $schema);
 *
 * License: MIT — makr-code/GalaxyQuest
 */
final class OllamaSchemaValidator
{
    /**
     * Validate a JSON string against a JSON Schema array.
     *
     * Returns true when the JSON parses successfully and satisfies the schema.
     * Returns false on parse failure or schema violation.
     *
     * @param string               $json   Raw JSON string (e.g. LLM response text)
     * @param array<string, mixed> $schema JSON Schema array
     */
    public static function validate(string $json, array $schema): bool
    {
        $trimmed = trim($json);
        if ($trimmed === '') {
            return false;
        }

        $data = json_decode($trimmed, true);
        if (!is_array($data) && !is_scalar($data) && $data !== null) {
            return false;
        }
        if (json_last_error() !== JSON_ERROR_NONE) {
            return false;
        }

        return self::checkValue($data, $schema);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /**
     * @param mixed                $value
     * @param array<string, mixed> $schema
     */
    private static function checkValue(mixed $value, array $schema): bool
    {
        $type = $schema['type'] ?? null;

        if ($type !== null) {
            if (!self::checkType($value, (string) $type)) {
                return false;
            }
        }

        // Object-level checks
        if ($type === 'object' || (is_array($value) && !array_is_list($value))) {
            if (!is_array($value)) {
                return false;
            }

            // required
            foreach ((array) ($schema['required'] ?? []) as $requiredKey) {
                if (!array_key_exists((string) $requiredKey, $value)) {
                    return false;
                }
            }

            // properties — recurse
            $properties = $schema['properties'] ?? null;
            if (is_array($properties)) {
                foreach ($properties as $propName => $propSchema) {
                    if (!array_key_exists($propName, $value)) {
                        continue; // optional property absent → ok
                    }
                    if (is_array($propSchema) && !self::checkValue($value[$propName], $propSchema)) {
                        return false;
                    }
                }
            }
        }

        // Array-level checks
        if ($type === 'array') {
            if (!is_array($value) || !array_is_list($value)) {
                return false;
            }
            $itemSchema = $schema['items'] ?? null;
            if (is_array($itemSchema)) {
                foreach ($value as $item) {
                    if (!self::checkValue($item, $itemSchema)) {
                        return false;
                    }
                }
            }
        }

        // String-level checks
        if ($type === 'string' && is_string($value)) {
            if (isset($schema['minLength']) && strlen($value) < (int) $schema['minLength']) {
                return false;
            }
            if (isset($schema['maxLength']) && strlen($value) > (int) $schema['maxLength']) {
                return false;
            }
        }

        // enum
        if (array_key_exists('enum', $schema)) {
            $enum = (array) $schema['enum'];
            if (!in_array($value, $enum, true)) {
                return false;
            }
        }

        return true;
    }

    private static function checkType(mixed $value, string $type): bool
    {
        return match ($type) {
            'string'  => is_string($value),
            'integer' => is_int($value),
            'number'  => is_int($value) || is_float($value),
            'boolean' => is_bool($value),
            'null'    => $value === null,
            'array'   => is_array($value) && array_is_list($value),
            'object'  => is_array($value) && !array_is_list($value),
            default   => true, // unknown types pass through
        };
    }
}
