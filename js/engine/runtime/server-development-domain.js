import { createServerColonyDomain } from './server-colony-domain.js';

export function createDevelopmentDomain(kind, { api, session }) {
  if (!['buildings', 'research'].includes(kind)) throw new Error('Unknown development domain.');
  const endpoint = `api/${kind}.php`;
  return createServerColonyDomain({
    api, session, name: kind,
    async read(colonyId, signal) {
      const data = await api.get(`${endpoint}?action=list&colony_id=${colonyId}`, { signal });
      if (data?.success !== true || !Array.isArray(data[kind])
          || data[kind].some((entry) => typeof entry.type !== 'string' || !Number.isInteger(entry.level)
            || !entry.next_cost || typeof entry.next_cost !== 'object')
          || (kind === 'buildings' && !Array.isArray(data.upgrade_queue))) {
        throw new Error('Invalid development data returned by the server.');
      }
      return data;
    },
    prepareCommand(action, type, state) {
      if (!['start', 'finish'].includes(action)) throw new Error('Unknown development command.');
      if (action === 'start' && !state.data?.[kind].some((entry) => entry.type === type)) {
        throw new Error('Refresh the server list before starting this order.');
      }
      const serverAction = action === 'finish' ? 'finish' : kind === 'buildings' ? 'upgrade' : 'research';
      return {
        endpoint: `${endpoint}?action=${serverAction}`,
        body: kind === 'research' && action === 'finish' ? {}
          : { colony_id: state.colonyId, ...(action === 'start' ? { type } : {}) },
      };
    },
  });
}
