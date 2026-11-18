/* 1. Recordatorio de medicamentos */
(function () {
  const GRACE = 30; // minutos antes de considerar una dosis olvidada
  const remindedDue = new Set();

  const dayLog = () => {
    const k = SA.dateKey();
    SA.state.intakes[k] = SA.state.intakes[k] || {};
    return SA.state.intakes[k];
  };

  /** Dosis de hoy con su estado: taken | missed | pending | due | late */
  SA.doses = () => {
    const log = dayLog();
    const now = SA.nowMin();
    const out = [];
    SA.state.meds.forEach((med) => med.times.forEach((time) => {
      const key = med.id + '@' + time;
      let status = log[key];
      if (!status) {
        const diff = now - SA.toMin(time);
        status = diff < 0 ? 'pending' : diff <= GRACE ? 'due' : 'late';
      }
      out.push({ med, time, key, status });
    }));
    return out.sort((a, b) => SA.toMin(a.time) - SA.toMin(b.time));
  };

  SA.nextDose = () => SA.doses().find((d) => d.status === 'due' || d.status === 'pending');

  function notify(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification(title, { body }); } catch (e) { /* algunos móviles no lo permiten */ }
    }
  }

  function markMissed(d) {
    dayLog()[d.key] = 'missed';
    SA.alertFamily('warn', `${SA.state.user.name} no ha confirmado la toma de ${d.med.name} (${d.time}).`);
  }

  /** Se ejecuta periódicamente: recuerda dosis y avisa de olvidos. */
  SA.medsCheck = () => {
    SA.doses().forEach((d) => {
      if (d.status === 'due' && !remindedDue.has(d.key)) {
        remindedDue.add(d.key);
        SA.beep(3);
        SA.toast(`⏰ Es hora de tomar ${d.med.name} (${d.med.dose}).`, 'warn', 10000);
        notify('SilverAid · Hora de su medicamento', `${d.med.name} — ${d.med.dose}`);
      } else if (d.status === 'late') {
        markMissed(d);
      }
    });
  };

  SA.takeDose = (key) => {
    const d = SA.doses().find((x) => x.key === key);
    if (!d) return;
    const wasMissed = d.status === 'missed' || d.status === 'late';
    dayLog()[key] = 'taken';
    SA.save();
    SA.toast('¡Muy bien! Toma registrada.', 'ok');
    if (wasMissed) SA.alertFamily('ok', `${SA.state.user.name} confirmó (con retraso) la toma de ${d.med.name} (${d.time}).`);
    else SA.renderAll();
  };

  const LABEL = { taken: 'Tomada', pending: 'Pendiente', due: 'Ahora', missed: 'No confirmada', late: 'No confirmada' };

  function render() {
    const doses = SA.doses();
    document.getElementById('dose-list').innerHTML = doses.length
      ? doses.map((d) => `
        <li class="dose ${d.status === 'late' ? 'missed' : d.status}">
          <span class="time">${d.time}</span>
          <span class="info"><strong>${SA.esc(d.med.name)}</strong>${SA.esc(d.med.dose)}</span>
          <span class="badge ${d.status === 'late' ? 'missed' : d.status}">${LABEL[d.status]}</span>
          ${d.status === 'taken'
            ? `<button class="btn ghost small" data-undo="${d.key}">Deshacer</button>`
            : `<button class="btn ok" data-take="${d.key}">✔ Ya la tomé</button>`}
        </li>`).join('')
      : '<li class="empty">No hay medicamentos programados.</li>';

    document.getElementById('med-list').innerHTML = SA.state.meds.length
      ? SA.state.meds.map((m) => `
        <li><span><span class="title">${SA.esc(m.name)}</span><span class="sub">${SA.esc(m.dose)} · ${m.times.join(', ')}</span></span>
        <button class="icon-btn" data-del-med="${m.id}" title="Eliminar" aria-label="Eliminar ${SA.esc(m.name)}">✕</button></li>`).join('')
      : '<li class="empty">Sin medicamentos.</li>';

    const btn = document.getElementById('btn-notify');
    if (!('Notification' in window)) btn.hidden = true;
    else if (Notification.permission === 'granted') { btn.textContent = '🔔 Notificaciones activadas'; btn.disabled = true; }
  }
  SA.onRender(render);

  document.addEventListener('DOMContentLoaded', () => {
    const view = document.getElementById('view-meds');

    view.addEventListener('click', (e) => {
      const t = e.target;
      if (t.dataset.take) {
        SA.takeDose(t.dataset.take);
      } else if (t.dataset.undo) {
        delete dayLog()[t.dataset.undo];
        remindedDue.delete(t.dataset.undo);
        SA.save(); SA.renderAll();
      } else if (t.dataset.delMed) {
        SA.state.meds = SA.state.meds.filter((m) => m.id !== t.dataset.delMed);
        SA.save(); SA.renderAll();
      }
    });

    document.getElementById('btn-notify').addEventListener('click', async () => {
      const p = await Notification.requestPermission();
      SA.toast(p === 'granted' ? 'Notificaciones activadas.' : 'No se concedió el permiso de notificaciones.', p === 'granted' ? 'ok' : 'warn');
      render();
    });

    document.getElementById('btn-sim-missed').addEventListener('click', () => {
      const d = SA.doses().find((x) => x.status === 'due' || x.status === 'pending');
      if (!d) return SA.toast('No quedan dosis pendientes hoy.', 'info');
      markMissed(d);
    });

    document.getElementById('form-med').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      const times = f.times.value.split(/[,\s]+/).filter(Boolean).map((t) => {
        const m = t.match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
        return `${SA.pad(+m[1])}:${m[2] || '00'}`;
      });
      if (!times.length || times.includes(null)) return SA.toast('Escriba las horas así: 08:00, 20:00', 'warn');
      SA.state.meds.push({ id: SA.uid(), name: f.name.value.trim(), dose: f.dose.value.trim() || '—', times: [...new Set(times)].sort() });
      SA.save(); f.reset(); SA.renderAll();
      SA.toast('Medicamento añadido.', 'ok');
    });
  });
})();
