/* 3. Botón de emergencia y detección de caídas */
(function () {
  const IMPACT = 25;   // m/s² — pico de aceleración que se considera impacto
  const COOLDOWN = 20000;
  let timer = null;
  let lastFall = 0;

  const $ = (id) => document.getElementById(id);

  function closeOverlay() {
    clearInterval(timer);
    timer = null;
    $('overlay').hidden = true;
  }

  function showOverlay({ title, text, count, actions }) {
    $('ov-title').textContent = title;
    $('ov-text').textContent = text;
    $('ov-count').textContent = count ?? '';
    $('ov-actions').innerHTML = '';
    actions.forEach(([label, cls, fn]) => {
      const b = document.createElement('button');
      b.className = 'btn ' + cls;
      b.textContent = label;
      b.onclick = fn;
      $('ov-actions').appendChild(b);
    });
    $('overlay').hidden = false;
    $('ov-actions').querySelector('button')?.focus();
  }

  /** Cuenta atrás con opción de cancelar; al llegar a 0 llama a onDone. */
  function countdown(opts, seconds, onDone) {
    clearInterval(timer);
    let n = seconds;
    showOverlay({ ...opts, count: n });
    SA.beep(1, 660);
    timer = setInterval(() => {
      n -= 1;
      $('ov-count').textContent = n;
      SA.beep(1, n <= 3 ? 990 : 660);
      if (n <= 0) { clearInterval(timer); onDone(); }
    }, 1000);
  }

  function getLocation() {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude.toFixed(5), lng: p.coords.longitude.toFixed(5) }),
        () => resolve(null),
        { timeout: 6000, maximumAge: 60000 }
      );
    });
  }

  async function sendSOS(reason) {
    showOverlay({ title: 'Enviando aviso…', text: 'Obteniendo su ubicación.', actions: [] });
    const loc = await getLocation();
    // Registra la llamada en la central de SilverAid (data/sos.txt), visible para el administrador.
    // Sin conexión queda en la cola del dispositivo (IndexedDB) y se envía sola al volver la conexión,
    // indicando la hora real del aviso.
    let central = 'sent';
    try {
      const sent = await SAAuth.api('/api/sos', {
        method: 'POST', queue: true, label: 'Aviso de emergencia',
        body: { reason: navigator.onLine ? reason : `${reason} · pedido sin conexión a las ${SA.hhmm()}`, lat: loc?.lat, lng: loc?.lng },
      });
      if (sent.queued) central = 'queued';
    } catch (err) {
      central = 'failed';
    }
    const names = SA.state.contacts.map((c) => c.name).join(', ') || 'ningún contacto (añada uno en Familia)';
    const link = loc ? `https://www.google.com/maps?q=${loc.lat},${loc.lng}` : null;
    SA.alertFamily('sos', `🆘 ${SA.state.user.name} necesita ayuda (${reason}). ${loc ? 'Ubicación adjunta.' : 'Ubicación no disponible.'}`, link);
    SA.beep(3, 990);
    showOverlay({
      title: '✅ Aviso enviado',
      text: {
        sent: `Se ha avisado a la central de SilverAid y a: ${names}. Mantenga la calma, la ayuda está en camino.`,
        queued: `No hay conexión: el aviso a la central de SilverAid quedó guardado y se enviará en cuanto vuelva la conexión. Si es grave, llame al 112 o pida ayuda a alguien cerca.`,
        failed: `No se pudo contactar con la central de SilverAid. Se avisó a: ${names}. Si es grave, llame al 112.`,
      }[central],
      actions: [['Cerrar', 'ghost', closeOverlay]],
    });
  }

  SA.startSOS = (reason = 'botón de emergencia') => {
    countdown({
      title: '🆘 Enviando aviso de emergencia',
      text: 'Se avisará a su familia con su ubicación en:',
      actions: [
        ['Enviar ya', 'danger', () => { clearInterval(timer); sendSOS(reason); }],
        ['Cancelar', 'ghost', () => { closeOverlay(); SA.toast('Aviso cancelado.', 'info'); }],
      ],
    }, 5, () => sendSOS(reason));
  };

  function onFall() {
    if (Date.now() - lastFall < COOLDOWN || timer) return;
    lastFall = Date.now();
    countdown({
      title: '¿Se encuentra bien?',
      text: 'Hemos detectado una posible caída. Si no responde, avisaremos a su familia.',
      actions: [
        ['Estoy bien', 'ok', () => { closeOverlay(); SA.toast('Nos alegra que esté bien.', 'ok'); }],
        ['Necesito ayuda', 'danger', () => { clearInterval(timer); sendSOS('posible caída detectada'); }],
      ],
    }, 15, () => sendSOS('posible caída sin respuesta'));
  }

  function onMotion(e) {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a || a.x == null) return;
    const g = Math.sqrt(a.x ** 2 + a.y ** 2 + a.z ** 2);
    if (g > IMPACT) onFall();
  }

  async function setFallDetection(on) {
    const status = $('fall-status');
    if (!on) {
      window.removeEventListener('devicemotion', onMotion);
      status.textContent = 'Desactivada.';
      return;
    }
    if (!('DeviceMotionEvent' in window)) {
      status.textContent = 'Este dispositivo no tiene sensor de movimiento. Use «Simular una caída».';
      return;
    }
    // iOS exige pedir permiso explícito
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        if ((await DeviceMotionEvent.requestPermission()) !== 'granted') {
          $('fall-toggle').checked = false;
          status.textContent = 'Permiso denegado.';
          return;
        }
      } catch (err) { /* se ignora */ }
    }
    window.addEventListener('devicemotion', onMotion);
    status.textContent = 'Activada: si el teléfono detecta un golpe fuerte, preguntará si está bien.';
  }

  function render() {
    $('sos-contacts').innerHTML = SA.state.contacts.length
      ? SA.state.contacts.map((c) => `<li><span><span class="title">${SA.esc(c.name)}</span><span class="sub">${SA.esc(c.relation)}</span></span><span>${SA.esc(c.phone)}</span></li>`).join('')
      : '<li class="empty">No hay contactos. Añádalos en la sección Familia.</li>';
  }
  SA.onRender(render);

  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="sos"]')) SA.startSOS();
    });
    $('btn-sim-fall').addEventListener('click', onFall);
    $('fall-toggle').addEventListener('change', (e) => setFallDetection(e.target.checked));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('overlay').hidden && timer) { closeOverlay(); SA.toast('Aviso cancelado.', 'info'); }
    });
  });
})();
