/**
 * GalaxyService and GalaxyController integration tests.
 *
 * Tests:
 * - GalaxyService range queries with mock HTTP
 * - GalaxyService system detail lookups
 * - GalaxyController state management
 * - Cache behavior
 * - Error handling
 * - Event emitting
 */

// Simple mock HTTP server for testing
class MockApiClient {
    constructor(data = {}) {
        this.data = data;
        this.requestCount = 0;
        this.lastRequest = null;
    }

    async get(path, params = {}) {
        this.requestCount++;
        this.lastRequest = { path, params };

        // Simulate network delay
        await new Promise(r => setTimeout(r, 1));

        if (params.action === 'range') {
            return this.getRangeResponse(params);
        }

        if (params.action === 'system_detail') {
            return this.getDetailResponse(params);
        }

        return {
            success: false,
            error: { code: 'UNKNOWN_ACTION', message: 'Unknown action' },
            meta: { trace_id: 'test', ts: Date.now() },
        };
    }

    getRangeResponse(params) {
        const { xmin, xmax, ymin, ymax } = params;

        // Filter test data by range
        const systems = (this.data.systems || []).filter(s =>
            s.x >= xmin && s.x <= xmax && s.y >= ymin && s.y <= ymax
        );

        return {
            success: true,
            data: {
                systems,
                total_count: systems.length,
                range_min: { x: xmin, y: ymin },
                range_max: { x: xmax, y: ymax },
            },
            meta: { trace_id: 'test-range', ts: Date.now() },
        };
    }

    getDetailResponse(params) {
        const { x, y } = params;

        const system = (this.data.systems || []).find(s => s.x === x && s.y === y);

        if (!system) {
            return {
                success: false,
                error: { code: 'GALAXY_SYSTEM_NOT_FOUND', message: `Not found at (${x}, ${y})` },
                meta: { trace_id: 'test-detail', ts: Date.now() },
            };
        }

        return {
            success: true,
            data: {
                x,
                y,
                payload: system,
            },
            meta: { trace_id: 'test-detail', ts: Date.now() },
        };
    }
}

describe('GalaxyService Tests', () => {
    let service;
    let apiClient;

    beforeEach(() => {
        // Set up test data
        const testSystems = [
            { id: 1, x: 10, y: 20, name: 'Sol' },
            { id: 2, x: 15, y: 25, name: 'Sirius' },
            { id: 3, x: 8, y: 18, name: 'Betelgeuse' },
            { id: 4, x: 50, y: 60, name: 'Vega' },
        ];

        apiClient = new MockApiClient({ systems: testSystems });
        service = new GalaxyService(apiClient);
    });

    test('getSystemsInRange returns systems in range', async () => {
        const systems = await service.getSystemsInRange(5, 20, 15, 30);

        expect(systems).toBeDefined();
        expect(systems.length).toBeGreaterThan(0);
        expect(systems[0]).toHaveProperty('name');
    });

    test('getSystemsInRange caches results', async () => {
        const range = { xmin: 5, xmax: 20, ymin: 15, ymax: 30 };

        // First call
        const systems1 = await service.getSystemsInRange(range.xmin, range.xmax, range.ymin, range.ymax);
        const requestCount1 = apiClient.requestCount;

        // Second call (same range) should use cache
        const systems2 = await service.getSystemsInRange(range.xmin, range.xmax, range.ymin, range.ymax);
        const requestCount2 = apiClient.requestCount;

        expect(requestCount2).toBe(requestCount1); // No additional request
        expect(systems1).toEqual(systems2);
    });

    test('getSystemsInRange validates range', async () => {
        // Invalid range: min > max
        await expect(service.getSystemsInRange(100, 50, 50, 100)).rejects.toThrow();
    });

    test('getSystemDetail returns system information', async () => {
        const detail = await service.getSystemDetail(10, 20);

        expect(detail).toBeDefined();
        expect(detail.name).toBe('Sol');
    });

    test('getSystemDetail throws for non-existent system', async () => {
        await expect(service.getSystemDetail(999, 999)).rejects.toThrow('System not found');
    });

    test('getSystemDetail caches results', async () => {
        // First call
        await service.getSystemDetail(10, 20);
        const requestCount1 = apiClient.requestCount;

        // Second call should use cache
        await service.getSystemDetail(10, 20);
        const requestCount2 = apiClient.requestCount;

        expect(requestCount2).toBe(requestCount1);
    });

    test('clearCache empties both caches', async () => {
        // Populate caches
        await service.getSystemsInRange(5, 20, 15, 30);
        await service.getSystemDetail(10, 20);

        const stats1 = service.getCacheStats();
        expect(stats1.rangeSize).toBeGreaterThan(0);
        expect(stats1.detailSize).toBeGreaterThan(0);

        // Clear cache
        service.clearCache();

        const stats2 = service.getCacheStats();
        expect(stats2.rangeSize).toBe(0);
        expect(stats2.detailSize).toBe(0);
    });
});

