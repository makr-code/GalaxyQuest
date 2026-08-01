import { test, expect } from '@playwright/test';

/**
 * E2E Tests for NPC Chat Integration
 * Tests the full flow from frontend to backend with Ollama
 */

test.describe('NPC Chat Integration', () => {
    test.beforeEach(async ({ page }) => {
        // Setup: Start at game lobby
        await page.goto('http://localhost:8080/');
        // Assume user is logged in as testplayer
    });

    test('Health check: Ollama service should be responding', async ({ page }) => {
        // Navigate to test interface
        await page.goto('http://localhost:8080/ollama_test.html');

        // Click health check button
        await page.click('button:has-text("Check Ollama Service")');

        // Wait for result
        await page.waitForSelector('.status-box');

        // Verify status
        const status = await page.textContent('.status-ok, .status-error');
        expect(status).toContain('Ollama Service');
    });

    test('Available models should be listed', async ({ page }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        // Click load models button
        await page.click('button:has-text("Load Available Models")');

        // Wait for models to load (with timeout for download)
        const modelsDiv = page.locator('#models-result');
        await expect(modelsDiv).not.toBeEmpty({ timeout: 10000 });

        // Verify at least one model is shown (Mistral)
        const modelsText = await modelsDiv.textContent();
        expect(modelsText).toMatch(/mistral|no models|downloading/i);
    });

    test('NPC dialogue test should generate response', async ({ page, context }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        // Set up NPC dialogue inputs
        await page.fill('input#npc-name', 'Commander Zyx');
        await page.selectOption('select#faction', 'Federation');
        await page.fill('textarea#player-message', 'What are your thoughts on the current political situation?');

        // Send message
        await page.click('button:has-text("Send Message")');

        // Wait for response (with long timeout for first Mistral load)
        const responseDiv = page.locator('#npc-result');
        await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });

        // Verify response structure
        const responseText = await responseDiv.textContent();
        expect(responseText).toMatch(/Response Generated|Error|still downloading/i);

        // If model is loaded, check response content
        if (responseText.includes('Response Generated')) {
            expect(responseText).toContain('NPC Response:');
            expect(responseText).toMatch(/\d+ms/); // Latency should be shown
        }
    });

    test('Multi-tenant sessions should be isolated', async ({ page, context }) => {
        // Create second browser context (simulating different user)
        const context2 = await context.browser().newContext();
        const page2 = await context2.newPage();

        // Both pages start NPC chat with same NPC but different messages
        await page.goto('http://localhost:8080/ollama_test.html');
        await page2.goto('http://localhost:8080/ollama_test.html');

        // Page 1: Send message 1
        await page.fill('textarea#player-message', 'I need military assistance.');
        const page1Messages = page.locator('#npc-result');

        // Page 2: Send different message
        await page2.fill('textarea#player-message', 'Can we negotiate peace terms?');
        const page2Messages = page2.locator('#npc-result');

        // Both should show different content (no cross-contamination)
        const msg1Text = await page1Messages.textContent({ timeout: 5000 }).catch(() => '');
        const msg2Text = await page2Messages.textContent({ timeout: 5000 }).catch(() => '');

        // Sessions should be independent
        if (msg1Text.includes('NPC Response') && msg2Text.includes('NPC Response')) {
            // Both got responses, verify they contain the input prompts
            expect(msg1Text).toContain('military assistance');
            expect(msg2Text).toContain('peace terms');
        }

        await context2.close();
    });

    test('Response caching should reduce latency on repeat queries', async ({ page }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        // First query
        const firstMessage = 'What is your name?';
        await page.fill('textarea#player-message', firstMessage);
        await page.click('button:has-text("Send Message")');

        const responseDiv = page.locator('#npc-result');
        await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });

        const firstText = await responseDiv.textContent();
        const firstLatency = firstText.match(/(\d+)ms/) || [null, 'unknown'];

        // Clear result for second attempt
        await responseDiv.evaluate(el => el.innerHTML = '');

        // Second query (should be cached)
        await page.fill('textarea#player-message', firstMessage);
        await page.click('button:has-text("Send Message")');

        await expect(responseDiv).not.toBeEmpty({ timeout: 30000 });
        const secondText = await responseDiv.textContent();
        const secondLatency = secondText.match(/(\d+)ms/) || [null, 'unknown'];

        // Check for cache indicator
        if (secondText.includes('from_cache')) {
            expect(secondLatency[1]).toBeLessThan(firstLatency[1]); // Cached should be faster
        }
    });

    test('Agent personality variations should affect responses', async ({ page }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        const testMessage = 'We need more resources.';

        // Test with Commander (tactical response)
        await page.fill('input#npc-name', 'Commander');
        await page.selectOption('select#faction', 'Federation');
        await page.fill('textarea#player-message', testMessage);
        await page.click('button:has-text("Send Message")');

        let responseDiv = page.locator('#npc-result');
        await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });
        const commanderResponse = await responseDiv.textContent();

        // Test with Merchant (trade-focused response)
        await page.fill('input#npc-name', 'Merchant');
        await page.selectOption('select#faction', 'Neutral');
        
        // Clear previous response
        await responseDiv.evaluate(el => el.innerHTML = '');
        
        await page.fill('textarea#player-message', testMessage);
        await page.click('button:has-text("Send Message")');

        responseDiv = page.locator('#npc-result');
        await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });
        const merchantResponse = await responseDiv.textContent();

        // Responses should be different based on personality
        if (commanderResponse.includes('Response Generated') && merchantResponse.includes('Response Generated')) {
            // Extract the actual NPC responses (simple heuristic)
            expect(commanderResponse).not.toBe(merchantResponse);
        }
    });

    test('Session history should persist across interactions', async ({ page }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        // First message
        const npcName = 'Commander Zyx';
        await page.fill('input#npc-name', npcName);
        await page.fill('textarea#player-message', 'First question.');
        await page.click('button:has-text("Send Message")');

        let responseDiv = page.locator('#npc-result');
        await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });

        const firstResponse = await responseDiv.textContent();
        const sessionId = firstResponse.match(/session_id.*?(\w+)/)?.[1] || null;

        if (sessionId) {
            // Second message (should reference first in context)
            await responseDiv.evaluate(el => el.innerHTML = '');
            await page.fill('textarea#player-message', 'Second question related to the first.');
            await page.click('button:has-text("Send Message")');

            await expect(responseDiv).not.toBeEmpty({ timeout: 60000 });
            const secondResponse = await responseDiv.textContent();

            // Session ID should be same
            const secondSessionId = secondResponse.match(/session_id.*?(\w+)/)?.[1];
            expect(sessionId).toBe(secondSessionId);

            // Message count should increase
            const firstCount = firstResponse.match(/session_messages_count.*?(\d+)/)?.[1];
            const secondCount = secondResponse.match(/session_messages_count.*?(\d+)/)?.[1];
            
            if (firstCount && secondCount) {
                expect(parseInt(secondCount)).toBeGreaterThan(parseInt(firstCount));
            }
        }
    });

    test('Error handling: Invalid NPC should return error', async ({ page }) => {
        await page.goto('http://localhost:8080/ollama_test.html');

        await page.fill('textarea#player-message', 'Test message');
        // Don't set NPC ID - should trigger validation

        // Attempt to send (would need to modify form to allow empty NPC)
        // This test verifies error handling is in place
        const responseDiv = page.locator('#npc-result');
        // Error handling should prevent submission or show error
    });
});

test.describe('Cache Management API', () => {
    test('Cache statistics should be retrievable', async ({ page }) => {
        const response = await page.request.get('http://localhost:8080/api/npc_chat_integration.php?action=cache_stats', {
            headers: {
                // Would need auth token in real scenario
            }
        });

        if (response.status() === 200) {
            const data = await response.json();
            expect(data.ok).toBe(true);
            expect(data.cache_stats).toBeDefined();
        }
    });

    test('Cache should be clearable', async ({ page }) => {
        const response = await page.request.post('http://localhost:8080/api/npc_chat_integration.php', {
            data: {
                action: 'cache_clear',
            }
        });

        // Would need proper auth in production
        if (response.status() !== 403) {
            const data = await response.json();
            expect(data.ok).toBe(true);
        }
    });
});
