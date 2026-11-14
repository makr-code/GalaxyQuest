<?php
declare(strict_types=1);

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/../../api/registration_portrait_generator.php';

final class RegistrationPortraitGeneratorTest extends TestCase {
    public function testPortraitWorkflowUsesSpeciesWithoutSendingPrivateCharacterFields(): void {
        $snapshot = [
            'species_code' => 'vor_tak',
            'character' => ['name' => 'PrivateCommander', 'background' => 'Private background'],
        ];
        $workflow = registration_portrait_workflow($snapshot, str_repeat('a', 32));
        $encoded = json_encode($workflow, JSON_THROW_ON_ERROR);

        self::assertStringNotContainsString('PrivateCommander', $encoded);
        self::assertStringNotContainsString('Private background', $encoded);
        self::assertStringContainsString('Vor', $workflow['2']['inputs']['text']);
        self::assertSame(['width' => 768, 'height' => 1024, 'batch_size' => 1], $workflow['4']['inputs']);
        self::assertSame('PreviewImage', $workflow['7']['class_type']);
    }

    public function testStoredAttemptMapsToTheComfyUiQueueIdentifier(): void {
        self::assertSame(
            '01234567-89ab-cdef-0123-456789abcdef',
            registration_comfyui_prompt_id('0123456789abcdef0123456789abcdef')
        );
        $this->expectException(InvalidArgumentException::class);
        registration_comfyui_prompt_id('../another-job');
    }
}
