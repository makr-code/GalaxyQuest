import { createServerColonyDomain } from './server-colony-domain.js';

export const ECONOMY_POLICIES = {
  free_market: 'Freier Markt', subsidies: 'Subventionen', mercantilism: 'Merkantilismus',
  autarky: 'Autarkie', war_economy: 'Kriegswirtschaft',
};
export const ECONOMY_TAXES = {
  income: { label: 'Einkommensteuer', max: 40 },
  production: { label: 'Produktionssteuer', max: 30 },
  trade: { label: 'Handelssteuer', max: 25 },
};
export const ECONOMY_SUBSIDIES = { agriculture: 'Landwirtschaft', research: 'Forschung', military: 'Militär' };
export const ECONOMY_METHODS = { standard: 'Standard', efficient: 'Effizient', premium: 'Premium' };

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const numericRecord = (value) => record(value) && Object.values(value).every((entry) =>
  typeof entry === 'number' && Number.isFinite(entry));
// PHP serializes an empty associative array as [].
const map = (value) => Array.isArray(value) && value.length === 0 ? {} : value;

export function createEconomyDomain({ api, session }) {
  return createServerColonyDomain({
    api, session, name: 'economy',
    async read(colonyId, signal) {
      const [snapshot, policy] = await Promise.all([
        api.get(`api/colony_economy.php?action=snapshot&colony_id=${colonyId}`, { signal }),
        api.get('api/economy.php?action=get_policy', { signal }),
      ]);
      if (snapshot?.success !== true || Number(snapshot.colony?.id) !== Number(colonyId)
          || !record(snapshot.economy) || !numericRecord(snapshot.economy.stock)
          || !Number.isFinite(snapshot.economy.settled_at) || !Number.isFinite(snapshot.economy.pending_seconds)
          || !numericRecord(map(snapshot.pop_classes)) || !numericRecord(map(snapshot.storage))
          || Object.values(map(snapshot.pop_classes)).some((count) => !Number.isSafeInteger(count) || count < 0)
          || ['satisfaction', 'employment', 'population_growth_per_hour'].some((key) =>
            snapshot.economy[key] !== undefined && !Number.isFinite(snapshot.economy[key]))
          || (snapshot.economy.satisfaction !== undefined
            && (snapshot.economy.satisfaction < 0 || snapshot.economy.satisfaction > 100))
          || (snapshot.economy.employment !== undefined
            && (snapshot.economy.employment < 0 || snapshot.economy.employment > 1))
          || (snapshot.colony.max_population !== undefined
            && (!Number.isFinite(snapshot.colony.max_population) || snapshot.colony.max_population < 0))
          || !record(map(snapshot.methods)) || !record(map(snapshot.catalog)) || !Array.isArray(snapshot.buildings)
          || Object.values(map(snapshot.catalog)).some((entry) => !record(entry)
            || typeof entry.label !== 'string' || typeof entry.good !== 'string'
            || typeof entry.research !== 'string' || !numericRecord(map(entry.inputs)))
          || snapshot.buildings.some((entry) => typeof entry.type !== 'string' || !Number.isInteger(entry.level))
          || Object.values(map(snapshot.methods)).some((method) => !Object.hasOwn(ECONOMY_METHODS, method))
          || policy?.success !== true || !Object.hasOwn(ECONOMY_POLICIES, policy.global_policy)
          || !record(policy.taxes) || !record(policy.subsidies)
          || !numericRecord(policy.tax_steps)
          || Object.keys(ECONOMY_TAXES).some((type) => ![0.01, 0.0001].includes(policy.tax_steps[type]))
          || Object.keys(ECONOMY_TAXES).some((type) =>
            !Number.isFinite(policy.taxes[type]) || policy.taxes[type] < 0 || policy.taxes[type] > ECONOMY_TAXES[type].max / 100)
          || Object.keys(ECONOMY_SUBSIDIES).some((sector) => typeof policy.subsidies[sector] !== 'boolean')
          || snapshot.buildings.some((entry) => entry.level > 0 && Object.hasOwn(snapshot.catalog, entry.type)
            && !Object.hasOwn(ECONOMY_METHODS, snapshot.methods[entry.type]))
          || ['production', 'consumption', 'shortages'].some((key) =>
            snapshot.economy[key] !== undefined && !numericRecord(map(snapshot.economy[key])))) {
        throw new Error('Invalid economy data returned by the server.');
      }
      return { snapshot, policy };
    },
    prepareCommand(action, value, state) {
      if (!state.data) throw new Error('Load the server economy before changing settings.');
      if (action === 'policy' && Object.hasOwn(ECONOMY_POLICIES, value)) {
        return { endpoint: 'api/economy.php?action=set_policy', body: { policy: value } };
      }
      if (action === 'tax' && Object.hasOwn(ECONOMY_TAXES, value?.type)
          && Number.isFinite(value.rate) && value.rate >= 0 && value.rate <= ECONOMY_TAXES[value.type].max / 100) {
        return { endpoint: 'api/economy.php?action=set_tax', body: { type: value.type, rate: value.rate } };
      }
      if (action === 'subsidy' && Object.hasOwn(ECONOMY_SUBSIDIES, value?.sector) && typeof value.enabled === 'boolean') {
        return { endpoint: 'api/economy.php?action=set_subsidy', body: { sector: value.sector, enabled: value.enabled } };
      }
      if (action === 'method' && Object.hasOwn(ECONOMY_METHODS, value?.method)
          && Object.hasOwn(state.data.snapshot.catalog, value.building_type)
          && state.data.snapshot.buildings.some((entry) => entry.type === value.building_type && entry.level > 0)) {
        return {
          endpoint: 'api/colony_economy.php?action=set_method',
          body: { colony_id: state.colonyId, building_type: value.building_type, method: value.method },
        };
      }
      throw new Error('Invalid economy command.');
    },
  });
}
