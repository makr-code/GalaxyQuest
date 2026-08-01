/**
 * Event Domain Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventController, EventCalculations } from '../js/engine/runtime/domains/event/EventController.js';

describe('EventController', () => {
  let controller;
  let mockEventBus;

  beforeEach(() => {
    mockEventBus = { emit: vi.fn(), on: vi.fn() };
    controller = new EventController({ eventBus: mockEventBus, repository: null });
  });

  describe('initialization', () => {
    it('should initialize with 6 event templates', () => {
      const events = controller.getAllEvents();
      expect(events.length).toBe(6);
    });
  });

  describe('triggerEvent', () => {
    it('should trigger event', () => {
      controller.triggerEvent('treasure');

      const event = controller.getEvent('treasure');
      expect(event.triggered).toBe(true);
    });

    it('should emit event-triggered', () => {
      controller.triggerEvent('famine');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'game-event:triggered',
        expect.any(Object)
      );
    });

    it('should add to event log', () => {
      controller.triggerEvent('plague');

      const log = controller.getEventLog();
      expect(log.length).toBeGreaterThan(0);
    });

    it('should throw if already triggered', () => {
      controller.triggerEvent('supernova');

      expect(() => {
        controller.triggerEvent('supernova');
      }).toThrow('already triggered');
    });
  });

  describe('getTriggeredEvents', () => {
    it('should return only triggered events', () => {
      controller.triggerEvent('treasure');
      controller.triggerEvent('invasion');

      const triggered = controller.getTriggeredEvents();
      expect(triggered.length).toBe(2);
    });
  });

  describe('createEventChain', () => {
    it('should create event chain', () => {
      controller.createEventChain('chain1', ['treasure', 'famine']);

      const chains = controller.getEventChains();
      expect(chains.length).toBe(1);
    });

    it('should emit chain-created', () => {
      controller.createEventChain('chain2', ['plague', 'invasion']);

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        'game-event:chain-created',
        expect.any(Object)
      );
    });
  });

  describe('progressEventChain', () => {
    beforeEach(() => {
      controller.createEventChain('chain1', ['treasure', 'famine']);
    });

    it('should progress chain', () => {
      controller.progressEventChain('chain1');

      const chains = controller.getEventChains();
      expect(chains[0].progress).toBe(1);
    });

    it('should complete chain at end', () => {
      controller.progressEventChain('chain1');
      controller.progressEventChain('chain1');

      const chains = controller.getEventChains();
      expect(chains[0].active).toBe(false);
    });
  });
});

describe('EventCalculations', () => {
  let calc;

  beforeEach(() => {
    calc = new EventCalculations();
  });

  describe('calculateEventImpact', () => {
    it('should calculate impact by severity', () => {
      const critical = calc.calculateEventImpact('critical');
      const minor = calc.calculateEventImpact('minor');

      expect(critical).toBeGreaterThan(minor);
    });
  });

  describe('calculateChainProbability', () => {
    it('should decrease with chain length', () => {
      const short = calc.calculateChainProbability(1);
      const long = calc.calculateChainProbability(5);

      expect(short).toBeGreaterThan(long);
    });
  });

  describe('predictNextEventType', () => {
    it('should predict event type', () => {
      const recentEvents = [
        { severity: 'critical' },
        { severity: 'major' }
      ];

      const prediction = calc.predictNextEventType(recentEvents);
      expect(['positive', 'random']).toContain(prediction);
    });
  });
});
