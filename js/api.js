import './network/api-transport.js';
import './network/api-session.js';

async function request(method, endpoint, body, { signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    const token = await window.APISession.fetchCsrfToken();
    if (!token) throw new Error('CSRF token is unavailable. Please retry.');
    headers['X-CSRF-Token'] = token;
  }
  const response = await window.APITransport.fetchWithRetry(
    window.APITransport.versionEndpoint(endpoint),
    {
      method, headers, signal, credentials: 'same-origin', cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { timeoutMs: 15000 },
  );
  const data = await response.json();
  if (data?.success !== true) throw new Error(data?.error || 'Invalid API response.');
  return data;
}

export const API = {
  get: (endpoint, options) => request('GET', endpoint, undefined, options),
  post: (endpoint, body, options) => request('POST', endpoint, body, options),
  put: (endpoint, body, options) => request('PUT', endpoint, body, options),
  delete: (endpoint, options) => request('DELETE', endpoint, undefined, options),
};

window.API = API;
