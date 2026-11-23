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
| 5 | 🧑‍⚕️ **Cuidadores** | Pedir compañía, compras, ayuda con tecnología o trámites; asignación automática del cuidador más adecuado y libre. |

Los módulos están conectados: una dosis olvidada, un SOS o una visita de un cuidador generan avisos en el panel de la familia y en la pantalla de inicio.

## Aplicación instalable y sin conexión (PWA)

SilverAid se puede **instalar** en el móvil o en el escritorio y **funciona sin conexión**.

- **Instalar:** botón «📲 Instalar» en la barra superior, en la portada y en las pantallas de acceso (Chrome, Edge y Android).
  En iPhone/iPad: Compartir → «Añadir a pantalla de inicio» (el botón lo explica). Manifiesto en `manifest.webmanifest`,
  íconos en `assets/icons/` (normales, *maskable* para Android y `apple-touch-icon`). La app instalada abre en
  `login.html`, que entra directamente si hay sesión; tiene accesos directos a *Emergencia* y *Medicamentos*.
- **Service worker** (`sw.js`), estrategias de caché:

  | Qué | Estrategia |
  |-----|------------|
  | Páginas | Red primero (máx. 4 s) → copia guardada → `offline.html` si nunca se abrió |
  | `css/`, `js/`, `assets/` | *Stale-while-revalidate*: responde al instante con la copia y la actualiza en segundo plano |
  | Fuentes de Google | Caché primero |
  | `GET /api/…` | Red primero → última respuesta guardada, **separada por usuario** (se borra al cerrar sesión); la página indica «📡 Sin conexión: última lista guardada» |
  | `POST/PUT/DELETE /api/…` | Siempre a la red; sin conexión, las que lo permiten (el aviso SOS) quedan en cola |

  Al instalarse guarda todas las páginas, estilos, scripts e íconos. Cuando hay una versión nueva avisa con «Actualizar».
  Al publicar cambios, suba `VERSION` en `sw.js` y el `?v=` de los HTML.
- **Base de datos del navegador** (IndexedDB, `js/db.js`), usada por las páginas y por el service worker:
  - `state`: los datos de la aplicación de cada usuario (medicamentos, citas, contactos, tareas…). Cada cambio se guarda
    al momento en el dispositivo y se sincroniza con el servidor (`GET/PUT /api/me/state`, archivo `data/states.txt`),
    así se ven también en otro dispositivo. Si hay cambios en los dos, **gana el más reciente**.
  - `outbox`: peticiones hechas sin conexión. Un **aviso de emergencia sin conexión** queda en la cola, se le dice a la
    persona que llame al 112 si es grave, y se envía solo al volver la conexión indicando la hora real del aviso.
  - La sincronización usa **Background Sync** (se envía aunque se haya cerrado la página) y, en navegadores sin él,
    el evento `online`. Si la sesión caducó, lo pendiente espera a que la persona vuelva a iniciar sesión.
- Sin conexión aparece una franja «📡 Sin conexión: lo que haga se guarda en este dispositivo (N cambios pendientes)».
  Registrarse, iniciar sesión, subir documentos o registrar a un familiar necesitan conexión, y lo avisan.
- **Móvil:** en pantallas estrechas las opciones de la barra superior van en un menú «☰», las secciones de la aplicación
  pasan a una barra de navegación fija abajo y se respetan las zonas seguras (*notch*) de la app instalada.

El service worker necesita `http://localhost` o HTTPS: para instalarla en un teléfono, publique SilverAid con HTTPS.

## Cómo ejecutarlo

Necesita Python 3 (sin librerías adicionales):

```bash
python server.py          # o: python server.py 8080
# y abra http://localhost:8000
```

Se abre la **landing page** de SilverAid (`index.html`); desde ahí, «Iniciar sesión» o «Crear cuenta».
Usuario administrador por defecto: **admin / admin**.

## Páginas

