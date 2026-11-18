/* 5. Red de voluntariado */
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { buscando: 'Buscando voluntario…', confirmada: 'Confirmada', completada: 'Completada', cancelada: 'Cancelada' };
  const initials = (n) => n.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const volById = (id) => SA.VOLUNTEERS.find((v) => v.id === id);

  /** Elige al voluntario con esa habilidad mejor valorado y más cercano que esté libre a esa hora. */
  function match(type, date, time) {
    const busy = new Set(SA.state.requests
      .filter((r) => r.date === date && r.time === time && r.status !== 'cancelada')
      .map((r) => r.volunteerId));
    return SA.VOLUNTEERS
      .filter((v) => v.skills.includes(type) && !busy.has(v.id))
      .sort((a, b) => b.rating - a.rating || a.km - b.km)[0];
  }

  SA.activeRequests = () => SA.state.requests.filter((r) => r.status === 'buscando' || r.status === 'confirmada');

  function render() {
    const reqs = [...SA.state.requests].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
    $('request-list').innerHTML = reqs.length
      ? reqs.map((r) => {
          const v = volById(r.volunteerId);
          return `<li><span>
              <span class="title">${SA.SKILLS[r.type]} · ${SA.fmtDate(r.date)}, ${r.time}</span>
              <span class="sub">${r.status === 'buscando' ? 'Buscando…' : v ? 'Con ' + SA.esc(v.name) : ''}${r.notes ? ' · ' + SA.esc(r.notes) : ''}</span>
              <span class="status ${r.status}">${STATUS[r.status]}</span>
            </span>
            <span class="row-actions" style="margin:0">
              ${r.status === 'confirmada' ? `<button class="btn ok small" data-done="${r.id}">Hecho</button><button class="btn ghost small" data-cancel="${r.id}">Cancelar</button>` : ''}
              ${r.status === 'completada' && !r.rated ? `<button class="btn ghost small" data-rate="${r.id}">⭐ Valorar</button>` : ''}
            </span></li>`;
        }).join('')
      : '<li class="empty">Todavía no ha pedido ayuda.</li>';

    $('volunteer-list').innerHTML = SA.VOLUNTEERS.map((v) => `
      <div class="vol">
        <div class="avatar" aria-hidden="true">${initials(v.name)}</div>
        <h3>${SA.esc(v.name)}</h3>
        <div class="muted">${v.age} años · a ${v.km} km · ⭐ ${v.rating.toFixed(1)}</div>
        <div class="tags">${v.skills.map((s) => `<span class="tag">${SA.SKILLS[s]}</span>`).join('')}</div>
        <p>${SA.esc(v.bio)}</p>
      </div>`).join('');
  }
  SA.onRender(render);

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('form-request');
    form.date.value = SA.addDays(1);
    form.date.min = SA.dateKey();

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const v = match(f.type.value, f.date.value, f.time.value);
      if (!v) return SA.toast('No hay voluntarios libres para esa hora. Pruebe otro horario.', 'warn');
      const req = { id: SA.uid(), type: f.type.value, date: f.date.value, time: f.time.value, notes: f.notes.value.trim(), volunteerId: v.id, status: 'buscando' };
      SA.state.requests.push(req);
      SA.save(); SA.renderAll();
      f.notes.value = '';
      // Simula que el voluntario acepta la solicitud
      setTimeout(() => {
        req.status = 'confirmada';
        SA.save();
        SA.toast(`🤝 ${v.name} ha aceptado ayudarle el ${SA.fmtDate(req.date)} a las ${req.time}.`, 'ok', 8000);
        SA.alertFamily('info', `Voluntario/a ${v.name} acompañará a ${SA.state.user.name} (${SA.SKILLS[req.type].toLowerCase()}) el ${SA.fmtDate(req.date)} a las ${req.time}.`);
      }, 2000);
    });

    $('request-list').addEventListener('click', (e) => {
      const d = e.target.dataset;
      const r = SA.state.requests.find((x) => x.id === (d.done || d.cancel || d.rate));
      if (!r) return;
      if (d.done) { r.status = 'completada'; SA.toast('¡Gracias! Esperamos que haya ido bien.', 'ok'); }
      else if (d.cancel) { r.status = 'cancelada'; SA.toast('Solicitud cancelada. Se ha avisado al voluntario.', 'info'); }
      else if (d.rate) { r.rated = true; SA.toast(`Ha valorado a ${volById(r.volunteerId).name} con 5 estrellas. ¡Gracias!`, 'ok'); }
      SA.save(); SA.renderAll();
    });
  });
})();
