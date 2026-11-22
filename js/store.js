/* SilverAid — estado compartido, utilidades y datos de ejemplo. */
(function () {
  const SA = (window.SA = {});
  // Cada usuario tiene sus propios datos en el navegador.
  SA.session = (window.SAAuth && SAAuth.get()) || { username: 'invitado', name: 'Carmen', role: 'usuario' };
  const KEY = 'silveraid-demo-v2:' + SA.session.username.toLowerCase();
  SA.isAdmin = () => SA.session.role === 'admin';

  // ---------- Utilidades ----------
  SA.uid = () => Math.random().toString(36).slice(2, 10);
  SA.pad = (n) => String(n).padStart(2, '0');
  SA.dateKey = (d = new Date()) => `${d.getFullYear()}-${SA.pad(d.getMonth() + 1)}-${SA.pad(d.getDate())}`;
  SA.addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return SA.dateKey(d); };
  SA.hhmm = (d = new Date()) => `${SA.pad(d.getHours())}:${SA.pad(d.getMinutes())}`;
  SA.toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  SA.nowMin = () => SA.toMin(SA.hhmm());
  SA.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  SA.fmtDate = (key) => new Date(key + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  SA.timeAgo = (ts) => {
    const s = Math.round((Date.now() - ts) / 1000);
    if (s < 60) return 'hace un momento';
    if (s < 3600) return `hace ${Math.round(s / 60)} min`;
    if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
    return new Date(ts).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
  };
  SA.normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ---------- Datos de ejemplo ----------
  SA.CAREGIVERS = []; // se cargan del servidor (data/caregivers.txt) en caregivers.js
  SA.SKILLS = { compania: 'Compañía', compras: 'Compras', tecnologia: 'Tecnología', tramites: 'Trámites' };

  function seed() {
    const now = SA.nowMin();
    const meds = [
      { id: SA.uid(), name: 'Enalapril', dose: '10 mg · 1 comprimido', times: ['08:00', '20:00'] },
      { id: SA.uid(), name: 'Metformina', dose: '850 mg · con la comida', times: ['09:00', '14:00', '21:00'] },
      { id: SA.uid(), name: 'Vitamina D', dose: '1 cápsula', times: ['13:00'] },
    ];
    // Las dosis que ya pasaron se marcan como tomadas para que el demo empiece "limpio".
    const day = {};
    meds.forEach((m) => m.times.forEach((t) => { if (SA.toMin(t) < now - 30) day[m.id + '@' + t] = 'taken'; }));
    return {
      user: { name: SA.session.name },
      settings: { big: false, contrast: false },
      contacts: [
        { id: SA.uid(), name: 'Laura', relation: 'Hija', phone: '+34 600 111 222' },
        { id: SA.uid(), name: 'Javier', relation: 'Hijo', phone: '+34 600 333 444' },
        { id: SA.uid(), name: 'Dra. Ruiz', relation: 'Médica de cabecera', phone: '+34 910 000 000' },
      ],
      meds,
      intakes: { [SA.dateKey()]: day },
      appointments: [
        { id: SA.uid(), title: 'Revisión de tensión', date: SA.addDays(1), time: '10:30', place: 'Centro de Salud Norte', who: 'Laura' },
        { id: SA.uid(), title: 'Oftalmólogo', date: SA.addDays(6), time: '12:00', place: 'Hospital General', who: 'Javier' },
      ],
      tasks: [
        { id: SA.uid(), title: 'Recoger receta en la farmacia', who: 'Javier', done: false },
        { id: SA.uid(), title: 'Pedir cita para análisis', who: 'Laura', done: true },
        { id: SA.uid(), title: 'Rellenar el pastillero semanal', who: 'Laura', done: false },
      ],
      visits: { '0-tarde': 'Laura', '2-manana': 'Javier', '4-tarde': 'Laura', '5-manana': 'Javier' },
      alerts: [{ id: SA.uid(), ts: Date.now() - 2 * 3600e3, type: 'info', msg: 'SilverAid activado. Aquí aparecerán los avisos para la familia.' }],
      requests: [],
      chat: [],
    };
  }

  // ---------- Persistencia ----------
  // Los datos viven en la base de datos del navegador (IndexedDB, js/db.js) y se sincronizan con el servidor
  // (/api/me/state) cuando hay conexión; gana el cambio más reciente. localStorage guarda solo una copia
  // para pintar la pantalla al instante mientras se abre IndexedDB.
  const STAMP = KEY + ':ts';
  const logged = !!(window.SAAuth && SAAuth.get());

  function normalize(s) {
    if (!s || !Array.isArray(s.meds)) return null;
    // Solicitudes que quedaron "buscando" al recargar → confirmadas.
    (s.requests || []).forEach((r) => { if (r.status === 'buscando') r.status = 'confirmada'; });
    s.user = { ...(s.user || {}), name: SA.session.name };
    return s;
  }
  function load() {
    try {
      const s = normalize(JSON.parse(localStorage.getItem(KEY)));
      if (s) return s;
    } catch (e) { /* datos corruptos o almacenamiento bloqueado */ }
    return null;
  }
  const snapshot = load();
  SA.state = snapshot || seed();
  SA.updatedAt = (snapshot && Number(localStorage.getItem(STAMP))) || 0; // 0 = datos de ejemplo sin tocar

  function snapshotSave() {
    try {
      localStorage.setItem(KEY, JSON.stringify(SA.state));
      localStorage.setItem(STAMP, String(SA.updatedAt));
    } catch (e) { /* sin almacenamiento */ }
  }
  /** Sustituye los datos por otros más recientes (de IndexedDB o del servidor) y repinta. */
  function adopt(data, updatedAt) {
    const s = normalize(data);
    if (!s) return;
    SA.state = s;
    SA.updatedAt = updatedAt;
    snapshotSave();
    window.dispatchEvent(new Event('sa:state')); // p. ej. vuelve a aplicar texto grande / alto contraste
    SA.renderAll();
  }

  let syncTimer = null;
  SA.save = () => {
    SA.updatedAt = Date.now();
    snapshotSave();
    if (!logged || !window.SADB) return;
    const session = SAAuth.get();
    SADB.putState({ username: SA.session.username, data: SA.state, updatedAt: SA.updatedAt, synced: false, token: session.token })
      .then(() => {
        window.SAPWA && SAPWA.refreshPending();
        clearTimeout(syncTimer);   // agrupa los cambios seguidos en un solo envío
        syncTimer = setTimeout(() => window.SAPWA && SAPWA.requestSync(), 1500);
      })
      .catch(() => { /* IndexedDB no disponible: queda la copia de localStorage */ });
  };
  SA.reset = () => { SA.state = seed(); SA.save(); SA.renderAll(); };

  /** Al abrir: IndexedDB y luego el servidor; se queda con la versión más reciente. */
  SA.ready = (async () => {
    if (!logged || !window.SADB) return;
    const session = SAAuth.get();
    let rec = null;
    try { rec = await SADB.getState(SA.session.username); } catch (e) { return; }
    if (rec && rec.updatedAt > SA.updatedAt) adopt(rec.data, rec.updatedAt);
    else if (!rec && SA.updatedAt) {
      // Datos de versiones anteriores (solo en localStorage): pasan a IndexedDB y al servidor.
      await SADB.putState({ username: SA.session.username, data: SA.state, updatedAt: SA.updatedAt, synced: false, token: session.token });
      rec = await SADB.getState(SA.session.username);
    }
    try {
      const remote = await SAAuth.api('/api/me/state');
      const localStamp = rec ? rec.updatedAt : 0;
      if (remote.state && remote.updatedAt > localStamp && (!rec || rec.synced || remote.updatedAt > SA.updatedAt)) {
        await SADB.putState({ username: SA.session.username, data: remote.state, updatedAt: remote.updatedAt, synced: true, token: session.token });
        adopt(remote.state, remote.updatedAt);
      } else if (rec && !rec.synced) {
        window.SAPWA && SAPWA.requestSync();
      }
    } catch (e) { /* sin conexión: se trabaja con lo guardado en el dispositivo */ }
  })();

  // Otro dispositivo tenía cambios más recientes: el servidor los devolvió al sincronizar.
  window.addEventListener('sa:synced', async () => {
    if (!logged || !window.SADB) return;
    try {
      const rec = await SADB.getState(SA.session.username);
      if (rec && rec.updatedAt > SA.updatedAt) adopt(rec.data, rec.updatedAt);
    } catch (e) { /* nada */ }
  });

  // ---------- Renderizado ----------
  const renderers = [];
  SA.onRender = (fn) => renderers.push(fn);
  SA.renderAll = () => renderers.forEach((fn) => fn());

  // ---------- Avisos ----------
  SA.toast = (msg, kind = 'info', ms = 5000) => {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    document.getElementById('toasts').appendChild(el);
    setTimeout(() => el.remove(), ms);
  };

  /** Registra un aviso para la familia (simula el envío de un SMS / notificación push). */
  SA.alertFamily = (type, msg, link) => {
    SA.state.alerts.unshift({ id: SA.uid(), ts: Date.now(), type, msg, link });
    SA.state.alerts = SA.state.alerts.slice(0, 50);
    SA.save();
    SA.toast('📨 Aviso enviado a la familia: ' + msg, type === 'sos' ? 'danger' : type === 'warn' ? 'warn' : 'ok', 7000);
    SA.renderAll();
  };

  SA.renderFeed = (el, alerts) => {
    el.innerHTML = alerts.length
      ? alerts.map((a) => `<li class="${a.type}">${SA.esc(a.msg)}${a.link ? ` <a href="${SA.esc(a.link)}" target="_blank" rel="noopener">Ver ubicación</a>` : ''}<time>${SA.timeAgo(a.ts)}</time></li>`).join('')
      : '<li class="empty">No hay avisos.</li>';
  };

  // ---------- Sonido ----------
  let audioCtx;
  SA.beep = (times = 2, freq = 880) => {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      for (let i = 0; i < times; i++) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.frequency.value = freq;
        o.connect(g); g.connect(audioCtx.destination);
        const t = audioCtx.currentTime + i * 0.35;
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        o.start(t); o.stop(t + 0.3);
      }
    } catch (e) { /* sin audio */ }
  };

  SA.speak = (text) => {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = 0.92;
    speechSynthesis.speak(u);
  };

  /** Citas de hoy en adelante, de la más cercana a la más lejana. */
  SA.upcomingAppointments = () => {
    const today = SA.dateKey();
    return SA.state.appointments
      .filter((a) => a.date >= today)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  };

  SA.contactOptions = (selected) =>
    SA.state.contacts.map((c) => `<option ${c.name === selected ? 'selected' : ''}>${SA.esc(c.name)}</option>`).join('');
})();
