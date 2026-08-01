/**
 * DOMAIN_NAME Domain Template
 * 
 * Copy this entire directory and replace:
 * - [DomainName] with your domain name (e.g., Fleet, War, Galaxy)
 * - [domainName] with snake_case (e.g., fleet, war, galaxy)
 * 
 * Directory structure:
 * js/engine/runtime/domains/[domainName]/
 *   ├── [DomainName]Controller.js  (Business logic)
 *   ├── [DomainName]UI.js         (Rendering)
 *   ├── [DomainName]Calculations.js (Pure math)
 *   ├── [DomainName]Events.js      (Event definitions)
 *   ├── types.js                   (JSDoc types)
 *   └── __exports.js               (Initialization)
 */

/**
 * [DomainName]Controller
 * 
 * Responsibilities:
 * - Manage domain state
 * - Implement business rules
 * - Validate operations
 * - Emit events for state changes
 * - Coordinate with other domains via EventBus
 * 
 * Pattern: Dependency Injection
 * Dependencies: eventBus, repository, logger
 */
class TemplateController {
  constructor(config = {}) {
    this.config = {
      repository: config.repository,
      eventBus: config.eventBus,
      logger: config.logger || console,
      ...config
    };

    // Initialize state
    this.state = {};

    // Callbacks to UI
    this.callbacks = {
      onStateChange: null,
      onError: null
    };
  }

  /**
   * Update state and notify listeners
   * @param {Object} updates - { field: value, ... }
   */
  setState(updates) {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...updates };

    // Notify UI
    this.callbacks.onStateChange?.({
      oldState,
      newState: this.state,
      changes: updates
    });

    // Emit event to other domains
    this.config.eventBus?.emit(`[domainName]:state-changed`, {
      changes: updates,
      timestamp: Date.now()
    });
  }

  /**
   * Get current state
   * @returns {Object} Cloned state
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Register callback for state changes
   * @param {Function} callback
   */
  onStateChange(callback) {
    this.callbacks.onStateChange = callback;
  }

  /**
   * Register callback for errors
   * @param {Function} callback
   */
  onError(callback) {
    this.callbacks.onError = callback;
  }

  /**
   * Save state to repository
   * @returns {Promise<void>}
   */
  async save() {
    if (!this.config.repository) {
      throw new Error('No repository configured');
    }

    try {
      await this.config.repository.save[DomainName]State(this.getState());
      this.config.eventBus?.emit('[domainName]:saved');
    } catch (error) {
      this.config.logger.error(`[[DomainName]] Save failed:`, error);
      throw error;
    }
  }

  /**
   * Load state from repository
   * @returns {Promise<void>}
   */
  async load() {
    if (!this.config.repository) {
      throw new Error('No repository configured');
    }

    try {
      const saved = await this.config.repository.load[DomainName]State();
      if (saved) {
        this.setState(saved);
      }
    } catch (error) {
      this.config.logger.error(`[[DomainName]] Load failed:`, error);
      throw error;
    }
  }
}

/**
 * [DomainName]UI
 * 
 * Responsibilities:
 * - Render DOM elements
 * - Handle user interactions
 * - Update UI based on controller state changes
 * - Delegate actions to controller
 * 
 * Pattern: Callback-based (no direct state mutation)
 */
class TemplateUI {
  constructor(controller, domTarget) {
    this.controller = controller;
    this.target = domTarget;

    // Listen to controller state changes
    this.controller.onStateChange((change) => {
      this.render(change);
    });

    // Listen to errors
    this.controller.onError((error) => {
      this.handleError(error);
    });
  }

  /**
   * Render UI
   * @param {Object} change - State change info
   */
  render(change) {
    if (!this.target) return;

    // Update DOM based on change
    // Example:
    // if (change.changes.statusText) {
    //   this.target.querySelector('.status').textContent = change.newState.statusText;
    // }
  }

  /**
   * Handle error display
   * @param {Error} error
   */
  handleError(error) {
    console.error(`[[DomainName]UI] Error:`, error);
    // Show error notification to user
  }
}

/**
 * [DomainName]Calculations
 * 
 * Pure functions for domain-specific math and logic
 * No side effects, fully testable and deterministic
 */
class TemplateCalculations {
  // Example pure function:
  /**
   * Calculate something
   * @param {number} input
   * @returns {number} Result
   */
  static calculate(input) {
    // Pure logic only
    return input * 2;
  }
}

export { TemplateController, TemplateUI, TemplateCalculations };