| Página | Para qué |
|--------|----------|
| `index.html` | Landing page pública: presentación, funciones, roles, cómo funciona y seguridad. Funciona también en GitHub Pages. |
| `login.html` | Inicio de sesión y «Crear cuenta», donde se elige el tipo de cuenta (`login.html#registro`). Los enlaces antiguos `#registro-cliente`, `#registro-cuidador` y `#registro-colaborador` redirigen a la página de registro de ese rol. |
| `registro-familiar.html`, `registro-cuidador.html`, `registro-colaborador.html` | Registro por pasos de cada rol, con barra de progreso; cada paso se valida antes de avanzar. Lógica común en `js/registro.js`. |
| `documentos.html` | «Mis documentos» del cuidador y del colaborador: lista de documentos obligatorios (✔/✖), subir o reemplazar cada PDF y, el cuidador, agregar o quitar títulos. |
| `app.html` | La aplicación (requiere sesión). |
| `admin.html` | Administración (solo admin). |
| `offline.html` | Se muestra sin conexión cuando la página pedida todavía no está guardada en el dispositivo. |

## Usuarios e inicio de sesión

- `server.py` sirve la aplicación y guarda los usuarios en `data/users.txt` (se crea solo, con `admin;admin;Administrador;admin`).
- Formato del archivo, una línea por usuario: `usuario;contraseña;nombre;rol`.
- Roles:

  | Código | Quién es |
  |--------|----------|
  | `usuario` | Adulto mayor |
  | `cliente` | Cliente: contrata SilverAid y registra al adulto mayor (uno por adulto mayor) |
  | `familiar` | Familiar responsable: acompaña a un adulto mayor desde su cuenta (puede haber varios) |
  | `cuidador` | Cuidador/a |
  | `colaborador` | Colaborador/a: acompañamiento a trámites y citas, solicitar y llevar medicamentos, conductor, entre otros |
  | `admin` | Administrador |

- Desde «Crear una cuenta» se elige el tipo de cuenta y se pasa al registro por pasos de ese rol:
  - **Adulto mayor** (`registro-familiar.html?para=mi`), 3 pasos: el formulario del cliente en modo «me registro yo mismo». La persona es su propio cliente: se crean su cuenta de *cliente* y una de *usuario* con sus mismos datos (solo se pide además el tipo de sangre), enlazada a ella. Como adulto mayor entra con su número de documento y la misma contraseña, cuando el administrador active esa cuenta. Por eso su nombre de usuario no puede ser su número de documento.
  - **Cliente** (*cliente*, `registro-familiar.html`), 3 pasos: sus datos (nombre, documento, dirección, celular, correo), los del adulto mayor y el acceso. Su cuenta queda activa; la del adulto mayor, pendiente de alta. Si el adulto mayor ya está registrado (mismo documento), no se deja registrarlo otra vez.
  - **Familiar responsable** (*familiar*, `registro-familiar.html?para=familiar`), 3 pasos: sus datos, su parentesco y el **documento del adulto mayor** (ya registrado), y el acceso. Su cuenta queda activa y su **solicitud para unirse** queda pendiente hasta que la apruebe el cliente del adulto mayor o el administrador.
  - **Cuidador/a** (*cuidador*), 4 pasos: datos personales; formación (nivel de escolaridad y hasta 5 títulos en PDF, opcionales); documentos (RUT ante la DIAN, certificados de afiliación a salud, pensión y ARL como independiente y certificado del RETHUS); acceso.
  - **Colaborador/a** (*colaborador*), 4 pasos: datos personales con documento de identidad; perfil (escolaridad, pase de conducción —carro, moto o ambos, con su categoría A1–C3— y afiliación a seguridad social como independiente); documentos (documento de identidad y, según las respuestas, pase y certificados de salud, pensión y ARL); acceso.
  - Todos los documentos son PDF de máximo 300 KB, revisados en el navegador y en el servidor. **Al registrarse son opcionales**: cuidador y colaborador quedan **en verificación**, pueden entrar solo a «Mis documentos» (`documentos.html`) para subir los que falten, y el administrador los activa cuando están completos (el servidor no deja activar a nadie con documentos obligatorios pendientes).
  - Los **adultos mayores** (*usuario*) los registra su cliente o el administrador, o se registran a sí mismos. Nunca se crean *admin* desde el registro.
- **Cliente y familiares responsables son roles distintos.** Cada adulto mayor tiene **un cliente** (`users.cliente`: quien lo registró o el que asigne el administrador), que contrata los servicios y recibe el catálogo, y puede tener **varios familiares responsables** (rol *familiar*), que no son clientes:
  - El cliente, en *Familia → Mis adultos mayores*, añade familiares por su número de documento (deben tener cuenta de familiar), aprueba o rechaza solicitudes y quita familiares. Los familiares ven en esa misma sección al adulto mayor, a su cliente y a los demás familiares, y pueden salir de la familia; no registran adultos mayores.
  - El administrador lo gestiona en la pestaña *Familiares responsables*. No se puede eliminar a un cliente mientras tenga algún adulto mayor; antes hay que asignarle otro cliente.
  - El cliente y los familiares activos aparecen como **contactos de emergencia** del adulto mayor (pantalla *Ayuda*) y junto a cada llamada SOS del panel de administración.
