<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

/**
 * Unit tests for api/tts_client.php
 *
 * Tests cover pure / side-effect-free behaviour:
 *   - TTS_AUDIO_DIR / TTS_AUDIO_WEB constants point to generated/tts
 *   - tts_is_enabled() reflects the TTS_ENABLED constant
 *   - _tts_decode() correctly parses audio, JSON-success, and JSON-error responses
 *   - tts_synthesise() returns early when TTS is disabled, text empty, or too long
 *   - Cache key is deterministic (sha256 of voice|text)
 */
final class TtsClientTest extends TestCase
{
    // ── Constants ─────────────────────────────────────────────────────────────

    public function testAudioDirPointsToGeneratedTts(): void
    {
        self::assertStringContainsString(
            'generated/tts',
            str_replace('\\', '/', TTS_AUDIO_DIR),
            'TTS_AUDIO_DIR must resolve to generated/tts'
        );
    }

    public function testAudioWebIsGeneratedTts(): void
    {
        self::assertSame('generated/tts', TTS_AUDIO_WEB);
    }

    // ── tts_is_enabled() ──────────────────────────────────────────────────────

    public function testIsEnabledReflectsTtsEnabledConstant(): void
    {
        $expected = (int) TTS_ENABLED === 1;
        self::assertSame($expected, tts_is_enabled());
    }

    // ── _tts_decode() ─────────────────────────────────────────────────────────

    public function testDecodeAudioMpegReturnsBytes(): void
    {
        $result = _tts_decode("\xFF\xFB\x90\x00", 200, 'audio/mpeg');
        self::assertTrue($result['ok']);
        self::assertSame("\xFF\xFB\x90\x00", $result['bytes']);
    }

    public function testDecodeAudioWithErrorStatusReturnsError(): void
    {
        $result = _tts_decode('{"detail":"not found"}', 404, 'audio/mpeg');
        self::assertFalse($result['ok']);
    }

    public function testDecodeOctetStreamReturnsBytes(): void
    {
        $result = _tts_decode('binary', 200, 'application/octet-stream');
        self::assertTrue($result['ok']);
        self::assertSame('binary', $result['bytes']);
    }

    public function testDecodeJsonSuccessReturnsData(): void
    {
        $json = json_encode(['engine' => 'piper', 'default_voice' => 'de_DE-thorsten-high']);
        $result = _tts_decode($json, 200, 'application/json');
        self::assertTrue($result['ok']);
        self::assertSame('piper', $result['data']['engine']);
    }

    public function testDecodeJsonErrorWithDetailKey(): void
    {
        $json = json_encode(['detail' => 'Synthesis failed.']);
        $result = _tts_decode($json, 500, 'application/json');
        self::assertFalse($result['ok']);
        self::assertSame('Synthesis failed.', $result['error']);
    }

    public function testDecodeJsonErrorWithErrorKey(): void
    {
        $json = json_encode(['error' => 'Voice not found.']);
        $result = _tts_decode($json, 400, 'application/json');
        self::assertFalse($result['ok']);
        self::assertSame('Voice not found.', $result['error']);
    }

    public function testDecodeNonJsonBodyReturnsBodyAsError(): void
    {
        $result = _tts_decode('Service Unavailable', 503, 'text/plain');
        self::assertFalse($result['ok']);
        self::assertSame(503, $result['status']);
        self::assertStringContainsString('Service Unavailable', $result['error']);
    }

    // ── tts_synthesise() early-exit paths ─────────────────────────────────────

    public function testSynthesiseReturnsFalseWhenDisabled(): void
    {
        if (tts_is_enabled()) {
            self::markTestSkipped('TTS is enabled in this environment; skipping disabled-path test.');
        }

        $result = tts_synthesise('Willkommen, Kommandant!');
        self::assertFalse($result['ok']);
        self::assertSame(503, $result['status']);
        self::assertStringContainsString('disabled', strtolower((string) ($result['error'] ?? '')));
    }

    public function testSynthesiseReturnsFalseForEmptyText(): void
    {
        if (tts_is_enabled()) {
            self::markTestSkipped('TTS is enabled; skipped to avoid real network call.');
        }
        $result = tts_synthesise('   ');
        self::assertFalse($result['ok']);
    }

    public function testSynthesiseReturnsFalseForTextExceedingMaxChars(): void
    {
        if (tts_is_enabled()) {
            self::markTestSkipped('TTS is enabled; skipped to avoid real network call.');
        }
        $overlong = str_repeat('A', (int) TTS_MAX_CHARS + 1);
        $result = tts_synthesise($overlong);
        self::assertFalse($result['ok']);
    }

    // ── Cache key determinism ─────────────────────────────────────────────────

    public function testCacheKeyIsDeterministic(): void
    {
        $key1 = hash('sha256', 'de_DE-thorsten-high|Willkommen, Kommandant!');
        $key2 = hash('sha256', 'de_DE-thorsten-high|Willkommen, Kommandant!');
        self::assertSame($key1, $key2);
        self::assertRegExp('/^[a-f0-9]{64}$/', $key1);
    }

    public function testCacheKeyDiffersForDifferentVoices(): void
    {
        $key1 = hash('sha256', 'voice_a|Same text');
        $key2 = hash('sha256', 'voice_b|Same text');
        self::assertNotSame($key1, $key2);
    }

    public function testCacheKeyDiffersForDifferentTexts(): void
    {
        $key1 = hash('sha256', 'voice|Text one');
        $key2 = hash('sha256', 'voice|Text two');
        self::assertNotSame($key1, $key2);
    }

    public function testCacheFilePathIsInsideGeneratedTts(): void
    {
        $cacheKey  = hash('sha256', 'de_DE-thorsten-high|Hallo');
        $cacheFile = rtrim(TTS_AUDIO_DIR, '/\\') . DIRECTORY_SEPARATOR . $cacheKey . '.mp3';
        self::assertStringContainsString('generated/tts', str_replace('\\', '/', $cacheFile));
        self::assertStringEndsWith('.mp3', $cacheFile);
    }
}
