/* SilverAid — aplicación instalable (PWA): service worker, instalación, estado de la conexión,
   sincronización de lo guardado sin conexión y menú de la barra superior en el móvil.
   Se carga en todas las páginas. */
(function () {
  const SYNC_TAG = 'sa-sync';
  const DISMISS_KEY = 'silveraid-install-dismissed';
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let registration = null;
  let installEvent = null;

  const SAPWA = (window.SAPWA = {
    standalone,

    /** Pide enviar lo pendiente: Background Sync si existe; si no, en cuanto haya conexión. */
    async requestSync() {
      if (registration && registration.active) {
        try { if ('sync' in registration) await registration.sync.register(SYNC_TAG); } catch (e) { /* sin permiso */ }
        if (navigator.onLine) registration.active.postMessage({ type: 'SYNC' });
        return;
      }
      if (window.SADB && navigator.onLine) report(await SADB.syncAll());   // sin service worker
    },

    /** Al cerrar sesión: borra del dispositivo las respuestas de la API guardadas para esa sesión. */
    forget(token) {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_USER', token });
      }
    },

    async refreshPending() {
      if (!window.SADB) return;
      const s = window.SAAuth && SAAuth.get();
      try { pending = await SADB.pendingCount(s && s.username); } catch (e) { pending = 0; }
      renderBanner();
    },
  });

  // ------------------------------------------------------------------ avisos
  function toast(msg, kind = 'info', ms = 5000) {
    let box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts'; box.className = 'toasts'; box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), ms);
    return el;
  }

  // ------------------------------------------------------------------ estado de la conexión
  let pending = 0;
  let banner = null;
  function renderBanner() {
    if (!document.body) return;
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'net-banner';
      banner.setAttribute('role', 'status');
      document.body.prepend(banner);
    }
    const offline = !navigator.onLine;
    banner.hidden = !offline && !pending;
    banner.classList.toggle('offline', offline);
    const what = pending ? ` (${pending} ${pending === 1 ? 'cambio pendiente' : 'cambios pendientes'})` : '';
    banner.textContent = offline
      ? `📡 Sin conexión: lo que haga se guarda en este dispositivo${what}.`
      : `🔄 Enviando lo guardado sin conexión${what}…`;
    document.documentElement.classList.toggle('is-offline', offline);
  }

  function report(r) {
    if (!r) return;
    if (r.sent) toast(`✔ Se ${r.sent === 1 ? 'envió 1 cambio guardado' : `enviaron ${r.sent} cambios guardados`} sin conexión.`, 'ok');
    if (r.authErrors) toast('Hay cambios sin enviar: inicie sesión de nuevo para enviarlos.', 'warn', 8000);
    window.dispatchEvent(new CustomEvent('sa:synced', { detail: r }));
    SAPWA.refreshPending();
  }

  window.addEventListener('online', () => { renderBanner(); SAPWA.requestSync(); });
  window.addEventListener('offline', renderBanner);
  window.addEventListener('sa:queued', () => SAPWA.refreshPending());

  // ------------------------------------------------------------------ service worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        registration = await navigator.serviceWorker.register('sw.js');
      } catch (e) {
        return; // p. ej. abierto como archivo local: la aplicación sigue funcionando con conexión
      }
      const offerUpdate = (worker) => {
        if (!navigator.serviceWorker.controller) return;   // primera instalación: nada que actualizar
        const el = toast('Hay una versión nueva de SilverAid. ', 'info', 60000);
        const b = document.createElement('button');
        b.className = 'btn small'; b.textContent = 'Actualizar';
        b.onclick = () => { worker.postMessage({ type: 'SKIP_WAITING' }); el.remove(); };
        el.appendChild(b);
      };
      if (registration.waiting) offerUpdate(registration.waiting);
      registration.addEventListener('updatefound', () => {
        const w = registration.installing;
        w && w.addEventListener('statechange', () => { if (w.state === 'installed') offerUpdate(w); });
      });
      await navigator.serviceWorker.ready;
      SAPWA.requestSync();
    });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Solo recarga cuando la persona pidió actualizar (había ya una versión controlando la página).
      if (reloading || !sessionStorage.getItem('sa-updating')) return;
      reloading = true;
      sessionStorage.removeItem('sa-updating');
      location.reload();
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('.toast .btn')) sessionStorage.setItem('sa-updating', '1');
    }, true);
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'SYNCED') report(e.data.report);
    });
  }

  // ------------------------------------------------------------------ instalar la aplicación
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismissed = () => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; } };

  function installButtons() { return document.querySelectorAll('[data-install]'); }
  function showInstall(show) { installButtons().forEach((b) => { b.hidden = !show; }); }

  function addInstallUI() {
    // Botón en la barra superior (o en la cabecera de la portada) y aviso en pantallas de acceso.
    const slot = document.querySelector('.topbar .a11y, .lp-actions');
    if (slot && !slot.querySelector('[data-install]')) {
      const b = document.createElement('button');
      const landing = slot.matches('.lp-actions');
      b.type = 'button'; b.className = landing ? 'btn ghost lp-install' : 'chip';
      b.dataset.install = ''; b.hidden = true;
      if (landing) { // en la portada el texto se oculta cuando no cabe; el nombre accesible se mantiene
        b.innerHTML = '<span aria-hidden="true">📲</span> <span class="lp-install-text">Instalar</span>';
        b.setAttribute('aria-label', 'Instalar SilverAid'); b.title = 'Instalar SilverAid';
      } else b.textContent = '📲 Instalar';
      slot.prepend(b);
    }
    const card = document.querySelector('.login-wrap');
    if (card && !document.querySelector('.install-card')) {
      const box = document.createElement('aside');
      box.className = 'install-card'; box.hidden = true; box.dataset.installCard = '';
      box.innerHTML = `<img src="assets/icons/icon-192.png" alt="" width="48" height="48">
        <span><strong>Instale SilverAid</strong><small>Ábrala desde su pantalla de inicio, también sin conexión.</small></span>
        <button type="button" class="btn small" data-install>Instalar</button>
        <button type="button" class="link-btn" data-install-close aria-label="No mostrar más">✕</button>`;
      card.appendChild(box);
    }
  }

  function updateInstallUI() {
    const can = !standalone() && (installEvent || isIOS);
    showInstall(!!can);
    document.querySelectorAll('[data-install-card]').forEach((c) => { c.hidden = !can || dismissed(); });
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();                 // se ofrece con nuestro botón, no con el aviso del navegador
    installEvent = e;
    updateInstallUI();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    updateInstallUI();
    toast('✔ SilverAid quedó instalada. Ábrala desde su pantalla de inicio.', 'ok');
  });

  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-install-close]')) {
      try { localStorage.setItem(DISMISS_KEY, '1'); } catch (err) { /* sin almacenamiento */ }
      return updateInstallUI();
    }
    if (!e.target.closest('[data-install]')) return;
    if (installEvent) {
      installEvent.prompt();
      const { outcome } = await installEvent.userChoice;
      if (outcome === 'accepted') installEvent = null;
      updateInstallUI();
    } else if (isIOS) {
      toast('Para instalarla en iPhone o iPad: toque el botón Compartir ⬆️ y luego «Añadir a pantalla de inicio».', 'info', 12000);
    }
  });

  // ------------------------------------------------------------------ menú de la barra superior (móvil)
  function addMenuToggle() {
    const bar = document.querySelector('.topbar');
    const menu = bar && bar.querySelector('.a11y');
    if (!menu || bar.querySelector('.menu-toggle')) return;
    menu.id = menu.id || 'topbar-menu';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip menu-toggle';
    b.setAttribute('aria-controls', menu.id); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '☰ <span>Menú</span>';
    b.addEventListener('click', () => {
      const open = bar.classList.toggle('menu-open');
      b.setAttribute('aria-expanded', open);
    });
    menu.addEventListener('click', (e) => {
      if (e.target.closest('button, a') && !e.target.closest('#btn-big, #btn-contrast')) bar.classList.remove('menu-open');
    });
    menu.before(b);
  }

  function init() {
    document.documentElement.classList.toggle('standalone', standalone());
    addMenuToggle();
    addInstallUI();
    updateInstallUI();
    renderBanner();
    SAPWA.refreshPending();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
