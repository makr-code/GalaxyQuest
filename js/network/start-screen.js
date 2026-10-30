import { initializeServerAnnouncements } from './server-announcements.js';
import { initializeRegistrationPrologue } from './registration-prologue.js';

export function initializeStartScreen({ onResume, onMute, onFlightTour = () => true, onRegistrationRequest, onRegistrationPreview } = {}) {
  const menu = document.getElementById('start-menu');
  const template = document.getElementById('auth-forms-template');
  if (!menu || !template?.content.firstElementChild) throw new Error('Start-screen HTML is missing required markup');
  const authRoot = template.content.firstElementChild.cloneNode(true);
  authRoot.removeAttribute('data-wm-window');
  const login = authRoot.querySelector('#login-form');
  const dev = authRoot.querySelector('#dev-auth-tools');
  const contentDialog = document.getElementById('start-content-dialog');
  const sessionStatus = document.getElementById('start-session-status');
  const activity = document.createElement('p');
  activity.className = 'start-auth-activity';
  activity.setAttribute('role', 'status');
  activity.hidden = true;
  let authDialog = null;
  let returnFocus = null;
  let resumePending = false;
  let panelListeners = null;
  let activeTrigger = null;
  const loginButton = document.getElementById('start-login');
  const announcements = initializeServerAnnouncements({
    beforeOpen: () => {
      // Do not interrupt credentials, registration or settings while the initial request finishes.
      if (authDialog || contentDialog.open || registration.isActive()) return false;
      return true;
    },
  });

  function releasePanel() {
    panelListeners?.abort();
    panelListeners = null;
    activeTrigger?.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
  }

  function closeContent() {
    if (!contentDialog.open) return;
    contentDialog.close();
    const trigger = activeTrigger;
    releasePanel();
    trigger?.focus();
    window.dispatchEvent(new Event('gq:start-panel-closed'));
  }

  function showPanel(panel, trigger, close) {
    activeTrigger = trigger;
    panel.classList.add('start-cascade-panel');
    trigger.parentElement.append(panel);
    panel.show();
    trigger.setAttribute('aria-expanded', 'true');
    panelListeners = new AbortController();
    const { signal } = panelListeners;
    const fitPanel = () => panel.style.setProperty('--start-panel-top', `${Math.max(0, panel.getBoundingClientRect().top)}px`);
    fitPanel();
    window.addEventListener('resize', fitPanel, { signal });
    window.addEventListener('scroll', fitPanel, { signal, passive: true });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }, { signal });
    document.addEventListener('pointerdown', (event) => {
      if (!panel.contains(event.target) && !trigger.contains(event.target)) close();
    }, { signal });
  }

  function report(message, level = 'info') {
    sessionStatus.textContent = message;
    window.GQLog?.[level]?.('[start-screen]', message);
  }

  function closeAuth(force = false) {
    if (force) closeContent();
    if (force) announcements.close();
    if (!authDialog || (!force && authRoot.querySelector('button[type="submit"]:disabled, #auth-2fa-submit:disabled, #dev-reset-btn:disabled, [data-registration-busy="true"]'))) return;
    if (!force) authRoot.querySelector('#auth-2fa-cancel')?.click();
    releasePanel();
    authDialog.close();
    authRoot.remove();
    authDialog.remove();
    authDialog = null;
    login.reset();
    registration.close();
    dev.reset();
    authRoot.querySelector('#auth-2fa-code').value = '';
    activity.hidden = true;
    authRoot.querySelectorAll('.form-error').forEach((el) => { el.textContent = ''; });
    returnFocus?.focus();
    window.dispatchEvent(new Event('gq:start-panel-closed'));
  }

  const registration = initializeRegistrationPrologue({
    request: onRegistrationRequest, onPreview: onRegistrationPreview,
    onClose: () => {
      document.getElementById('start-register').focus();
      window.dispatchEvent(new Event('gq:start-panel-closed'));
    },
  });

  function openAuth(mode, trigger) {
    if (activeTrigger === trigger) {
      closeAuth();
      return;
    }
    if (authDialog) {
      closeAuth();
      if (authDialog) return;
    }
    closeContent();
    returnFocus = trigger;
    authDialog = document.createElement('dialog');
    authDialog.className = 'start-dialog start-auth-dialog';
    authDialog.id = 'start-auth-dialog';
    authDialog.setAttribute('aria-labelledby', 'start-auth-title');
    const header = document.createElement('header');
    header.className = 'start-dialog-header';
    const title = document.createElement('h2');
    title.id = 'start-auth-title';
    title.textContent = mode === 'dev' ? 'Developer tools' : 'Welcome back, Commander';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close authentication');
    close.addEventListener('click', () => closeAuth());
    header.append(title, close);
    authDialog.append(header, authRoot, activity);
    login.classList.toggle('hidden', mode !== 'login');
    dev.classList.toggle('hidden', mode !== 'dev');
    [login, dev].forEach((form) => form.removeAttribute('hidden'));
    authDialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeAuth();
    });
    showPanel(authDialog, trigger, closeAuth);
    (mode === 'dev' ? dev : login).querySelector('input')?.focus();
  }

  ['login', 'dev'].forEach((mode) => {
    const trigger = document.getElementById(`start-${mode}`);
    trigger.addEventListener('click', () => openAuth(mode, trigger));
  });
  document.getElementById('start-register').addEventListener('click', () => {
    closeAuth();
    if (authDialog) return;
    closeContent();
    announcements.close();
    registration.open();
  });
  document.getElementById('start-resume').addEventListener('click', async (event) => {
    if (resumePending) return;
    resumePending = true;
    event.currentTarget.disabled = true;
    try {
      await onResume();
    } catch (error) {
      report(`Unable to resume: ${error.message}`, 'error');
    } finally {
      resumePending = false;
      document.getElementById('start-resume').disabled = false;
    }
  });
  menu.querySelectorAll('[data-start-panel]').forEach((button) => {
    button.addEventListener('click', () => {
      if (activeTrigger === button) {
        closeContent();
        return;
      }
      if (authDialog) {
        closeAuth();
        if (authDialog) return;
      }
      closeContent();
      document.querySelectorAll('[id^="start-panel-"]').forEach((panel) => {
        panel.hidden = panel.id !== `start-panel-${button.dataset.startPanel}`;
      });
      document.getElementById('start-content-title').textContent = button.childNodes[0].textContent.trim();
      showPanel(contentDialog, button, closeContent);
      contentDialog.querySelector('[data-start-close]').focus();
    });
  });
  contentDialog.querySelector('[data-start-close]').addEventListener('click', closeContent);
  document.getElementById('auth-console-toggle')?.addEventListener('click', () => {
    const terminal = document.getElementById('boot-terminal');
    if (!terminal) {
      report('The log console is unavailable.', 'error');
      return;
    }
    terminal.classList.remove('hidden');
    window.WM?.open?.('console');
    window.__GQ_SET_BOOT_CONSOLE_EXPANDED?.(!terminal.classList.contains('is-expanded'));
  });

  const motion = document.getElementById('start-reduced-motion');
  const mute = document.getElementById('start-mute');
  const flightTour = document.getElementById('start-flight-tour');
  const flightStatus = document.getElementById('start-flight-status');
  const settingsStatus = document.getElementById('start-settings-status');
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  try {
    const storedMotion = localStorage.getItem('gq_start_reduced_motion');
    motion.checked = storedMotion === null ? media.matches : storedMotion === '1';
    const storedFlightTour = localStorage.getItem('gq_start_flight_tour') === '1';
    flightTour.checked = storedFlightTour && !motion.checked;
    if (storedFlightTour && motion.checked) flightStatus.textContent = 'Turn off Reduce motion to enable automatic flight.';
    const audio = JSON.parse(localStorage.getItem('gq_audio_settings') || '{}');
    mute.checked = audio.masterMuted === true;
  } catch (error) {
    motion.checked = media.matches;
    flightTour.checked = false;
    settingsStatus.textContent = `Preferences could not be loaded: ${error.message}`;
  }
  function applyMotion() {
    document.body.classList.toggle('start-reduced-motion', motion.checked);
    document.body.dataset.startReducedMotion = String(motion.checked);
    window.dispatchEvent(new CustomEvent('gq:start-motion', { detail: { reduced: motion.checked } }));
  }
  applyMotion();
  motion.addEventListener('change', () => {
    applyMotion();
    try {
      localStorage.setItem('gq_start_reduced_motion', motion.checked ? '1' : '0');
      settingsStatus.textContent = 'Motion preference saved.';
    } catch (error) {
      settingsStatus.textContent = `Preference could not be saved: ${error.message}`;
    }
    if (motion.checked && flightTour.checked) {
      flightTour.checked = false;
      void applyFlightTour(false);
      flightStatus.textContent = 'Stopped because Reduce motion is enabled.';
    }
  });
  async function applyFlightTour(enabled, persist = true) {
    if (enabled && motion.checked) {
      flightTour.checked = false;
      flightStatus.textContent = 'Turn off Reduce motion to enable automatic flight.';
      return;
    }
    flightTour.disabled = true;
    try {
      const accepted = await onFlightTour(enabled);
      if (enabled && accepted === false) throw new Error('The galaxy renderer is not ready yet.');
      if (persist) localStorage.setItem('gq_start_flight_tour', enabled ? '1' : '0');
      flightStatus.textContent = enabled ? 'Automatic database flight is running.' : 'Automatic flight is off.';
    } catch (error) {
      flightTour.checked = !enabled;
      flightStatus.textContent = `Automatic flight could not be changed: ${error.message}`;
    } finally {
      flightTour.disabled = false;
    }
  }
  flightTour.addEventListener('change', () => { void applyFlightTour(flightTour.checked); });
  if (flightTour.checked) void applyFlightTour(true, false);
  mute.addEventListener('change', async () => {
    mute.disabled = true;
    try {
      await onMute(mute.checked);
      settingsStatus.textContent = 'Audio preference applied.';
    } catch (error) {
      mute.checked = !mute.checked;
      settingsStatus.textContent = `Audio preference could not be applied: ${error.message}`;
    } finally {
      mute.disabled = false;
    }
  });
  window.addEventListener('gq:audio-state', (event) => {
    if (typeof event.detail?.masterMuted === 'boolean') mute.checked = event.detail.masterMuted;
  });

  return {
    authRoot,
    registration,
    closeAuth,
    setActivity(title, text) {
      activity.textContent = title ? `${title} ${text}` : '';
      activity.hidden = !title;
      return !!authDialog;
    },
    setSession(authenticated, username = '') {
      loginButton.parentElement.hidden = authenticated;
      document.getElementById('start-register').parentElement.hidden = authenticated;
      document.getElementById('start-login').hidden = authenticated;
      document.getElementById('start-resume').hidden = !authenticated;
      document.getElementById('start-register').hidden = authenticated;
      report(authenticated ? `Welcome back${username ? `, ${username}` : ''}. Ready to resume.` : 'Your next chapter awaits.');
    },
    setStatus: report,
  };
}
