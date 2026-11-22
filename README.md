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
| `login.html` | Inicio de sesión y «Crear cuenta», donde se elige el tipo de cuenta (`login.html#registro`). Los enlaces antiguos `#registro-cliente`, `#registro-cuidador` y `#registro-colaborador` redirigen a la página de registro de ese rol. |
| `registro-familiar.html`, `registro-cuidador.html`, `registro-colaborador.html` | Registro por pasos de cada rol, con barra de progreso; cada paso se valida antes de avanzar. Lógica común en `js/registro.js`. |
| `documentos.html` | «Mis documentos» del cuidador y del colaborador: lista de documentos obligatorios (✔/✖), subir o reemplazar cada PDF y, el cuidador, agregar o quitar títulos. |
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

- Desde «Crear una cuenta» se elige el tipo de cuenta y se pasa al registro por pasos de ese rol:
  - **Familiar responsable** (*cliente*), 3 pasos: sus datos (nombre, documento, dirección, celular, correo), los del adulto mayor y el acceso. Su cuenta queda activa; la del adulto mayor, pendiente de alta.
    - Si marca **«¿Usted es el adulto mayor?»**, la persona tiene los dos roles: se crean su cuenta de *cliente* y una de *usuario* con sus mismos datos (solo se pide además el tipo de sangre), enlazada a ella. Como adulto mayor entra con su número de documento y la misma contraseña, cuando el administrador active esa cuenta. Por eso su nombre de usuario no puede ser su número de documento.
  - **Cuidador/a** (*cuidador*), 4 pasos: datos personales; formación (nivel de escolaridad y hasta 5 títulos en PDF, opcionales); documentos (RUT ante la DIAN, certificados de afiliación a salud, pensión y ARL como independiente y certificado del RETHUS); acceso.
  - **Colaborador/a** (*colaborador*), 4 pasos: datos personales con documento de identidad; perfil (escolaridad, pase de conducción —carro, moto o ambos, con su categoría A1–C3— y afiliación a seguridad social como independiente); documentos (documento de identidad y, según las respuestas, pase y certificados de salud, pensión y ARL); acceso.
  - Todos los documentos son PDF de máximo 300 KB, revisados en el navegador y en el servidor. **Al registrarse son opcionales**: cuidador y colaborador quedan **en verificación**, pueden entrar solo a «Mis documentos» (`documentos.html`) para subir los que falten, y el administrador los activa cuando están completos (el servidor no deja activar a nadie con documentos obligatorios pendientes).
  - Los **adultos mayores** (*usuario*) los registra su familiar o el administrador. Nunca se crean *admin* desde el registro.
- Estados de cuenta: `activo`, `pendiente` (esperando alta), `inactivo` y `verificacion` (cuidador o colaborador registrado que aún no ha sido activado).

## Página de administración (`admin.html`)

Solo para el rol `admin` (al iniciar sesión como admin se abre directamente):

| Pestaña | Qué permite |
|---------|-------------|
| 👥 **Usuarios** | Adultos mayores (rol `usuario`), con filtro por estado y acciones **✏️ Editar**, **Inactivar**/Activar y Eliminar. El botón **➕ Crear usuario** despliega el formulario: nombre completo, dirección, teléfono, celular, correo (opcional), tipo de sangre, **cliente asociado** (debe existir antes) y usuario/contraseña de acceso. Es la pestaña que se abre por defecto. |
| 👨‍👩‍👧 **Clientes** | Familiares responsables con los adultos mayores que han registrado y su estado; permite dar de alta a esos familiares y activar/desactivar al cliente. |
| 🧑‍⚕️ **Cuidadores** | Lista de cuidadores registrados con botones **✏️ Editar** (abre el formulario con sus datos; si tiene cuenta se puede cambiar la contraseña, si no, crearla) y **Eliminar**. Debajo, el botón **➕ Registrar cuidador** que despliega el formulario: información personal, perfil, cuenta opcional (rol `cuidador`) y **disponibilidad semanal** en una matriz (días en columnas, una hora por fila de 06:00 a 22:00; clic o arrastre para marcar). La aplicación solo asigna un cuidador si está disponible ese día y hora. |
| 🧑‍⚕️ **Cuidadores** (cuentas) | Debajo de las fichas, los cuidadores que se registraron desde «Crear cuenta», con escolaridad, botones **📄** para abrir sus PDF (RUT, salud, pensión, ARL, RETHUS y cada título), los documentos que faltan y **✔ Verificar y activar** (solo con todos los obligatorios) o Inactivar. La pestaña muestra cuántos esperan verificación. |
| 🤝 **Colaboradores** | Colaboradores registrados: documento, contacto, escolaridad, pase de conducción, afiliación a seguridad social, con botones **📄** para abrir los PDF adjuntos (documento, pase y certificados de salud, pensión y ARL), los documentos que faltan y **✔ Verificar y activar** (solo con todos los obligatorios) o Inactivar. La pestaña muestra cuántos esperan verificación. |
| ⏳ **Altas pendientes** | Adultos mayores que un cliente (familiar) registró desde la sección *Familia*. No pueden entrar hasta que el admin les da de alta (o rechaza la solicitud). |
| 🚨 **Llamadas SOS** | Registro de cada pulsación del botón de pánico (y de caídas sin respuesta): fecha, persona, motivo y ubicación. Se actualiza cada 10 s, suena un aviso con cada llamada nueva (en cualquier pestaña) y se marcan como atendidas con una nota. |

Archivos de datos (en `data/`, fuera de git):

| Archivo | Campos |
|---------|--------|
| `users.txt` | `usuario;contraseña;nombre;rol;estado;registrado_por;fecha_registro;direccion;telefono;celular;email;tipo_sangre;cliente;tipo_documento;documento;catalogo_enviado;escolaridad;pase_conduccion;pase_vehiculo;pase_categorias;seguridad_social;certificado;adjunto_documento;adjunto_pase;adjunto_pension;adjunto_arl;adjunto_rut;adjunto_titulos;adjunto_rethus` (de `direccion` a `cliente`, ficha del adulto mayor; desde `escolaridad`, ficha del colaborador y del cuidador; en `adjunto_titulos`, los nombres de los títulos separados por «\|») |
| `attachments.txt` | `id;usuario;clase;nombre_archivo;fecha;contenido` — PDF del colaborador (`clase`: `documento`, `pase`, `salud`, `pension`, `arl`, `rut`, `rethus` o `titulos-1`…`titulos-5`; contenido en base64) |
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
