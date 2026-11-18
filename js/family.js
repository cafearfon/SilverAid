/* 2. Panel de la familia / cuidadores */
(function () {
  const DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const SLOTS = [['manana', 'Mañana'], ['tarde', 'Tarde']];

  SA.upcomingAppointments = () => {
    const today = SA.dateKey();
    return SA.state.appointments
      .filter((a) => a.date >= today)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  };

  function render() {
    const s = SA.state;
    SA.renderFeed(document.getElementById('family-alerts'), s.alerts);

    // Citas
    const appts = SA.upcomingAppointments();
    document.getElementById('appt-list').innerHTML = appts.length
      ? appts.map((a) => `
        <li><span><span class="title">${SA.esc(a.title)}</span>
          <span class="sub">${SA.fmtDate(a.date)} · ${a.time}${a.place ? ' · ' + SA.esc(a.place) : ''}${a.who ? ' · Acompaña: ' + SA.esc(a.who) : ''}</span></span>
          <button class="icon-btn" data-del-appt="${a.id}" title="Eliminar" aria-label="Eliminar cita">✕</button></li>`).join('')
      : '<li class="empty">No hay citas próximas.</li>';

    // Tareas
    document.getElementById('task-list').innerHTML = s.tasks.length
      ? s.tasks.map((t) => `
        <li class="${t.done ? 'done' : ''}">
          <label class="switch" style="margin:0"><input type="checkbox" data-task="${t.id}" ${t.done ? 'checked' : ''}>
            <span><span class="title">${SA.esc(t.title)}</span><span class="sub">${SA.esc(t.who || 'Sin asignar')}</span></span></label>
          <button class="icon-btn" data-del-task="${t.id}" title="Eliminar" aria-label="Eliminar tarea">✕</button></li>`).join('')
      : '<li class="empty">No hay tareas.</li>';

    // Turnos de visita
    const todayIdx = (new Date().getDay() + 6) % 7; // lunes = 0
    document.getElementById('visit-grid').innerHTML =
      `<tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join('')}</tr>` +
      SLOTS.map(([slot, label]) => `<tr><th>${label}</th>${DAYS.map((_, i) => {
        const who = s.visits[`${i}-${slot}`];
        return `<td class="${i === todayIdx ? 'today' : ''}"><button data-visit="${i}-${slot}" class="${who ? 'filled' : ''}">${who ? SA.esc(who) : '—'}</button></td>`;
      }).join('')}</tr>`).join('');

    // Contactos
    document.getElementById('contact-list').innerHTML = s.contacts.length
      ? s.contacts.map((c) => `
        <li><span><span class="title">${SA.esc(c.name)}</span><span class="sub">${SA.esc(c.relation)} · ${SA.esc(c.phone)}</span></span>
        <button class="icon-btn" data-del-contact="${c.id}" title="Eliminar" aria-label="Eliminar contacto">✕</button></li>`).join('')
      : '<li class="empty">Añada al menos un contacto para poder recibir avisos.</li>';

    // Desplegables de personas (conservando la selección actual)
    document.querySelectorAll('.contact-select').forEach((sel) => {
      const cur = sel.value;
      sel.innerHTML = '<option value="">Sin asignar</option>' + SA.contactOptions(cur);
    });
  }
  SA.onRender(render);

  document.addEventListener('DOMContentLoaded', () => {
    const view = document.getElementById('view-family');
    const s = () => SA.state;

    view.addEventListener('click', (e) => {
      const d = e.target.closest('button')?.dataset || {};
      if (d.delAppt) s().appointments = s().appointments.filter((a) => a.id !== d.delAppt);
      else if (d.delTask) s().tasks = s().tasks.filter((t) => t.id !== d.delTask);
      else if (d.delContact) s().contacts = s().contacts.filter((c) => c.id !== d.delContact);
      else if (d.visit) {
        // Rota entre: vacío → contacto 1 → contacto 2 → … → vacío
        const names = s().contacts.map((c) => c.name);
        const cur = s().visits[d.visit];
        const next = names[names.indexOf(cur) + 1];
        if (next) s().visits[d.visit] = next; else delete s().visits[d.visit];
      } else return;
      SA.save(); SA.renderAll();
    });

    view.addEventListener('change', (e) => {
      const id = e.target.dataset.task;
      if (!id) return;
      const t = s().tasks.find((x) => x.id === id);
      t.done = e.target.checked;
      SA.save(); SA.renderAll();
      if (t.done) SA.toast(`Tarea completada: ${t.title}`, 'ok');
    });

    document.getElementById('form-appt').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      s().appointments.push({ id: SA.uid(), title: f.title.value.trim(), date: f.date.value, time: f.time.value, place: f.place.value.trim(), who: f.who.value });
      SA.save(); f.reset(); f.time.value = '10:00'; SA.renderAll();
      SA.toast('Cita añadida y compartida con la familia.', 'ok');
    });

    document.getElementById('form-task').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      s().tasks.push({ id: SA.uid(), title: f.title.value.trim(), who: f.who.value, done: false });
      SA.save(); f.reset(); SA.renderAll();
    });

    document.getElementById('form-contact').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target;
      s().contacts.push({ id: SA.uid(), name: f.name.value.trim(), relation: f.relation.value.trim() || 'Contacto', phone: f.phone.value.trim() || '—' });
      SA.save(); f.reset(); SA.renderAll();
    });

    document.getElementById('btn-clear-alerts').addEventListener('click', () => {
      s().alerts = [];
      SA.save(); SA.renderAll();
    });
  });
})();
