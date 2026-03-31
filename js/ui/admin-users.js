/**
 * Admin User Management Panel
 *
 * Rendered into #admin-users-modal.
 * Requires an active admin session; the nav button (#nav-btn-admin-users)
 * is shown/hidden by checking the `is_admin` flag on the /api/auth.php?action=me
 * response (wired in game.js / auth bootstrap).
 *
 * Exposes: window.AdminUsers.open() / window.AdminUsers.init()
 */
(function () {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────
  const state = {
    page:        1,
    limit:       50,
    q:           '',
    showDeleted: false,
    total:       0,
    pages:       1,
    loaded:      false,
  };

  // ─── DOM refs (resolved lazily once) ────────────────────────────────────
  let dom = null;

  function getDom() {
    if (dom) return dom;
    dom = {
      modal:        document.getElementById('admin-users-modal'),
      tbody:        document.getElementById('admin-users-tbody'),
      search:       document.getElementById('admin-users-search'),
      showDeleted:  document.getElementById('admin-users-show-deleted'),
      reload:       document.getElementById('admin-users-reload'),
      createBtn:    document.getElementById('admin-users-create-btn'),
      prev:         document.getElementById('admin-users-prev'),
      next:         document.getElementById('admin-users-next'),
      pageInfo:     document.getElementById('admin-users-page-info'),
      error:        document.getElementById('admin-users-error'),
      // Edit sub-dialog
      editModal:    document.getElementById('admin-user-edit-modal'),
      editTitle:    document.getElementById('admin-user-edit-title'),
      editId:       document.getElementById('admin-user-edit-id'),
      editUsername: document.getElementById('admin-user-edit-username'),
      editEmail:    document.getElementById('admin-user-edit-email'),
      editControlType: document.getElementById('admin-user-edit-control-type'),
      editAuthEnabled: document.getElementById('admin-user-edit-auth-enabled'),
      editPassword: document.getElementById('admin-user-edit-password'),
      editIsAdmin:  document.getElementById('admin-user-edit-is-admin'),
      editError:    document.getElementById('admin-user-edit-error'),
      editSave:     document.getElementById('admin-user-edit-save'),
      editCancel:   document.getElementById('admin-user-edit-cancel'),
      editClose:    document.getElementById('admin-user-edit-close'),
      // Delete sub-dialog
      deleteModal:  document.getElementById('admin-user-delete-modal'),
      deleteText:   document.getElementById('admin-user-delete-text'),
      deleteError:  document.getElementById('admin-user-delete-error'),
      deleteConfirm:document.getElementById('admin-user-delete-confirm'),
      deleteCancel: document.getElementById('admin-user-delete-cancel'),
      deleteClose:  document.getElementById('admin-user-delete-close'),
    };
    return dom;
  }

  // ─── API helpers ─────────────────────────────────────────────────────────
  const API = '/api/admin_users.php';

  async function apiFetch(params = {}, method = 'GET', body = null) {
    const url = API + '?' + new URLSearchParams(params).toString();
    const opts = { method, headers: { 'Accept': 'application/json' } };

    if (body !== null) {
      // Attach CSRF token from window.apiPost helper if available, else fetch directly.
      const csrf = await getCsrfToken();
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['X-CSRF-Token'] = csrf;
      opts.body = JSON.stringify(body);
    }

    const res  = await fetch(url, opts);
    const data = await res.json().catch(() => ({ success: false, error: 'Parse error' }));
    if (!data.success) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  async function getCsrfToken() {
    // Reuse the auth module's CSRF function if available.
    if (window.__GQ_GET_CSRF && typeof window.__GQ_GET_CSRF === 'function') {
      return window.__GQ_GET_CSRF();
    }
    const res  = await fetch('/api/auth.php?action=csrf');
    const data = await res.json();
    return data.token || '';
  }

  // ─── User table rendering ─────────────────────────────────────────────────
  function renderTable(users) {
    const d = getDom();
    if (!users.length) {
      d.tbody.innerHTML = '<tr><td colspan="11" style="padding:1rem;text-align:center;opacity:.6">No users found.</td></tr>';
      return;
    }

    d.tbody.innerHTML = users.map(u => {
      const deleted   = !!u.deleted_at;
      const adminBadge = u.is_admin ? '✓' : '';
      const actorType = u.control_type === 'npc_engine' ? 'NPC' : 'Human';
      const authBadge = u.auth_enabled ? 'on' : 'off';
      const status    = deleted
        ? '<span style="color:#e74c3c">Ghost NPC</span>'
        : (u.control_type === 'npc_engine'
          ? '<span style="opacity:.6">NPC</span>'
          : '<span style="color:#2ecc71">Active</span>');
      const lastLogin = u.last_login
        ? new Date(u.last_login).toLocaleDateString()
        : '—';

      const editBtn = !deleted
        ? `<button class="wm-modal-nav-btn" data-admin-edit="${u.id}" type="button" style="padding:0.15rem 0.5rem;font-size:0.8rem">Edit</button>`
        : '';
      const deleteBtn = !deleted
        ? `<button class="wm-modal-nav-btn" data-admin-delete="${u.id}" data-admin-username="${escHtml(u.username)}" type="button"
               style="padding:0.15rem 0.5rem;font-size:0.8rem;background:var(--btn-danger-bg,#c0392b);color:#fff;border-color:transparent">Delete</button>`
        : '';

      const rowStyle = deleted ? 'opacity:.45' : '';
      return `<tr style="${rowStyle};border-bottom:1px solid rgba(255,255,255,0.07)">
        <td style="padding:0.35rem 0.5rem">${u.id}</td>
        <td style="padding:0.35rem 0.5rem">${escHtml(u.username)}</td>
        <td style="padding:0.35rem 0.5rem">${escHtml(u.email)}</td>
        <td style="padding:0.35rem 0.5rem">${actorType}</td>
        <td style="padding:0.35rem 0.5rem;text-align:center">${authBadge}</td>
        <td style="padding:0.35rem 0.5rem;text-align:center">${adminBadge}</td>
        <td style="padding:0.35rem 0.5rem;text-align:center">${u.colony_count ?? 0}</td>
        <td style="padding:0.35rem 0.5rem;text-align:right">${u.rank_points}</td>
        <td style="padding:0.35rem 0.5rem">${lastLogin}</td>
        <td style="padding:0.35rem 0.5rem">${status}</td>
        <td style="padding:0.35rem 0.5rem;white-space:nowrap;display:flex;gap:0.25rem">${editBtn}${deleteBtn}</td>
      </tr>`;
    }).join('');
  }

  function escHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Load data ────────────────────────────────────────────────────────────
  async function load() {
    const d = getDom();
    d.error.textContent = '';
    d.tbody.innerHTML   = '<tr><td colspan="9" style="padding:1rem;text-align:center;opacity:.6">Loading…</td></tr>';

    try {
      const params = {
        action:       'list',
        page:         state.page,
        limit:        state.limit,
        show_deleted: state.showDeleted ? '1' : '0',
      };
      if (state.q) params.q = state.q;

      const data = await apiFetch(params);
      state.total = data.total;
      state.pages = data.pages;

      renderTable(data.users || []);

      d.pageInfo.textContent = `Page ${state.page} / ${state.pages}  (${state.total} users)`;
      d.prev.disabled = state.page <= 1;
      d.next.disabled = state.page >= state.pages;

    } catch (err) {
      d.error.textContent = err.message;
      d.tbody.innerHTML   = '<tr><td colspan="11" style="padding:1rem;text-align:center;color:#e74c3c">Error loading users.</td></tr>';
    }
  }

  function syncActorEditFields() {
    const d = getDom();
    const isHuman = d.editControlType.value === 'human';
    d.editAuthEnabled.disabled = !isHuman;
    if (!isHuman) {
      d.editAuthEnabled.checked = false;
      d.editIsAdmin.checked = false;
      d.editIsAdmin.disabled = true;
    } else {
      d.editIsAdmin.disabled = false;
    }
  }

  // ─── Edit dialog ─────────────────────────────────────────────────────────
  async function openEdit(userId) {
    const d = getDom();
    d.editError.textContent = '';
    d.editPassword.value    = '';

    if (userId) {
      d.editTitle.textContent = 'Edit User';
      try {
        const data = await apiFetch({ action: 'get', id: userId });
        const u = data.user;
        d.editId.value       = u.id;
        d.editUsername.value = u.username;
        d.editEmail.value    = u.email;
        d.editControlType.value = u.control_type || 'human';
        d.editAuthEnabled.checked = !!u.auth_enabled;
        d.editIsAdmin.checked = !!u.is_admin;
        syncActorEditFields();
      } catch (err) {
        getDom().error.textContent = err.message;
        return;
      }
    } else {
      d.editTitle.textContent = 'New User';
      d.editId.value       = '';
      d.editUsername.value = '';
      d.editEmail.value    = '';
      d.editControlType.value = 'human';
      d.editAuthEnabled.checked = true;
      d.editIsAdmin.checked = false;
      syncActorEditFields();
    }

    d.editModal.removeAttribute('hidden');
    d.editUsername.focus();
  }

  function closeEdit() {
    getDom().editModal.setAttribute('hidden', '');
  }

  async function saveEdit() {
    const d = getDom();
    d.editError.textContent = '';
    const id    = d.editId.value ? parseInt(d.editId.value, 10) : null;
    const body  = {
      username: d.editUsername.value.trim() || undefined,
      email:    d.editEmail.value.trim()    || undefined,
      control_type: d.editControlType.value,
      auth_enabled: d.editAuthEnabled.checked ? 1 : 0,
      is_admin: d.editIsAdmin.checked ? 1 : 0,
    };
    if (d.editPassword.value) {
      body.password = d.editPassword.value;
    }

    if (id) {
      body.id = id;
    }

    const action = id ? 'update' : 'create';

    try {
      await apiFetch({ action }, 'POST', body);
      closeEdit();
      await load();
    } catch (err) {
      d.editError.textContent = err.message;
    }
  }

  // ─── Delete dialog ────────────────────────────────────────────────────────
  let _pendingDeleteId = null;

  function openDelete(userId, username) {
    const d = getDom();
    _pendingDeleteId            = userId;
    d.deleteError.textContent   = '';
    d.deleteText.innerHTML      =
      `Delete <strong>${escHtml(username)}</strong> (ID ${userId})?<br><br>` +
      `The user account will be scrubbed (username, email, password, 2FA). ` +
      `All colonies, fleets and research will be preserved and assigned to a ghost NPC placeholder.`;
    d.deleteModal.removeAttribute('hidden');
  }

  function closeDelete() {
    _pendingDeleteId = null;
    getDom().deleteModal.setAttribute('hidden', '');
  }

  async function confirmDelete() {
    if (!_pendingDeleteId) return;
    const d = getDom();
    d.deleteError.textContent = '';
    d.deleteConfirm.disabled  = true;
    try {
      await apiFetch({ action: 'delete' }, 'POST', { id: _pendingDeleteId });
      closeDelete();
      await load();
    } catch (err) {
      d.deleteError.textContent = err.message;
    } finally {
      d.deleteConfirm.disabled = false;
    }
  }

  // ─── Wire events (once) ───────────────────────────────────────────────────
  let wired = false;

  function wireEvents() {
    if (wired) return;
    wired = true;

    const d = getDom();

    // Search (debounced)
    let searchTimer = null;
    d.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.q    = d.search.value.trim();
        state.page = 1;
        load();
      }, 350);
    });

    d.showDeleted.addEventListener('change', () => {
      state.showDeleted = d.showDeleted.checked;
      state.page = 1;
      load();
    });

    d.reload.addEventListener('click', () => load());

    d.prev.addEventListener('click', () => {
      if (state.page > 1) { state.page--; load(); }
    });

    d.next.addEventListener('click', () => {
      if (state.page < state.pages) { state.page++; load(); }
    });

    d.createBtn.addEventListener('click', () => openEdit(null));
    d.editControlType.addEventListener('change', syncActorEditFields);

    // Edit / Delete via event delegation on tbody
    d.tbody.addEventListener('click', (ev) => {
      const editTarget   = ev.target.closest('[data-admin-edit]');
      const deleteTarget = ev.target.closest('[data-admin-delete]');
      if (editTarget) {
        openEdit(parseInt(editTarget.dataset.adminEdit, 10));
      } else if (deleteTarget) {
        openDelete(
          parseInt(deleteTarget.dataset.adminDelete, 10),
          deleteTarget.dataset.adminUsername
        );
      }
    });

    // Edit dialog buttons
    d.editSave.addEventListener('click',   saveEdit);
    d.editCancel.addEventListener('click', closeEdit);
    d.editClose.addEventListener('click',  closeEdit);

    // Delete dialog buttons
    d.deleteConfirm.addEventListener('click', confirmDelete);
    d.deleteCancel.addEventListener('click',  closeDelete);
    d.deleteClose.addEventListener('click',   closeDelete);
  }

  // ─── Public API ──────────────────────────────────────────────────────────
  function open() {
    wireEvents();
    const d = getDom();
    d.modal.removeAttribute('hidden');
    if (!state.loaded) {
      state.loaded = true;
      load();
    }
  }

  function init() {
    // Show the nav button if the current user is an admin.
    // Called from game.js / auth bootstrap after /me resolves.
    const navBtn = document.getElementById('nav-btn-admin-users');
    if (navBtn) navBtn.style.display = '';

    // Wire the WM window open event.
    if (window.WM && typeof window.WM.on === 'function') {
      window.WM.on('open', function (id) {
        if (id === 'admin-users') open();
      });
    }

    // Fallback: wire nav button directly.
    if (navBtn) {
      navBtn.addEventListener('click', open);
    }
  }

  window.AdminUsers = { init, open };
})();
