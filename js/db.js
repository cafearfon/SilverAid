/* SilverAid — base de datos del navegador (IndexedDB) y sincronización con el servidor.
   La usan las páginas y el service worker (sw.js la carga con importScripts).

   Almacenes:
     state   datos de la aplicación de cada usuario: { username, data, updatedAt, synced, token }
             «synced» = false mientras haya cambios que el servidor todavía no tiene.
     outbox  peticiones hechas sin conexión (p. ej. un aviso de emergencia) que se envían al volver:
             { id, username, token, path, method, body, label, createdAt, tries, lastError }

   Sincronización: el estado se envía completo con su marca de tiempo y gana el cambio más reciente
   (el servidor responde con el vigente). La cola se envía en orden; lo que el servidor rechaza (4xx)
   se descarta para no bloquear el resto, salvo la sesión caducada (401), que espera a un nuevo inicio de sesión. */
(function (root) {
  const DB_NAME = 'silveraid';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) return reject(new Error('Este navegador no tiene IndexedDB.'));
      const req = root.indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'username' });
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true }).createIndex('username', 'username');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { dbPromise = null; reject(new Error('Base de datos bloqueada por otra pestaña.')); };
    });
    return dbPromise;
  }

  /** Ejecuta fn(store) en una transacción y devuelve lo que resuelva la petición que fn retorne. */
  async function tx(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const req = fn(t.objectStore(storeName));
      let result;
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const key = (u) => String(u || '').toLowerCase();

  const SADB = {
    open,

    // ------------------------------------------------------------- estado de la aplicación
    getState: (username) => tx('state', 'readonly', (s) => s.get(key(username))),
    putState: (record) => tx('state', 'readwrite', (s) => s.put({ ...record, username: key(record.username) })),
    deleteState: (username) => tx('state', 'readwrite', (s) => s.delete(key(username))),

    /** Guarda un cambio local: queda pendiente de enviar al servidor. */
    async saveLocal(username, data, token) {
      const rec = { username, data, updatedAt: Date.now(), synced: false, token };
      await SADB.putState(rec);
      return rec;
    },

    // ------------------------------------------------------------- cola de envíos pendientes
    enqueue: (item) => tx('outbox', 'readwrite', (s) => s.add({
      ...item, username: key(item.username), createdAt: Date.now(), tries: 0, lastError: '',
    })),
    outbox: () => tx('outbox', 'readonly', (s) => s.getAll()),
    removeQueued: (id) => tx('outbox', 'readwrite', (s) => s.delete(id)),
    updateQueued: (item) => tx('outbox', 'readwrite', (s) => s.put(item)),

    /** Tras iniciar sesión de nuevo: lo pendiente de ese usuario usa el nuevo token. */
    async retoken(username, token) {
      const items = (await SADB.outbox()).filter((i) => i.username === key(username));
      for (const i of items) await SADB.updateQueued({ ...i, token, lastError: '' });
      const st = await SADB.getState(username);
      if (st) await SADB.putState({ ...st, token });
    },

    /** Número de cambios sin enviar (cola + estado sin sincronizar) de un usuario, o de todos. */
    async pendingCount(username) {
      const db = await open();
      const all = await new Promise((resolve, reject) => {
        const t = db.transaction(['outbox', 'state'], 'readonly');
        const out = {};
        t.objectStore('outbox').getAll().onsuccess = (e) => { out.outbox = e.target.result; };
        t.objectStore('state').getAll().onsuccess = (e) => { out.state = e.target.result; };
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error);
      });
      const mine = (r) => !username || r.username === key(username);
      return all.outbox.filter(mine).length + all.state.filter((r) => mine(r) && !r.synced).length;
    },

    // ------------------------------------------------------------- sincronización
    /**
     * Envía al servidor todo lo pendiente. fetchFn permite usar el fetch de la página o del service worker.
     * Devuelve { sent, failed, offline, states: [usernames actualizados desde el servidor] }.
     */
    async syncAll(fetchFn = root.fetch.bind(root)) {
      const report = { sent: 0, failed: 0, offline: false, authErrors: 0, updated: [] };
      const call = async (path, method, body, token) => {
        try {
          const res = await fetchFn(path, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-SA-Sync': '1', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
          let data = null;
          try { data = await res.json(); } catch (e) { /* sin JSON */ }
          return { status: res.status, ok: res.ok, data };
        } catch (e) {
          return { status: 0, ok: false, data: null };
        }
      };

      // 1) Cola, en el orden en que se hicieron las peticiones.
      const items = (await SADB.outbox()).sort((a, b) => a.id - b.id);
      for (const item of items) {
        const r = await call(item.path, item.method, item.body, item.token);
        if (r.status === 0) { report.offline = true; break; }           // sigue sin conexión: se reintenta luego
        if (r.ok) { await SADB.removeQueued(item.id); report.sent++; continue; }
        if (r.status === 401) {                                         // sesión caducada: espera a que vuelva a entrar
          report.authErrors++;
          await SADB.updateQueued({ ...item, tries: item.tries + 1, lastError: 'Inicie sesión de nuevo para enviarlo.' });
          continue;
        }
        if (r.status >= 500 && item.tries < 5) {                        // error del servidor: se reintenta luego
          await SADB.updateQueued({ ...item, tries: item.tries + 1, lastError: (r.data && r.data.error) || 'Error ' + r.status });
          report.failed++;
          continue;
        }
        await SADB.removeQueued(item.id);                               // rechazada (datos no válidos): se descarta
        report.failed++;
      }

      // 2) Estado de la aplicación de cada usuario con cambios sin enviar.
      if (!report.offline) {
        const states = await tx('state', 'readonly', (s) => s.getAll());
        for (const st of states.filter((x) => !x.synced && x.token)) {
          const r = await call('/api/me/state', 'PUT', { state: st.data, updatedAt: st.updatedAt }, st.token);
          if (r.status === 0) { report.offline = true; break; }
          if (r.status === 401) { report.authErrors++; continue; }
          if (!r.ok || !r.data) { report.failed++; continue; }
          // Puede que otro dispositivo tenga un cambio más reciente: se adopta el del servidor.
          const fresh = await SADB.getState(st.username);
          if (fresh && fresh.updatedAt > st.updatedAt) continue;        // hubo otro cambio mientras se enviaba
          await SADB.putState({ ...st, data: r.data.state, updatedAt: r.data.updatedAt, synced: true });
          report.sent++;
          if (!r.data.saved) report.updated.push(st.username);
        }
      }
      return report;
    },
  };

  root.SADB = SADB;
})(typeof self !== 'undefined' ? self : window);
