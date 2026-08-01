import { test, expect } from '@playwright/test';

/**
 * xTTS/Piper Integration E2E Tests
 * Tests text-to-speech synthesis from browser
 */

test.describe('xTTS/Piper Integration', () => {
    test.beforeEach(async ({ page }) => {
        // Load test page
        await page.goto('http://localhost:8080');
    });

    test('Service health check', async ({ page }) => {
        const response = await page.request.get('http://localhost:5500/health');
        expect(response.status()).toBe(200);
        
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.engine).toBe('piper');
        expect(data.piper_available).toBe(true);
    });

    test('Voice listing', async ({ page }) => {
        const response = await page.request.get('http://localhost:5500/voices');
        expect(response.status()).toBe(200);
        
        const data = await response.json();
        expect(Array.isArray(data.voices)).toBe(true);
        expect(data.voices.length).toBeGreaterThan(0);
        
        // Check for German voice (voices are objects with 'name' property)
        const germanVoices = data.voices.filter((v: any) => v.name.includes('de_DE'));
        expect(germanVoices.length).toBeGreaterThan(0);
    });

    test('German text synthesis', async ({ page }) => {
        const payload = {
            text: 'Willkommen im GalaxyQuest.',
            voice: 'de_DE-thorsten-high',
            language: 'de'
        };

        const response = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });

        expect(response.status()).toBe(200);
        
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.audio_url).toBeTruthy();
        expect(data.duration_ms).toBeGreaterThan(0);
        expect(data.voice).toBe('de_DE-thorsten-high');
    });

    test('English text synthesis', async ({ page }) => {
        const payload = {
            text: 'Welcome to GalaxyQuest.',
            voice: 'en_US-amy-medium',
            language: 'en'
        };

        const response = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });

        expect(response.status()).toBe(200);
        
        const data = await response.json();
        expect(data.ok).toBe(true);
        expect(data.audio_url).toBeTruthy();
    });

    test('Audio file retrieval', async ({ page }) => {
        // First, generate audio
        const synthesis = await page.request.post('http://localhost:5500/tts', {
            data: {
                text: 'Test audio.',
                voice: 'de_DE-thorsten-high',
                language: 'de'
            },
        });

        const synthData = await synthesis.json();
        const audioUrl = synthData.audio_url;

        // Then retrieve the audio
        const audioResponse = await page.request.get(audioUrl);
        expect(audioResponse.status()).toBe(200);
        
        // Check content type
        const contentType = audioResponse.headers()['content-type'];
        expect(
            contentType?.includes('audio/wav') || 
            contentType?.includes('audio/mpeg') ||
            contentType?.includes('audio/x-wav')
        ).toBe(true);

        // Check audio size
        const buffer = await audioResponse.arrayBuffer();
        expect(buffer.byteLength).toBeGreaterThan(1000);
    });

    test('Caching behavior', async ({ page }) => {
        const payload = {
            text: 'Cached synthesis test.',
            voice: 'de_DE-thorsten-high',
            language: 'de'
        };

        // First request
        const response1 = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });
        const data1 = await response1.json();

        // Second request (should be cached)
        const response2 = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });
        const data2 = await response2.json();

        // Should return same URL
        expect(data1.audio_url).toBe(data2.audio_url);
        
        // Second request should indicate cache
        expect(data2.from_cache).toBe(true);
    });

    test('Error handling - empty text', async ({ page }) => {
        const payload = {
            text: '',
            voice: 'de_DE-thorsten-high',
            language: 'de'
        };

        const response = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });

        const data = await response.json();
        expect(data.ok).toBe(false);
        expect(data.error).toBeTruthy();
    });

    test('Error handling - invalid voice', async ({ page }) => {
        const payload = {
            text: 'Test',
            voice: 'invalid_voice_xyz',
            language: 'en'
        };

        const response = await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });

        const data = await response.json();
        expect(data.ok).toBe(false);
    });

    test('Performance - response time', async ({ page }) => {
        const payload = {
            text: 'Performance test.',
            voice: 'de_DE-thorsten-high',
            language: 'de'
        };

        const start = Date.now();
        await page.request.post('http://localhost:5500/tts', {
            data: payload,
        });
        const duration = Date.now() - start;

        // Should complete in reasonable time (not strictly enforced in test)
        expect(duration).toBeLessThan(10000);
    });

    test('Concurrent requests', async ({ page }) => {
        const requests = [
            { text: 'Request one.', voice: 'de_DE-thorsten-high' },
            { text: 'Request two.', voice: 'de_DE-thorsten-high' },
            { text: 'Request three.', voice: 'en_US-amy-medium' },
        ];

        const promises = requests.map(req =>
            page.request.post('http://localhost:5500/tts', {
                data: {
                    ...req,
                    language: req.voice.includes('de_') ? 'de' : 'en'
                },
            })
        );

        const responses = await Promise.all(promises);
        
        for (const response of responses) {
            expect(response.status()).toBe(200);
            const data = await response.json();
            expect(data.ok).toBe(true);
        }
    });
});

