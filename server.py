#!/usr/bin/env python3
"""SilverAid — servidor local.

Sirve la aplicación y una pequeña API. Todos los datos se guardan en archivos
de texto dentro de data/, una línea por registro y campos separados por «;»:

    data/users.txt       usuario;contraseña;nombre;rol;estado;registrado_por;fecha_registro;
                         direccion;telefono;celular;email;tipo_sangre;cliente  (ficha del adulto mayor)
    data/caregivers.txt  ficha personal de cada cuidador; disponibilidad como «lun=8,9,10|mar=14,15»
                         (día = horas de inicio de cada franja de 1 h, de 06:00 a 22:00)
    data/sos.txt         registro de llamadas del botón de pánico

Roles:   usuario (adulto mayor), cliente (familiar responsable), cuidador, admin.
Estados: activo, pendiente (esperando alta del administrador), inactivo.

Uso:  python server.py [puerto]      (por defecto 8000)
"""
import json
import posixpath
import re
import secrets
import sys
import threading
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"

# Solo se sirven estos archivos y carpetas (nunca data/, server.py ni .git/).
PUBLIC_FILES = {"/", "/index.html", "/app.html", "/login.html", "/admin.html", "/favicon.ico"}
PUBLIC_DIRS = ("/css/", "/js/", "/assets/")

ROLES = ("usuario", "cliente", "cuidador", "admin")
# Registro público: solo familiares responsables y cuidadores. Los adultos mayores los registra
# su familiar (quedan pendientes de alta) o el administrador; nunca se crean admins desde aquí.
SELF_SIGNUP_ROLES = ("cliente", "cuidador")
LEGACY_ROLES = {"user": "usuario"}
STATUSES = ("activo", "pendiente", "inactivo")
SKILLS = ("compania", "compras", "tecnologia", "tramites")
DAYS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")
HOURS = range(6, 22)  # franjas de 1 h, de 06:00 a 22:00


def parse_availability(text):
    """«lun=8,9,10|mar=14,15» → {"lun": [8, 9, 10], "mar": [14, 15]}. Texto con otro formato → None."""
    if not text:
        return {}
    result = {}
    for part in text.split("|"):
        day, _, hours = part.partition("=")
        if day not in DAYS:
            return None
        try:
            result[day] = sorted({int(h) for h in hours.split(",") if h} & set(HOURS))
        except ValueError:
            return None
    return result


def dump_availability(av):
    return "|".join(f"{d}={','.join(map(str, av[d]))}" for d in DAYS if av.get(d))


def clean_availability(value):
    """Valida la matriz recibida del navegador ({día: [horas]}) y la devuelve normalizada."""
    if not isinstance(value, dict):
        return {}
    out = {}
    for day in DAYS:
        hours = value.get(day) or []
        if isinstance(hours, list):
            valid = sorted({h for h in hours if isinstance(h, int) and h in HOURS})
            if valid:
                out[day] = valid
    return out


def week(days, start, end):
    """Atajo para los datos de ejemplo: mismos horarios [start, end) en varios días."""
    return dump_availability({d: list(range(start, end)) for d in days})
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,30}$")

lock = threading.Lock()
sessions = {}  # token -> nombre de usuario (en minúsculas)


def now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def clean(value, limit=300):
    """Texto seguro para guardar en una línea con campos separados por «;»."""
    text = "" if value is None else str(value)
    return text.replace(";", ",").replace("\r", " ").replace("\n", " ").strip()[:limit]


# --------------------------------------------------------------- archivos .txt
class Table:
    """Archivo de texto con una cabecera «# campo;campo;…» y una línea por registro."""

    def __init__(self, filename, fields, seed=()):
        self.path = DATA / filename
        self.fields = fields
        self.seed = seed

    def read(self):
        if not self.path.exists():
            self.write([dict(zip(self.fields, row)) for row in self.seed])
        rows = []
        for line in self.path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or line.startswith("#"):
                continue
            parts = line.split(";")
            parts += [""] * (len(self.fields) - len(parts))  # líneas de versiones anteriores
            rows.append(dict(zip(self.fields, parts)))
        return rows

    def write(self, rows):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# " + ";".join(self.fields) + "\n"]
        lines += [";".join(row.get(f, "") for f in self.fields) + "\n" for row in rows]
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("".join(lines), encoding="utf-8")
        tmp.replace(self.path)


