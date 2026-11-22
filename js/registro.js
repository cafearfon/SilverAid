/* Registro por pasos (registro-familiar/cuidador/colaborador.html): navegación entre pasos, validación,
   archivos PDF y envío. Cada página describe sus pasos con SAReg.init({ steps, body }). */
(function () {
  const PHONE = /^[0-9+()\-\s]{7,20}$/;
  const EMAIL = /^[^@\s;]+@[^@\s;]+\.[^@\s;]+$/;
  const USERNAME = /^[A-Za-z0-9_.-]{3,30}$/;
  const PDF_KB = 300;

  /** Mismas reglas que el servidor: CC y CE solo dígitos; pasaporte y PPT letras y números. */
  function docOk(type, value) {
    const v = value.replace(/[.\s]/g, '');
    return ['CC', 'CE'].includes(type) ? /^[0-9]{4,12}$/.test(v) : /^[A-Za-z0-9]{4,20}$/.test(v);
  }

  /** Problema de un PDF elegido (no PDF o demasiado grande), o '' si está bien. Sin archivo → ''. */
  function fileProblem(file, what, kb = PDF_KB) {
    if (!file) return '';
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return `El archivo con ${what} debe ser un PDF.`;
    if (file.size > kb * 1024) return `El PDF con ${what} pesa ${Math.ceil(file.size / 1024)} KB; el máximo es ${kb} KB.`;
    return '';
  }

  /** Contenido del archivo en base64 (sin el prefijo «data:…;base64,»). */
  const fileBase64 = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error(`No se pudo leer el archivo «${file.name}».`));
    r.readAsDataURL(file);
  });
  const pdfPayload = async (file) => ({ name: file.name, data: await fileBase64(file) });

  /** Lista de títulos: una fila por PDF, «➕ Agregar título» añade otra (hasta max) y «✕ Quitar» la elimina. */
  function titleList(list, addBtn, max = 5) {
    const inputs = () => [...list.querySelectorAll('input[type="file"]')];
    function renumber() {
      list.querySelectorAll('.title-row').forEach((row, i) => {
        row.querySelector('.title-name').textContent = `Título ${i + 1}`;
        row.querySelector('[data-remove-title]').setAttribute('aria-label', `Quitar título ${i + 1}`);
      });
      addBtn.disabled = inputs().length >= max;
      addBtn.textContent = addBtn.disabled ? `Máximo ${max} títulos` : '➕ Agregar título';
    }
    function add(focus) {
      if (inputs().length >= max) return;
      const row = document.createElement('div');
      row.className = 'title-row';
      row.innerHTML = `<label class="file-field"><span class="title-name"></span>
          <input type="file" accept="application/pdf,.pdf"></label>
        <button type="button" class="btn ghost small" data-remove-title>✕ Quitar</button>`;
      list.appendChild(row);
      renumber();
      if (focus) row.querySelector('input').focus();
    }
    addBtn.addEventListener('click', () => add(true));
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove-title]');
      if (!btn) return;
      btn.closest('.title-row').remove();
      if (!inputs().length) add(false); // siempre queda una fila
      renumber();
    });
    add(false);
    return {
      /** Títulos con archivo: [{ input, file, n }]. Las filas vacías no cuentan. */
      chosen: () => inputs().map((input, i) => ({ input, file: input.files[0], n: i + 1 })).filter((t) => t.file),
      problem() {
        for (const t of this.chosen()) {
          const msg = fileProblem(t.file, `el título ${t.n}`);
          if (msg) return { field: t.input, msg };
        }
        return null;
      },
    };
  }

  /**
   * Arranca el asistente.
   *   steps: una función por <section class="step"> que devuelve el primer problema { field, msg } o null
   *          (field: nombre del campo o el propio elemento).
   *   body:  async () => datos para /api/register (sin usuario ni contraseña, que añade este módulo).
   */
  function init({ role, steps, body, onShow }) {
    const form = document.getElementById('reg-form');
    const sections = [...form.querySelectorAll('.step')];
    const bar = document.getElementById('steps');
    const error = form.querySelector('.form-error');
    const prev = form.querySelector('[data-prev]');
    const next = form.querySelector('[data-next]');
    let current = 0;

    bar.innerHTML = sections.map((s, i) => `<li data-i="${i}"><span class="step-num">${i + 1}</span><span class="step-name">${s.dataset.title}</span></li>`).join('');

    const showError = (msg) => { error.textContent = msg || ''; error.hidden = !msg; };

    function show(i) {
      current = i;
      sections.forEach((s, k) => { s.hidden = k !== i; });
      bar.querySelectorAll('li').forEach((li, k) => {
        li.classList.toggle('done', k < i);
        li.classList.toggle('current', k === i);
        if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      prev.hidden = i === 0;
      next.textContent = i === sections.length - 1 ? 'Crear cuenta' : 'Siguiente →';
      showError('');
      onShow?.(i);
      document.getElementById('step-label').textContent = `Paso ${i + 1} de ${sections.length}: ${sections[i].dataset.title}`;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      sections[i].querySelector('input:not([type="radio"]):not([type="checkbox"]):not([type="file"]), select')?.focus({ preventScroll: true });
    }

    function fail({ field, msg }) {
      const el = typeof field === 'string' ? form.elements[field] : field;
      const target = el && (el.focus ? el : el[0]);
      target?.focus();
      showError(msg);
    }

    /** Paso de acceso (último de todas las páginas): usuario y contraseña. */
    function accessProblem() {
      const f = form.elements;
      if (!USERNAME.test(f.username.value.trim())) return { field: 'username', msg: 'El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo.' };
      if (f.password.value.length < 4) return { field: 'password', msg: 'La contraseña debe tener al menos 4 caracteres.' };
      if (f.password.value !== f.password2.value) return { field: 'password2', msg: 'Las contraseñas no coinciden.' };
      return null;
    }

    prev.addEventListener('click', () => show(current - 1));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const last = current === sections.length - 1;
      const problem = last ? accessProblem() : steps[current]();
      if (problem) return fail(problem);
      if (!last) return show(current + 1);

      // Antes de enviar se revisan otra vez todos los pasos (por si se cambió algo al volver atrás).
      for (let i = 0; i < steps.length; i++) {
        const p = steps[i]();
        if (p) { show(i); return fail(p); }
      }
      next.disabled = true;
      next.textContent = 'Creando cuenta…';
      try {
        const data = { ...(await body()), role, username: form.elements.username.value.trim(), password: form.elements.password.value };
        await SAAuth.api('/api/register', { method: 'POST', body: data });
        const login = await SAAuth.api('/api/login', { method: 'POST', body: { username: data.username, password: data.password } });
        SAAuth.set({ token: login.token, username: login.user.username, name: login.user.name, role: login.user.role, status: login.user.status });
        location.replace(SAAuth.home(login.user.role, login.user.status));
      } catch (err) {
        showError(err.message);
        next.disabled = false;
        next.textContent = 'Crear cuenta';
      }
    });

    document.querySelectorAll('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
      const input = b.previousElementSibling;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      b.textContent = visible ? 'Ver' : 'Ocultar';
      b.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
    }));

    show(0);
    return { show };
  }

  window.SAReg = { init, docOk, fileProblem, pdfPayload, titleList, PHONE, EMAIL };
})();
