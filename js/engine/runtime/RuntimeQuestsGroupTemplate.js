/**
 * RuntimeQuestsGroupTemplate.js
 *
 * Builds one quest category group wrapper and embeds pre-rendered card HTML.
 */
(function () {
  function createQuestsGroupTemplateBuilder() {
    function build({ categoryLabel, done, total, claimable, cardsHtml, esc }) {
      return `<div class="quest-group">
          <h3 class="quest-group-title">
            ${esc(categoryLabel)}
            <span class="quest-group-progress">${done}/${total}</span>
            ${claimable ? `<span class="quest-claimable-badge">${claimable} ready!</span>` : ''}
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
