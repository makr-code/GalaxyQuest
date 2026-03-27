/**
 * Authentication page logic (index.html)
 */
(async function () {
  // ── Redirect if already logged in ───────────────────────
  try {
    const me = await fetch('api/auth.php?action=me');
    if (me.ok) {
      const data = await me.json();
      if (data.success) {
        window.location.href = 'game.html';
        return;
      }
    }
  } catch (_) { /* not logged in */ }

  // ── Tab switching ────────────────────────────────────────
  const tabs    = document.querySelectorAll('.tab-btn');
  const loginForm    = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const devTools = document.getElementById('dev-auth-tools');
  const devResetBtn = document.getElementById('dev-reset-btn');
  const devResetUser = document.getElementById('dev-reset-username');
  const devResetPass = document.getElementById('dev-reset-password');
  const devResetResult = document.getElementById('dev-reset-result');

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      loginForm.classList.toggle('hidden', tab !== 'login');
      registerForm.classList.toggle('hidden', tab !== 'register');
    });
  });

  // ── CSRF ─────────────────────────────────────────────────
  async function getCsrf() {
    const r = await fetch('api/auth.php?action=csrf');
    const d = await r.json();
    return d.token;
  }

  async function loadDevToolsStatus() {
    try {
      const r = await fetch('api/auth.php?action=dev_tools_status');
      const d = await r.json();
      if (d.success && d.enabled) {
        devTools.classList.remove('hidden');
      }
    } catch (_) {
      // Keep hidden on errors.
    }
  }

  devResetBtn?.addEventListener('click', async () => {
    devResetResult.textContent = '';
    const username = devResetUser.value.trim();
    const password = devResetPass.value;
    if (!username || password.length < 8) {
      devResetResult.textContent = 'Username and password (min 8 chars) required.';
      return;
    }
    devResetBtn.disabled = true;
    devResetBtn.textContent = 'Resetting...';
    try {
      const csrf = await getCsrf();
      const res = await fetch('api/auth.php?action=dev_reset_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        devResetResult.style.color = '#86efac';
        devResetResult.textContent = data.message || 'Password reset complete.';
      } else {
        devResetResult.style.color = '';
        devResetResult.textContent = data.error || 'Reset failed.';
      }
    } catch (_) {
      devResetResult.style.color = '';
      devResetResult.textContent = 'Network error. Please try again.';
    } finally {
      devResetBtn.disabled = false;
      devResetBtn.textContent = 'Reset Password (Dev)';
    }
  });

  // ── Login ────────────────────────────────────────────────
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl  = document.getElementById('login-error');
    errEl.textContent = '';
    const btn    = loginForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Launching…';

    try {
      const csrf = await getCsrf();
      const res  = await fetch('api/auth.php?action=login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          username: document.getElementById('login-username').value.trim(),
          password: document.getElementById('login-password').value,
          remember: document.getElementById('login-remember').checked,
        }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = 'game.html';
      } else {
        errEl.textContent = data.error || 'Login failed.';
      }
    } catch (err) {
      errEl.textContent = 'Network error. Please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enter the Galaxy';
    }
  });

  // ── Register ─────────────────────────────────────────────
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const errEl  = document.getElementById('register-error');
    errEl.textContent = '';
    const btn    = registerForm.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Creating empire…';

    try {
      const csrf = await getCsrf();
      const res  = await fetch('api/auth.php?action=register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
        body: JSON.stringify({
          username: document.getElementById('reg-username').value.trim(),
          email:    document.getElementById('reg-email').value.trim(),
          password: document.getElementById('reg-password').value,
          remember: document.getElementById('reg-remember').checked,
        }),
      });
      const data = await res.json();
      if (data.success) {
        window.location.href = 'game.html';
      } else {
        errEl.textContent = data.error || 'Registration failed.';
      }
    } catch (err) {
      errEl.textContent = 'Network error. Please try again.';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Launch into the Galaxy';
    }
  });

  loadDevToolsStatus();
})();