USERS = Table(
    "users.txt",
    ["usuario", "contraseña", "nombre", "rol", "estado", "registrado_por", "fecha_registro",
     # Ficha del adulto mayor (rol usuario); vacía para el resto de roles
     "direccion", "telefono", "celular", "email", "tipo_sangre", "cliente"],
    seed=[("admin", "admin", "Administrador", "admin", "activo", "", "")],
)

BLOOD_TYPES = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
PHONE_RE = re.compile(r"^[0-9+()\-\s]{7,20}$")
EMAIL_RE = re.compile(r"^[^@\s;]+@[^@\s;]+\.[^@\s;]+$")

CAREGIVERS = Table(
    "caregivers.txt",
    ["id", "nombre", "documento", "fecha_nacimiento", "telefono", "email", "direccion", "zona",
     "titulo", "experiencia", "habilidades", "disponibilidad", "usuario", "fecha_registro"],
    seed=[  # datos ficticios de ejemplo
        ("c1", "Lucía Martín", "1000000001", "1994-03-12", "3001112233", "lucia@example.com", "Calle 10 # 5-20", "Centro",
         "Auxiliar de enfermería", "5", "compania,tecnologia", week(DAYS[:5], 8, 13), "", ""),
        ("c2", "Andrés Gil", "1000000002", "1989-07-30", "3002223344", "andres@example.com", "Carrera 7 # 12-45", "Norte",
         "Gerocultor", "8", "compras,tramites", week(DAYS[:6], 7, 12), "", ""),
        ("c3", "Sara López", "1000000003", "2001-11-05", "3003334455", "sara@example.com", "Calle 22 # 9-10", "Sur",
         "Cuidadora", "2", "tecnologia,compania",
         week(DAYS[:5], 15, 19) + "|" + week(DAYS[5:], 9, 14), "", ""),
        ("c4", "Pedro Sánchez", "1000000004", "1958-01-20", "3004445566", "pedro@example.com", "Avenida Norte # 30-02", "Centro",
         "Cuidador", "12", "compania,tramites", week(DAYS, 8, 12), "", ""),
        ("c5", "Nerea Ortiz", "1000000005", "1997-06-14", "3005556677", "nerea@example.com", "Calle 5 # 3-33", "Oriente",
         "Técnica en atención sociosanitaria", "4", "compras,compania", week(("lun", "mie", "vie"), 9, 18), "", ""),
    ],
)


def migrate_caregivers():
    """Versiones anteriores guardaban la disponibilidad como texto libre: los cuidadores de ejemplo
    pasan al horario nuevo y los demás quedan sin horario (el administrador puede volver a registrarlos)."""
    rows = CAREGIVERS.read()
    seed = {row[0]: row[11] for row in CAREGIVERS.seed}
    changed = False
    for c in rows:
        if parse_availability(c["disponibilidad"]) is None:
            c["disponibilidad"] = seed.get(c["id"], "")
            changed = True
    if changed:
        CAREGIVERS.write(rows)

SOS = Table(
    "sos.txt",
    ["id", "fecha", "usuario", "nombre", "motivo", "lat", "lng", "estado", "atendido_por", "fecha_atencion", "nota"],
)


def read_users():
    users = USERS.read()
    for u in users:
        u["rol"] = LEGACY_ROLES.get(u["rol"], u["rol"])
        u["estado"] = u["estado"] or "activo"
    return users


def find_user(users, username):
    key = (username or "").lower()
    return next((u for u in users if u["usuario"].lower() == key), None)


