import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('wordpress-integration/gq-admin-tables.php', 'utf8');
const script = source.match(/private const SCRIPT = <<<'JS'\r?\n([\s\S]*?)\r?\nJS;/)[1];

const visibleIds = table => [...table.tBodies[0].rows]
  .filter(row => !row.hidden && row.cells.length === 2)
  .map(row => row.cells[0].textContent);

beforeEach(() => {
  document.body.innerHTML = `
    <table data-gq-admin-table><thead><tr><th>ID</th><th>Status</th></tr></thead><tbody>
      <tr><td>10</td><td>Pending</td></tr>
      <tr><td>2</td><td>Executed</td></tr>
      <tr><td>3</td><td>Pending</td></tr>
    </tbody></table>
    <table data-gq-admin-table><thead><tr><th>ID</th><th>Status</th></tr></thead><tbody>
      <tr><td>8</td><td>Other</td></tr>
    </tbody></table>
    <table data-gq-player-table><thead><tr><th>ID</th></tr></thead><tbody></tbody></table>`;
  window.eval(script);
});

describe('WordPress table header controls', () => {
  it('sorts numerically in both directions and resets to source order', () => {
    const table = document.querySelector('table');
    const sort = table.tHead.rows[0].cells[0].querySelector('button');
    sort.click();
    expect(visibleIds(table)).toEqual(['2', '3', '10']);
    expect(table.tHead.rows[0].cells[0].getAttribute('aria-sort')).toBe('ascending');
    sort.click();
    expect(visibleIds(table)).toEqual(['10', '3', '2']);
    table.tHead.querySelector('.button').click();
    expect(visibleIds(table)).toEqual(['10', '2', '3']);
    expect(table.tHead.rows[0].cells[0].getAttribute('aria-sort')).toBe('none');
  });

  it('combines column searches and exact filters without affecting other tables', () => {
    const [table, other] = document.querySelectorAll('table');
    const filter = table.tHead.rows[0].cells[1].querySelector('select');
    filter.value = 'Pending';
    filter.dispatchEvent(new Event('change'));
    expect(visibleIds(table)).toEqual(['10', '3']);
    const search = table.tHead.rows[0].cells[0].querySelector('input');
    search.value = '10';
    search.dispatchEvent(new Event('input'));
    expect(visibleIds(table)).toEqual(['10']);
    expect(visibleIds(other)).toEqual(['8']);
    search.value = '<script>';
    search.dispatchEvent(new Event('input'));
    expect(visibleIds(table)).toEqual([]);
    expect(table.tBodies[0].lastElementChild.textContent).toBe('No matching records.');
    expect(table.tHead.querySelector('[role=status]').textContent).toBe('0 / 3');
    table.tHead.querySelector('.button').click();
    expect(visibleIds(table)).toEqual(['10', '2', '3']);
  });

  it('initializes once and leaves server-paginated player tables alone', () => {
    window.eval(script);
    expect(document.querySelector('table').tHead.querySelectorAll('input')).toHaveLength(2);
    expect(document.querySelector('[data-gq-player-table] input')).toBeNull();
  });
});
