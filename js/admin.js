/* Página de administración: llamadas SOS, altas pendientes, cuidadores y usuarios. */
(function () {
  const session = SAAuth.get();
  if (!session || session.role !== 'admin') return; // admin.html ya redirige

  const $ = (id) => document.getElementById(id);
  const api = SAAuth.api;
  const ROLE = SAAuth.ROLES;
  const SKILLS = { compania: 'Compañía', compras: 'Compras', tecnologia: 'Tecnología', tramites: 'Trámites' };
  const STATUS = { activo: 'Activo', pendiente: 'Pendiente de alta', inactivo: 'Inactivo' };
  const POLL_MS = 10000;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => (d ? new Date(d.replace(' ', 'T')).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const isSelf = (u) => u.toLowerCase() === session.username.toLowerCase();

  let users = [];
  let calls = [];
  let sosFilter = 'pendiente';
  let attending = null;     // id de la llamada que se está atendiendo (formulario abierto)
  let knownCalls = null;    // ids ya vistos, para avisar de las nuevas

  // ---------------------------------------------------------------- utilidades
  function toast(msg, kind = 'info', ms = 5000) {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  let audioCtx;
  function alarm() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      [0, 0.3, 0.6].forEach((t) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = 990;
        o.connect(g); g.connect(audioCtx.destination);
        const at = audioCtx.currentTime + t;
        g.gain.setValueAtTime(0.25, at);
        g.gain.exponentialRampToValueAtTime(0.001, at + 0.25);
        o.start(at); o.stop(at + 0.25);
      });
    } catch (e) { /* sin audio */ }
  }

  /** Botón de dos pulsaciones para acciones destructivas. Devuelve true en la segunda. */
  function confirmed(btn, label = '¿Seguro? Pulse otra vez') {
    if (btn.dataset.armed === '1') return true;
    const original = btn.textContent;
    btn.dataset.armed = '1';
    btn.textContent = label;
    btn.classList.add('danger');
    setTimeout(() => {
      if (!btn.isConnected) return;
      btn.dataset.armed = '';
      btn.textContent = original;
      btn.classList.remove('danger');
    }, 4000);
    return false;
  }

  function setCount(id, n) {
    const el = $(id);
    el.textContent = n;
    el.hidden = !n;
  }

  function handleError(err) {
    if (err.status === 401) { SAAuth.clear(); location.replace('login.html'); return; }
    if (err.status === 403) { location.replace('app.html'); return; }
    toast(err.message, 'warn');
  }

  // ---------------------------------------------------------------- pestañas
  function showTab(name) {
    if (!$('tab-' + name)) name = 'sos';
    document.querySelectorAll('main > .view').forEach((v) => v.classList.toggle('active', v.id === 'tab-' + name));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    history.replaceState(null, '', '#' + name);
  }

  // ---------------------------------------------------------------- 3. SOS
  async function loadCalls() {
    try {
      calls = (await api('/api/admin/sos')).calls;
    } catch (err) { return handleError(err); }

    const pending = calls.filter((c) => c.status === 'pendiente');
    if (knownCalls) {
      const fresh = pending.filter((c) => !knownCalls.has(c.id));
      if (fresh.length) {
        alarm();
        fresh.forEach((c) => toast(`🚨 Nueva llamada SOS de ${c.name}: ${c.reason}`, 'danger', 10000));
      }
    }
    knownCalls = new Set(calls.map((c) => c.id));
    setCount('count-sos', pending.length);
    document.title = (pending.length ? `(${pending.length}) ` : '') + 'SilverAid — Administración';
    $('sos-updated').textContent = 'Actualizado ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    if (!attending) renderCalls();
  }

  function renderCalls() {
    const rows = calls.filter((c) => !sosFilter || c.status === sosFilter);
    $('sos-body').innerHTML = rows.length
      ? rows.map((c) => `
        <tr class="${c.status === 'pendiente' ? 'row-alert' : ''}">
          <td>${fmt(c.date)}</td>
          <td><strong>${esc(c.name)}</strong><span class="sub">@${esc(c.username)}</span></td>
          <td>${esc(c.reason)}</td>
          <td>${c.lat ? `<a href="https://www.google.com/maps?q=${esc(c.lat)},${esc(c.lng)}" target="_blank" rel="noopener">📍 Ver mapa</a>` : '<span class="muted">No disponible</span>'}</td>
          <td><span class="pill ${c.status}">${c.status === 'pendiente' ? 'Pendiente' : 'Atendida'}</span></td>
          <td>${c.status === 'atendida'
            ? `<span class="sub">${esc(c.attendedBy)} · ${fmt(c.attendedAt)}</span>${c.note ? esc(c.note) : ''}`
            : attending === c.id
              ? `<form class="attend-form" data-id="${esc(c.id)}">
                   <input name="note" placeholder="Nota (ej. Se llamó a la hija)" maxlength="300" aria-label="Nota de atención">
                   <button class="btn ok small">Guardar</button>
                   <button type="button" class="btn ghost small" data-cancel-attend>Cancelar</button>
                 </form>`
              : `<button class="btn small" data-attend="${esc(c.id)}">Marcar atendida</button>`}</td>
        </tr>`).join('')
      : `<tr><td colspan="6" class="empty">${sosFilter === 'pendiente' ? '✅ No hay llamadas pendientes.' : 'No hay llamadas registradas.'}</td></tr>`;
    $('sos-body').querySelector('.attend-form input')?.focus();
  }

  // ---------------------------------------------------------------- 1 y usuarios
  async function loadUsers() {
    try {
      users = (await api('/api/admin/users')).users;
    } catch (err) { return handleError(err); }
    renderPending();
    renderUsers();
  }

  function nameOf(username) {
    const u = users.find((x) => x.username.toLowerCase() === (username || '').toLowerCase());
    return u ? `${esc(u.name)} <span class="sub">@${esc(u.username)}</span>` : esc(username || '—');
  }

  function renderPending() {
    const pending = users.filter((u) => u.status === 'pendiente');
    setCount('count-pending', pending.length);
    $('pending-body').innerHTML = pending.length
      ? pending.map((u) => `
        <tr>
          <td><strong>${esc(u.name)}</strong></td>
          <td>@${esc(u.username)}</td>
          <td>${nameOf(u.registeredBy)}</td>
          <td>${fmt(u.registeredAt)}</td>
          <td class="actions">
            <button class="btn ok small" data-approve="${esc(u.username)}">✔ Dar de alta</button>
            <button class="btn ghost small" data-reject="${esc(u.username)}">Rechazar</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">✅ No hay altas pendientes.</td></tr>';
  }

  function renderUsers() {
    $('users-body').innerHTML = users.map((u) => `
      <tr>
        <td><strong>${esc(u.name)}</strong> ${isSelf(u.username) ? '<span class="tag">Usted</span>' : ''}</td>
        <td>@${esc(u.username)}</td>
        <td>${esc(ROLE[u.role] || u.role)}</td>
        <td><span class="pill ${u.status}">${STATUS[u.status] || esc(u.status)}</span></td>
        <td>${u.registeredBy ? nameOf(u.registeredBy) : '<span class="muted">—</span>'}</td>
        <td class="actions">${isSelf(u.username) ? '' : `
          ${u.status === 'activo'
            ? `<button class="btn ghost small" data-status="inactivo" data-user="${esc(u.username)}">Desactivar</button>`
            : `<button class="btn ok small" data-status="activo" data-user="${esc(u.username)}">${u.status === 'pendiente' ? 'Dar de alta' : 'Activar'}</button>`}
          <button class="btn ghost small" data-delete-user="${esc(u.username)}">Eliminar</button>`}
        </td>
      </tr>`).join('');
  }

  async function setStatus(username, status) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(username)}/status`, { method: 'POST', body: { status } });
      toast(status === 'activo' ? `@${username} ya puede usar SilverAid.` : `@${username} desactivado.`, 'ok');
    } catch (err) { handleError(err); }
    loadUsers();
  }

  async function deleteUser(username) {
    try {
      await api('/api/admin/users/' + encodeURIComponent(username), { method: 'DELETE' });
      toast(`Cuenta @${username} eliminada.`, 'ok');
    } catch (err) { handleError(err); }
    loadUsers();
    loadCaregivers();
  }

  // ---------------------------------------------------------------- 2. cuidadores
  let caregivers = [];
  let editingId = null; // id del cuidador que se está editando (null = registro nuevo)

  async function loadCaregivers() {
    let list;
    try {
      list = (await api('/api/admin/caregivers')).caregivers;
    } catch (err) { return handleError(err); }
    caregivers = list;
    $('cg-count').textContent = `(${list.length})`;
    $('cg-body').innerHTML = list.length
      ? list.map((c) => `
        <tr class="${c.id === editingId ? 'row-editing' : ''}">
          <td><strong>${esc(c.name)}</strong><span class="sub">${c.birthdate ? 'Nac. ' + esc(c.birthdate) : ''}${c.zone ? ' · ' + esc(c.zone) : ''}</span></td>
          <td>${esc(c.document)}</td>
          <td>📞 ${esc(c.phone)}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ''}${c.address ? `<span class="sub">${esc(c.address)}</span>` : ''}</td>
          <td>${esc(c.title)}<span class="sub">${c.experience} años de experiencia</span></td>
          <td>${c.skills.map((s) => `<span class="tag">${SKILLS[s] || esc(s)}</span>`).join(' ')}</td>
          <td>${SAAvail.total(c.availability)
            ? `${SAAvail.summary(c.availability).split(' · ').map((part) => `<span class="nowrap">${esc(part)}</span>`).join('<br>')}<span class="sub">${SAAvail.total(c.availability)} h/semana</span>`
            : '<span class="muted">Sin horario</span>'}</td>
          <td>${c.username ? '@' + esc(c.username) : '<span class="muted">Sin cuenta</span>'}</td>
          <td class="actions">
            <button class="btn small" data-edit-cg="${esc(c.id)}">✏️ Editar</button>
            <button class="btn ghost small" data-delete-cg="${esc(c.id)}" data-name="${esc(c.name)}">Eliminar</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="8" class="empty">No hay cuidadores registrados.</td></tr>';
  }

  // ---------------------------------------------------------------- arranque
  document.addEventListener('DOMContentLoaded', () => {
    $('user-chip').textContent = `👤 ${session.name}` + (session.name === ROLE.admin ? '' : ` · ${ROLE.admin}`);
    $('btn-logout').addEventListener('click', () => SAAuth.logout());
    SAAuth.api('/api/me').then(({ user }) => { if (user.role !== 'admin') location.replace('app.html'); }).catch(handleError);

    $('tabs').addEventListener('click', (e) => {
      const tab = e.target.closest('button')?.dataset.tab;
      if (tab) showTab(tab);
    });
    showTab(location.hash.slice(1) || 'sos');

    // SOS
    $('sos-filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      sosFilter = b.dataset.filter;
      document.querySelectorAll('#sos-filter .chip').forEach((c) => c.setAttribute('aria-pressed', c === b));
      attending = null;
      renderCalls();
    });
    $('sos-body').addEventListener('click', (e) => {
      if (e.target.dataset.attend) { attending = e.target.dataset.attend; renderCalls(); }
      if ('cancelAttend' in e.target.dataset) { attending = null; renderCalls(); }
    });
    $('sos-body').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      try {
        await api(`/api/admin/sos/${encodeURIComponent(f.dataset.id)}/attend`, { method: 'POST', body: { note: f.elements.note.value } });
        toast('Llamada marcada como atendida.', 'ok');
      } catch (err) { handleError(err); }
      attending = null;
      loadCalls();
    });

    // Altas y usuarios
    $('pending-body').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.approve) setStatus(b.dataset.approve, 'activo');
      if (b.dataset.reject && confirmed(b, '¿Rechazar? Pulse otra vez')) deleteUser(b.dataset.reject);
    });
    $('users-body').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.status) setStatus(b.dataset.user, b.dataset.status);
      if (b.dataset.deleteUser && confirmed(b)) deleteUser(b.dataset.deleteUser);
    });
    $('form-user').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await api('/api/admin/users', { method: 'POST', body: { name: f.name.value.trim(), username: f.username.value.trim(), password: f.password.value, role: f.role.value } });
        toast(`Usuario @${f.username.value.trim()} creado.`, 'ok');
        e.target.reset();
        loadUsers();
      } catch (err) { handleError(err); }
    });

    // Cuidadores: formulario plegable bajo la lista
    const avail = SAAvail.editor($('avail-editor'), () => {
      const av = avail.get();
      const n = SAAvail.total(av);
      $('avail-summary').textContent = n ? `${n} h/semana · ${SAAvail.summary(av)}` : 'Ninguna hora marcada';
    });
    avail.set({});
    const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
    const PRESETS = {
      manana: Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie'].map((d) => [d, range(8, 12)])),
      tarde: Object.fromEntries(['lun', 'mar', 'mie', 'jue', 'vie'].map((d) => [d, range(14, 18)])),
      limpiar: {},
    };
    document.querySelector('.avail-tools').addEventListener('click', (e) => {
      const p = e.target.dataset.preset;
      if (p) avail.set(PRESETS[p]);
    });

    const cgForm = $('form-caregiver');

    function setAccountFields(checked) {
      $('cg-account').checked = checked;
      $('cg-account-fields').hidden = !checked;
      $('cg-account-fields').querySelectorAll('input').forEach((i) => { i.required = checked; });
    }

    /** Deja el formulario vacío (registro nuevo) o con los datos del cuidador `c` (edición). */
    function fillCaregiverForm(c) {
      const f = cgForm.elements;
      cgForm.reset();
      cgForm.querySelector('.form-error').hidden = true;
      setAccountFields(false);
      editingId = c ? c.id : null;
      $('cg-form-title').textContent = c ? `Editar cuidador: ${c.name}` : 'Registrar cuidador';
      $('cg-submit').textContent = c ? 'Guardar cambios' : 'Registrar cuidador';
      // Cuenta de acceso: si ya tiene, solo se puede cambiar la contraseña; si no, se puede crear.
      $('cg-account-existing').hidden = !(c && c.username);
      $('cg-account-new').hidden = !!(c && c.username);
      $('cg-account-name').textContent = c && c.username ? '@' + c.username : '';
      if (c) {
        Object.entries({
          name: c.name, document: c.document, birthdate: c.birthdate, phone: c.phone, email: c.email,
          address: c.address, zone: c.zone, title: c.title, experience: c.experience,
        }).forEach(([k, v]) => { f[k].value = v ?? ''; });
        cgForm.querySelectorAll('input[name="skills"]').forEach((i) => { i.checked = c.skills.includes(i.value); });
      }
      avail.set(c ? c.availability : {});
      document.querySelectorAll('#cg-body tr').forEach((tr) => {
        tr.classList.toggle('row-editing', !!c && !!tr.querySelector(`[data-edit-cg="${CSS.escape(c.id)}"]`));
      });
    }

    function toggleCaregiverForm(open, caregiver = null) {
      const card = $('cg-form-card');
      const btn = $('btn-toggle-cg');
      if (open) fillCaregiverForm(caregiver);
      else { editingId = null; document.querySelectorAll('#cg-body tr.row-editing').forEach((tr) => tr.classList.remove('row-editing')); }
      card.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open && !caregiver ? '✕ Cerrar formulario' : '➕ Registrar cuidador';
      if (open) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); card.querySelector('input').focus({ preventScroll: true }); }
    }
    // Si se está editando, el botón «Registrar cuidador» cambia el formulario a registro nuevo.
    $('btn-toggle-cg').addEventListener('click', () => toggleCaregiverForm($('cg-form-card').hidden || !!editingId));
    $('btn-cancel-cg').addEventListener('click', () => toggleCaregiverForm(false));

    $('cg-account').addEventListener('change', (e) => setAccountFields(e.target.checked));
    $('form-caregiver').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const f = form.elements;
      const error = form.querySelector('.form-error');
      const skills = [...form.querySelectorAll('input[name="skills"]:checked')].map((i) => i.value);
      const show = (msg) => { error.textContent = msg; error.hidden = !msg; };
      if (!skills.length) return show('Seleccione al menos un servicio que ofrece.');
      const availability = avail.get();
      if (!SAAvail.total(availability)) return show('Marque en la matriz al menos una hora de disponibilidad.');
      show('');
      const editing = editingId;
      try {
        const { caregiver } = await api('/api/admin/caregivers' + (editing ? '/' + encodeURIComponent(editing) : ''), {
          method: editing ? 'PUT' : 'POST',
          body: {
            name: f.name.value, document: f.document.value, birthdate: f.birthdate.value, phone: f.phone.value,
            email: f.email.value, address: f.address.value, zone: f.zone.value, title: f.title.value,
            experience: f.experience.value, skills, availability,
            createAccount: f.createAccount.checked, username: f.username.value.trim(), password: f.password.value,
            newPassword: f.newPassword.value,
          },
        });
        toast(editing ? `Datos de ${caregiver.name} actualizados.` : `Cuidador/a ${caregiver.name} registrado/a.`, 'ok');
        toggleCaregiverForm(false);
        $('cg-body').scrollIntoView({ behavior: 'smooth', block: 'center' });
        loadCaregivers();
        if (caregiver.username) loadUsers();
      } catch (err) {
        if (err.status === 401 || err.status === 403) handleError(err); else show(err.message);
      }
    });
    $('cg-body').addEventListener('click', async (e) => {
      const edit = e.target.closest('[data-edit-cg]');
      if (edit) {
        const c = caregivers.find((x) => x.id === edit.dataset.editCg);
        if (c) toggleCaregiverForm(true, c);
        return;
      }
      const b = e.target.closest('[data-delete-cg]');
      if (!b || !confirmed(b)) return;
      if (b.dataset.deleteCg === editingId) toggleCaregiverForm(false);
      try {
        await api('/api/admin/caregivers/' + encodeURIComponent(b.dataset.deleteCg), { method: 'DELETE' });
        toast(`Cuidador/a ${b.dataset.name} eliminado/a.`, 'ok');
      } catch (err) { handleError(err); }
      loadCaregivers();
      loadUsers();
    });

    loadCalls();
    loadUsers();
    loadCaregivers();
    setInterval(() => { loadCalls(); loadUsers(); }, POLL_MS);
  });
})();