def public_user(u):
    return {"username": u["usuario"], "name": u["nombre"], "role": u["rol"], "status": u["estado"],
            "registeredBy": u["registrado_por"], "registeredAt": u["fecha_registro"],
            "address": u.get("direccion", ""), "phone": u.get("telefono", ""), "mobile": u.get("celular", ""),
            "email": u.get("email", ""), "bloodType": u.get("tipo_sangre", ""), "client": u.get("cliente", "")}


def validate_name(name):
    if not name.strip():
        return "Escriba el nombre completo."
    if ";" in name or "\n" in name or "\r" in name:
        return "El nombre no puede contener «;» ni saltos de línea."
    return None


def elder_profile(data, users):
    """Valida la ficha de un adulto mayor. El cliente asociado debe existir previamente. Devuelve (campos, error)."""
    address = clean(data.get("address"), 120)
    phone = clean(data.get("phone"), 20)
    mobile = clean(data.get("mobile"), 20)
    email = clean(data.get("email"), 80)
    blood = data.get("bloodType")
    client = find_user(users, str(data.get("client") or "").strip())
    if not address:
        return None, "Escriba la dirección."
    if not PHONE_RE.match(phone):
        return None, "Escriba un teléfono válido (7 a 20 dígitos)."
    if not PHONE_RE.match(mobile):
        return None, "Escriba un celular válido (7 a 20 dígitos)."
    if email and not EMAIL_RE.match(email):
        return None, "El correo electrónico no es válido."
    if blood not in BLOOD_TYPES:
        return None, "Seleccione el tipo de sangre."
    if not client or client["rol"] != "cliente":
        return None, "Seleccione un cliente asociado ya registrado."
    return {"direccion": address, "telefono": phone, "celular": mobile, "email": email,
            "tipo_sangre": blood, "cliente": client["usuario"]}, None


def public_caregiver(c):
    return {"id": c["id"], "name": c["nombre"], "zone": c["zona"], "title": c["titulo"],
            "experience": int(c["experiencia"] or 0), "skills": [s for s in c["habilidades"].split(",") if s],
            "availability": parse_availability(c["disponibilidad"]) or {}}


def full_caregiver(c):
    return {**public_caregiver(c), "document": c["documento"], "birthdate": c["fecha_nacimiento"],
            "phone": c["telefono"], "email": c["email"], "address": c["direccion"],
            "username": c["usuario"], "registeredAt": c["fecha_registro"]}


def public_call(s):
    return {"id": s["id"], "date": s["fecha"], "username": s["usuario"], "name": s["nombre"], "reason": s["motivo"],
            "lat": s["lat"], "lng": s["lng"], "status": s["estado"], "attendedBy": s["atendido_por"],
            "attendedAt": s["fecha_atencion"], "note": s["nota"]}


def validate_account(username, password, name):
    if not USERNAME_RE.match(username or ""):
        return "El usuario debe tener de 3 a 30 caracteres: letras, números, punto, guion o guion bajo."
    if not password or len(password) < 4:
        return "La contraseña debe tener al menos 4 caracteres."
    for value in (password, name):
        if ";" in value or "\n" in value or "\r" in value:
            return "La contraseña y el nombre no pueden contener «;» ni saltos de línea."
    if not name.strip():
        return "Escriba el nombre."
    return None


def new_account(users, data, role, status, registered_by=""):
    """Valida y añade una cuenta a la lista. Devuelve (cuenta, error)."""
    username = str(data.get("username", "")).strip()
    password = str(data.get("password", ""))
    name = str(data.get("name", "")).strip()
    error = validate_account(username, password, name)
    if error:
        return None, error
    if find_user(users, username):
        return None, "Ese usuario ya existe."
    user = {field: "" for field in USERS.fields}  # incluye los campos de la ficha, vacíos
    user.update({"usuario": username, "contraseña": password, "nombre": name, "rol": role, "estado": status,
                 "registrado_por": registered_by, "fecha_registro": now()})
    users.append(user)
    return user, None


def drop_sessions(username):
    for token, key in list(sessions.items()):
        if key == username.lower():
            del sessions[token]


