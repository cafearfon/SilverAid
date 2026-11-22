/* Sesión del usuario y llamadas a la API del servidor local (server.py). */
(function () {
  const KEY = 'silveraid-session';

  const SAAuth = (window.SAAuth = {
    get() {
      try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
    },
    set(session) {
      const before = SAAuth.get();
      try { localStorage.setItem(KEY, JSON.stringify(session)); } catch (e) { /* sin almacenamiento */ }
      // Nuevo inicio de sesión: lo que quedó pendiente sin conexión se enviará con el nuevo token.
      if (window.SADB && session && session.token && (!before || before.token !== session.token)) {
        SADB.retoken(session.username, session.token).then(() => window.SAPWA && SAPWA.requestSync()).catch(() => {});
      }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (e) { /* sin almacenamiento */ }
    },

    /**
     * Llama a la API. Lanza un Error con .status (0 = sin conexión o sin servidor).
     * Con queue: true, una petición que no es GET y no llega por falta de conexión se guarda en la cola
     * de IndexedDB (js/db.js) y se envía sola al volver la conexión; entonces devuelve { queued: true }.
     * Una respuesta GET servida desde la copia del dispositivo (sin conexión) trae .offline = true.
     */
    async api(path, { method = 'GET', body, queue = false, label = '' } = {}) {
      const s = SAAuth.get();
      let res;
      try {
        res = await fetch(path, {
          method,
          headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: 'Bearer ' + s.token } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        res = null;
      }
      const offline = !res || res.headers.get('X-SA-Offline') === '1';
      let data = null;
      try { data = res && await res.json(); } catch (e) { /* respuesta sin JSON */ }
      if (!res || (offline && !res.ok)) {
        if (queue && method !== 'GET' && window.SADB && s) {
          await SADB.enqueue({ username: s.username, token: s.token, path, method, body, label });
          window.dispatchEvent(new CustomEvent('sa:queued', { detail: { path, label } }));
          if (window.SAPWA) SAPWA.requestSync();
          return { queued: true };
        }
        throw Object.assign(new Error(navigator.onLine ? SAAuth.NO_SERVER : SAAuth.OFFLINE), { status: 0 });
      }
      if (!data) throw Object.assign(new Error(SAAuth.NO_SERVER), { status: 0 });
      if (!res.ok) throw Object.assign(new Error(data.error || 'Error ' + res.status), { status: res.status });
      if (offline) Object.defineProperty(data, 'offline', { value: true });
      return data;
    },

    async logout() {
      const s = SAAuth.get();
      try { await SAAuth.api('/api/logout', { method: 'POST', body: {} }); } catch (e) { /* da igual */ }
      if (s && window.SAPWA) SAPWA.forget(s.token); // borra las respuestas guardadas de esta sesión
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

    OFFLINE: 'No hay conexión a internet. Inténtelo de nuevo cuando vuelva la conexión.',
    NO_SERVER: 'No se encontró el servidor de SilverAid. Ejecútelo con «python server.py» y abra http://localhost:8000',
  });
})();
