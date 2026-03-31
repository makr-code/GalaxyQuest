/**
 * settings-2fa.js
 *
 * Drives the TOTP 2FA setup/disable UI in the Account tab of the Settings
 * dialog (#settings-modal → [data-tab="account"]).
 *
 * Endpoints (api/auth.php):
 *   GET  ?action=totp_status       → { success, enabled }
 *   GET  ?action=totp_begin_setup  → { success, uri, secret }
 *   POST ?action=totp_confirm_setup { code, csrf }
 *   POST ?action=totp_disable       { code, csrf }
 */
(function () {
  'use strict';

  // ── QR-code rendering ──────────────────────────────────────────────────────
  // Uses qrcode.js (MIT) loaded from CDN on demand, so the library is only
  // fetched when the user actually opens the 2FA setup panel.
  const QR_CDN = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js';
  let qrLibPromise = null;

  function loadQrLib() {
    if (qrLibPromise) return qrLibPromise;
    qrLibPromise = new Promise((resolve, reject) => {
      if (window.QRCode) { resolve(window.QRCode); return; }
      const s = document.createElement('script');
      s.src = QR_CDN;
      s.onload = () => resolve(window.QRCode);
      s.onerror = () => reject(new Error('QRCode library failed to load'));
      document.head.appendChild(s);
    });
    return qrLibPromise;
  }

  async function renderQr(container, text) {
    container.innerHTML = '';
    try {
      const QRCode = await loadQrLib();
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      QRCode.toCanvas(canvas, text, { width: 200, margin: 2 }, (err) => {
        if (err) {
          container.innerHTML = '<span class="settings-help-text" style="color:#f97">QR-Code konnte nicht geladen werden.</span>';
        }
      });
    } catch (e) {
      container.innerHTML = '<span class="settings-help-text" style="color:#f97">QR-Code konnte nicht geladen werden.</span>';
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function getCsrf() {
    return fetch('api/auth.php?action=csrf', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => d.token || '');
  }

  async function apiGet(action) {
    const r = await fetch(`api/auth.php?action=${action}`, { credentials: 'same-origin' });
    return r.json();
  }

  async function apiPost(action, body) {
    const csrf = await getCsrf();
    const r = await fetch(`api/auth.php?action=${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg || '';
  }

  // ── UI state machine ───────────────────────────────────────────────────────
  function show(...ids) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    });
  }

  function hide(...ids) {
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  function setStatus(text) {
    const el = document.getElementById('2fa-status-row');
    if (el) el.textContent = text;
  }

  function applyStatus(enabled) {
    if (enabled) {
      setStatus('');
      show('2fa-enabled-ui');
      hide('2fa-disabled-ui', '2fa-setup-panel', '2fa-disable-panel');
    } else {
      setStatus('');
      show('2fa-disabled-ui');
      hide('2fa-enabled-ui', '2fa-setup-panel', '2fa-disable-panel');
    }
  }

  async function loadStatus() {
    setStatus('Lade 2FA-Status…');
    hide('2fa-enabled-ui', '2fa-disabled-ui', '2fa-setup-panel', '2fa-disable-panel');
    try {
      const d = await apiGet('totp_status');
      applyStatus(d.enabled === true || d.enabled === 1);
    } catch {
      setStatus('Status konnte nicht geladen werden.');
    }
  }

  // ── Event wiring ───────────────────────────────────────────────────────────
  function wire() {
    // Open setup flow
    const enableBtn = document.getElementById('2fa-enable-open-btn');
    if (enableBtn && !enableBtn.__2faWired) {
      enableBtn.__2faWired = true;
      enableBtn.addEventListener('click', async () => {
        setError('2fa-setup-error', '');
        const qrContainer = document.getElementById('2fa-qr-container');
        const secretDisplay = document.getElementById('2fa-secret-display');
        if (qrContainer) qrContainer.innerHTML = '<span class="settings-help-text">Wird generiert…</span>';

        hide('2fa-disabled-ui');
        show('2fa-setup-panel');

        try {
          const d = await apiPost('totp_begin_setup', {});
          if (!d.success) throw new Error(d.error || 'Setup fehlgeschlagen');
          if (secretDisplay) secretDisplay.textContent = d.secret || '';
          if (qrContainer && d.uri) await renderQr(qrContainer, d.uri);
          const codeInput = document.getElementById('2fa-setup-code');
          if (codeInput) codeInput.focus();
        } catch (e) {
          const qr = document.getElementById('2fa-qr-container');
          if (qr) qr.innerHTML = '';
          setError('2fa-setup-error', e.message || 'Setup fehlgeschlagen');
        }
      });
    }

    // Confirm setup
    const confirmBtn = document.getElementById('2fa-setup-confirm-btn');
    if (confirmBtn && !confirmBtn.__2faWired) {
      confirmBtn.__2faWired = true;
      confirmBtn.addEventListener('click', async () => {
        setError('2fa-setup-error', '');
        const code = (document.getElementById('2fa-setup-code')?.value || '').trim();
        if (!/^\d{6}$/.test(code)) {
          setError('2fa-setup-error', 'Bitte einen 6-stelligen Code eingeben.');
          return;
        }
        confirmBtn.disabled = true;
        try {
          const d = await apiPost('totp_confirm_setup', { code });
          if (d.success) {
            applyStatus(true);
          } else {
            setError('2fa-setup-error', d.error || 'Code ungültig.');
          }
        } catch (e) {
          setError('2fa-setup-error', e.message || 'Fehler beim Aktivieren');
        } finally {
          confirmBtn.disabled = false;
        }
      });
    }

    // Cancel setup
    const cancelSetup = document.getElementById('2fa-setup-cancel-btn');
    if (cancelSetup && !cancelSetup.__2faWired) {
      cancelSetup.__2faWired = true;
      cancelSetup.addEventListener('click', () => applyStatus(false));
    }

    // Open disable flow
    const disableOpenBtn = document.getElementById('2fa-disable-open-btn');
    if (disableOpenBtn && !disableOpenBtn.__2faWired) {
      disableOpenBtn.__2faWired = true;
      disableOpenBtn.addEventListener('click', () => {
        setError('2fa-disable-error', '');
        const inp = document.getElementById('2fa-disable-code');
        if (inp) { inp.value = ''; inp.focus(); }
        hide('2fa-enabled-ui');
        show('2fa-disable-panel');
      });
    }

    // Confirm disable
    const disableConfirmBtn = document.getElementById('2fa-disable-confirm-btn');
    if (disableConfirmBtn && !disableConfirmBtn.__2faWired) {
      disableConfirmBtn.__2faWired = true;
      disableConfirmBtn.addEventListener('click', async () => {
        setError('2fa-disable-error', '');
        const code = (document.getElementById('2fa-disable-code')?.value || '').trim();
        if (!/^\d{6}$/.test(code)) {
          setError('2fa-disable-error', 'Bitte einen 6-stelligen Code eingeben.');
          return;
        }
        disableConfirmBtn.disabled = true;
        try {
          const d = await apiPost('totp_disable', { code });
          if (d.success) {
            applyStatus(false);
          } else {
            setError('2fa-disable-error', d.error || 'Code ungültig.');
          }
        } catch (e) {
          setError('2fa-disable-error', e.message || 'Fehler beim Deaktivieren');
        } finally {
          disableConfirmBtn.disabled = false;
        }
      });
    }

    // Cancel disable
    const cancelDisable = document.getElementById('2fa-disable-cancel-btn');
    if (cancelDisable && !cancelDisable.__2faWired) {
      cancelDisable.__2faWired = true;
      cancelDisable.addEventListener('click', () => applyStatus(true));
    }
  }

  // ── Initialise when settings modal opens on the Account tab ───────────────
  function onSettingsTabChange(tab) {
    if (tab !== 'account') return;
    wire();
    loadStatus();
  }

  // Listen for the WM modal-open event and tab changes.
  window.addEventListener('wm:modal-opened', (ev) => {
    if ((ev?.detail?.id || '') !== 'settings-modal') return;
    // Check if the account tab is already active.
    const active = document.querySelector('#settings-modal [data-ui-tab-panel].is-active[data-ui-tab-panel]');
    if (active?.getAttribute('data-ui-tab-panel') === 'account') {
      wire();
      loadStatus();
    }
  });

  document.addEventListener('gq:ui-tab-change', (ev) => {
    const host = ev?.target;
    if (!host || host.id !== 'settings-tabs') return;
    const tab = ev?.detail?.tabId || '';
    if (tab) onSettingsTabChange(tab);
  });
})();
