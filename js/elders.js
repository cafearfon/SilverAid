/* Sección «Familia» → «Mis adultos mayores».
   Cliente: los adultos mayores que registró (o que le asignó el administrador). Para cada uno gestiona sus
   familiares responsables: los añade por su documento y aprueba, rechaza o quita. También registra a otro adulto mayor.
   Familiar responsable (rol familiar): los adultos mayores a los que está unido, con su cliente y los demás
   familiares, y sus solicitudes en espera; puede salir de una familia. */
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { pendiente: '⏳ Pendiente de alta', activo: '✅ Dado de alta', inactivo: '⛔ Desactivado' };
  const RELATIONS = ['Hijo/a', 'Nieto/a', 'Cónyuge o pareja', 'Hermano/a', 'Sobrino/a', 'Otro familiar', 'Amigo/a o vecino/a'];
  const esc = (s) => SA.esc(s ?? '');
  const me = () => SA.session.username.toLowerCase();
  const isClient = () => SA.session.role === 'cliente';

  function memberLine(e, m) {
    const self = m.username.toLowerCase() === me();
    const actions = [];
    if (isClient() && m.status === 'pendiente') {
      actions.push(`<button class="btn ok small" data-approve="${esc(m.username)}" data-elder="${esc(e.username)}">✔ Aprobar</button>`);
      actions.push(`<button class="btn ghost small" data-remove="${esc(m.username)}" data-elder="${esc(e.username)}" data-label="Rechazar">Rechazar</button>`);
    } else if (isClient() || self) {
      const label = self ? 'Salir de esta familia' : 'Quitar';
      actions.push(`<button class="btn ghost small" data-remove="${esc(m.username)}" data-elder="${esc(e.username)}" data-label="${label}">${label}</button>`);
    }
    return `<li>
      <span><span class="title">${esc(m.name)}${self ? ' (usted)' : ''}</span>
        <span class="sub">${[m.relation, m.status === 'pendiente' ? '⏳ Solicitud pendiente' : '', m.mobile ? '📱 ' + m.mobile : '']
          .filter(Boolean).map(esc).join(' · ')}</span></span>
      ${actions.length ? `<span class="send-btns">${actions.join('')}</span>` : ''}</li>`;
  }

  function elderCard(e) {
    const pending = e.family.filter((m) => m.status === 'pendiente').length;
    return `<section class="elder-box">
      <div class="card-head">
        <h3>${esc(e.name)} <span class="sub">@${esc(e.username)}</span></h3>
        <span class="pill ${esc(e.status)}">${STATUS[e.status] || esc(e.status)}</span>
      </div>
      <p class="small-text muted">${isClient()
        ? `🧾 Usted es su cliente. ${pending ? `<strong>${pending} solicitud${pending > 1 ? 'es' : ''} por aprobar.</strong>` : ''}`
        : `Usted es familiar responsable${e.relation ? ` (${esc(e.relation)})` : ''}. Cliente: ${esc(e.clientName || '—')}.`}</p>
      <h4>👨‍👩‍👧 Familiares responsables</h4>
      <ul class="list">
        <li><span><span class="title">🧾 ${esc(isClient() ? SA.session.name || SA.session.username : e.clientName || '—')}${isClient() ? ' (usted)' : ''}</span>
          <span class="sub">Cliente · responsable principal</span></span></li>
        ${e.family.map((m) => memberLine(e, m)).join('')}</ul>
      ${isClient() ? `
      <form class="form compact family-add" data-elder="${esc(e.username)}">
        <p class="small-text muted">Añadir a un familiar responsable: debe tener su cuenta de «Familiar responsable» en SilverAid.</p>
        <div class="form-row">
          <label>Tipo de documento
            <select name="docType" required><option value="CC">Cédula de ciudadanía</option><option value="CE">Cédula de extranjería</option>
              <option value="PA">Pasaporte</option><option value="PPT">Permiso por protección temporal</option></select></label>
          <label>Número de documento <input name="document" required maxlength="20" inputmode="numeric"></label>
          <label>Parentesco
            <select name="relation" required><option value="">Seleccione…</option>${RELATIONS.map((r) => `<option>${r}</option>`).join('')}</select></label>
        </div>
        <button class="btn small">➕ Añadir familiar</button>
      </form>` : ''}
    </section>`;
  }

  async function load() {
    try {
      const res = await SAAuth.api('/api/elders');
      const elders = res.elders || [];
      const requests = res.requests || [];
      $('elders-offline').hidden = !res.offline;
      $('join-requests').innerHTML = requests.map((r) => `
        <li><span><span class="title">⏳ Solicitud enviada: ${esc(r.elder)}</span>
          <span class="sub">Su cliente (o SilverAid) debe aprobarla para que pueda acompañarle desde aquí.</span></span></li>`).join('');
      // No se repinta mientras escribe en un formulario de «Añadir familiar».
      if ($('elder-list').contains(document.activeElement) && document.activeElement.closest('form')) return;
      $('elder-list').innerHTML = elders.length
        ? elders.map(elderCard).join('')
        : requests.length ? '' : `<p class="empty">${isClient() ? 'Todavía no ha registrado a ningún adulto mayor.'
          : 'Todavía no está unido a ningún adulto mayor.'}</p>`;
    } catch (err) {
      $('elder-list').innerHTML = `<p class="empty">${esc(err.message)}</p>`;
    }
  }

  async function change(method, path, body, okMsg) {
    if (!navigator.onLine) return SA.toast('Para cambiar la familia necesita conexión a internet.', 'warn');
    try {
      await SAAuth.api(path, { method, body });
      SA.toast(okMsg, 'ok', 6000);
    } catch (err) {
      SA.toast(err.message, 'warn', 9000);
    }
    load();
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (!['cliente', 'familiar'].includes(SA.session.role)) return;
    $('elders-card').hidden = false;
    $('elders-intro').textContent = isClient()
      ? 'Las personas mayores de las que es cliente. Aquí gestiona sus familiares responsables: los añade y aprueba sus solicitudes.'
      : 'Las personas mayores de las que es familiar responsable, con su cliente y los demás familiares.';
    document.querySelector('.elder-new').hidden = !isClient(); // solo el cliente registra adultos mayores
    load();
    setInterval(load, 30000); // para ver altas y solicitudes nuevas

    $('elder-list').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-elder]');
      if (!b) return;
      const base = `/api/elders/${encodeURIComponent(b.dataset.elder)}/family/`;
      if (b.dataset.approve) {
        change('POST', base + encodeURIComponent(b.dataset.approve) + '/approve', {}, 'Solicitud aprobada: ya forma parte de la familia.');
      } else if (b.dataset.remove) {
        if (b.dataset.armed !== '1') { // dos pulsaciones para confirmar
          b.dataset.armed = '1';
          b.textContent = '¿Seguro? Pulse otra vez';
          b.classList.add('danger');
          setTimeout(() => { if (b.isConnected) { b.dataset.armed = ''; b.textContent = b.dataset.label; b.classList.remove('danger'); } }, 4000);
          return;
        }
        const self = b.dataset.remove.toLowerCase() === me();
        change('DELETE', base + encodeURIComponent(b.dataset.remove), undefined,
          self ? 'Ha salido de la familia.' : b.dataset.label === 'Rechazar' ? 'Solicitud rechazada.' : 'Familiar quitado.');
      }
    });

    $('elder-list').addEventListener('submit', (e) => {
      const form = e.target.closest('form.family-add');
      if (!form) return;
      e.preventDefault();
      const f = form.elements;
      change('POST', `/api/elders/${encodeURIComponent(form.dataset.elder)}/family`,
        { docType: f.docType.value, document: f.document.value.trim(), relation: f.relation.value },
        'Familiar añadido.');
      form.reset();
    });

    $('form-elder').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      if (!navigator.onLine) return SA.toast('Para registrar a un familiar necesita conexión a internet.', 'warn');
      try {
        await SAAuth.api('/api/elders', { method: 'POST', body: { name: f.name.value.trim(), username: f.username.value.trim(), password: f.password.value } });
        SA.toast(`Cuenta de ${f.name.value.trim()} enviada. Quedará activa cuando el administrador le dé de alta.`, 'ok', 8000);
        e.target.reset();
        e.target.closest('details').open = false;
        load();
      } catch (err) {
        SA.toast(err.message, 'warn');
      }
    });
  });
})();