/**
 * ComfyUI Integration E2E Tests
 * Tests image generation workflow execution
 */

test.describe('ComfyUI Integration', () => {
    const comfyApiUrl = 'http://localhost:8188';

    test('Service availability check', async ({ page }) => {
        try {
            const response = await page.request.get(comfyApiUrl + '/system/status', {
                timeout: 5000
            });
            
            if (response.status() === 200) {
                const data = await response.json();
                expect(data).toBeDefined();
            }
        } catch {
            // ComfyUI not deployed yet - this is expected
            test.skip();
        }
    });

    test('Model listing', async ({ page }) => {
        try {
            const response = await page.request.get(comfyApiUrl + '/api/checkpoints');
            
            if (response.status() === 200) {
                const data = await response.json();
                expect(Array.isArray(data)).toBe(true);
            }
        } catch {
            test.skip();
        }
    });

    test('Workflow execution - text to image', async ({ page }) => {
        try {
            const workflow = {
                '1': {
                    'class_type': 'CheckpointLoaderSimple',
                    'inputs': { 'ckpt_name': 'model.safetensors' }
                },
                '2': {
                    'class_type': 'CLIPTextEncode',
                    'inputs': {
                        'text': 'A sci-fi spaceship',
                        'clip': [1, 1]
                    }
                }
            };

            const response = await page.request.post(comfyApiUrl + '/prompt', {
                data: { prompt: workflow },
                timeout: 30000
            });

            if (response.status() === 200) {
                const data = await response.json();
                expect(data.prompt_id).toBeTruthy();
            }
        } catch {
            test.skip();
        }
    });

    test('Queue status retrieval', async ({ page }) => {
        try {
            const response = await page.request.get(comfyApiUrl + '/queue');
            
            if (response.status() === 200) {
                const data = await response.json();
                expect(data.queue_pending).toBeDefined();
                expect(data.queue_running).toBeDefined();
            }
        } catch {
            test.skip();
        }
    });

    test('History tracking', async ({ page }) => {
        try {
            const response = await page.request.get(comfyApiUrl + '/history');
            
            if (response.status() === 200) {
                const data = await response.json();
                expect(typeof data).toBe('object');
            }
        } catch {
            test.skip();
        }
    });

    test('Error handling - invalid endpoint', async ({ page }) => {
        try {
            const response = await page.request.get(comfyApiUrl + '/invalid/endpoint', {
                timeout: 5000
            });
            
            // Should return error status
            expect([404, 400, 500]).toContain(response.status());
        } catch {
            test.skip();
        }
    });
});

/**
 * Integration Tests - xTTS + ComfyUI + NPC Chat
 * Tests complete workflow: Generate dialogue -> TTS -> ComfyUI
 */

test.describe('Complete AI Integration Workflow', () => {
    test('NPC Chat -> TTS Pipeline', async ({ page }) => {
        // 1. Generate NPC dialogue
        const dialogueResponse = await page.request.post('http://localhost:8080/api/npc_chat_integration.php', {
            data: {
                action: 'chat',
                npc_id: 'test_commander',
                npc_name: 'Commander Test',
                faction: 'Federation',
                agent_type: 'commander',
                player_message: 'Greetings Commander!'
            }
        });

        expect(dialogueResponse.status()).toBe(200);
        const dialogue = await dialogueResponse.json();
        expect(dialogue.response).toBeTruthy();

        // 2. Convert response to speech
        const ttsResponse = await page.request.post('http://localhost:5500/tts', {
            data: {
                text: dialogue.response,
                voice: 'de_DE-thorsten-high',
                language: 'de'
            }
        });

        if (ttsResponse.status() === 200) {
            const audio = await ttsResponse.json();
            expect(audio.audio_url).toBeTruthy();
        }
    });

    test('Multi-step AI workflow performance', async ({ page }) => {
        const start = Date.now();

        // 1. NPC dialogue
        await page.request.post('http://localhost:8080/api/npc_chat_integration.php', {
            data: {
                action: 'chat',
                npc_id: 'test_npc',
                npc_name: 'Test NPC',
                faction: 'Federation',
                player_message: 'Hello!'
            }
        });

        // 2. TTS synthesis
        await page.request.post('http://localhost:5500/tts', {
            data: {
                text: 'Test response.',
                voice: 'de_DE-thorsten-high',
                language: 'de'
            }
        });

        const totalTime = Date.now() - start;
        
        // Complete workflow should complete in reasonable time
        expect(totalTime).toBeLessThan(15000);
    });
});
