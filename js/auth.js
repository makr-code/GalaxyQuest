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
})();
