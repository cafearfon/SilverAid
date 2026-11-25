/* 1. Recordatorio de medicamentos */
(function () {
  const GRACE = 30; // minutos antes de considerar una dosis olvidada
  // Listas del selector de horarios al añadir un medicamento: horas 00–23 y minutos de 5 en 5.
  const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
  const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
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

    document.getElementById('btn-sim-missed')?.addEventListener('click', () => {
      const d = SA.doses().find((x) => x.status === 'due' || x.status === 'pending');
      if (!d) return SA.toast('No quedan dosis pendientes hoy.', 'info');
      markMissed(d);
    });

    const form = document.getElementById('form-med');
    const rows = form.querySelector('[data-time-rows]');
    const options = (values, selected) => values.map((v) =>
      `<option value="${v}"${v === selected ? ' selected' : ''}>${v}</option>`).join('');

    /** Añade una fila hora + minutos; las nuevas proponen 4 h después de la última. */
    function addTimeRow(hour, minute = '00') {
      const n = rows.children.length + 1;
      const row = document.createElement('div');
      row.className = 'time-row';
      row.innerHTML = `
        <span class="time-num">${n}.</span>
        <select data-h aria-label="Hora del horario ${n}">${options(HOURS, hour)}</select>
        <span class="time-sep" aria-hidden="true">:</span>
        <select data-m aria-label="Minutos del horario ${n}">${options(MINUTES, minute)}</select>
        <button type="button" class="icon-btn" data-del-time title="Quitar este horario" aria-label="Quitar el horario ${n}">✕</button>`;
      rows.append(row);
      renumber();
    }

    function renumber() {
      [...rows.children].forEach((row, i) => {
        row.querySelector('.time-num').textContent = `${i + 1}.`;
        row.querySelector('[data-h]').setAttribute('aria-label', `Hora del horario ${i + 1}`);
        row.querySelector('[data-m]').setAttribute('aria-label', `Minutos del horario ${i + 1}`);
        // Siempre queda al menos un horario: con una sola fila no se puede quitar.
        row.querySelector('[data-del-time]').hidden = rows.children.length === 1;
      });
    }

    const readTimes = () => [...rows.children].map((row) =>
      `${row.querySelector('[data-h]').value}:${row.querySelector('[data-m]').value}`);

    form.querySelector('[data-add-time]').addEventListener('click', () => {
      const last = readTimes().pop() || '04:00';
      addTimeRow(SA.pad((+last.slice(0, 2) + 4) % 24), last.slice(3));
      rows.lastElementChild.querySelector('[data-h]').focus();
    });

    rows.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del-time]');
      if (del) { del.closest('.time-row').remove(); renumber(); }
    });

    // Al vaciar el formulario vuelve a un solo horario, a las 08:00.
    form.addEventListener('reset', () => setTimeout(() => { rows.innerHTML = ''; addTimeRow('08'); }));
    addTimeRow('08');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const times = [...new Set(readTimes())].sort();
      SA.state.meds.push({ id: SA.uid(), name: form.name.value.trim(), dose: form.dose.value.trim() || '—', times });
      SA.save(); form.reset(); SA.renderAll();
      SA.toast('Medicamento añadido.', 'ok');
    });
  });
})();
