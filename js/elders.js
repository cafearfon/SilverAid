/* Clientes (familiar responsable): registran a su adulto mayor, que queda pendiente de alta del administrador. */
(function () {
  const $ = (id) => document.getElementById(id);
  const STATUS = { pendiente: '⏳ Pendiente de alta', activo: '✅ Dado de alta', inactivo: '⛔ Desactivado' };

  async function load() {
    try {
      const { elders } = await SAAuth.api('/api/elders');
      $('elder-list').innerHTML = elders.length
        ? elders.map((u) => `
          <li><span><span class="title">${SA.esc(u.name)}</span><span class="sub">@${SA.esc(u.username)}</span></span>
          <span class="pill ${SA.esc(u.status)}">${STATUS[u.status] || SA.esc(u.status)}</span></li>`).join('')
        : '<li class="empty">Todavía no ha registrado a ningún familiar.</li>';
    } catch (err) {
      $('elder-list').innerHTML = `<li class="empty">${SA.esc(err.message)}</li>`;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (SA.session.role !== 'cliente') return;
    $('elders-card').hidden = false;
    load();
    setInterval(load, 30000); // para ver cuándo el administrador le da de alta

    $('form-elder').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target.elements;
      try {
        await SAAuth.api('/api/elders', { method: 'POST', body: { name: f.name.value.trim(), username: f.username.value.trim(), password: f.password.value } });
        SA.toast(`Cuenta de ${f.name.value.trim()} enviada. Quedará activa cuando el administrador le dé de alta.`, 'ok', 8000);
        e.target.reset();
        load();
      } catch (err) {
        SA.toast(err.message, 'warn');
      }
    });
  });
})();
