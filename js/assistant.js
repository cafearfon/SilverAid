/* 4. Asistente por chat y voz.
   En este demo las respuestas se generan con reglas locales; en una versión real
   se conectaría a un modelo de lenguaje (por ejemplo, la API de Claude). */
(function () {
  const $ = (id) => document.getElementById(id);

  const RECIPES = [
    'Crema de calabacín (2 personas):\n1. Trocee 2 calabacines, 1 patata y media cebolla.\n2. Cuézalos 20 minutos en agua con sal.\n3. Tritúrelo todo con un chorrito de aceite de oliva.\n¡Fácil, suave y ligera!',
    'Tortilla francesa con espinacas:\n1. Saltee un puñado de espinacas 2 minutos.\n2. Bata 2 huevos con una pizca de sal.\n3. Viértalos en la sartén con las espinacas y doble la tortilla al cuajar.',
    'Merluza al horno:\n1. Ponga un filete de merluza sobre rodajas de patata cocida.\n2. Añada ajo picado, perejil y un chorrito de aceite.\n3. Hornee 15 minutos a 180 °C.',
  ];
  const JOKES = [
    '—Doctor, doctor, tengo complejo de feo.\n—Pues no es complejo, es sencillo. 😄',
    '¿Qué le dice una iguana a su hermana gemela?\n¡Somos iguanitas! 🦎',
    '—¿Cuál es el colmo de un jardinero?\n—Que su novia se llame Rosa y lo deje plantado. 🌹',
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /** Devuelve { text, actions?, speakText? } */
  function reply(input) {
    const q = SA.normalize(input);
    const s = SA.state;

    const read = input.match(/^\s*(?:lee|leer|leeme|léeme)\s*:?\s*(.+)$/i);
    if (read) return { text: '📖 Leyendo en voz alta:\n«' + read[1] + '»', speakText: read[1], forceSpeak: true };

    if (/\b(ayuda|socorro|emergencia|me he caido|me caido|me duele|mareo|mareada|mareado)\b/.test(q))
      return { text: 'Si necesita ayuda urgente, puedo avisar ahora mismo a su familia con su ubicación. Si es grave, llame al 112.', actions: [['🆘 Avisar a mi familia', 'sos']] };

    if (/\b(hola|buenos dias|buenas tardes|buenas noches|buenas)\b/.test(q))
      return { text: `¡Hola, ${s.user.name}! ¿En qué puedo ayudarle hoy?` };

    if (/\bhora\b/.test(q) && !/\bcita\b/.test(q))
      return { text: `Son las ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.` };

    if (/\b(fecha|que dia|dia es hoy|dia estamos)\b/.test(q))
      return { text: `Hoy es ${SA.fmtDate(SA.dateKey())} de ${new Date().getFullYear()}.` };

    if (/(medic|pastill|dosis|tomar|tome)/.test(q)) {
      const left = SA.doses().filter((d) => d.status !== 'taken');
      if (!left.length) return { text: '¡Enhorabuena! Ya ha tomado todas sus medicinas de hoy. 👏' };
      return {
        text: 'Le quedan estas tomas hoy:\n' + left.map((d) => `• ${d.time} — ${d.med.name} (${d.med.dose})`).join('\n'),
        actions: [['💊 Ver medicamentos', 'view:meds']],
      };
    }

    if (/(cita|medico|medica|doctor|doctora|consulta|hospital)/.test(q)) {
      const a = SA.upcomingAppointments()[0];
      if (!a) return { text: 'No tiene citas próximas apuntadas.' };
      return {
        text: `Su próxima cita es «${a.title}» el ${SA.fmtDate(a.date)} a las ${a.time}${a.place ? ', en ' + a.place : ''}.${a.who ? ` Le acompañará ${a.who}.` : ''}`,
        actions: [['📅 Ver todas las citas', 'view:family']],
      };
    }

    if (/(receta|cocinar|cocina|comida|cenar|comer)/.test(q)) return { text: pick(RECIPES) };

    if (/(chiste|reir|gracioso)/.test(q)) return { text: pick(JOKES) };

    if (/(llamar|telefono|familia|hija|hijo|nieto|nieta)/.test(q)) {
      if (!s.contacts.length) return { text: 'Todavía no hay contactos guardados.', actions: [['📇 Añadir contactos', 'view:family']] };
      return { text: 'Estos son sus contactos:\n' + s.contacts.map((c) => `• ${c.name} (${c.relation}): ${c.phone}`).join('\n') };
    }

    if (/(cuidador|cuidadora|compania|compra|acompan|sola|solo|aburr)/.test(q))
      return { text: 'Puedo buscarle un cuidador cerca de usted para hacerle compañía, ayudarle con la compra, con el móvil o con trámites.', actions: [['🧑‍⚕️ Pedir un cuidador', 'view:caregivers']] };

    if (/(gracias)/.test(q)) return { text: '¡De nada! Estoy aquí para lo que necesite. 😊' };

    if (/(tiempo|clima|lluvia|llover)/.test(q))
      return { text: 'En este demo no tengo conexión con el servicio del tiempo. En la versión completa podré decirle si va a llover. ☂️' };

    return {
      text: 'Perdone, no le he entendido bien. Puedo ayudarle con:\n• La hora y la fecha\n• Sus medicamentos y citas\n• Recetas fáciles y chistes\n• Llamar a su familia o pedir un cuidador\n• Leer un texto en voz alta (escriba «Lee: …»)\n• Pedir ayuda urgente',
    };
  }

  function renderChat() {
    const chat = $('chat');
    chat.innerHTML = SA.state.chat.map((m) => `
      <div class="msg ${m.from}">${SA.esc(m.text)}${m.actions?.length ? `<div class="msg-actions">${m.actions.map(([label, act]) => `<button class="btn small" data-act="${SA.esc(act)}">${SA.esc(label)}</button>`).join('')}</div>` : ''}</div>`).join('');
    chat.scrollTop = chat.scrollHeight;
  }

  function send(text) {
    text = text.trim();
    if (!text) return;
    SA.state.chat.push({ from: 'user', text });
    const r = reply(text);
    SA.state.chat.push({ from: 'bot', text: r.text, actions: r.actions });
    SA.state.chat = SA.state.chat.slice(-40);
    SA.save();
    renderChat();
    if ($('tts-toggle').checked || r.forceSpeak) SA.speak(r.speakText || r.text);
  }

  function setupMic() {
    const btn = $('btn-mic');
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) {
      btn.disabled = true;
      btn.title = 'Su navegador no permite el dictado por voz (pruebe con Chrome o Edge).';
      return;
    }
    const rec = new Rec();
    rec.lang = 'es-ES';
    rec.interimResults = false;
    let listening = false;
    rec.onresult = (e) => send(e.results[0][0].transcript);
    rec.onend = () => { listening = false; btn.classList.remove('listening'); };
    rec.onerror = (e) => SA.toast(e.error === 'not-allowed' ? 'Permita el uso del micrófono para hablar.' : 'No se pudo escuchar. Inténtelo de nuevo.', 'warn');
    btn.addEventListener('click', () => {
      if (listening) return rec.stop();
      listening = true;
      btn.classList.add('listening');
      rec.start();
    });
  }

  function greet() {
    if (!SA.state.chat.length) {
      SA.state.chat.push({ from: 'bot', text: `¡Hola, ${SA.state.user.name}! Soy su asistente. Puede escribirme o pulsar 🎤 para hablar.` });
    }
    renderChat();
  }

  document.addEventListener('DOMContentLoaded', () => {
    greet();
    setupMic();

    $('form-chat').addEventListener('submit', (e) => {
      e.preventDefault();
      send($('chat-input').value);
      $('chat-input').value = '';
    });
    $('suggestions').addEventListener('click', (e) => { if (e.target.dataset.say) send(e.target.dataset.say); });
    $('chat').addEventListener('click', (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === 'sos') SA.startSOS('solicitado desde el asistente');
      else if (act.startsWith('view:')) SA.showView(act.slice(5));
    });
  });

  SA.resetChat = greet;
})();
