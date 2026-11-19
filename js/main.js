/* Navegación, accesibilidad, pantalla de inicio y arranque. */
(function () {
  const $ = (id) => document.getElementById(id);
  const VIEWS = ['home', 'meds', 'family', 'sos', 'assistant', 'caregivers'];

  SA.showView = (name) => {
    if (!VIEWS.includes(name)) name = 'home';
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
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

  function renderHome() {
    const h = new Date().getHours();
    const saludo = h < 13 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches';
    $('greeting').textContent = `${saludo}, ${SA.state.user.name} 👋`;
    $('today-date').textContent = SA.fmtDate(SA.dateKey()).replace(/^./, (c) => c.toUpperCase());

    const d = SA.nextDose();
    const doses = SA.doses();
    const taken = doses.filter((x) => x.status === 'taken').length;
    $('home-next-dose').innerHTML = d
      ? `<p class="big-text">${d.time} · ${SA.esc(d.med.name)}</p><p class="muted">${SA.esc(d.med.dose)}</p>
         ${d.status === 'due' ? `<button class="btn ok" data-take="${d.key}">✔ Ya la tomé</button>` : ''}
         <p class="muted">Hoy: ${taken} de ${doses.length} tomas confirmadas.</p>`
      : `<p class="big-text">✅ Todo tomado</p><p class="muted">Hoy: ${taken} de ${doses.length} tomas confirmadas.</p>`;

    const a = SA.upcomingAppointments()[0];
    $('home-next-appt').innerHTML = a
      ? `<p class="big-text">${SA.esc(a.title)}</p><p class="muted">${SA.fmtDate(a.date)} · ${a.time}<br>${SA.esc(a.place)}${a.who ? ' · con ' + SA.esc(a.who) : ''}</p>`
      : '<p class="muted">No hay citas próximas.</p>';

    const r = SA.activeRequests();
    $('home-requests').innerHTML = r.length
      ? `<p class="big-text">${r.length} ${r.length === 1 ? 'visita' : 'visitas'}</p><p class="muted">Próxima: ${SA.SKILLS[r[0].type]} el ${SA.fmtDate(r[0].date)}</p>`
      : '<p class="muted">Pida un cuidador para compañía o ayuda con la compra.</p><button class="btn ghost" data-goto="caregivers">Pedir cuidador</button>';

    SA.renderFeed($('home-alerts'), SA.state.alerts.slice(0, 4));
  }
  SA.onRender(renderHome);

  document.addEventListener('DOMContentLoaded', () => {
    applySettings();

    // Sesión: muestra el usuario y comprueba con el servidor que sigue siendo válida.
    $('user-chip').textContent = `👤 ${SA.session.name} · ${SAAuth.ROLES[SA.session.role] || SA.session.role}`;
    $('admin-link').hidden = !SA.isAdmin();
    $('btn-logout').addEventListener('click', () => SAAuth.logout());
    SAAuth.api('/api/me').catch(() => { SAAuth.clear(); location.replace('login.html'); });

    $('tabs').addEventListener('click', (e) => { const v = e.target.closest('button')?.dataset.view; if (v) SA.showView(v); });
    window.addEventListener('hashchange', () => SA.showView(location.hash.slice(1)));

    $('view-home').addEventListener('click', (e) => {
      const goto = e.target.dataset.goto;
      if (goto) SA.showView(goto);
      // El botón "Ya la tomé" de inicio reutiliza la lógica de la sección de medicamentos
      if (e.target.dataset.take) SA.takeDose(e.target.dataset.take);
    });

    $('btn-big').addEventListener('click', () => { SA.state.settings.big = !SA.state.settings.big; SA.save(); applySettings(); });
    $('btn-contrast').addEventListener('click', () => { SA.state.settings.contrast = !SA.state.settings.contrast; SA.save(); applySettings(); });
    $('btn-reset').addEventListener('click', () => {
      if (confirm('¿Restaurar todos los datos de ejemplo? Se perderán los cambios.')) {
        SA.reset(); SA.resetChat(); applySettings(); SA.toast('Demo reiniciado.', 'ok');
      }
    });

    SA.showView(location.hash.slice(1) || 'home');
    SA.medsCheck();
    SA.renderAll();
    // Revisión periódica de dosis y refresco de la interfaz
    setInterval(() => { SA.medsCheck(); SA.renderAll(); }, 20000);
  });
})();
