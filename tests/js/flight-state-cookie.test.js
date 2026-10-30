import { describe, expect, it } from 'vitest';
import {
  clearFlightStateCookie,
  FLIGHT_STATE_COOKIE,
  readFlightStateCookie,
  writeFlightStateCookie,
} from '../../js/rendering/flight-state-cookie.js';

describe('flight coordinate cookie', () => {
  it('stores only finite start and destination coordinate triples', () => {
    const documentRef = { cookie: '' };
    expect(writeFlightStateCookie({
      start: [1.25, -2, 3],
      destination: [40000, 25.5, -800],
      name: 'must not persist',
      targetId: 42,
    }, { documentRef, locationRef: { protocol: 'https:' } })).toBe(true);
    expect(documentRef.cookie).toContain(`${FLIGHT_STATE_COOKIE}=`);
    expect(documentRef.cookie).toContain('SameSite=Lax');
    expect(documentRef.cookie).toContain('Secure');
    expect(readFlightStateCookie(documentRef)).toEqual({
      start: [1.25, -2, 3],
      destination: [40000, 25.5, -800],
    });
    const encoded = documentRef.cookie.split(';')[0].split('=').slice(1).join('=');
    expect(decodeURIComponent(encoded)).toBe(JSON.stringify({
      start: [1.25, -2, 3],
      destination: [40000, 25.5, -800],
    }));
  });

  it('rejects malformed or non-finite coordinate payloads', () => {
    const documentRef = { cookie: '' };
    expect(writeFlightStateCookie({ start: [1, 2, Infinity], destination: [4, 5, 6] }, { documentRef })).toBe(false);
    documentRef.cookie = `${FLIGHT_STATE_COOKIE}=${encodeURIComponent('{bad json')}`;
    expect(readFlightStateCookie(documentRef)).toBeNull();
    expect(documentRef.cookie).toContain('Max-Age=0');
    documentRef.cookie = `${FLIGHT_STATE_COOKIE}=${encodeURIComponent(JSON.stringify({ start: [null, 2, 3], destination: [4, 5, 6] }))}`;
    expect(readFlightStateCookie(documentRef)).toBeNull();
    expect(documentRef.cookie).toContain('Max-Age=0');
  });

  it('clears the persisted flight state when the tour is disabled', () => {
    const documentRef = { cookie: '' };
    writeFlightStateCookie({ start: [1, 2, 3], destination: [4, 5, 6] }, { documentRef });
    clearFlightStateCookie(documentRef);
    expect(documentRef.cookie).toContain('Max-Age=0');
  });
});