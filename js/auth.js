/* Sesión del usuario y llamadas a la API del servidor local (server.py). */
(function () {
  const KEY = 'silveraid-session';

  const SAAuth = (window.SAAuth = {
    get() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
    },
    set(session) {
      try { localStorage.setItem(KEY, JSON.stringify(session)); } catch (e) { /* sin almacenamiento */ }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ }
    },

    /** Llama a la API. Lanza un Error con .status (0 = no hay servidor). */
    async api(path, { method = 'GET', body } = {}) {
      const s = SAAuth.get();
      let res;
      try {
        res = await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        throw Object.assign(new Error(SAAuth.NO_SERVER), { status: 0 });
      }
      let data = null;
      try { data = await res.json(); } catch (e) { /* respuesta sin JSON */ }
      if (!data) throw Object.assign(new Error(SAAuth.NO_SERVER), { status: 0 });
      if (!res.ok) throw Object.assign(new Error(data.error || 'Error ' + res.status), { status: res.status });
      return data;
    },

    async logout() {
      try { await SAAuth.api('/api/logout', { method: 'POST', body: {} }); } catch (e) { /* da igual */ }
      SAAuth.clear();
      location.replace('login.html');
    },

    /** Página de inicio según el rol. Una cuenta en verificación solo puede subir sus documentos. */
    home(role, status) {
      if (status === 'verificacion') return 'documentos.html';
      return role === 'admin' ? 'admin.html' : role === 'usuario' ? 'usuario.html' : 'app.html';
    },

    /** Roles de la aplicación (código guardado en users.txt → nombre visible). */
    ROLES: {
      usuario: 'Adulto mayor',
      cliente: 'Familiar responsable',
      cuidador: 'Cuidador/a',
      colaborador: 'Colaborador/a',
      admin: 'Administrador',
    },

    NO_SERVER:'No se encontró el servidor de SilverAid. Ejecútelo con «python server.py» y abra http://localhost:8000',
  });
})();
