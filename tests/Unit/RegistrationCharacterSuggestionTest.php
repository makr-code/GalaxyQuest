<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../lib/RegistrationCharacterSuggestion.php';

final class RegistrationCharacterSuggestionTest extends TestCase
{
    public function testParsesValidSuggestionWithLoreCharacters(): void
    {
        self::assertSame(
            [
                'name' => 'DrakThuun',
                'background' => 'Auf Drak’Thuun lernte diese Person, Stärke mit Verantwortung zu verbinden.',
            ],
            RegistrationCharacterSuggestion::parse(
                '{"name":" DrakThuun ","background":" Auf Drak’Thuun lernte diese Person, Stärke mit Verantwortung zu verbinden. "}'
            )
        );
    }

    public function testRejectsNamesThatCannotBeSavedAsCommanderNames(): void
    {
        foreach (['Kael Thuun', 'Kael-Thuun', 'A'] as $name) {
            try {
                RegistrationCharacterSuggestion::parse(json_encode([
                    'name' => $name,
                    'background' => 'Eine kurze Geschichte aus der Lore.',
                ], JSON_THROW_ON_ERROR));
                self::fail('Invalid commander name was accepted: ' . $name);
            } catch (UnexpectedValueException) {
                self::assertTrue(true);
            }
        }
    }

    public function testRejectsInvalidJsonAndOverlongBackgrounds(): void
    {
        foreach ([
            'not json',
            json_encode(['name' => 'LoreCommander', 'background' => str_repeat('x', 501)], JSON_THROW_ON_ERROR),
        ] as $response) {
            try {
                RegistrationCharacterSuggestion::parse($response);
                self::fail('Invalid model response was accepted.');
            } catch (UnexpectedValueException) {
                self::assertTrue(true);
            }
        }
    }

    public function testPromptUsesOnlySelectedSpeciesLoreAndCanonicalNameExamples(): void
    {
        $messages = RegistrationCharacterSuggestion::messages([
            'display_name' => 'Vor’Tak',
            'species_type' => 'Reptiloide Strategen',
            'homeworld' => 'Drak’Thuun',
            'description' => 'Ehre und Disziplin prägen ihre Kultur.',
            'society' => ['government' => 'Hierarchisch-Militärisch', 'culture' => 'Ehre, Disziplin, Stärke'],
            'important_npcs' => [
                ['name' => 'General Drak’Mol'],
                ['name' => 'Stratega T’Asha'],
            ],
            'secret_ai_prompt' => 'Do not include this field.',
        ]);
        $context = json_decode(substr($messages[1]['content'], strpos($messages[1]['content'], "\n") + 1), true, 512, JSON_THROW_ON_ERROR);

        self::assertSame('Vor’Tak', $context['species']);
        self::assertSame('Drak’Thuun', $context['homeworld']);
        self::assertSame(['General Drak’Mol', 'Stratega T’Asha'], $context['name_style_examples']);
        self::assertStringNotContainsString('secret_ai_prompt', $messages[1]['content']);
        self::assertStringContainsString('editable player-commander', $messages[0]['content']);
    }
}
