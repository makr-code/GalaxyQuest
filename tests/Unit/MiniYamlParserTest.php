<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for lib/MiniYamlParser.php
 *
 * Tests cover:
 *  - Scalar types: unquoted strings, quoted strings (single/double),
 *    integers, floats, booleans, null
 *  - Block mappings (flat and nested)
 *  - Block sequences
 *  - Comments and blank lines (skipped)
 *  - Document markers (--- / ...) skipped
 *  - Inline comment stripping
 *  - Unsupported feature rejection (anchors, aliases, tags, flow-style, block-scalars)
 */
final class MiniYamlParserTest extends TestCase
{
    private function parse(string $yaml): array
    {
        return (new MiniYamlParser())->parse($yaml);
    }

    // ── Scalars ───────────────────────────────────────────────────────────────

    public function testUnquotedString(): void
    {
        $r = $this->parse('name: Vor Tak');
        self::assertSame('Vor Tak', $r['name']);
    }

    public function testDoubleQuotedString(): void
    {
        $r = $this->parse('display_name: "Die Eisenflotte"');
        self::assertSame('Die Eisenflotte', $r['display_name']);
    }

    public function testDoubleQuotedStringWithEscapedQuote(): void
    {
        $r = $this->parse('title: "Say \\"hello\\""');
        self::assertSame('Say "hello"', $r['title']);
    }

    public function testSingleQuotedString(): void
    {
        $r = $this->parse("motto: 'Stärke durch Spektakel'");
        self::assertSame('Stärke durch Spektakel', $r['motto']);
    }

    public function testSingleQuotedStringWithEscapedSingleQuote(): void
    {
        $r = $this->parse("value: 'it''s here'");
        self::assertSame("it's here", $r['value']);
    }

    public function testInteger(): void
    {
        $r = $this->parse('strength: 7');
        self::assertSame(7, $r['strength']);
    }

    public function testNegativeInteger(): void
    {
        $r = $this->parse('delta: -3');
        self::assertSame(-3, $r['delta']);
    }

    public function testFloat(): void
    {
        $r = $this->parse('ratio: 3.14');
        self::assertSame(3.14, $r['ratio']);
    }

    public function testBooleanTrue(): void
    {
        $r = $this->parse('active: true');
        self::assertTrue($r['active']);
    }

    public function testBooleanFalse(): void
    {
        $r = $this->parse('active: false');
        self::assertFalse($r['active']);
    }

    public function testBooleanYes(): void
    {
        $r = $this->parse('enabled: yes');
        self::assertTrue($r['enabled']);
    }

    public function testBooleanNo(): void
    {
        $r = $this->parse('enabled: no');
        self::assertFalse($r['enabled']);
    }

    public function testNullTilde(): void
    {
        $r = $this->parse('value: ~');
        self::assertNull($r['value']);
    }

    public function testNullKeyword(): void
    {
        $r = $this->parse('value: null');
        self::assertNull($r['value']);
    }

    public function testNullEmptyValue(): void
    {
        $r = $this->parse("key:\nother: x");
        self::assertNull($r['key']);
        self::assertSame('x', $r['other']);
    }

    // ── Inline comments ───────────────────────────────────────────────────────

    public function testInlineCommentStripped(): void
    {
        $r = $this->parse('threat: low # this is stripped');
        self::assertSame('low', $r['threat']);
    }

    // ── Block mappings ────────────────────────────────────────────────────────

    public function testFlatMapping(): void
    {
        $yaml = <<<YAML
            division_code: parade
            display_name: "Ehrenlegion"
            threat_level: low
            YAML;

        $r = $this->parse($yaml);
        self::assertSame('parade', $r['division_code']);
        self::assertSame('Ehrenlegion', $r['display_name']);
        self::assertSame('low', $r['threat_level']);
    }

    public function testNestedMapping(): void
    {
        $yaml = <<<YAML
            notable_officer:
              name: "Admiral Müller"
              rank: Admiral
            YAML;

        $r = $this->parse($yaml);
        self::assertIsArray($r['notable_officer']);
        self::assertSame('Admiral Müller', $r['notable_officer']['name']);
        self::assertSame('Admiral', $r['notable_officer']['rank']);
    }

