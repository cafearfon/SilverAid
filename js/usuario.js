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
    $('sos-float').hidden = name === 'sos' || name === 'home'; // ahí ya está el botón grande
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    $('app-main').scrollTop = 0; // en el ordenador la página se desplaza dentro del marco del teléfono
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
  /** «Hoy», «Mañana», el día de la semana si es esta semana («Jueves») o la fecha. */
  const dayName = (key) => {
    const n = daysUntil(key);
    if (n < 2) return whenText(key);
    const text = n < 7 ? new Date(key + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long' }) : SA.fmtDate(key);
    return text.replace(/^./, (c) => c.toUpperCase());
  };

  // ---------- Inicio ----------
  function renderHome() {
    const h = new Date().getHours();
    const saludo = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    $('greeting').textContent = `${saludo}, ${SA.state.user.name.split(' ')[0]} 👋`;
    $('today-date').textContent = SA.fmtDate(SA.dateKey()).replace(/^./, (c) => c.toUpperCase());

    const doses = SA.doses();
    const taken = doses.filter((x) => x.status === 'taken').length;
    const d = SA.nextDose();
    // Mismo diseño que la vista previa de la portada: dato en negrita, detalle debajo y botón verde.
    $('home-next-dose').innerHTML = (d
      ? `<strong class="mini-main">${d.time} · ${SA.esc(d.med.name)}</strong>
         ${d.med.dose ? `<span class="mini-sub">${SA.esc(d.med.dose)}</span>` : ''}
         ${d.status === 'due' ? `<button class="mini-btn" data-take="${d.key}">✔ Ya la tomé</button>` : ''}`
      : '<strong class="mini-main">✅ Todo tomado</strong>')
      + `<span class="mini-foot"><span class="mini-sub">Hoy: ${taken} de ${doses.length} tomadas</span>
         <button class="mini-link" data-goto="meds">Ver dosis ›</button></span>`;

    const a = SA.upcomingAppointments()[0];
    $('home-next-appt').innerHTML = a
      ? `<strong class="mini-main">${SA.esc(a.title)}</strong>
         <span class="mini-sub">${dayName(a.date)} · ${a.time}${a.who ? ' · con ' + SA.esc(a.who) : ''}</span>
         <span class="mini-foot"><span class="mini-sub">${a.place ? '📍 ' + SA.esc(a.place) : ''}</span>
         <button class="mini-link" data-goto="appts">Ver citas ›</button></span>`
      : `<span class="mini-foot"><span class="mini-sub">No tiene citas próximas.</span>
         <button class="mini-link" data-goto="appts">Añadir ›</button></span>`;
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

  /** Ordenador (sobremesa o portátil): ratón o touchpad y pantalla ancha. Misma condición que en styles.css. */
  const DESKTOP = window.matchMedia('(min-width: 900px) and (hover: hover) and (pointer: fine)');
  function adaptToDevice() {
    document.body.classList.toggle('is-desktop', DESKTOP.matches);
    const notify = $('btn-notify');
    if (!notify.disabled) notify.textContent = `🔔 Activar avisos en este ${DESKTOP.matches ? 'equipo' : 'teléfono'}`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    applySettings();
    adaptToDevice();
    DESKTOP.addEventListener('change', adaptToDevice);

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
