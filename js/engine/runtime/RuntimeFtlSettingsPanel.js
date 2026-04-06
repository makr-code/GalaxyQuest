/**
 * RuntimeFtlSettingsPanel.js
 *
 * Binds FTL drive selection controls in the settings panel.
 */

'use strict';

(function () {
  function bindFtlSettingsPanel(opts = {}) {
    const {
      root = null,
      api = null,
      wm = null,
      esc = (value) => String(value || ''),
      fmt = (value) => String(value || ''),
      showToast = () => {},
      windowRef = (typeof window !== 'undefined' ? window : null),
    } = opts;

    if (!root || !api) return;

    const ftlCurrentEl = root.querySelector('#set-ftl-current');
    const ftlResultEl = root.querySelector('#set-ftl-result');
    const ftlButtons = root.querySelectorAll('.set-ftl-drive-btn');

    api.ftlStatus().then((ftlData) => {
      if (!ftlCurrentEl) return;
      const driveType = ftlData?.ftl_drive_type || 'aereth';
      const dm = windowRef?._GQ_meta?.dark_matter ?? '?';
      const isDefault = driveType === 'aereth';
      ftlCurrentEl.textContent = `Aktueller Antrieb: ${driveType}${isDefault ? ' (Standard - Auswahl kostenlos)' : ''} | DM ${fmt(dm)}`;
      ftlButtons.forEach((button) => {
        const drive = button.getAttribute('data-drive');
        button.style.borderColor = drive === driveType ? '#88ccff' : '';
        button.style.background = drive === driveType ? 'rgba(136,204,255,0.12)' : '';
      });
    }).catch(() => {
      if (ftlCurrentEl) ftlCurrentEl.textContent = 'FTL-Status konnte nicht geladen werden.';
    });

    ftlButtons.forEach((button) => {
      button.addEventListener('click', async () => {
        const drive = button.getAttribute('data-drive');
        if (!drive) return;
        ftlButtons.forEach((entry) => {
          entry.disabled = true;
        });
        if (ftlResultEl) ftlResultEl.textContent = 'Wird gesetzt...';
        try {
          const res = await api.setFtlDrive(drive);
          if (res?.success) {
            if (ftlResultEl) {
              ftlResultEl.innerHTML = `<span style="color:#88ff88">OK ${esc(res.message || 'Drive gesetzt.')}</span>`;
            }
            if (ftlCurrentEl) ftlCurrentEl.textContent = `Aktueller Antrieb: ${drive}`;
            ftlButtons.forEach((entry) => {
              const entryDrive = entry.getAttribute('data-drive');
              entry.style.borderColor = entryDrive === drive ? '#88ccff' : '';
              entry.style.background = entryDrive === drive ? 'rgba(136,204,255,0.12)' : '';
            });
            if (Number(res.dm_spent || 0) > 0) {
              showToast(`FTL Drive gewechselt. ${Number(res.dm_spent || 0)} DM abgezogen.`, 'info');
            } else {
              showToast(`FTL Drive auf ${drive} gesetzt.`, 'success');
            }
            wm?.refresh?.('fleet');
          } else {
            if (ftlResultEl) {
              ftlResultEl.innerHTML = `<span style="color:#ff6666">Fehler: ${esc(res?.error || 'Unbekannt')}</span>`;
            }
            showToast(res?.error || 'Drive-Wechsel fehlgeschlagen.', 'error');
          }
        } catch (_) {
          if (ftlResultEl) ftlResultEl.innerHTML = '<span style="color:#ff6666">Netzwerkfehler</span>';
          showToast('Drive-Wechsel fehlgeschlagen.', 'error');
        }
        ftlButtons.forEach((entry) => {
          entry.disabled = false;
        });
      });
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { bindFtlSettingsPanel };
  } else {
    window.GQRuntimeFtlSettingsPanel = { bindFtlSettingsPanel };
  }
})();