- Estados de cuenta: `activo`, `pendiente` (esperando alta), `inactivo` y `verificacion` (cuidador o colaborador registrado que aún no ha sido activado).

## Página de administración (`admin.html`)

Solo para el rol `admin` (al iniciar sesión como admin se abre directamente):

| Pestaña | Qué permite |
|---------|-------------|
| 👥 **Usuarios** | Adultos mayores (rol `usuario`), con filtro por estado y acciones **✏️ Editar**, **Inactivar**/Activar y Eliminar. El botón **➕ Crear usuario** despliega el formulario: nombre completo, dirección, teléfono, celular, correo (opcional), tipo de sangre, **cliente** (debe existir antes) y usuario/contraseña de acceso. La columna *Cliente* indica también cuántos familiares responsables tiene. Es la pestaña que se abre por defecto. |
| 👪 **Familiares responsables** | Por cada adulto mayor: su **cliente** (se cambia con el desplegable) y sus familiares responsables, con botones para aprobar o rechazar solicitudes, quitar familiares, añadir un familiar ya registrado o **👤➕ Crear nuevo familiar** (cuenta activa y ya unida). Filtros «Con solicitudes» y «Sin familiares»; la pestaña muestra cuántas solicitudes hay por aprobar. Debajo, las **cuentas de familiares responsables** con sus adultos mayores y acciones Activar/Inactivar/Eliminar. |
| 🧾 **Clientes** | Quienes contratan SilverAid, con sus adultos mayores y su estado; permite dar de alta a esos adultos mayores, enviar el catálogo y activar/desactivar al cliente. |
| 🧑‍⚕️ **Cuidadores** | Lista de cuidadores registrados con botones **✏️ Editar** (abre el formulario con sus datos; si tiene cuenta se puede cambiar la contraseña, si no, crearla) y **Eliminar**. Debajo, el botón **➕ Registrar cuidador** que despliega el formulario: información personal, perfil, cuenta opcional (rol `cuidador`) y **disponibilidad semanal** en una matriz (días en columnas, una hora por fila de 06:00 a 22:00; clic o arrastre para marcar). La aplicación solo asigna un cuidador si está disponible ese día y hora. |
| 🧑‍⚕️ **Cuidadores** (cuentas) | Debajo de las fichas, los cuidadores que se registraron desde «Crear cuenta», con escolaridad, botones **📄** para abrir sus PDF (RUT, salud, pensión, ARL, RETHUS y cada título), los documentos que faltan y **✔ Verificar y activar** (solo con todos los obligatorios) o Inactivar. La pestaña muestra cuántos esperan verificación. |
| 🤝 **Colaboradores** | Colaboradores registrados: documento, contacto, escolaridad, pase de conducción, afiliación a seguridad social, con botones **📄** para abrir los PDF adjuntos (documento, pase y certificados de salud, pensión y ARL), los documentos que faltan y **✔ Verificar y activar** (solo con todos los obligatorios) o Inactivar. La pestaña muestra cuántos esperan verificación. |
| ⏳ **Altas pendientes** | Adultos mayores que un cliente registró. No pueden entrar hasta que el admin les da de alta (o rechaza la solicitud). Debajo, las **solicitudes de familiares responsables** que quieren unirse a un adulto mayor. |
| 🚨 **Llamadas SOS** | Registro de cada pulsación del botón de pánico (y de caídas sin respuesta): fecha, persona con su cliente y sus familiares responsables (y su celular), motivo y ubicación. Se actualiza cada 10 s, suena un aviso con cada llamada nueva (en cualquier pestaña) y se marcan como atendidas con una nota. |

Archivos de datos (en `data/`, fuera de git):

