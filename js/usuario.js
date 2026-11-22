/* Página del adulto mayor: inicio, dosis, citas y botón de ayuda.
   Las dosis vienen de meds.js y el botón de pánico de sos.js; aquí solo va lo propio de esta página. */
(function () {
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['home', 'meds', 'appts', 'sos'];
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

  SA.showView = (name) => {
    if (!VIEWS.includes(name)) name = 'home';
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    $('sos-float').hidden = name === 'sos'; // en «Ayuda» ya está el botón grande
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo(0, 0);
  };

  function applySettings() {
    const st = SA.state.settings;
    document.body.classList.toggle('big', st.big);
    document.body.classList.toggle('contrast', st.contrast);
    $('btn-big').setAttribute('aria-pressed', st.big);
    $('btn-contrast').setAttribute('aria-pressed', st.contrast);
  }

  /** Días que faltan para una fecha (0 = hoy). */
  const daysUntil = (key) => Math.round((new Date(key + 'T00:00') - new Date(SA.dateKey() + 'T00:00')) / 864e5);
  const whenText = (key) => {
    const n = daysUntil(key);
    return n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`;
  };

  // ---------- Inicio ----------
  function renderHome() {
    const h = new Date().getHours();
    const saludo = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    $('greeting').textContent = `${saludo}, ${SA.state.user.name} 👋`;
    $('today-date').textContent = SA.fmtDate(SA.dateKey()).replace(/^./, (c) => c.toUpperCase());

    const doses = SA.doses();
    const taken = doses.filter((x) => x.status === 'taken').length;
    const d = SA.nextDose();
    $('home-next-dose').innerHTML = (d
      ? `<p class="big-text">${d.time} · ${SA.esc(d.med.name)}</p><p class="muted">${SA.esc(d.med.dose)}</p>
         ${d.status === 'due' ? `<button class="btn ok big" data-take="${d.key}">✔ Ya la tomé</button>` : ''}`
      : '<p class="big-text">✅ Todo tomado</p>')
      + `<p class="muted">Hoy: ${taken} de ${doses.length} tomas confirmadas.</p>
         <button class="btn ghost" data-goto="meds">Ver mis dosis</button>`;

    const a = SA.upcomingAppointments()[0];
    $('home-next-appt').innerHTML = a
      ? `<p class="big-text">${SA.esc(a.title)}</p>
         <p class="muted"><strong>${whenText(a.date)}</strong> · ${SA.fmtDate(a.date)} · ${a.time}<br>${SA.esc(a.place)}${a.who ? ' · con ' + SA.esc(a.who) : ''}</p>
         <button class="btn ghost" data-goto="appts">Ver mis citas</button>`
      : '<p class="muted">No tiene citas próximas.</p><button class="btn ghost" data-goto="appts">Añadir una cita</button>';
  }

  // ---------- Citas ----------
  function renderAppts() {
    const appts = SA.upcomingAppointments();
    $('appt-list').innerHTML = appts.length
      ? appts.map((a) => {
        const [, m, day] = a.date.split('-');
        const n = daysUntil(a.date);
        return `
        <li class="appt ${n <= 1 ? 'soon' : ''}">
          <span class="appt-date" aria-hidden="true"><strong>${+day}</strong>${MONTHS[+m - 1]}</span>
          <span class="appt-info">
            <span class="badge ${n <= 1 ? 'due' : 'pending'}">${whenText(a.date)}</span>
            <strong>${SA.esc(a.title)}</strong>
            <span>${SA.fmtDate(a.date)} · <b>${a.time}</b></span>
            ${a.place ? `<span class="muted">📍 ${SA.esc(a.place)}</span>` : ''}
            ${a.who ? `<span class="muted">🤝 Le acompaña ${SA.esc(a.who)}</span>` : ''}
          </span>
          <button class="icon-btn" data-del-appt="${a.id}" title="Eliminar cita" aria-label="Eliminar la cita ${SA.esc(a.title)}">✕</button>
        </li>`;
      }).join('')
      : '<li class="empty">No tiene citas próximas.</li>';

    const sel = $('appt-who');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Nadie / sin decidir</option>' + SA.contactOptions(cur);
  }

  SA.onRender(renderHome);
  SA.onRender(renderAppts);

  document.addEventListener('DOMContentLoaded', () => {
    applySettings();

    // Sesión: muestra el usuario y comprueba con el servidor que sigue siendo válida y del rol correcto.
    $('user-chip').textContent = `👤 ${SA.session.name}`;
    $('btn-logout').addEventListener('click', () => SAAuth.logout());
    SAAuth.api('/api/me')
      .then(({ user }) => { if (user.role !== 'usuario') location.replace(SAAuth.home(user.role, user.status)); })
      .catch((err) => { if (err.status === 401) { SAAuth.clear(); location.replace('login.html'); } }); // sin conexión: sigue
    window.addEventListener('sa:state', applySettings);

    $('tabs').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.view; if (v) SA.showView(v); });
    window.addEventListener('hashchange', () => SA.showView(location.hash.slice(1)));

    $('view-home').addEventListener('click', (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.goto) SA.showView(t.dataset.goto);
      if (t.dataset.take) SA.takeDose(t.dataset.take);
    });

    $('btn-big').addEventListener('click', () => { SA.state.settings.big = !SA.state.settings.big; SA.save(); applySettings(); });
    $('btn-contrast').addEventListener('click', () => { SA.state.settings.contrast = !SA.state.settings.contrast; SA.save(); applySettings(); });

    $('appt-list').addEventListener('click', (e) => {
      const id = e.target.closest('[data-del-appt]')?.dataset.delAppt;
      if (!id) return;
      const a = SA.state.appointments.find((x) => x.id === id);
      if (!a || !confirm(`¿Eliminar la cita «${a.title}»?`)) return;
      SA.state.appointments = SA.state.appointments.filter((x) => x.id !== id);
      SA.save(); SA.renderAll();
      SA.toast('Cita eliminada.', 'info');
    });

    const form = $('form-appt');
    form.date.min = SA.dateKey();
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (form.date.value < SA.dateKey()) return SA.toast('Elija una fecha de hoy en adelante.', 'warn');
      SA.state.appointments.push({
        id: SA.uid(), title: form.title.value.trim(), date: form.date.value, time: form.time.value,
        place: form.place.value.trim(), who: form.who.value,
      });
      SA.save(); form.reset(); form.time.value = '10:00'; SA.renderAll();
      form.closest('details').open = false;
      SA.toast('Cita guardada.', 'ok');
    });

    SA.showView(location.hash.slice(1) || 'home');
    SA.medsCheck();
    SA.renderAll();
    // Revisión periódica de dosis (recordatorios y avisos de olvido) y refresco de la pantalla
    setInterval(() => { SA.medsCheck(); SA.renderAll(); }, 20000);
  });
})();
