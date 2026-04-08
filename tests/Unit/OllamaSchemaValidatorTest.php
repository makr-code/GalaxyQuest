<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/OllamaSchemaValidator.php';

/**
 * Unit tests for OllamaSchemaValidator.
 *
 * Tests are fully isolated: no DB, no HTTP, no external dependencies.
 */
final class OllamaSchemaValidatorTest extends TestCase
{
    // ── Trivial cases ─────────────────────────────────────────────────────────

    public function testEmptyJsonReturnsFalse(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('', []));
    }

    public function testWhitespaceOnlyReturnsFalse(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('   ', []));
    }

    public function testInvalidJsonReturnsFalse(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('{not json}', []));
    }

    // ── Empty schema ──────────────────────────────────────────────────────────

    public function testValidJsonWithEmptySchemaReturnsTrue(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('{"foo": "bar"}', []));
    }

    // ── Type checks ───────────────────────────────────────────────────────────

    public function testTypeStringPassesForString(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('"hello"', ['type' => 'string']));
    }

    public function testTypeStringFailsForNumber(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('42', ['type' => 'string']));
    }

    public function testTypeIntegerPassesForInt(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('7', ['type' => 'integer']));
    }

    public function testTypeIntegerFailsForFloat(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('3.14', ['type' => 'integer']));
    }

    public function testTypeNumberPassesForFloat(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('3.14', ['type' => 'number']));
    }

    public function testTypeNumberPassesForInt(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('42', ['type' => 'number']));
    }

    public function testTypeBooleanPassesForTrue(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('true', ['type' => 'boolean']));
    }

    public function testTypeBooleanFailsForString(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('"true"', ['type' => 'boolean']));
    }

    public function testTypeNullPassesForNull(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('null', ['type' => 'null']));
    }

    public function testTypeNullFailsForFalse(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('false', ['type' => 'null']));
    }

    public function testTypeArrayPassesForJsonArray(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('[1,2,3]', ['type' => 'array']));
    }

    public function testTypeArrayFailsForObject(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('{"a":1}', ['type' => 'array']));
    }

    public function testTypeObjectPassesForJsonObject(): void
    {
        $this->assertTrue(OllamaSchemaValidator::validate('{"a":1}', ['type' => 'object']));
    }

    public function testTypeObjectFailsForArray(): void
    {
        $this->assertFalse(OllamaSchemaValidator::validate('[1,2]', ['type' => 'object']));
    }

    // ── Required fields ───────────────────────────────────────────────────────

    public function testRequiredFieldPresentPasses(): void
    {
        $schema = ['type' => 'object', 'required' => ['reply']];
        $this->assertTrue(OllamaSchemaValidator::validate('{"reply":"hello"}', $schema));
    }

    public function testRequiredFieldMissingFails(): void
    {
        $schema = ['type' => 'object', 'required' => ['reply']];
        $this->assertFalse(OllamaSchemaValidator::validate('{"mood":"neutral"}', $schema));
    }

    public function testMultipleRequiredFieldsBothPresentPass(): void
    {
        $schema = ['type' => 'object', 'required' => ['reply', 'mood']];
        $json   = '{"reply":"hi","mood":"neutral"}';
        $this->assertTrue(OllamaSchemaValidator::validate($json, $schema));
    }

    public function testMultipleRequiredOneMissingFails(): void
    {
        $schema = ['type' => 'object', 'required' => ['reply', 'mood']];
        $json   = '{"reply":"hi"}';
        $this->assertFalse(OllamaSchemaValidator::validate($json, $schema));
    }

    // ── Properties type validation ────────────────────────────────────────────

    public function testPropertyTypeCorrectPasses(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'reply' => ['type' => 'string'],
            ],
        ];
        $this->assertTrue(OllamaSchemaValidator::validate('{"reply":"hello"}', $schema));
    }

    public function testPropertyTypeWrongFails(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'reply' => ['type' => 'string'],
            ],
        ];
        $this->assertFalse(OllamaSchemaValidator::validate('{"reply":123}', $schema));
    }

    public function testOptionalPropertyAbsentStillPasses(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'reply' => ['type' => 'string'],
                'mood'  => ['type' => 'string'],
            ],
            'required' => ['reply'],
        ];
        $this->assertTrue(OllamaSchemaValidator::validate('{"reply":"hi"}', $schema));
    }

    // ── enum ──────────────────────────────────────────────────────────────────

    public function testEnumValuePresentPasses(): void
    {
        $schema = ['enum' => ['neutral', 'hostile', 'friendly']];
        $this->assertTrue(OllamaSchemaValidator::validate('"neutral"', $schema));
    }

    public function testEnumValueAbsentFails(): void
    {
        $schema = ['enum' => ['neutral', 'hostile', 'friendly']];
        $this->assertFalse(OllamaSchemaValidator::validate('"confused"', $schema));
    }

    public function testEnumInsidePropertyPasses(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'mood' => [
                    'type' => 'string',
                    'enum' => ['neutral', 'hostile', 'friendly', 'fearful', 'amused'],
                ],
            ],
        ];
        $this->assertTrue(OllamaSchemaValidator::validate('{"mood":"amused"}', $schema));
    }

    public function testEnumInsidePropertyWrongValueFails(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'mood' => [
                    'type' => 'string',
                    'enum' => ['neutral', 'hostile'],
                ],
            ],
        ];
        $this->assertFalse(OllamaSchemaValidator::validate('{"mood":"confused"}', $schema));
    }

    // ── minLength / maxLength ─────────────────────────────────────────────────

    public function testMinLengthPassesWhenMet(): void
    {
        $schema = ['type' => 'string', 'minLength' => 3];
        $this->assertTrue(OllamaSchemaValidator::validate('"hello"', $schema));
    }

    public function testMinLengthFailsWhenNotMet(): void
    {
        $schema = ['type' => 'string', 'minLength' => 10];
        $this->assertFalse(OllamaSchemaValidator::validate('"hi"', $schema));
    }

    public function testMaxLengthPassesWhenMet(): void
    {
        $schema = ['type' => 'string', 'maxLength' => 20];
        $this->assertTrue(OllamaSchemaValidator::validate('"hello"', $schema));
    }

    public function testMaxLengthFailsWhenExceeded(): void
    {
        $schema = ['type' => 'string', 'maxLength' => 3];
        $this->assertFalse(OllamaSchemaValidator::validate('"toolongstring"', $schema));
    }

    // ── NPC chat schema (integration-style) ───────────────────────────────────

    public function testNpcChatSchemaValidReply(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'reply' => ['type' => 'string'],
                'mood'  => [
                    'type' => 'string',
                    'enum' => ['neutral', 'hostile', 'friendly', 'fearful', 'amused'],
                ],
            ],
            'required' => ['reply'],
        ];
        $json = '{"reply":"Greetings, traveller.","mood":"neutral"}';
        $this->assertTrue(OllamaSchemaValidator::validate($json, $schema));
    }

    public function testNpcChatSchemaMissingReplyFails(): void
    {
        $schema = [
            'type' => 'object',
            'required' => ['reply'],
        ];
        $this->assertFalse(OllamaSchemaValidator::validate('{"mood":"hostile"}', $schema));
    }

    public function testNpcChatSchemaInvalidMoodFails(): void
    {
        $schema = [
            'type' => 'object',
            'properties' => [
                'mood' => [
                    'type' => 'string',
                    'enum' => ['neutral', 'hostile', 'friendly', 'fearful', 'amused'],
                ],
            ],
            'required' => ['reply'],
        ];
        $json = '{"reply":"hi","mood":"sleepy"}';
        $this->assertFalse(OllamaSchemaValidator::validate($json, $schema));
    }

    // ── Array items ───────────────────────────────────────────────────────────

    public function testArrayItemsValidPasses(): void
    {
        $schema = [
            'type'  => 'array',
            'items' => ['type' => 'string'],
        ];
        $this->assertTrue(OllamaSchemaValidator::validate('["a","b","c"]', $schema));
    }

    public function testArrayItemsInvalidFails(): void
    {
        $schema = [
            'type'  => 'array',
            'items' => ['type' => 'string'],
        ];
        $this->assertFalse(OllamaSchemaValidator::validate('["a",2,"c"]', $schema));
    }
}
