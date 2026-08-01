/**
 * Base State Manager with validation and change tracking
 * Provides immutability and observer pattern for domain state
 */

class State {
  constructor(initialData = {}, schema = {}) {
    this._data = { ...initialData };
    this._schema = schema;
    this._observers = [];
    this._history = [];
    this._version = 1;
    
    // Freeze initial state for debugging
    Object.freeze(this._data);
  }

  /**
   * Get state value by path (e.g., 'colony.population')
   * @param {string} path - Dot-separated path
   * @returns {any} State value or undefined
   */
  get(path) {
    if (!path) return { ...this._data };
    
    const keys = path.split('.');
    let value = this._data;
    
    for (const key of keys) {
      value = value?.[key];
      if (value === undefined) return undefined;
    }
    
    return value;
  }

  /**
   * Set state value with validation and change tracking
   * @param {string} path - Dot-separated path
   * @param {any} value - New value
   * @throws {Error} If validation fails
   */
  set(path, value) {
    if (!path) throw new Error('Path required');
    
    // Validate
    if (this._schema[path]) {
      this._validateField(path, value);
    }
    
    // Clone and update
    const newData = JSON.parse(JSON.stringify(this._data));
    const keys = path.split('.');
    let obj = newData;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!obj[key]) obj[key] = {};
      obj = obj[key];
    }
    
    const lastKey = keys[keys.length - 1];
    const oldValue = obj[lastKey];
    
    if (oldValue === value) return; // No change
    
    obj[lastKey] = value;
    
    // Update state
    this._data = newData;
    Object.freeze(this._data);
    this._version++;
    
    // Track history
    this._history.push({
      path,
      oldValue,
      newValue: value,
      version: this._version,
      timestamp: Date.now()
    });
    
    // Notify observers
    this._notifyObservers(path, value, oldValue);
  }

  /**
   * Batch update multiple fields
   * @param {Object} updates - { path: value, ... }
   */
  batch(updates) {
    const changes = [];
    
    for (const [path, value] of Object.entries(updates)) {
      if (this.get(path) !== value) {
        changes.push({ path, value });
      }
    }
    
    if (changes.length === 0) return;
    
    // Apply all at once
    const newData = JSON.parse(JSON.stringify(this._data));
    
    for (const { path, value } of changes) {
      const keys = path.split('.');
      let obj = newData;
      
      for (let i = 0; i < keys.length - 1; i++) {
        if (!obj[keys[i]]) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      
      obj[keys[keys.length - 1]] = value;
    }
    
    this._data = newData;
    Object.freeze(this._data);
    this._version++;
    
    // Notify once for all changes
    changes.forEach(({ path, value }) => {
      this._notifyObservers(path, value);
    });
  }

  /**
   * Subscribe to state changes
   * @param {Function} callback - (path, newValue, oldValue) => void
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this._observers.push(callback);
    return () => {
      this._observers = this._observers.filter(obs => obs !== callback);
    };
  }

  /**
   * Get change history
   * @param {number} limit - Max entries to return
   * @returns {Array} History entries
   */
  getHistory(limit = 50) {
    return this._history.slice(-limit);
  }

  /**
   * Clear history
   */
  clearHistory() {
    this._history = [];
  }

  /**
   * Get current version number
   * @returns {number} Version
   */
  getVersion() {
    return this._version;
  }

  /**
   * Clone entire state
   * @returns {Object} Deep copy of state
   */
  clone() {
    return JSON.parse(JSON.stringify(this._data));
  }

  // Private methods

  /**
   * Validate field against schema
   * @private
   */
  _validateField(path, value) {
    const schema = this._schema[path];
    if (!schema) return;
    
    // Type check
    if (schema.type && typeof value !== schema.type) {
      throw new Error(
        `Invalid type for ${path}: expected ${schema.type}, got ${typeof value}`
      );
    }
    
    // Range check
    if (schema.min !== undefined && value < schema.min) {
      throw new Error(`${path} must be >= ${schema.min}`);
    }
    if (schema.max !== undefined && value > schema.max) {
      throw new Error(`${path} must be <= ${schema.max}`);
    }
    
    // Custom validator
    if (schema.validate && !schema.validate(value)) {
      throw new Error(`${path} failed validation`);
    }
  }

  /**
   * Notify all observers
   * @private
   */
  _notifyObservers(path, newValue, oldValue) {
    this._observers.forEach(callback => {
      try {
        callback(path, newValue, oldValue);
      } catch (error) {
        console.error('[State] Observer error:', error);
      }
    });
  }
}

export default State;