| Archivo | Campos |
|---------|--------|
| `users.txt` | `usuario;contraseña;nombre;rol;estado;registrado_por;fecha_registro;direccion;telefono;celular;email;tipo_sangre;cliente;tipo_documento;documento;catalogo_enviado;escolaridad;pase_conduccion;pase_vehiculo;pase_categorias;seguridad_social;certificado;adjunto_documento;adjunto_pase;adjunto_pension;adjunto_arl;adjunto_rut;adjunto_titulos;adjunto_rethus` (de `direccion` a `cliente`, ficha del adulto mayor; desde `escolaridad`, ficha del colaborador y del cuidador; en `adjunto_titulos`, los nombres de los títulos separados por «\|») |
| `attachments.txt` | `id;usuario;clase;nombre_archivo;fecha;contenido` — PDF del colaborador (`clase`: `documento`, `pase`, `salud`, `pension`, `arl`, `rut`, `rethus` o `titulos-1`…`titulos-5`; contenido en base64) |
| `caregivers.txt` | `id;nombre;documento;fecha_nacimiento;telefono;email;direccion;zona;titulo;experiencia;habilidades;disponibilidad;usuario;fecha_registro` — disponibilidad como `lun=8,9,10\|mar=14,15` (horas de inicio de cada franja de 1 h) |
| `family.txt` | `id;adulto;familiar;parentesco;estado;solicitado_por;fecha` — familiares responsables (rol `familiar`) de cada adulto mayor (`estado`: `activo` o `pendiente` de aprobación; `id` = `adulto:familiar` en minúsculas). El cliente no aparece aquí: está en `users.cliente`. |
| `sos.txt` | `id;fecha;usuario;nombre;motivo;lat;lng;estado;atendido_por;fecha_atencion;nota` |
| `states.txt` | `usuario;actualizado;contenido` — datos de la aplicación de cada usuario sincronizados desde IndexedDB (JSON en base64; `actualizado` = marca de tiempo en ms del último cambio) |
- Cada usuario tiene sus propios datos de demo (medicamentos, citas, etc.), guardados en el dispositivo y sincronizados con el servidor.

⚠️ Las contraseñas se guardan **en texto plano**: es un demo educativo, no lo use con contraseñas reales.
`data/` está en `.gitignore` para que no se suban al repositorio, y el servidor nunca entrega ese archivo por HTTP.

**GitHub Pages:** la landing page se ve completa, pero como Pages solo sirve archivos estáticos, allí no hay servidor y no se puede iniciar sesión
(la página de login lo indica). Para usar el login, ejecute `server.py` en su equipo.

## Notas del demo

- Los datos se guardan en el navegador (IndexedDB, con una copia en `localStorage` para mostrarse al instante) y se sincronizan con el servidor. El botón **↺ Reiniciar demo** restaura los datos de ejemplo.
- Los avisos a la familia son simulados (aparecen en el panel); en producción se enviarían por SMS o notificación push.
- El asistente usa reglas locales; en producción se conectaría a un modelo de lenguaje.
- Los 5 cuidadores de ejemplo (datos ficticios) se crean la primera vez que arranca el servidor.

## Identidad visual

- Colores: marrón `#92400E` (principal), ocre `#D6A05C` (acento), crema `#F5E6C8` (fondos).
- Tipografía: [Poppins](https://fonts.google.com/specimen/Poppins) (Google Fonts).
- Logos en `assets/brand/`: horizontal a color, negativo (usado en alto contraste), símbolo e ícono de app (favicon).

## Estructura

```
server.py          servidor local: archivos + API (datos en data/*.txt)
index.html         landing page
login.html         inicio de sesión y registro
app.html           aplicación (requiere sesión)
admin.html         administración (solo admin)
offline.html       página sin conexión
sw.js              service worker: cachés, modo sin conexión y sincronización en segundo plano
manifest.webmanifest  manifiesto de la aplicación instalable
assets/icons/      íconos de la aplicación instalada (PNG normales, maskable y apple-touch-icon)
js/db.js           base de datos del navegador (IndexedDB) y sincronización
js/pwa.js          registro del service worker, «Instalar», estado de la conexión y menú móvil
css/landing.css    estilos de la landing page
assets/brand/      logos e ícono
js/auth.js         sesión y llamadas a la API
js/admin.js        página de administración
js/elders.js       cliente y familiar: sus adultos mayores y los familiares responsables de cada uno
js/availability.js matriz de disponibilidad (editor y resumen)
css/styles.css
js/store.js        estado, persistencia y utilidades
js/meds.js         1. medicamentos
js/family.js       2. panel de la familia
js/sos.js          3. emergencia y caídas
js/assistant.js    4. asistente
js/caregivers.js   5. red de cuidadores
js/main.js         navegación, inicio y accesibilidad
```
