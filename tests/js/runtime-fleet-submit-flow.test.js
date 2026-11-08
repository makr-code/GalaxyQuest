import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const { createFleetSubmitFlowHelper } = createRequire(import.meta.url)(
  '../../js/engine/runtime/RuntimeFleetSubmitFlow.js',
);

afterEach(() => document.body.replaceChildren());

describe('Legacy fleet submission identity', () => {
  it('reuses the identity after a lost reply and rotates it after acknowledgement', async () => {
    document.body.innerHTML = `<section><form id="fleet-form-wm">
      <button type="submit">Send</button></form><span id="fleet-send-result-wm"></span></section>`;
    const root = document.querySelector('section');
    const api = { sendFleet: vi.fn()
      .mockRejectedValueOnce(new Error('Lost acknowledgement'))
      .mockResolvedValue({ success: true, arrival_time: '2026-11-07 18:00:00' }) };
    const helper = createFleetSubmitFlowHelper({ api });
    const payload = { origin_colony_id: 1, mission: 'attack', target_galaxy: 1,
      target_system: 2, target_position: 1, ships: { light_fighter: 40 }, cargo: { metal: 0 } };
    helper.bindSubmit(root, () => structuredClone(payload));
    const submit = async () => {
      root.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
      await vi.waitFor(() => expect(root.querySelector('button').disabled).toBe(false));
    };
    await submit();
    expect(root.querySelector('#fleet-send-result-wm').textContent).toBe('Network error.');
    await submit();
    expect(api.sendFleet.mock.calls[1][0]).toEqual(api.sendFleet.mock.calls[0][0]);
    await submit();
    expect(api.sendFleet.mock.calls[2][0].request_id).not.toBe(api.sendFleet.mock.calls[0][0].request_id);
    expect(payload).not.toHaveProperty('request_id');
  });
});
