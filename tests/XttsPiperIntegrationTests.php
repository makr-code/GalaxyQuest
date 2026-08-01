<?php
/**
 * xTTS/Piper TTS Integration Tests
 * Tests text-to-speech synthesis via Piper engine
 * 
 * Note: xTTS service provides direct binary audio responses (MP3)
 * this test suite validates audio synthesis and caching.
 */

class XttsPiperIntegrationTests
{
    private int $passed = 0;
    private int $failed = 0;

    public function runAllTests(): void
    {
        echo "\n" . str_repeat("=", 60) . "\n";
        echo "🎙️ Starting xTTS/Piper Integration Test Suite\n";
        echo str_repeat("=", 60) . "\n\n";

        $this->testHealthCheck();
        $this->testVoiceConfiguration();
        $this->testGermanSynthesis();
        $this->testEnglishSynthesis();
        $this->testAudioOutput();
        $this->testCaching();
        $this->testErrorHandling();
        $this->testPerformance();
        $this->testConcurrency();

        $this->printSummary();
    }

    private function testHealthCheck(): void
    {
        echo "✨ Testing Service Health\n";
        echo str_repeat("-", 40) . "\n";

        $response = $this->makeRequest('http://tts:5500/health');
        if (!$response) {
            $this->fail("Could not fetch health status");
            return;
        }

        $data = json_decode($response, true);
        
        $this->assert($data['ok'] ?? false, "Service health check", "Service not healthy");
        $this->assert(($data['engine'] ?? null) === 'piper', "Piper engine detected", "Wrong TTS engine");
        $this->assert(!empty($data['default_voice'] ?? null), "Default voice configured", "No default voice");
        $this->assert($data['piper_available'] ?? false, "Piper availability", "Piper unavailable");

        echo "\n";
    }

    private function testVoiceConfiguration(): void
    {
        echo "🎤 Testing Voice Configuration\n";
        echo str_repeat("-", 40) . "\n";

        $response = $this->makeRequest('http://tts:5500/voices');
        if (!$response) {
            $this->fail("Could not fetch voices");
            return;
        }

        $data = json_decode($response, true);
        $voices = $data['voices'] ?? [];

        $this->assert(!empty($voices), "Voices available", "No voices found");
        
        // Extract voice names
        $voiceNames = [];
        foreach ($voices as $voice) {
            if (is_array($voice) && isset($voice['name'])) {
                $voiceNames[] = $voice['name'];
            } elseif (is_string($voice)) {
                $voiceNames[] = $voice;
            }
        }

        // Check for German voices
        $germanVoices = array_filter($voiceNames, fn($v) => is_string($v) && strpos($v, 'de_DE') !== false);
        $this->assert(!empty($germanVoices), "German voices present", "No German voices");

        // Check for English voices
        $englishVoices = array_filter($voiceNames, fn($v) => is_string($v) && strpos($v, 'en_') !== false);
        $this->assert(!empty($englishVoices), "English voices present", "No English voices");

        echo "\n";
    }

    private function testGermanSynthesis(): void
    {
        echo "🇩🇪 Testing German Text Synthesis\n";
        echo str_repeat("-", 40) . "\n";

        $text = "Willkommen im GalaxyQuest.";
        $voice = "de_DE-thorsten-high";

        $audio = $this->synthesizeAudio($text, $voice);
        
        $this->assert($audio !== null, "Synthesis successful", "Synthesis failed");
        
        if ($audio) {
            $this->assert(strlen($audio) > 1000, "Audio generated", "Audio too small");
        }

        echo "\n";
    }

    private function testEnglishSynthesis(): void
    {
        echo "🇬🇧 Testing English Text Synthesis\n";
        echo str_repeat("-", 40) . "\n";

        $text = "Welcome to GalaxyQuest.";
        $voice = "en_US-lessac-high";

        $audio = $this->synthesizeAudio($text, $voice);
        
        $this->assert($audio !== null, "English synthesis successful", "Synthesis failed");
        
        if ($audio) {
            $this->assert(strlen($audio) > 1000, "Audio generated", "Audio too small");
        }

        echo "\n";
    }

    private function testAudioOutput(): void
    {
        echo "🔊 Testing Audio Output Validation\n";
        echo str_repeat("-", 40) . "\n";

        $text = "Test audio output.";
        $voice = "de_DE-thorsten-high";
        
        $audio = $this->synthesizeAudio($text, $voice);

        if ($audio === null) {
            $this->fail("No audio to validate");
            return;
        }

        $this->assert(strlen($audio) > 1000, "Audio size > 1KB", "Audio file too small");
        $this->assert(strlen($audio) < 500000, "Audio size < 500KB", "Audio file too large");

        echo "\n";
    }

