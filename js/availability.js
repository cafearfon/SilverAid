/* Disponibilidad semanal de los cuidadores: matriz días × horas.
   Formato: { lun: [8, 9, 10], mar: [...], ... } — cada número es la hora de inicio de una franja de 1 h. */
(function () {
  const DAYS = [
    ['lun', 'Lun', 'Lunes'], ['mar', 'Mar', 'Martes'], ['mie', 'Mié', 'Miércoles'], ['jue', 'Jue', 'Jueves'],
    ['vie', 'Vie', 'Viernes'], ['sab', 'Sáb', 'Sábado'], ['dom', 'Dom', 'Domingo'],
  ];
  const HOURS = [];
  for (let h = 6; h <= 21; h++) HOURS.push(h); // franjas de 06:00 a 22:00

  const pad = (n) => String(n).padStart(2, '0');

  /** [8,9,10,14] → ["08–11", "14–15"] */
  function ranges(hours) {
    const sorted = [...new Set(hours)].sort((a, b) => a - b);
    const out = [];
    sorted.forEach((h) => {
      const last = out[out.length - 1];
      if (last && last[1] === h) last[1] = h + 1; else out.push([h, h + 1]);
    });
    return out.map(([a, b]) => `${pad(a)}–${pad(b)}`);
  }

  /** Resumen legible: "Lun–Vie 08–12 h · Sáb 09–13 h" (agrupa días seguidos con el mismo horario). */
  function summary(av) {
    if (!av) return '';
    const parts = [];
    let group = null;
    DAYS.forEach(([key, short], i) => {
      const r = ranges(av[key] || []).join(', ');
      if (group && r && group.r === r && group.to === i - 1) { group.to = i; return; }
      if (group) parts.push(group);
      group = r ? { from: i, to: i, r } : null;
    });
    if (group) parts.push(group);
    return parts.map((g) => `${DAYS[g.from][1]}${g.to > g.from ? '–' + DAYS[g.to][1] : ''} ${g.r} h`).join(' · ');
  }

  const total = (av) => DAYS.reduce((n, [k]) => n + ((av && av[k]) || []).length, 0);

  /** ¿Está disponible el día (AAAA-MM-DD) y la hora (HH:MM) indicados? */
  function isAvailable(av, dateStr, timeStr) {
    if (!av || !total(av)) return false;
    const day = DAYS[(new Date(dateStr + 'T00:00').getDay() + 6) % 7][0];
    return (av[day] || []).includes(parseInt(timeStr, 10));
  }

  /** Editor: dibuja la matriz en `container`. Clic o arrastre para marcar; clic en un día u hora marca toda la columna o fila. */
  function editor(container, onChange = () => {}) {
    container.innerHTML = `
      <table class="avail-grid">
        <thead><tr><th scope="col"><span class="sr-only">Hora</span></th>${DAYS.map(([k, s, l]) =>
          `<th scope="col"><button type="button" data-col="${k}" title="Marcar o desmarcar todo el ${l.toLowerCase()}">${s}</button></th>`).join('')}</tr></thead>
        <tbody>${HOURS.map((h) => `<tr>
          <th scope="row"><button type="button" data-row="${h}" title="Marcar o desmarcar esta hora todos los días">${pad(h)}:00</button></th>
          ${DAYS.map(([k, , l]) => `<td><button type="button" class="slot" data-slot="${k}-${h}" aria-pressed="false" aria-label="${l} de ${pad(h)}:00 a ${pad(h + 1)}:00"></button></td>`).join('')}
        </tr>`).join('')}</tbody>
      </table>`;

    const slots = () => [...container.querySelectorAll('[data-slot]')];
    const on = (el) => el.getAttribute('aria-pressed') === 'true';
    const set = (el, value) => el.setAttribute('aria-pressed', String(value));
    const toggleAll = (els) => { const value = !els.every(on); els.forEach((el) => set(el, value)); onChange(); };

    // Arrastre con ratón o dedo: el primer clic decide si se marca o se desmarca.
    let painting = null;
    container.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('[data-slot]');
      if (!el) return;
      e.preventDefault();
      painting = !on(el);
      set(el, painting);
      onChange();
    });
    container.addEventListener('pointermove', (e) => {
      if (painting === null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-slot]');
      if (el && container.contains(el) && on(el) !== painting) { set(el, painting); onChange(); }
    });
    document.addEventListener('pointerup', () => { painting = null; });
    document.addEventListener('pointercancel', () => { painting = null; });

    container.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.slot && e.detail === 0) { set(b, !on(b)); onChange(); } // teclado (Enter/Espacio)
      if (b.dataset.col) toggleAll(slots().filter((s) => s.dataset.slot.startsWith(b.dataset.col + '-')));
      if (b.dataset.row) toggleAll(slots().filter((s) => s.dataset.slot.endsWith('-' + b.dataset.row)));
    });

    return {
      get() {
        const av = {};
        slots().filter(on).forEach((el) => {
          const [day, h] = el.dataset.slot.split('-');
          (av[day] = av[day] || []).push(Number(h));
        });
        return av;
      },
      set(av = {}) {
        slots().forEach((el) => {
          const [day, h] = el.dataset.slot.split('-');
          set(el, (av[day] || []).includes(Number(h)));
        });
        onChange();
      },
    };
  }

  window.SAAvail = { DAYS, HOURS, summary, total, isAvailable, editor };
})();
