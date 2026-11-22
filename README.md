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
| `login.html` | Inicio de sesión y registro (`login.html#registro`, `#registro-cliente`, `#registro-cuidador`, `#registro-colaborador` abren el registro con el rol elegido). |
| `app.html` | La aplicación (requiere sesión). |
| `admin.html` | Administración (solo admin). |

## Usuarios e inicio de sesión

- `server.py` sirve la aplicación y guarda los usuarios en `data/users.txt` (se crea solo, con `admin;admin;Administrador;admin`).
- Formato del archivo, una línea por usuario: `usuario;contraseña;nombre;rol`.
- Roles:

  | Código | Quién es |
  |--------|----------|
  | `usuario` | Adulto mayor |
  | `cliente` | Familiar responsable |
  | `cuidador` | Cuidador/a |
  | `colaborador` | Colaborador/a: acompañamiento a trámites y citas, solicitar y llevar medicamentos, conductor, entre otros |
  | `admin` | Administrador |

- Desde «Crear una cuenta» se registran **familiares responsables** (*cliente*: nombre y apellidos, dirección, celular, correo electrónico, usuario y contraseña) y **cuidadores** (*cuidador*: nombre y apellidos, dirección, celular, correo electrónico, usuario y contraseña) y **colaboradores** (*colaborador*: nombre y apellidos, documento de identidad, dirección, celular, correo electrónico, grado de escolaridad, pase de conducción —carro, moto o ambos, con su categoría A1–C3—, afiliación a seguridad social como independiente con certificado de salud opcional en PDF/JPG/PNG de hasta 2 MB, usuario y contraseña). Los **adultos mayores** (*usuario*) los registra su familiar desde la aplicación (quedan pendientes de alta) o el administrador. Nunca se crean *admin* desde el registro.
- Estados de cuenta: `activo`, `pendiente` (esperando alta) e `inactivo`.

## Página de administración (`admin.html`)

Solo para el rol `admin` (al iniciar sesión como admin se abre directamente):

| Pestaña | Qué permite |
|---------|-------------|
| 👥 **Usuarios** | Adultos mayores (rol `usuario`), con filtro por estado y acciones **✏️ Editar**, **Inactivar**/Activar y Eliminar. El botón **➕ Crear usuario** despliega el formulario: nombre completo, dirección, teléfono, celular, correo (opcional), tipo de sangre, **cliente asociado** (debe existir antes) y usuario/contraseña de acceso. Es la pestaña que se abre por defecto. |
| 👨‍👩‍👧 **Clientes** | Familiares responsables con los adultos mayores que han registrado y su estado; permite dar de alta a esos familiares y activar/desactivar al cliente. |
| 🧑‍⚕️ **Cuidadores** | Lista de cuidadores registrados con botones **✏️ Editar** (abre el formulario con sus datos; si tiene cuenta se puede cambiar la contraseña, si no, crearla) y **Eliminar**. Debajo, el botón **➕ Registrar cuidador** que despliega el formulario: información personal, perfil, cuenta opcional (rol `cuidador`) y **disponibilidad semanal** en una matriz (días en columnas, una hora por fila de 06:00 a 22:00; clic o arrastre para marcar). La aplicación solo asigna un cuidador si está disponible ese día y hora. |
| 🤝 **Colaboradores** | Colaboradores registrados: documento, contacto, escolaridad, pase de conducción, afiliación a seguridad social (botón **📄 Ver certificado** si lo adjuntaron) y **Inactivar**/Activar. |
| ⏳ **Altas pendientes** | Adultos mayores que un cliente (familiar) registró desde la sección *Familia*. No pueden entrar hasta que el admin les da de alta (o rechaza la solicitud). |
| 🚨 **Llamadas SOS** | Registro de cada pulsación del botón de pánico (y de caídas sin respuesta): fecha, persona, motivo y ubicación. Se actualiza cada 10 s, suena un aviso con cada llamada nueva (en cualquier pestaña) y se marcan como atendidas con una nota. |

Archivos de datos (en `data/`, fuera de git):

| Archivo | Campos |
|---------|--------|
| `users.txt` | `usuario;contraseña;nombre;rol;estado;registrado_por;fecha_registro;direccion;telefono;celular;email;tipo_sangre;cliente;tipo_documento;documento;catalogo_enviado;escolaridad;pase_conduccion;pase_vehiculo;pase_categorias;seguridad_social;certificado` (de `direccion` a `cliente`, ficha del adulto mayor; los seis últimos, ficha del colaborador) |
| `certificates.txt` | `usuario;nombre_archivo;tipo;fecha;contenido` — certificado de afiliación a salud del colaborador (contenido en base64) |
| `caregivers.txt` | `id;nombre;documento;fecha_nacimiento;telefono;email;direccion;zona;titulo;experiencia;habilidades;disponibilidad;usuario;fecha_registro` — disponibilidad como `lun=8,9,10\|mar=14,15` (horas de inicio de cada franja de 1 h) |
| `sos.txt` | `id;fecha;usuario;nombre;motivo;lat;lng;estado;atendido_por;fecha_atencion;nota` |
- Cada usuario tiene sus propios datos de demo (medicamentos, citas, etc.) en el navegador.

⚠️ Las contraseñas se guardan **en texto plano**: es un demo educativo, no lo use con contraseñas reales.
`data/` está en `.gitignore` para que no se suban al repositorio, y el servidor nunca entrega ese archivo por HTTP.

**GitHub Pages:** la landing page se ve completa, pero como Pages solo sirve archivos estáticos, allí no hay servidor y no se puede iniciar sesión
(la página de login lo indica). Para usar el login, ejecute `server.py` en su equipo.

## Notas del demo

- Los datos se guardan en el navegador (`localStorage`). El botón **↺ Reiniciar demo** restaura los datos de ejemplo.
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
css/landing.css    estilos de la landing page
assets/brand/      logos e ícono
js/auth.js         sesión y llamadas a la API
js/admin.js        página de administración
js/elders.js       clientes: registrar a su familiar mayor
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