# ---------------------------------------------------------------------- HTTP
class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
        ".html": "text/html; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # --- utilidades
    def clean_path(self):
        path = posixpath.normpath(unquote(urlsplit(self.path).path))
        return "/" if path in (".", "/") else path

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message):
        self.send_json(status, {"error": message})

    def read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > 20_000:
            return None
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
            return data if isinstance(data, dict) else None
        except (ValueError, UnicodeDecodeError):
            return None

    def token(self):
        auth = self.headers.get("Authorization", "")
        return auth[7:] if auth.startswith("Bearer ") else ""

    def auth(self, role=None):
        """Usuario activo de la sesión. Si no hay sesión o no tiene el rol, responde el error y devuelve None."""
        key = sessions.get(self.token())
        user = None
        if key:
            with lock:
                user = find_user(read_users(), key)
        if not user or user["estado"] != "activo":
            self.fail(HTTPStatus.UNAUTHORIZED, "Sesión no válida.")
            return None
        if role and user["rol"] != role:
            self.fail(HTTPStatus.FORBIDDEN, "No tiene permiso para hacer esto.")
            return None
        return user

    # --- archivos estáticos
    def is_public(self, path):
        return path in PUBLIC_FILES or path.startswith(PUBLIC_DIRS)

    def do_HEAD(self):
        if not self.is_public(self.clean_path()):
            return self.send_error(HTTPStatus.NOT_FOUND)
        super().do_HEAD()

    # --- GET
    def do_GET(self):
        path = self.clean_path()
        if not path.startswith("/api/"):
            if not self.is_public(path):
                return self.send_error(HTTPStatus.NOT_FOUND)
            return super().do_GET()

        if path == "/api/me":
            user = self.auth()
            if user:
                self.send_json(HTTPStatus.OK, {"user": public_user(user)})

        elif path == "/api/caregivers":
            if self.auth():
                with lock:
                    rows = CAREGIVERS.read()
                self.send_json(HTTPStatus.OK, {"caregivers": [public_caregiver(c) for c in rows]})

        elif path == "/api/elders":
            client = self.auth("cliente")
            if client:
                with lock:
                    mine = [u for u in read_users() if client["usuario"].lower()
                            in (u["registrado_por"].lower(), u["cliente"].lower())]
                self.send_json(HTTPStatus.OK, {"elders": [public_user(u) for u in mine]})

        elif path == "/api/admin/users":
            if self.auth("admin"):
                with lock:
                    users = read_users()
                self.send_json(HTTPStatus.OK, {"users": [public_user(u) for u in users]})

        elif path == "/api/admin/caregivers":
            if self.auth("admin"):
                with lock:
                    rows = CAREGIVERS.read()
                self.send_json(HTTPStatus.OK, {"caregivers": [full_caregiver(c) for c in rows]})

        elif path == "/api/admin/sos":
            if self.auth("admin"):
                with lock:
                    rows = SOS.read()
                self.send_json(HTTPStatus.OK, {"calls": [public_call(s) for s in reversed(rows)]})

        else:
            self.fail(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    # --- POST
    def do_POST(self):
        path = self.clean_path()
        data = self.read_json()
        if data is None:
            return self.fail(HTTPStatus.BAD_REQUEST, "Petición no válida.")

        if path == "/api/login":
            return self.login(data)

        if path == "/api/logout":
            sessions.pop(self.token(), None)
            return self.send_json(HTTPStatus.OK, {"ok": True})

        if path == "/api/register":
            role = data.get("role")
            if role not in SELF_SIGNUP_ROLES:
                return self.fail(HTTPStatus.BAD_REQUEST,
                                 "Elija «Familiar responsable» o «Cuidador/a». Las cuentas de adultos mayores las crea su familiar.")
            # Familiar responsable y cuidador: dirección, celular y correo obligatorios.
            extra = {"direccion": clean(data.get("address"), 120), "celular": clean(data.get("mobile"), 20),
                     "email": clean(data.get("email"), 80)}
            if not extra["direccion"]:
                return self.fail(HTTPStatus.BAD_REQUEST, "Escriba su dirección.")
            if not PHONE_RE.match(extra["celular"]):
                return self.fail(HTTPStatus.BAD_REQUEST, "Escriba un número de celular válido (7 a 20 dígitos).")
            if not EMAIL_RE.match(extra["email"]):
                return self.fail(HTTPStatus.BAD_REQUEST, "Escriba un correo electrónico válido.")
            with lock:
                users = read_users()
                user, error = new_account(users, data, role, "activo")
                if user:
                    user.update(extra)
                    USERS.write(users)
            if error:
                return self.fail(HTTPStatus.BAD_REQUEST, error)
            return self.send_json(HTTPStatus.CREATED, {"user": public_user(user)})

        if path == "/api/elders":
            # Un cliente (familiar) registra a su adulto mayor; queda pendiente de alta.
            client = self.auth("cliente")
            if not client:
                return
            with lock:
                users = read_users()
                user, error = new_account(users, data, "usuario", "pendiente", client["usuario"])
                if user:
                    user["cliente"] = client["usuario"]  # queda asociado al familiar que lo registró
                    USERS.write(users)
            if error:
                return self.fail(HTTPStatus.BAD_REQUEST, error)
            return self.send_json(HTTPStatus.CREATED, {"user": public_user(user)})

        if path == "/api/sos":
            user = self.auth()
            if not user:
                return
            call = {"id": datetime.now().strftime("S%Y%m%d%H%M%S") + secrets.token_hex(2), "fecha": now(),
                    "usuario": user["usuario"], "nombre": user["nombre"],
                    "motivo": clean(data.get("reason") or "botón de emergencia", 120),
                    "lat": self.coord(data.get("lat")), "lng": self.coord(data.get("lng")),
                    "estado": "pendiente", "atendido_por": "", "fecha_atencion": "", "nota": ""}
            with lock:
                rows = SOS.read()
                rows.append(call)
                SOS.write(rows)
            return self.send_json(HTTPStatus.CREATED, {"call": public_call(call)})

        # ---- administración
        if path == "/api/admin/users":
            # El administrador crea un usuario (adulto mayor) con su ficha y su cliente asociado.
            if not self.auth("admin"):
                return
            with lock:
                users = read_users()
                profile, error = elder_profile(data, users)
                user = None
                if not error:
                    user, error = new_account(users, data, "usuario", "activo")
                if user:
                    user.update(profile)
                    USERS.write(users)
            if error:
                return self.fail(HTTPStatus.BAD_REQUEST, error)
            return self.send_json(HTTPStatus.CREATED, {"user": public_user(user)})

        m = re.fullmatch(r"/api/admin/users/([^/]+)/status", path)
        if m:
            admin = self.auth("admin")
            if not admin:
                return
            status = data.get("status")
            if status not in ("activo", "inactivo"):
                return self.fail(HTTPStatus.BAD_REQUEST, "Estado no válido.")
            if m.group(1).lower() == admin["usuario"].lower():
                return self.fail(HTTPStatus.BAD_REQUEST, "No puede cambiar el estado de su propia cuenta.")
            with lock:
                users = read_users()
                user = find_user(users, m.group(1))
                if not user:
                    return self.fail(HTTPStatus.NOT_FOUND, "El usuario no existe.")
                user["estado"] = status
                USERS.write(users)
            if status != "activo":
                drop_sessions(user["usuario"])
            return self.send_json(HTTPStatus.OK, {"user": public_user(user)})

        if path == "/api/admin/caregivers":
            if not self.auth("admin"):
                return
            return self.save_caregiver(data)

        m = re.fullmatch(r"/api/admin/sos/([^/]+)/attend", path)
        if m:
            admin = self.auth("admin")
            if not admin:
                return
            with lock:
                rows = SOS.read()
                call = next((s for s in rows if s["id"] == m.group(1)), None)
                if not call:
                    return self.fail(HTTPStatus.NOT_FOUND, "La llamada no existe.")
                call.update(estado="atendida", atendido_por=admin["usuario"], fecha_atencion=now(),
                            nota=clean(data.get("note"), 300))
                SOS.write(rows)
            return self.send_json(HTTPStatus.OK, {"call": public_call(call)})

        self.fail(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    # --- PUT (editar)
    def do_PUT(self):
        path = self.clean_path()
        data = self.read_json()
        if data is None:
            return self.fail(HTTPStatus.BAD_REQUEST, "Petición no válida.")
        m = re.fullmatch(r"/api/admin/caregivers/([^/]+)", path)
        if m:
            if not self.auth("admin"):
                return
            return self.save_caregiver(data, m.group(1))

        m = re.fullmatch(r"/api/admin/users/([^/]+)", path)
        if m:
            # Editar un usuario: nombre, ficha (si es adulto mayor) y, opcionalmente, la contraseña.
            if not self.auth("admin"):
                return
            name = str(data.get("name", "")).strip()
            error = validate_name(name)
            if error:
                return self.fail(HTTPStatus.BAD_REQUEST, error)
            new_password = str(data.get("newPassword") or "")
            if new_password and (len(new_password) < 4 or ";" in new_password or "\n" in new_password):
                return self.fail(HTTPStatus.BAD_REQUEST, "La nueva contraseña debe tener al menos 4 caracteres y no contener «;».")
            with lock:
                users = read_users()
                user = find_user(users, m.group(1))
                if not user:
                    return self.fail(HTTPStatus.NOT_FOUND, "El usuario no existe.")
                if user["rol"] == "usuario":
                    profile, error = elder_profile(data, users)
                    if error:
                        return self.fail(HTTPStatus.BAD_REQUEST, error)
                    user.update(profile)
                user["nombre"] = name
                if new_password:
                    user["contraseña"] = new_password
                USERS.write(users)
            return self.send_json(HTTPStatus.OK, {"user": public_user(user)})

        self.fail(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    # --- DELETE
    def do_DELETE(self):
        path = self.clean_path()
        m = re.fullmatch(r"/api/admin/users/([^/]+)", path)
        if m:
            admin = self.auth("admin")
            if not admin:
                return
            target = m.group(1)
            if target.lower() == admin["usuario"].lower():
                return self.fail(HTTPStatus.BAD_REQUEST, "No puede eliminar su propia cuenta.")
            with lock:
                users = read_users()
                user = find_user(users, target)
                if not user:
                    return self.fail(HTTPStatus.NOT_FOUND, "El usuario no existe.")
                users.remove(user)
                USERS.write(users)
            drop_sessions(target)
            return self.send_json(HTTPStatus.OK, {"ok": True})

        m = re.fullmatch(r"/api/admin/caregivers/([^/]+)", path)
        if m:
            if not self.auth("admin"):
                return
            with lock:
                rows = CAREGIVERS.read()
                cg = next((c for c in rows if c["id"] == m.group(1)), None)
                if not cg:
                    return self.fail(HTTPStatus.NOT_FOUND, "El cuidador no existe.")
                rows.remove(cg)
                CAREGIVERS.write(rows)
                if cg["usuario"]:  # también se elimina su cuenta de acceso
                    users = read_users()
                    account = find_user(users, cg["usuario"])
                    if account and account["rol"] == "cuidador":
                        users.remove(account)
                        USERS.write(users)
                        drop_sessions(cg["usuario"])
            return self.send_json(HTTPStatus.OK, {"ok": True})

        self.fail(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    # --- acciones
    def login(self, data):
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        with lock:
            user = find_user(read_users(), username)
        if not user or not secrets.compare_digest(user["contraseña"].encode(), password.encode()):
            return self.fail(HTTPStatus.UNAUTHORIZED, "Usuario o contraseña incorrectos.")
        if user["estado"] == "pendiente":
            return self.fail(HTTPStatus.FORBIDDEN, "Su cuenta está pendiente de alta. El administrador de SilverAid la revisará pronto.")
        if user["estado"] != "activo":
            return self.fail(HTTPStatus.FORBIDDEN, "Su cuenta está desactivada. Contacte con el administrador.")
        token = secrets.token_urlsafe(32)
        sessions[token] = user["usuario"].lower()
        self.send_json(HTTPStatus.OK, {"token": token, "user": public_user(user)})

    def save_caregiver(self, data, cg_id=None):
        """Crea un cuidador (cg_id=None) o actualiza el existente con ese id."""
        name = clean(data.get("name"), 80)
        document = clean(data.get("document"), 30)
        phone = clean(data.get("phone"), 30)
        if not name or not document or not phone:
            return self.fail(HTTPStatus.BAD_REQUEST, "Nombre, documento y teléfono son obligatorios.")
        try:
            experience = max(0, min(60, int(data.get("experience") or 0)))
        except (TypeError, ValueError):
            return self.fail(HTTPStatus.BAD_REQUEST, "Los años de experiencia deben ser un número.")
        skills = [s for s in data.get("skills") or [] if s in SKILLS]
        if not skills:
            return self.fail(HTTPStatus.BAD_REQUEST, "Seleccione al menos un servicio que ofrece.")
        availability = clean_availability(data.get("availability"))
        if not availability:
            return self.fail(HTTPStatus.BAD_REQUEST, "Marque en la matriz al menos una hora de disponibilidad.")
        fields = {"nombre": name, "documento": document,
                  "fecha_nacimiento": clean(data.get("birthdate"), 10), "telefono": phone,
                  "email": clean(data.get("email"), 80), "direccion": clean(data.get("address"), 120),
                  "zona": clean(data.get("zone"), 40), "titulo": clean(data.get("title"), 60) or "Cuidador/a",
                  "experiencia": str(experience), "habilidades": ",".join(skills),
                  "disponibilidad": dump_availability(availability)}

        with lock:
            rows = CAREGIVERS.read()
            cg = None
            if cg_id:
                cg = next((c for c in rows if c["id"] == cg_id), None)
                if not cg:
                    return self.fail(HTTPStatus.NOT_FOUND, "El cuidador no existe.")
            if any(c["documento"] == document and c is not cg for c in rows):
                return self.fail(HTTPStatus.CONFLICT, "Ya hay otro cuidador registrado con ese documento.")

            users = read_users()
            users_changed = False
            account = find_user(users, cg["usuario"]) if cg and cg["usuario"] else None
            if account:
                # Ya tiene cuenta: se mantiene el nombre al día y, si se indica, se cambia la contraseña.
                account["nombre"] = name
                new_password = str(data.get("newPassword") or "")
                if new_password:
                    if len(new_password) < 4 or ";" in new_password or "\n" in new_password:
                        return self.fail(HTTPStatus.BAD_REQUEST, "La nueva contraseña debe tener al menos 4 caracteres y no contener «;».")
                    account["contraseña"] = new_password
                users_changed = True
            elif data.get("createAccount"):
                account, error = new_account(users, {**data, "name": name}, "cuidador", "activo")
                if error:
                    return self.fail(HTTPStatus.BAD_REQUEST, error)
                users_changed = True

            if cg:
                cg.update(fields, usuario=account["usuario"] if account else "")
            else:
                cg = {"id": "c" + secrets.token_hex(4), **fields,
                      "usuario": account["usuario"] if account else "", "fecha_registro": now()}
                rows.append(cg)
            CAREGIVERS.write(rows)
            if users_changed:
                USERS.write(users)
        self.send_json(HTTPStatus.OK if cg_id else HTTPStatus.CREATED, {"caregiver": full_caregiver(cg)})

    @staticmethod
    def coord(value):
        try:
            return f"{float(value):.5f}"
        except (TypeError, ValueError):
            return ""


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    with lock:
        # Crea los archivos si no existen y actualiza el formato de users.txt de versiones anteriores.
        users = read_users()
        for u in users:  # adultos mayores registrados por un cliente antes de existir el campo «cliente»
            if u["rol"] == "usuario" and not u["cliente"] and u["registrado_por"]:
                u["cliente"] = u["registrado_por"]
        USERS.write(users)
        migrate_caregivers()
        SOS.read()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"SilverAid en http://localhost:{port}   (datos en {DATA})")
    print("Pulse Ctrl+C para detener.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