    public function testDeeplyNestedMapping(): void
    {
        $yaml = <<<YAML
            level1:
              level2:
                level3: deep
            YAML;

        $r = $this->parse($yaml);
        self::assertSame('deep', $r['level1']['level2']['level3']);
    }

    // ── Block sequences ───────────────────────────────────────────────────────

    public function testSequence(): void
    {
        $yaml = <<<YAML
            tech:
              - "Kinetische Waffen"
              - "Massenschiffe"
              - "KI-Systeme"
            YAML;

        $r = $this->parse($yaml);
        self::assertCount(3, $r['tech']);
        self::assertSame('Kinetische Waffen', $r['tech'][0]);
        self::assertSame('Massenschiffe', $r['tech'][1]);
    }

    public function testTopLevelSequenceItemsMixedWithMapping(): void
    {
        $yaml = <<<YAML
            name: fleet
            weapons:
              - cannon
              - laser
            doctrine: mass
            YAML;

        $r = $this->parse($yaml);
        self::assertSame('fleet', $r['name']);
        self::assertSame(['cannon', 'laser'], $r['weapons']);
        self::assertSame('mass', $r['doctrine']);
    }

    // ── Comments and blank lines ──────────────────────────────────────────────

    public function testCommentsAndBlankLinesSkipped(): void
    {
        $yaml = <<<YAML
            # Iron Fleet division

            division_code: parade

            # Ceremonial unit
            display_name: "Ehrenlegion"
            YAML;

        $r = $this->parse($yaml);
        self::assertSame('parade', $r['division_code']);
        self::assertSame('Ehrenlegion', $r['display_name']);
    }

    // ── Document markers ──────────────────────────────────────────────────────

    public function testDocumentStartMarkerSkipped(): void
    {
        $yaml = <<<YAML
            ---
            name: fleet
            YAML;

        $r = $this->parse($yaml);
        self::assertSame('fleet', $r['name']);
    }

    // ── Empty input ───────────────────────────────────────────────────────────

    public function testEmptyInput(): void
    {
        $r = $this->parse('');
        self::assertSame([], $r);
    }

    public function testOnlyComments(): void
    {
        $r = $this->parse("# just a comment\n# another");
        self::assertSame([], $r);
    }

    // ── Unsupported feature rejection ─────────────────────────────────────────

    public function testAnchorThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/anchor/i');
        $this->parse('key: &anchor value');
    }

    public function testAliasThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->parse("base: &b val\nother: *b");
    }

    public function testTagThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/tag/i');
        $this->parse('key: !str value');
    }

    public function testFlowMappingThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/flow/i');
        $this->parse('key: {a: 1}');
    }

    public function testFlowSequenceThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/flow/i');
        $this->parse('key: [1, 2]');
    }

    public function testLiteralBlockScalarThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/block-scalar/i');
        $this->parse("key: |\n  multi\n  line");
    }

    public function testFoldedBlockScalarThrows(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        $this->expectExceptionMessageMatches('/block-scalar/i');
        $this->parse("key: >\n  folded");
    }

    // ── Real mini-faction YAML snippet ───────────────────────────────────────

    public function testParadeMiniFactionSnippet(): void
    {
        $yaml = <<<YAML
            division_code: parade
            display_name: "Ehrenlegion"
            role: "Zeremonielle Machtdemonstrationen"
            motto: "Stärke durch Spektakel"
            personnel_scale: full_division
            threat_level: low
            known_intel: detailed
            current_objective: "Vierteljährliche Militärparaden auf Saturn-Kolonie"
            notable_officer:
              name: "Vizeadmiral Klaus Brenner"
              rank: "Vizeadmiral"
              specialization: "Zeremonielle Kriegsführung"
            YAML;

        $r = $this->parse($yaml);

        self::assertSame('parade', $r['division_code']);
        self::assertSame('Ehrenlegion', $r['display_name']);
        self::assertSame('low', $r['threat_level']);
        self::assertIsArray($r['notable_officer']);
        self::assertSame('Vizeadmiral Klaus Brenner', $r['notable_officer']['name']);
    }
}
