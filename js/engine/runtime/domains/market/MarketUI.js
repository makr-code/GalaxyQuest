/**
 * MarketUI - Market display and trading interface
 */

export class MarketUI {
  constructor(marketController, domTarget) {
    this.controller = marketController;
    this.container = domTarget;
    this.state = { selectedCommodity: null };

    if (domTarget) this.render();
    this.controller.onStateChange = (change) => this.handleStateChange(change);
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = this._buildHtml();
    this._attachEventHandlers();
  }

  _buildHtml() {
    return `
      <div class="market-panel">
        <h2>📊 Market</h2>
        ${this._buildCommoditiesSection()}
        ${this._buildPriceChartSection()}
        ${this._buildInventorySection()}
        <button class="btn-update" id="btn-update">📈 Update Prices</button>
        <button class="btn-save" id="btn-save">💾 Save</button>
      </div>
    `;
  }

  _buildCommoditiesSection() {
    const commodities = this.controller.getAllCommodities();
    let html = `<div class="commodities"><h3>Commodities</h3><table>`;

    commodities.forEach(c => {
      const trend = this.controller.getMarketTrend(c.name);
      const trendEmoji = trend?.trend === 'up' ? '📈' : trend?.trend === 'down' ? '📉' : '➡️';
      html += `
        <tr data-commodity="${c.name}">
          <td>${c.name}</td>
          <td>${trendEmoji}</td>
          <td>💰 ${c.currentPrice.toFixed(2)}</td>
          <td>📦 ${c.supply}</td>
          <td>👥 ${c.demand}</td>
        </tr>
      `;
    });

    html += `</table></div>`;
    return html;
  }

  _buildPriceChartSection() {
    return `<div class="chart"><h3>Price Trends (Last 24h)</h3><canvas id="price-chart"></canvas></div>`;
  }

  _buildInventorySection() {
    const inventory = this.controller.getInventory('player_faction');
    let html = `<div class="inventory"><h3>Player Inventory</h3><ul>`;

    Object.entries(inventory).forEach(([name, qty]) => {
      html += `<li>${name}: ${qty}</li>`;
    });

    html += `</ul></div>`;
    return html;
  }

  _attachEventHandlers() {
    const updateBtn = this.container.querySelector('#btn-update');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        this.controller.updatePrices();
        this.render();
      });
    }

    const saveBtn = this.container.querySelector('#btn-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        try {
          await this.controller.save();
          alert('✅ Market saved');
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      });
    }
  }

  handleStateChange(change) {
    if (change.type === 'trade-executed') {
      this.render();
    }
  }
}
