/* SilverAid — estado compartido, utilidades y datos de ejemplo. */
(function () {
  const SA = (window.SA = {});
  const KEY = 'silveraid-demo-v1';

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
  SA.VOLUNTEERS = [
    { id: 'v1', name: 'Lucía Martín', age: 24, skills: ['compania', 'tecnologia'], km: 0.8, rating: 4.9, bio: 'Estudiante de Enfermería. Le encanta pasear y charlar.' },
    { id: 'v2', name: 'Andrés Gil', age: 31, skills: ['compras', 'tramites'], km: 1.2, rating: 4.7, bio: 'Tiene coche y horario flexible por las mañanas.' },
    { id: 'v3', name: 'Sara López', age: 19, skills: ['tecnologia', 'compania'], km: 2.1, rating: 4.8, bio: 'Ayuda con WhatsApp, videollamadas y el banco online.' },
    { id: 'v4', name: 'Pedro Sánchez', age: 67, skills: ['compania', 'tramites'], km: 0.5, rating: 5.0, bio: 'Jubilado, exfuncionario. Conoce bien los trámites.' },
    { id: 'v5', name: 'Nerea Ortiz', age: 27, skills: ['compras', 'compania'], km: 1.7, rating: 4.6, bio: 'Vive en el barrio. Puede hacer la compra semanal.' },
  ];
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
      user: { name: 'Carmen' },
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
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.meds)) {
        // Solicitudes que quedaron "buscando" al recargar → confirmadas.
        s.requests.forEach((r) => { if (r.status === 'buscando') r.status = 'confirmada'; });
        return s;
      }
    } catch (e) { /* datos corruptos o almacenamiento bloqueado */ }
    return seed();
  }
  SA.state = load();
  SA.save = () => { try { localStorage.setItem(KEY, JSON.stringify(SA.state)); } catch (e) { /* sin almacenamiento */ } };
  SA.reset = () => { SA.state = seed(); SA.save(); SA.renderAll(); };

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

  SA.contactOptions = (selected) =>
    SA.state.contacts.map((c) => `<option ${c.name === selected ? 'selected' : ''}>${SA.esc(c.name)}</option>`).join('');
})();
