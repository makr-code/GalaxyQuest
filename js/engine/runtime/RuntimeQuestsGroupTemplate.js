/**
 * RuntimeQuestsGroupTemplate.js
 *
 * Builds one quest category group wrapper and embeds pre-rendered card HTML.
 */
(function () {
  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createQuestsGroupTemplateBuilder() {
    function build({ categoryLabel, done, total, claimable, cardsHtml }) {
      return `<div class="quest-group">
          <h3 class="quest-group-title">
            ${escapeHtml(categoryLabel)}
            <span class="quest-group-progress">${escapeHtml(done)}/${escapeHtml(total)}</span>
            ${claimable ? `<span class="quest-claimable-badge">${escapeHtml(claimable)} ready!</span>` : ''}
          </h3><div class="quest-list">${cardsHtml}</div></div>`;
    }

    return { build };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createQuestsGroupTemplateBuilder };
  } else {
    window.GQRuntimeQuestsGroupTemplate = { createQuestsGroupTemplateBuilder };
  }
})();
