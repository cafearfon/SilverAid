/* Página de administración: llamadas SOS, altas pendientes, cuidadores, colaboradores, usuarios, clientes y catálogo de servicios. */
(function () {
  const session = SAAuth.get();
  if (!session || session.role !== 'admin') return; // admin.html ya redirige

  const $ = (id) => document.getElementById(id);
  const api = SAAuth.api;
  const ROLE = SAAuth.ROLES;
  const SKILLS = { compania: 'Compañía', compras: 'Compras', tecnologia: 'Tecnología', tramites: 'Trámites' };
  const STATUS = { activo: 'Activo', pendiente: 'Pendiente de alta', inactivo: 'Inactivo', verificacion: 'En verificación' };
  const DOC_LABELS = { documento: 'Documento de identidad', pase: 'Pase', salud: 'Salud', pension: 'Pensión', arl: 'ARL', rut: 'RUT', rethus: 'RETHUS' };
  /** Documentos obligatorios que le faltan a un cuidador o colaborador (debajo del estado). */
  const missingText = (u) => (u.missingDocuments?.length
    ? `<span class="sub warn-text">Faltan: ${u.missingDocuments.map((k) => DOC_LABELS[k] || k).join(', ')}</span>` : '');
  /** «Activar» de cuidadores y colaboradores: solo con todos los documentos obligatorios. */
  const activateBtn = (u) => (u.missingDocuments?.length
    ? `<button class="btn ok small" disabled title="Faltan documentos obligatorios">Activar</button>`
    : `<button class="btn ok small" data-status="activo" data-user="${esc(u.username)}">${u.status === 'verificacion' ? '✔ Verificar y activar' : 'Activar'}</button>`);
  const EDUCATION = { ninguno: 'Ninguno', primaria: 'Primaria', bachillerato: 'Bachillerato', tecnico: 'Técnico',
    tecnologo: 'Tecnólogo', universitario: 'Universitario', posgrado: 'Posgrado' };
  const VEHICLE = { carro: '🚗 Carro', moto: '🏍️ Moto', ambos: '🚗 Carro y 🏍️ moto' };
  /** Botón para abrir un PDF adjunto de un colaborador o cuidador. */
  const attachBtn = (c, kind, label) => (c.attachments?.[kind]
    ? `<button class="btn ghost small" data-attach="${kind}" data-user="${esc(c.username)}" title="${esc(c.attachments[kind])}">📄 ${label}</button>`
    : '');
  const POLL_MS = 10000;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => (d ? new Date(d.replace(' ', 'T')).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
  const isSelf = (u) => u.toLowerCase() === session.username.toLowerCase();

  let users = [];
  let services = [];
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
    if (!$('tab-' + name)) name = 'users';
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
    renderClients();
    renderCollaborators();
    renderCaregiverSignups();
  }

  /** Cuidadores registrados desde «Crear cuenta»: escolaridad y PDF (RUT, seguridad social, RETHUS y cada título). */
  function renderCaregiverSignups() {
    const list = users.filter((u) => u.role === 'cuidador');
    setCount('count-cg-verif', list.filter((u) => u.status === 'verificacion').length);
    $('cg-signup-body').innerHTML = list.length
      ? list.map((c) => `
        <tr>
          <td><strong>${esc(c.name)}</strong><span class="sub">@${esc(c.username)}</span><span class="sub">Registro: ${fmt(c.registeredAt)}</span></td>
          <td>${c.mobile ? `📱 ${esc(c.mobile)}` : '<span class="muted">Sin celular</span>'}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ''}${c.address ? `<span class="sub">${esc(c.address)}</span>` : ''}</td>
          <td>${EDUCATION[c.education] || '<span class="muted">—</span>'}</td>
          <td><div class="attach-btns">${[['rut', 'RUT'], ['salud', 'Salud'], ['pension', 'Pensión'], ['arl', 'ARL'], ['rethus', 'RETHUS'],
              ...Object.keys(c.attachments || {}).filter((k) => k.startsWith('titulos-')).map((k) => [k, 'Título ' + k.split('-')[1]])]
            .map(([kind, label]) => attachBtn(c, kind, label)).join('') || '<span class="muted">Ninguno</span>'}</div></td>
          <td><span class="pill ${c.status}">${STATUS[c.status] || esc(c.status)}</span>${missingText(c)}</td>
          <td class="actions">${c.status === 'activo'
            ? `<button class="btn ghost small" data-status="inactivo" data-user="${esc(c.username)}">Inactivar</button>`
            : activateBtn(c)}</td>
        </tr>`).join('')
      : '<tr><td colspan="6" class="empty">Ningún cuidador se ha registrado desde «Crear cuenta».</td></tr>';
  }

  /** Colaboradores: formación, pase de conducción y afiliación a seguridad social. */
  function renderCollaborators() {
    const list = users.filter((u) => u.role === 'colaborador');
    setCount('count-collab-verif', list.filter((u) => u.status === 'verificacion').length);
    $('collab-body').innerHTML = list.length
      ? list.map((c) => `
        <tr>
          <td><strong>${esc(c.name)}</strong><span class="sub">@${esc(c.username)}</span>${docText(c)}<span class="sub">Registro: ${fmt(c.registeredAt)}</span>
            <div class="attach-btns">${attachBtn(c, 'documento', 'Documento')}</div></td>
          <td>${c.mobile ? `📱 ${esc(c.mobile)}` : '<span class="muted">Sin celular</span>'}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ''}${c.address ? `<span class="sub">${esc(c.address)}</span>` : ''}</td>
          <td>${EDUCATION[c.education] || '<span class="muted">—</span>'}</td>
          <td>${c.license === 'si'
            ? `${VEHICLE[c.licenseVehicle] || ''}<span class="sub">Categoría: ${esc(c.licenseCategories.join(', ')) || '—'}</span>
               <div class="attach-btns">${attachBtn(c, 'pase', 'Ver pase')}</div>`
            : c.license === 'no' ? 'No tiene' : '<span class="muted">—</span>'}</td>
          <td>${c.socialSecurity === 'si'
            ? `Afiliado como independiente<div class="attach-btns">${
              (attachBtn(c, 'salud', 'Salud') + attachBtn(c, 'pension', 'Pensión') + attachBtn(c, 'arl', 'ARL'))
              || '<span class="sub">Sin certificados adjuntos</span>'}</div>`
            : c.socialSecurity === 'no' ? 'No afiliado' : '<span class="muted">—</span>'}</td>
          <td><span class="pill ${c.status}">${STATUS[c.status] || esc(c.status)}</span>${missingText(c)}</td>
          <td class="actions">${c.status === 'activo'
            ? `<button class="btn ghost small" data-status="inactivo" data-user="${esc(c.username)}">Inactivar</button>`
            : activateBtn(c)}</td>
        </tr>`).join('')
      : '<tr><td colspan="7" class="empty">Todavía no hay colaboradores registrados.</td></tr>';
  }

  /** Abre un PDF adjunto en una pestaña nueva (la API exige el token, así que se descarga aquí). */
  async function openAttachment(username, kind, btn) {
    const tab = window.open('', '_blank'); // abrir antes del await para que el navegador no lo bloquee
    btn.disabled = true;
    try {
      const doc = await api(`/api/admin/users/${encodeURIComponent(username)}/attachments/${kind}`);
      const bytes = Uint8Array.from(atob(doc.data), (ch) => ch.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: doc.type }));
      if (tab) tab.location.href = url; else location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      tab?.close();
      handleError(err);
    } finally {
      btn.disabled = false;
    }
  }

  /** Clientes (familiares responsables) con los adultos mayores que han registrado. */
  function renderClients() {
    const clients = users.filter((u) => u.role === 'cliente');
    $('clients-body').innerHTML = clients.length
      ? clients.map((c) => {
          const elders = users.filter((u) => u.role === 'usuario' && (u.client || '').toLowerCase() === c.username.toLowerCase());
          return `
        <tr>
          <td><strong>${esc(c.name)}</strong><span class="sub">@${esc(c.username)}</span>${docText(c)}</td>
          <td>${c.mobile ? `📱 ${esc(c.mobile)}` : '<span class="muted">Sin celular</span>'}${c.email ? `<span class="sub">${esc(c.email)}</span>` : ''}${c.address ? `<span class="sub">${esc(c.address)}</span>` : ''}</td>
          <td><span class="pill ${c.status}">${STATUS[c.status] || esc(c.status)}</span></td>
          <td>${fmt(c.registeredAt)}</td>
          <td>${elders.length
            ? elders.map((e) => `<div class="elder-line">${esc(e.name)} <span class="pill ${e.status}">${STATUS[e.status] || esc(e.status)}</span>
                ${e.status === 'pendiente' ? `<button class="btn ok small" data-status="activo" data-user="${esc(e.username)}">Dar de alta</button>` : ''}</div>`).join('')
            : '<span class="muted">Ninguno</span>'}</td>
          <td>
            <div class="send-btns">
              <button class="btn whatsapp small" data-send="whatsapp" data-user="${esc(c.username)}" ${c.mobile ? '' : 'disabled title="Sin celular"'}>📲 WhatsApp</button>
              <button class="btn ghost small" data-send="email" data-user="${esc(c.username)}" ${c.email ? '' : 'disabled title="Sin correo"'}>✉️ Correo</button>
            </div>
            <span class="sub">${c.catalogSent ? 'Último envío: ' + esc(c.catalogSent.replace(/^(\S+) (\S+)/, (_, d, h) => fmt(d + ' ' + h))) : 'Nunca enviado'}</span>
          </td>
          <td class="actions">${c.status === 'activo'
            ? `<button class="btn ghost small" data-status="inactivo" data-user="${esc(c.username)}">Inactivar</button>`
            : `<button class="btn ok small" data-status="activo" data-user="${esc(c.username)}">Activar</button>`}</td>
        </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="empty">Todavía no hay clientes registrados.</td></tr>';
  }

  const docText = (u) => (u.document ? `<span class="sub">🪪 ${esc(u.docType)} ${esc(u.document)}</span>` : '');
  const noPassword = (u) => (u.hasPassword ? '' : '<span class="sub warn-text">⚠️ Sin contraseña: asígnela en «Editar»</span>');

  // ---------------------------------------------------------------- catálogo de servicios
  async function loadServices() {
    try {
      services = (await api('/api/admin/services')).services;
    } catch (err) { return handleError(err); }
    renderServices();
  }

  function renderServices() {
    $('services-body').innerHTML = services.length
      ? services.map((s) => `
        <tr class="${s.id === editingService ? 'row-editing' : ''}">
          <td><strong>${esc(s.name)}</strong></td>
          <td>${s.description ? esc(s.description) : '<span class="muted">—</span>'}</td>
          <td class="nowrap">${s.price ? esc(s.price) : '<span class="muted">—</span>'}</td>
          <td><span class="pill ${s.active ? 'activo' : 'inactivo'}">${s.active ? 'Activo' : 'Oculto'}</span></td>
          <td class="actions stack">
            <button class="btn small" data-edit-service="${esc(s.id)}">✏️ Editar</button>
            <button class="btn ghost small" data-toggle-service="${esc(s.id)}">${s.active ? 'Ocultar' : 'Activar'}</button>
            <button class="btn ghost small" data-delete-service="${esc(s.id)}">Eliminar</button>
          </td>
        </tr>`).join('')
      : '<tr><td colspan="5" class="empty">El catálogo está vacío. Añada al menos un servicio para poder enviarlo.</td></tr>';
    $('catalog-preview').textContent = catalogMessage('Laura') || 'No hay servicios activos.';
  }

  /** Texto del catálogo (servicios activos) con el nombre del cliente en el saludo. */
  function catalogMessage(name) {
    const active = services.filter((s) => s.active);
    if (!active.length) return '';
    const first = String(name || '').trim().split(/\s+/)[0];
    return [
      `Hola ${first}, le compartimos el catálogo de servicios de SilverAid:`,
      '',
      ...active.map((s) => `• ${s.name}${s.price ? ` (${s.price})` : ''}${s.description ? `\n   ${s.description}` : ''}`),
      '',
      'Para contratar un servicio o resolver cualquier duda, responda a este mensaje.',
      'Equipo SilverAid',
    ].join('\n');
  }

  /** Número para wa.me: solo dígitos y, si es un celular colombiano de 10 dígitos, con el prefijo 57. */
  function whatsappNumber(mobile) {
    const digits = String(mobile || '').replace(/\D/g, '');
    return /^3\d{9}$/.test(digits) ? '57' + digits : digits;
  }

  /** Abre WhatsApp o el correo con el catálogo y anota el envío en la ficha del cliente. */
  async function sendCatalog(username, channel) {
    const c = users.find((u) => u.username === username);
    if (!c) return;
    const text = catalogMessage(c.name);
    if (!text) { toast('El catálogo no tiene servicios activos. Añádalos en la pestaña «Catálogo».', 'warn'); return; }
    // Se abre en el mismo clic (si no, el navegador puede bloquear la ventana).
    if (channel === 'whatsapp') {
      window.open(`https://wa.me/${whatsappNumber(c.mobile)}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    } else {
      const a = document.createElement('a');
      a.href = `mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent('Catálogo de servicios SilverAid')}&body=${encodeURIComponent(text)}`;
      a.click();
    }
    try {
      await api(`/api/admin/users/${encodeURIComponent(username)}/catalog`, { method: 'POST', body: { channel } });
      toast(`Catálogo preparado para ${c.name} por ${channel === 'whatsapp' ? 'WhatsApp' : 'correo'}. Revise y pulse «Enviar» en la ventana que se abrió.`, 'ok', 8000);
    } catch (err) { handleError(err); }
    loadUsers();
  }

  /** Mismas reglas que el servidor: CC y CE solo dígitos; pasaporte y PPT letras y números. */
  function docOk(type, value) {
    const v = String(value || '').replace(/[.\s]/g, '');
    return ['CC', 'CE'].includes(type) ? /^[0-9]{4,12}$/.test(v) : /^[A-Za-z0-9]{4,20}$/.test(v);
  }

  let editingService = null;

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
          <td><strong>${esc(u.name)}</strong>${docText(u)}${noPassword(u)}</td>
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

  // ---- Usuarios (adultos mayores)
  let usersFilter = '';
  let editingUser = null; // nombre de usuario que se está editando (null = alta nueva)

  function renderUsers() {
    const elders = users.filter((u) => u.role === 'usuario' && (!usersFilter || u.status === usersFilter));
    $('users-body').innerHTML = elders.length
      ? elders.map((u) => `
      <tr class="${u.username === editingUser ? 'row-editing' : ''}">
        <td><strong>${esc(u.name)}</strong><span class="sub">@${esc(u.username)}</span>${docText(u)}${noPassword(u)}</td>
        <td>${u.phone ? `☎️ ${esc(u.phone)}` : ''}${u.mobile ? `<span class="sub">📱 ${esc(u.mobile)}</span>` : ''}${u.email ? `<span class="sub">${esc(u.email)}</span>` : ''}${!u.phone && !u.mobile ? '<span class="muted">Sin datos</span>' : ''}</td>
        <td>${u.address ? esc(u.address) : '<span class="muted">—</span>'}</td>
        <td>${u.bloodType ? `<span class="blood">${esc(u.bloodType)}</span>` : '<span class="muted">—</span>'}</td>
        <td>${u.client ? nameOf(u.client) : '<span class="muted">Sin asignar</span>'}</td>
        <td><span class="pill ${u.status}">${STATUS[u.status] || esc(u.status)}</span></td>
        <td class="actions stack">
          <button class="btn small" data-edit-user="${esc(u.username)}">✏️ Editar</button>
          ${u.status === 'activo'
            ? `<button class="btn ghost small" data-status="inactivo" data-user="${esc(u.username)}">Inactivar</button>`
            : `<button class="btn ok small" data-status="activo" data-user="${esc(u.username)}">${u.status === 'pendiente' ? 'Dar de alta' : 'Activar'}</button>`}
          <button class="btn ghost small" data-delete-user="${esc(u.username)}">Eliminar</button>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="7" class="empty">${usersFilter ? 'No hay usuarios con ese estado.' : 'Todavía no hay usuarios registrados.'}</td></tr>`;
    fillClientSelect();
  }

  /** Desplegable «Cliente asociado»: solo clientes ya registrados. */
  function fillClientSelect() {
    const sel = $('user-client');
    const current = sel.value;
    const clients = users.filter((u) => u.role === 'cliente');
    sel.innerHTML = '<option value="">Seleccione…</option>' + clients
      .map((c) => `<option value="${esc(c.username)}">${esc(c.name)} (@${esc(c.username)})${c.status !== 'activo' ? ' — ' + (STATUS[c.status] || c.status).toLowerCase() : ''}</option>`).join('');
    sel.value = current;
    $('no-clients').hidden = clients.length > 0;
    $('user-submit').disabled = !clients.length;
  }

  async function setStatus(username, status) {
    try {
      await api(`/api/admin/users/${encodeURIComponent(username)}/status`, { method: 'POST', body: { status } });
      toast(status === 'activo' ? `@${username} ya puede usar SilverAid.` : `@${username} inactivado: ya no puede iniciar sesión.`, 'ok');
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
    showTab(location.hash.slice(1) || 'users');

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
    $('clients-body').addEventListener('click', (e) => {
      const send = e.target.closest('button[data-send]');
      if (send) return sendCatalog(send.dataset.user, send.dataset.send);
      const b = e.target.closest('button[data-status]');
      if (b) setStatus(b.dataset.user, b.dataset.status);
    });
    $('cg-signup-body').addEventListener('click', (e) => {
      const att = e.target.closest('button[data-attach]');
      if (att) return openAttachment(att.dataset.user, att.dataset.attach, att);
      const b = e.target.closest('button[data-status]');
      if (b) setStatus(b.dataset.user, b.dataset.status);
    });
    $('collab-body').addEventListener('click', (e) => {
      const att = e.target.closest('button[data-attach]');
      if (att) return openAttachment(att.dataset.user, att.dataset.attach, att);
      const b = e.target.closest('button[data-status]');
      if (b) setStatus(b.dataset.user, b.dataset.status);
    });
    document.querySelectorAll('[data-goto-tab]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); showTab(a.dataset.gotoTab); }));

    // Clientes: formulario «Crear cliente»
    const clientForm = $('form-client');
    const clientError = (msg) => {
      const p = clientForm.querySelector('.form-error');
      p.textContent = msg || '';
      p.hidden = !msg;
    };
    function toggleClientForm(open) {
      $('client-form-card').hidden = !open;
      $('btn-toggle-client').setAttribute('aria-expanded', String(open));
      $('btn-toggle-client').textContent = open ? '✕ Cerrar formulario' : '➕ Crear cliente';
      if (open) {
        clientForm.reset();
        clientError('');
        $('client-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        clientForm.elements.name.focus({ preventScroll: true });
      }
    }
    $('btn-toggle-client').addEventListener('click', () => toggleClientForm($('client-form-card').hidden));
    $('btn-cancel-client').addEventListener('click', () => toggleClientForm(false));
    clientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = clientForm.elements;
      const v = (k) => f[k].value.trim();
      if (!v('name')) return clientError('Escriba el nombre del familiar responsable.');
      if (!f.docType.value || !docOk(f.docType.value, v('document'))) return clientError('Revise el tipo y número de documento del familiar responsable.');
      if (!v('address')) return clientError('Escriba la dirección.');
      if (!/^[0-9+()\-\s]{7,20}$/.test(v('mobile'))) return clientError('Escriba un celular válido (7 a 20 dígitos).');
      if (!/^[^@\s;]+@[^@\s;]+\.[^@\s;]+$/.test(v('email'))) return clientError('Escriba un correo electrónico válido.');
      if (!v('elderName')) return clientError('Escriba el nombre completo del usuario (adulto mayor).');
      if (!f.elderDocType.value || !docOk(f.elderDocType.value, v('elderDocument'))) return clientError('Revise el tipo y número de documento del usuario.');
      if (!v('elderAddress')) return clientError('Escriba la dirección del usuario (adulto mayor).');
      if (!/^[0-9+()\-\s]{7,20}$/.test(v('elderMobile'))) return clientError('Escriba un celular válido para el usuario (7 a 20 dígitos).');
      if (!f.elderBloodType.value) return clientError('Seleccione el tipo de sangre del usuario.');
      if (v('elderEmail') && !/^[^@\s;]+@[^@\s;]+\.[^@\s;]+$/.test(v('elderEmail'))) return clientError('El correo electrónico del usuario no es válido.');
      clientError('');
      const body = {
        name: v('name'), docType: f.docType.value, document: v('document'), address: v('address'), mobile: v('mobile'), email: v('email'),
        elderName: v('elderName'), elderDocType: f.elderDocType.value, elderDocument: v('elderDocument'),
        elderAddress: v('elderAddress'), elderMobile: v('elderMobile'), elderEmail: v('elderEmail'),
        elderBloodType: f.elderBloodType.value,
        username: v('username'), password: f.password.value,
      };
      try {
        const { user } = await api('/api/admin/clients', { method: 'POST', body });
        toast(`Cliente ${user.name} creado. Su familiar quedó en «Altas pendientes».`, 'ok', 7000);
        toggleClientForm(false);
        loadUsers();
      } catch (err) {
        if (err.status === 401 || err.status === 403) handleError(err); else clientError(err.message);
      }
    });

    // Catálogo de servicios
    const serviceForm = $('form-service');
    const serviceError = (msg) => {
      const p = serviceForm.querySelector('.form-error');
      p.textContent = msg || '';
      p.hidden = !msg;
    };
    function toggleServiceForm(open, s = null) {
      editingService = open && s ? s.id : null;
      $('service-form-card').hidden = !open;
      $('btn-toggle-service').textContent = open && !s ? '✕ Cerrar formulario' : '➕ Añadir servicio';
      $('btn-toggle-service').setAttribute('aria-expanded', String(open));
      if (open) {
        serviceForm.reset();
        serviceError('');
        $('service-form-title').textContent = s ? `Editar servicio: ${s.name}` : 'Añadir servicio';
        $('service-submit').textContent = s ? 'Guardar cambios' : 'Añadir servicio';
        if (s) {
          const f = serviceForm.elements;
          f.name.value = s.name; f.price.value = s.price; f.description.value = s.description; f.active.checked = s.active;
        }
        $('service-form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        serviceForm.elements.name.focus({ preventScroll: true });
      }
      renderServices();
    }
    $('btn-toggle-service').addEventListener('click', () => toggleServiceForm($('service-form-card').hidden || !!editingService));
    $('btn-cancel-service').addEventListener('click', () => toggleServiceForm(false));
    serviceForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = serviceForm.elements;
      const editing = editingService;
      const body = { name: f.name.value.trim(), price: f.price.value.trim(), description: f.description.value.trim(), active: f.active.checked };
      try {
        await api('/api/admin/services' + (editing ? '/' + encodeURIComponent(editing) : ''), { method: editing ? 'PUT' : 'POST', body });
        toast(editing ? 'Servicio actualizado.' : 'Servicio añadido al catálogo.', 'ok');
        toggleServiceForm(false);
        loadServices();
      } catch (err) {
        if (err.status === 401 || err.status === 403) handleError(err); else serviceError(err.message);
      }
    });
    $('services-body').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const s = services.find((x) => x.id === (b.dataset.editService || b.dataset.toggleService || b.dataset.deleteService));
      if (!s) return;
      if (b.dataset.editService) return toggleServiceForm(true, s);
      try {
        if (b.dataset.toggleService) {
          await api('/api/admin/services/' + encodeURIComponent(s.id), { method: 'PUT', body: { ...s, active: !s.active } });
        } else if (b.dataset.deleteService && confirmed(b)) {
          if (s.id === editingService) toggleServiceForm(false);
          await api('/api/admin/services/' + encodeURIComponent(s.id), { method: 'DELETE' });
          toast(`Servicio «${s.name}» eliminado.`, 'ok');
        } else return;
      } catch (err) { handleError(err); }
      loadServices();
    });
    // Usuarios: formulario oculto hasta pulsar «Crear usuario» o «Editar»
    const userForm = $('form-user');
    const userError = (msg) => {
      const p = userForm.querySelector('.form-error');
      p.textContent = msg || '';
      p.hidden = !msg;
    };

    function fillUserForm(u) {
      const f = userForm.elements;
      userForm.reset();
      userError('');
      editingUser = u ? u.username : null;
      fillClientSelect();
      $('user-form-title').textContent = u ? `Editar usuario: ${u.name}` : 'Crear usuario';
      $('user-submit').textContent = u ? 'Guardar cambios' : 'Crear usuario';
      // Al crear se piden usuario y contraseña; al editar solo se puede cambiar la contraseña.
      $('user-new-access').hidden = !!u;
      $('user-edit-access').hidden = !u;
      f.username.required = !u;
      f.password.required = !u;
      $('user-edit-username').textContent = u ? '@' + u.username : '';
      if (u) {
        f.name.value = u.name;
        f.address.value = u.address || '';
        f.phone.value = u.phone || '';
        f.mobile.value = u.mobile || '';
        f.email.value = u.email || '';
        f.bloodType.value = u.bloodType || '';
        f.client.value = u.client || '';
      }
      document.querySelectorAll('#users-body tr').forEach((tr) => {
        tr.classList.toggle('row-editing', !!u && !!tr.querySelector(`[data-edit-user="${CSS.escape(u.username)}"]`));
      });
    }

    function toggleUserForm(open, u = null) {
      const card = $('user-form-card');
      const btn = $('btn-toggle-user');
      if (open) fillUserForm(u);
      else { editingUser = null; document.querySelectorAll('#users-body tr.row-editing').forEach((tr) => tr.classList.remove('row-editing')); }
      card.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open && !u ? '✕ Cerrar formulario' : '➕ Crear usuario';
      if (open) { card.scrollIntoView({ behavior: 'smooth', block: 'start' }); userForm.elements.name.focus({ preventScroll: true }); }
    }
    $('btn-toggle-user').addEventListener('click', () => toggleUserForm($('user-form-card').hidden || !!editingUser));
    $('btn-cancel-user').addEventListener('click', () => toggleUserForm(false));

    $('users-filter').addEventListener('click', (e) => {
      const b = e.target.closest('[data-filter]');
      if (!b) return;
      usersFilter = b.dataset.filter;
      document.querySelectorAll('#users-filter .chip').forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
      renderUsers();
    });

    $('users-body').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.editUser) {
        const u = users.find((x) => x.username === b.dataset.editUser);
        if (u) toggleUserForm(true, u);
      }
      if (b.dataset.status) setStatus(b.dataset.user, b.dataset.status);
      if (b.dataset.deleteUser && confirmed(b)) {
        if (b.dataset.deleteUser === editingUser) toggleUserForm(false);
        deleteUser(b.dataset.deleteUser);
      }
    });

    userForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = userForm.elements;
      const editing = editingUser;
      const body = {
        name: f.name.value.trim(), address: f.address.value.trim(), phone: f.phone.value.trim(),
        mobile: f.mobile.value.trim(), email: f.email.value.trim(), bloodType: f.bloodType.value, client: f.client.value,
      };
      if (editing) body.newPassword = f.newPassword.value;
      else Object.assign(body, { username: f.username.value.trim(), password: f.password.value });
      userError('');
      try {
        const { user } = await api('/api/admin/users' + (editing ? '/' + encodeURIComponent(editing) : ''), { method: editing ? 'PUT' : 'POST', body });
        toast(editing ? `Datos de ${user.name} actualizados.` : `Usuario @${user.username} creado.`, 'ok');
        toggleUserForm(false);
        loadUsers();
      } catch (err) {
        if (err.status === 401 || err.status === 403) handleError(err); else userError(err.message);
      }
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
    loadServices();
    setInterval(() => { loadCalls(); loadUsers(); }, POLL_MS);
  });
})();
