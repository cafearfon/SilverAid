/* 5. Red de cuidadores */
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { buscando: 'Buscando cuidador…', confirmada: 'Confirmada', completada: 'Completada', cancelada: 'Cancelada' };
  const initials = (n) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const caregiverById = (id) => SA.CAREGIVERS.find((c) => c.id === id);

  /** Elige al cuidador con ese servicio, disponible ese día y hora según su horario, sin otra cita y con más experiencia. */
  function match(type, date, time) {
    const busy = new Set(SA.state.requests
      .filter((r) => r.date === date && r.time === time && r.status !== 'cancelada')
      .map((r) => r.caregiverId));
    return SA.CAREGIVERS
      .filter((c) => c.skills.includes(type) && SAAvail.isAvailable(c.availability, date, time) && !busy.has(c.id))
      .sort((a, b) => b.experience - a.experience)[0];
  }

  /** Fichas de los cuidadores registrados por el administrador (data/caregivers.txt). */
  async function load() {
    try {
      const res = await SAAuth.api('/api/caregivers');
      SA.CAREGIVERS = res.caregivers;
      SA.caregiversOffline = !!res.offline; // copia guardada en el dispositivo (sin conexión)
      render();
    } catch (err) {
      $('caregiver-list').innerHTML = `<p class="empty">${SA.esc(err.message)}</p>`;
    }
  }

  SA.activeRequests = () => SA.state.requests.filter((r) => r.status === 'buscando' || r.status === 'confirmada');

  function render() {
    const reqs = [...SA.state.requests].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    $('request-list').innerHTML = reqs.length
      ? reqs.map((r) => {
          const name = caregiverById(r.caregiverId)?.name || r.caregiverName;
          return `<li><span>
              <span class="title">${SA.SKILLS[r.type]} · ${SA.fmtDate(r.date)}, ${r.time}</span>
              <span class="sub">${r.status === 'buscando' ? 'Buscando…' : name ? 'Con ' + SA.esc(name) : ''}${r.notes ? ' · ' + SA.esc(r.notes) : ''}</span>
              <span class="status ${r.status}">${STATUS[r.status]}</span>
            </span>
            <span class="row-actions" style="margin:0">
              ${r.status === 'confirmada' ? `<button class="btn ok small" data-done="${r.id}">Hecho</button><button class="btn ghost small" data-cancel="${r.id}">Cancelar</button>` : ''}
              ${r.status === 'completada' && !r.rated ? `<button class="btn ghost small" data-rate="${r.id}">⭐ Valorar</button>` : ''}
            </span></li>`;
        }).join('')
      : '<li class="empty">Todavía no ha pedido un cuidador.</li>';

    $('caregiver-list').innerHTML = (SA.caregiversOffline
      ? '<p class="offline-note">📡 Sin conexión: esta es la última lista guardada en el dispositivo.</p>' : '') + (SA.CAREGIVERS.length
      ? SA.CAREGIVERS.map((c) => `
      <div class="cg">
        <div class="avatar" aria-hidden="true">${SA.esc(initials(c.name))}</div>
        <h3>${SA.esc(c.name)}</h3>
        <div class="muted">${SA.esc(c.title)}${c.zone ? ' · ' + SA.esc(c.zone) : ''} · ${c.experience} ${c.experience === 1 ? 'año' : 'años'} de experiencia</div>
        <div class="tags">${c.skills.map((s) => `<span class="tag">${SA.SKILLS[s] || SA.esc(s)}</span>`).join('')}</div>
        <p>🕒 ${SAAvail.total(c.availability) ? SA.esc(SAAvail.summary(c.availability)) : 'Sin horario publicado'}</p>
      </div>`).join('')
      : '<p class="empty">Aún no hay cuidadores registrados.</p>');
  }
  SA.onRender(render);

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('form-request');
    form.date.value = SA.addDays(1);
    form.date.min = SA.dateKey();
    load();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const c = match(f.type.value, f.date.value, f.time.value);
      if (!c) return SA.toast(`No hay cuidadores de ${SA.SKILLS[f.type.value].toLowerCase()} disponibles el ${SA.fmtDate(f.date.value)} a las ${f.time.value}. Pruebe otro horario.`, 'warn', 7000);
      const req = { id: SA.uid(), type: f.type.value, date: f.date.value, time: f.time.value, notes: f.notes.value.trim(), caregiverId: c.id, caregiverName: c.name, status: 'buscando' };
      SA.state.requests.push(req);
      SA.save(); SA.renderAll();
      f.notes.value = '';
      // Simula que el cuidador acepta la solicitud
      setTimeout(() => {
        req.status = 'confirmada';
        SA.save();
        SA.toast(`🧑‍⚕️ ${c.name} ha aceptado atenderle el ${SA.fmtDate(req.date)} a las ${req.time}.`, 'ok', 8000);
        SA.alertFamily('info', `Cuidador/a ${c.name} acompañará a ${SA.state.user.name} (${SA.SKILLS[req.type].toLowerCase()}) el ${SA.fmtDate(req.date)} a las ${req.time}.`);
      }, 2000);
    });

    $('request-list').addEventListener('click', (e) => {
      const d = e.target.dataset;
      const r = SA.state.requests.find((x) => x.id === (d.done || d.cancel || d.rate));
      if (!r) return;
      if (d.done) { r.status = 'completada'; SA.toast('¡Gracias! Esperamos que haya ido bien.', 'ok'); }
      else if (d.cancel) { r.status = 'cancelada'; SA.toast('Solicitud cancelada. Se ha avisado al cuidador.', 'info'); }
      else if (d.rate) { r.rated = true; SA.toast(`Ha valorado a ${caregiverById(r.caregiverId)?.name || r.caregiverName} con 5 estrellas. ¡Gracias!`, 'ok'); }
      SA.save(); SA.renderAll();
    });
  });
})();
