# SilverAid

Demo de una aplicación web para ayudar a personas mayores y a sus familias.
Interfaz en español, letra grande, botones amplios y modo de alto contraste.

## Funcionalidades

| # | Módulo | Qué hace |
|---|--------|----------|
| 1 | 💊 **Medicamentos** | Lista de tomas del día, aviso sonoro y notificación a la hora de cada dosis, botón «Ya la tomé». Si una dosis pasa 30 min sin confirmarse, se avisa automáticamente a la familia. |
| 2 | 👨‍👩‍👧 **Panel de la familia** | Avisos recibidos, citas médicas con acompañante, tareas repartidas entre cuidadores, turnos de visita semanales y contactos. |
| 3 | 🆘 **Emergencia** | Botón SOS con cuenta atrás cancelable que envía la ubicación a los contactos. Detección de caídas con el acelerómetro del móvil (o botón «Simular una caída»). |
| 4 | 💬 **Asistente** | Chat por texto o voz (dictado y lectura en voz alta): hora, fecha, medicamentos pendientes, próxima cita, recetas, chistes, contactos, leer textos y pedir ayuda. |
| 5 | 🤝 **Voluntarios** | Pedir compañía, compras, ayuda con tecnología o trámites; asignación automática del voluntario más adecuado y libre. |

Los módulos están conectados: una dosis olvidada, un SOS o una visita de voluntario generan avisos en el panel de la familia y en la pantalla de inicio.

## Cómo ejecutarlo

No necesita instalar nada. Abra `index.html` en el navegador.

Para que funcionen la ubicación, el micrófono y las notificaciones, es mejor servirlo en `localhost`:

```bash
python -m http.server 8000
# y abra http://localhost:8000
```

## Notas del demo

- Los datos se guardan en el navegador (`localStorage`). El botón **↺ Reiniciar demo** restaura los datos de ejemplo.
- Los avisos a la familia son simulados (aparecen en el panel); en producción se enviarían por SMS o notificación push.
- El asistente usa reglas locales; en producción se conectaría a un modelo de lenguaje.
- Los voluntarios son ficticios.

## Estructura

```
index.html
css/styles.css
js/store.js        estado, persistencia y utilidades
js/meds.js         1. medicamentos
js/family.js       2. panel de la familia
js/sos.js          3. emergencia y caídas
js/assistant.js    4. asistente
js/volunteers.js   5. voluntarios
js/main.js         navegación, inicio y accesibilidad
```
