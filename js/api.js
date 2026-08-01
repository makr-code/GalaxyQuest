/**
 * Shared API Module
 * Unified interface for all API calls
 * 
 * Usage:
 *   import { API } from './api.js';
 *   const data = await API.get('/api/economy');
 *   await API.post('/api/economy/tax', { rate: 0.2 });
 */

export const API = {
  /**
   * GET request
   * @param {string} url - API endpoint
   * @returns {Promise<Object>}
   */
  async get(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${url}`);
    }
    return response.json();
  },

  /**
   * POST request
   * @param {string} url - API endpoint
   * @param {Object} data - Request body
   * @returns {Promise<Object>}
   */
  async post(url, data) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${url}`);
    }
    return response.json();
  },

  /**
   * PUT request
   * @param {string} url - API endpoint
   * @param {Object} data - Request body
   * @returns {Promise<Object>}
   */
  async put(url, data) {
    const response = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${url}`);
    }
    return response.json();
  },

  /**
   * DELETE request
   * @param {string} url - API endpoint
   * @returns {Promise<Object>}
   */
  async delete(url) {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`API ${response.status}: ${url}`);
    }
    return response.json();
  },
};

// Make available globally for backward compatibility
window.API = API;