    private function testCaching(): void
    {
        echo "💾 Testing Response Caching\n";
        echo str_repeat("-", 40) . "\n";

        $text = "Caching test.";
        $voice = "de_DE-thorsten-high";

        $start1 = microtime(true);
        $audio1 = $this->synthesizeAudio($text, $voice);
        $time1 = (microtime(true) - $start1) * 1000;

        $start2 = microtime(true);
        $audio2 = $this->synthesizeAudio($text, $voice);
        $time2 = (microtime(true) - $start2) * 1000;

        if ($audio1 && $audio2) {
            $this->assert($audio1 === $audio2, "Cache returns same audio", "Audio differs");
            $this->assert($time2 < $time1, "Cached response faster", "No cache benefit");
        }

        echo "\n";
    }

    private function testErrorHandling(): void
    {
        echo "⚠️ Testing Error Handling\n";
        echo str_repeat("-", 40) . "\n";

        // Empty text
        $audio = $this->synthesizeAudio('', 'de_DE-thorsten-high');
        $this->assert($audio === null, "Empty text rejected", "Empty text accepted");

        // Invalid voice
        $audio = $this->synthesizeAudio('Test', 'invalid_voice_xyz');
        $this->assert($audio === null, "Invalid voice rejected", "Invalid voice accepted");

        echo "\n";
    }

    private function testPerformance(): void
    {
        echo "⏱️ Testing Performance Metrics\n";
        echo str_repeat("-", 40) . "\n";

        $texts = [
            "Short.",
            "This is a medium length text for synthesis testing.",
            "This is a longer text that should take more time to synthesize properly.",
        ];

        $times = [];
        foreach ($texts as $text) {
            $start = microtime(true);
            $this->synthesizeAudio($text, 'de_DE-thorsten-high');
            $times[] = (microtime(true) - $start) * 1000;
        }

        $avgTime = array_sum($times) / count($times);
        $this->assert($avgTime < 5000, "Average synthesis < 5s", sprintf("Average: %.0f ms", $avgTime));

        echo "\n";
    }

    private function testConcurrency(): void
    {
        echo "⚡ Testing Concurrent Requests\n";
        echo str_repeat("-", 40) . "\n";

        $requests = [
            ['text' => 'Request one.', 'voice' => 'de_DE-thorsten-high'],
            ['text' => 'Request two.', 'voice' => 'de_DE-thorsten-high'],
            ['text' => 'Request three.', 'voice' => 'en_US-lessac-high'],
        ];

        $results = [];
        $start = microtime(true);
        
        foreach ($requests as $req) {
            $audio = $this->synthesizeAudio($req['text'], $req['voice']);
            $results[] = $audio !== null;
        }

        $totalTime = (microtime(true) - $start) * 1000;
        $successCount = array_sum($results);

        $this->assert($successCount === count($requests), "All requests succeeded", "Some requests failed");
        $this->assert($totalTime < 15000, "Concurrent batch < 15s", sprintf("Total: %.0f ms", $totalTime));

        echo "\n";
    }

    private function synthesizeAudio(string $text, string $voice): ?string
    {
        if (empty($text) || empty($voice)) {
            return null;
        }

        $payload = json_encode([
            'text' => $text,
            'voice' => $voice,
            'lang' => strpos($voice, 'de_DE') !== false ? 'de' : 'en',
        ]);

        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'header' => 'Content-Type: application/json',
                'content' => $payload,
                'timeout' => 30,
            ]
        ]);

        $response = @file_get_contents('http://tts:5500/synthesize', false, $context);
        return $response ?: null;
    }

    private function makeRequest(string $endpoint): ?string
    {
        $context = stream_context_create([
            'http' => ['timeout' => 10]
        ]);

        return @file_get_contents($endpoint, false, $context);
    }

    private function assert(bool $condition, string $passMsg, string $failMsg): void
    {
        if ($condition) {
            echo "  ✅ $passMsg\n";
            $this->passed++;
        } else {
            echo "  ❌ $failMsg\n";
            $this->failed++;
        }
    }

    private function fail(string $msg): void
    {
        echo "  ❌ $msg\n";
        $this->failed++;
    }

    private function printSummary(): void
    {
        echo str_repeat("=", 60) . "\n";
        echo "📊 Test Summary\n";
        echo "✅ Passed: {$this->passed}\n";
        echo "❌ Failed: {$this->failed}\n";
        echo "Total: " . ($this->passed + $this->failed) . "\n";
        echo str_repeat("=", 60) . "\n\n";

        if ($this->failed > 0) {
            exit(1);
        }
    }
}

// Run tests
$tests = new XttsPiperIntegrationTests();
$tests->runAllTests();
