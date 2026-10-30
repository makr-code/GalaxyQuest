export const FLIGHT_STATE_COOKIE = 'gq_galaxy_flight';

function coordinates(value) {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ? value : null;
}

export function readFlightStateCookie(documentRef = globalThis.document) {
  const prefix = `${FLIGHT_STATE_COOKIE}=`;
  const cookie = String(documentRef?.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!cookie) return null;
  try {
    const value = JSON.parse(decodeURIComponent(cookie.slice(prefix.length)));
    const start = coordinates(value?.start);
    const destination = coordinates(value?.destination);
    if (start && destination) return { start, destination };
  } catch {
    clearFlightStateCookie(documentRef);
  }
  clearFlightStateCookie(documentRef);
  return null;
}

export function writeFlightStateCookie(state, {
  documentRef = globalThis.document,
  locationRef = globalThis.location,
  maxAgeSeconds = 7200,
} = {}) {
  const start = coordinates(state?.start);
  const destination = coordinates(state?.destination);
  if (!start || !destination || !documentRef) return false;
  const value = encodeURIComponent(JSON.stringify({ start, destination }));
  const maxAge = Math.max(60, Math.floor(Number(maxAgeSeconds) || 7200));
  const secure = locationRef?.protocol === 'https:' ? '; Secure' : '';
  documentRef.cookie = `${FLIGHT_STATE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
  return true;
}

export function clearFlightStateCookie(documentRef = globalThis.document, locationRef = globalThis.location) {
  if (!documentRef) return;
  const secure = locationRef?.protocol === 'https:' ? '; Secure' : '';
  documentRef.cookie = `${FLIGHT_STATE_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax${secure}`;
}