describe('GalaxyController Tests', () => {
    let controller;
    let service;
    let apiClient;

    beforeEach(() => {
        const testSystems = [
            { id: 1, x: 10, y: 20, name: 'Sol' },
            { id: 2, x: 15, y: 25, name: 'Sirius' },
        ];

        apiClient = new MockApiClient({ systems: testSystems });
        service = new GalaxyService(apiClient);
        controller = new GalaxyController(service);
    });

    test('loadSystemsInRange updates state', async () => {
        const systems = await controller.loadSystemsInRange(5, 20, 15, 30);

        expect(controller.currentSystems).toEqual(systems);
        expect(controller.currentRange).toEqual({ xmin: 5, xmax: 20, ymin: 15, ymax: 30 });
        expect(controller.error).toBeNull();
    });

    test('loadSystemsInRange emits events', async () => {
        const events = [];
        controller.on('loading', () => events.push('loading'));
        controller.on('systemsLoaded', () => events.push('loaded'));

        await controller.loadSystemsInRange(5, 20, 15, 30);

        expect(events).toContain('loading');
        expect(events).toContain('loaded');
    });

    test('loadSystemDetail updates state', async () => {
        const detail = await controller.loadSystemDetail(10, 20);

        expect(controller.currentDetail).toEqual(detail);
        expect(controller.selectedSystem).toEqual({ x: 10, y: 20 });
    });

    test('loadSystemDetail handles error', async () => {
        let errorReceived = null;
        controller.on('error', (data) => {
            errorReceived = data;
        });

        try {
            await controller.loadSystemDetail(999, 999);
        } catch (e) {
            // Expected error
        }

        expect(errorReceived).toBeDefined();
        expect(errorReceived.type).toBe('detail');
    });

    test('getState returns current state', () => {
        const state = controller.getState();

        expect(state).toHaveProperty('isLoading');
        expect(state).toHaveProperty('currentSystems');
        expect(state).toHaveProperty('error');
    });

    test('clear resets all state', async () => {
        await controller.loadSystemsInRange(5, 20, 15, 30);
        controller.clear();

        expect(controller.currentSystems).toEqual([]);
        expect(controller.currentRange).toBeNull();
        expect(controller.error).toBeNull();
    });

    test('on() and once() event listeners work', async () => {
        let loadedCount = 0;
        const unsubscribe = controller.on('systemsLoaded', () => {
            loadedCount++;
        });

        await controller.loadSystemsInRange(5, 20, 15, 30);
        await controller.loadSystemsInRange(5, 20, 15, 30);

        expect(loadedCount).toBe(2);

        // Unsubscribe and verify no more events
        unsubscribe();
        await controller.loadSystemsInRange(5, 20, 15, 30);

        expect(loadedCount).toBe(2); // Should not increment
    });
});

describe('GalaxyLegacyBridge Tests', () => {
    let bridge;
    let apiClient;

    beforeEach(() => {
        const testSystems = [
            { id: 1, x: 10, y: 20, name: 'Sol' },
            { id: 2, x: 15, y: 25, name: 'Sirius' },
        ];

        apiClient = new MockApiClient({ systems: testSystems });
        bridge = new GalaxyLegacyBridge(apiClient);
    });

    test('getStarsRange (legacy) returns systems', async () => {
        const systems = await bridge.getStarsRange({
            xmin: 5,
            xmax: 20,
            ymin: 15,
            ymax: 30,
        });

        expect(systems).toBeDefined();
        expect(systems.length).toBeGreaterThan(0);
    });

    test('getStarsRange supports callback style', (done) => {
        bridge.getStarsRange(
            { xmin: 5, xmax: 20, ymin: 15, ymax: 30, callback: (err, systems) => {
                expect(err).toBeNull();
                expect(systems).toBeDefined();
                done();
            }},
        );
    });

    test('getSystemDetail (legacy) returns detail', async () => {
        const detail = await bridge.getSystemDetail(10, 20);

        expect(detail).toBeDefined();
        expect(detail.name).toBe('Sol');
    });

    test('getSystemDetail supports callback style', (done) => {
        bridge.getSystemDetail(10, 20, (err, detail) => {
            expect(err).toBeNull();
            expect(detail).toBeDefined();
            done();
        });
    });

    test('clearCache delegates to service', () => {
        bridge.clearCache();
        const stats = bridge.getCacheStats();

        expect(stats.rangeSize).toBe(0);
        expect(stats.detailSize).toBe(0);
    });
});
