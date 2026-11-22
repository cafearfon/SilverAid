#!/usr/bin/env python3
"""SilverAid — servidor.

Sirve la aplicación y una pequeña API. Los datos se guardan en tres tablas:

    users        usuario;contraseña;nombre;rol;estado;registrado_por;fecha_registro;
                 direccion;telefono;celular;email;tipo_sangre;cliente  (ficha del adulto mayor);
                 tipo_documento;documento  (familiar responsable y adulto mayor)
    caregivers   ficha personal de cada cuidador; disponibilidad como «lun=8,9,10|mar=14,15»
                 (día = horas de inicio de cada franja de 1 h, de 06:00 a 22:00)
                 escolaridad;pase_conduccion;pase_vehiculo;pase_categorias;seguridad_social;certificado;
                 adjunto_documento;adjunto_pase;adjunto_pension;adjunto_arl;adjunto_rut;adjunto_titulos;adjunto_rethus
                 (ficha del colaborador y del cuidador; los adjuntos, nombre del archivo)
    attachments  PDF que adjuntan colaboradores y cuidadores al registrarse (documento, pase, RUT, títulos,
                 RETHUS y certificados de salud, pensión y ARL) en base64
    sos          registro de llamadas del botón de pánico
    services     catálogo de servicios que el administrador envía a los clientes

Almacenamiento (variable STORAGE):
    txt    (por defecto) archivos de texto en DATA_DIR: users.txt, caregivers.txt, sos.txt, services.txt
    mysql  base de datos MySQL (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE).
           Al crear las tablas por primera vez se importan los .txt de DATA_DIR si existen.

Otras variables: HOST (127.0.0.1), PORT (8000), DATA_DIR (./data),
                 ADMIN_PASSWORD (contraseña inicial de «admin»; por defecto «admin»).

Roles:   usuario (adulto mayor), cliente (familiar responsable), cuidador, colaborador
         (acompañamiento a trámites y citas, medicamentos, conductor…), admin.
Estados: activo, pendiente (esperando alta del administrador), inactivo.

Uso:  python server.py [puerto]
"""
import json
import os
import posixpath
import re
import secrets
import sys
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("DATA_DIR") or ROOT / "data")
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "8000"))
STORAGE = os.environ.get("STORAGE", "txt").lower()
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD") or "admin"
MYSQL = {
    "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
    "port": int(os.environ.get("MYSQL_PORT", "3306")),
    "user": os.environ.get("MYSQL_USER", "silveraid"),
    "password": os.environ.get("MYSQL_PASSWORD", ""),
    "database": os.environ.get("MYSQL_DATABASE", "silveraid"),
}
if STORAGE not in ("txt", "mysql"):
    sys.exit(f"STORAGE debe ser «txt» o «mysql» (se recibió «{STORAGE}»).")

# Solo se sirven estos archivos y carpetas (nunca data/, server.py ni .git/).
PUBLIC_FILES = {"/", "/index.html", "/app.html", "/login.html", "/admin.html", "/usuario.html", "/favicon.ico"}
PUBLIC_DIRS = ("/css/", "/js/", "/assets/")

ROLES = ("usuario", "cliente", "cuidador", "colaborador", "admin")
# Registro público: familiares responsables, cuidadores y colaboradores. Los adultos mayores los registra
# su familiar (quedan pendientes de alta) o el administrador; nunca se crean admins desde aquí.
SELF_SIGNUP_ROLES = ("cliente", "cuidador", "colaborador")
# Rol que entrega su documento de identidad al registrarse.
DOCUMENT_ROLES = ("cliente", "colaborador")
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


# ------------------------------------------------------------ almacenamiento
# Las dos implementaciones ofrecen lo mismo: read() → lista de diccionarios y write(lista).
# Todas las llamadas se hacen dentro de `lock`, así que no hay escrituras simultáneas.

class TextTable:
    """Archivo de texto con una cabecera «# campo;campo;…» y una línea por registro."""

    def __init__(self, filename, fields, seed=()):
        self.path = DATA / filename
        self.fields = fields
        self.seed = seed

    def setup(self):
        self.read()

    def read(self):
        if not self.path.exists():
            self.write([dict(zip(self.fields, row)) for row in self.seed])
        return read_text_rows(self.path, self.fields)

    def write(self, rows):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lines = ["# " + ";".join(self.fields) + "\n"]
        lines += [";".join(row.get(f, "") for f in self.fields) + "\n" for row in rows]
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text("".join(lines), encoding="utf-8")
        tmp.replace(self.path)


def read_text_rows(path, fields):
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        parts = line.split(";")
        parts += [""] * (len(fields) - len(parts))  # líneas de versiones anteriores
        rows.append(dict(zip(fields, parts)))
    return rows


def mysql_connect():
    import pymysql  # solo hace falta con STORAGE=mysql
    return pymysql.connect(charset="utf8mb4", autocommit=False, connect_timeout=5, **MYSQL)


class MySQLTable:
    """Tabla MySQL con una columna por campo (el primero es la clave primaria) y `orden` para conservar el orden."""

    LONG_FIELDS = {"disponibilidad", "nota", "direccion", "motivo", "descripcion"}
    HUGE_FIELDS = {"contenido"}  # archivos adjuntos en base64 (hasta unos 3 MB)

    def __init__(self, filename, fields, seed=()):
        self.legacy = DATA / filename                       # .txt a importar la primera vez
        self.name = Path(filename).stem                      # users, caregivers, sos
        self.fields = fields
        self.seed = seed
        self.cols = {f: f.replace("ñ", "n") for f in fields}  # «contraseña» → columna «contrasena»

    def _coldef(self, field, i):
        col = self.cols[field]
        if i == 0:
            return f"`{col}` VARCHAR(64) NOT NULL PRIMARY KEY"
        if field in self.HUGE_FIELDS:
            return f"`{col}` LONGTEXT NULL"
        if field in self.LONG_FIELDS:  # MySQL no admite valor por defecto en TEXT
            return f"`{col}` TEXT NULL"
        return f"`{col}` VARCHAR(255) NOT NULL DEFAULT ''"

    def setup(self):
        """Crea la tabla si no existe (con los datos de los .txt o los de ejemplo) y añade columnas nuevas."""
        conn = mysql_connect()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
                            (self.name,))
                exists = cur.fetchone()[0] > 0
                if not exists:
                    cols = ", ".join(self._coldef(f, i) for i, f in enumerate(self.fields))
                    cur.execute(f"CREATE TABLE `{self.name}` ({cols}, `orden` INT NOT NULL DEFAULT 0) "
                                "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4")
                else:  # versiones nuevas pueden traer columnas nuevas
                    cur.execute("SELECT column_name FROM information_schema.columns "
                                "WHERE table_schema = DATABASE() AND table_name = %s", (self.name,))
                    present = {r[0] for r in cur.fetchall()}
                    for i, f in enumerate(self.fields):
                        if self.cols[f] not in present:
                            cur.execute(f"ALTER TABLE `{self.name}` ADD COLUMN {self._coldef(f, i)}")
            conn.commit()
        finally:
            conn.close()
        if not exists:
            if self.legacy.exists():
                rows = read_text_rows(self.legacy, self.fields)
                print(f"  · {self.name}: importados {len(rows)} registros de {self.legacy.name}")
            else:
                rows = [dict(zip(self.fields, row)) for row in self.seed]
            self.write(rows)

    def read(self):
        conn = mysql_connect()
        try:
            with conn.cursor() as cur:
                cur.execute(f"SELECT {', '.join('`%s`' % self.cols[f] for f in self.fields)} "
                            f"FROM `{self.name}` ORDER BY `orden`")
                return [{f: (v or "") for f, v in zip(self.fields, row)} for row in cur.fetchall()]
        finally:
            conn.close()

    def write(self, rows):
        """Reemplaza el contenido de la tabla en una sola transacción."""
        names = [self.cols[f] for f in self.fields] + ["orden"]
        sql = (f"INSERT INTO `{self.name}` ({', '.join('`%s`' % n for n in names)}) "
               f"VALUES ({', '.join(['%s'] * len(names))})")
        conn = mysql_connect()
        try:
            with conn.cursor() as cur:
                cur.execute(f"DELETE FROM `{self.name}`")
                if rows:
                    cur.executemany(sql, [[row.get(f, "") for f in self.fields] + [i] for i, row in enumerate(rows)])
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


Table = MySQLTable if STORAGE == "mysql" else TextTable


def wait_for_mysql(attempts=30):
    """Al arrancar con Docker, MySQL puede tardar unos segundos en aceptar conexiones."""
    for i in range(1, attempts + 1):
        try:
            mysql_connect().close()
            return
        except Exception as exc:  # noqa: BLE001 — cualquier fallo de conexión: reintentar
            print(f"Esperando a MySQL en {MYSQL['host']}:{MYSQL['port']} ({i}/{attempts}): {exc}")
            time.sleep(2)
    sys.exit("No se pudo conectar con MySQL.")


USERS = Table(
    "users.txt",
    ["usuario", "contraseña", "nombre", "rol", "estado", "registrado_por", "fecha_registro",
     # Ficha del adulto mayor (rol usuario); vacía para el resto de roles
     "direccion", "telefono", "celular", "email", "tipo_sangre", "cliente",
     # Documento de identidad (familiar responsable y adulto mayor)
     "tipo_documento", "documento",
     # Último envío del catálogo de servicios al cliente: «fecha · canal»
     "catalogo_enviado",
     # Ficha del colaborador: escolaridad, pase de conducción (si/no, carro/moto/ambos, categorías
     # «B1,A2») y afiliación a seguridad social como independiente (si/no). Los tres PDF adjuntos se
     # guardan en ATTACHMENTS; aquí solo el nombre del archivo.
     "escolaridad", "pase_conduccion", "pase_vehiculo", "pase_categorias", "seguridad_social", "certificado",
     "adjunto_documento", "adjunto_pase", "adjunto_pension", "adjunto_arl",
     # Ficha del cuidador (registro público): escolaridad, certificado y los PDF de RUT, títulos y RETHUS
     "adjunto_rut", "adjunto_titulos", "adjunto_rethus"],
    seed=[("admin", ADMIN_PASSWORD, "Administrador", "admin", "activo", "", "")],
)

DOC_TYPES = {"CC": "Cédula de ciudadanía", "CE": "Cédula de extranjería",
             "PA": "Pasaporte", "PPT": "Permiso por protección temporal"}
BLOOD_TYPES = ("A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-")
PHONE_RE = re.compile(r"^[0-9+()\-\s]{7,20}$")
EMAIL_RE = re.compile(r"^[^@\s;]+@[^@\s;]+\.[^@\s;]+$")
EDUCATION = ("ninguno", "primaria", "bachillerato", "tecnico", "tecnologo", "universitario", "posgrado")
# Categorías de licencia de conducción (Colombia) según el vehículo.
LICENSE_CATEGORIES = {"moto": ("A1", "A2"), "carro": ("B1", "B2", "B3", "C1", "C2", "C3")}
VEHICLES = {"carro": ("carro",), "moto": ("moto",), "ambos": ("carro", "moto")}
# PDF que adjuntan colaborador y cuidador: clase → (campo de la petición, columna en users, tamaño máximo en KB, descripción)
ATTACHMENT_KINDS = {
    "documento": ("documentFile", "adjunto_documento", 300, "su documento de identidad"),
    "pase": ("licenseFile", "adjunto_pase", 300, "su pase de conducción"),
    "salud": ("certificate", "certificado", 300, "el certificado de afiliación a salud"),
    "pension": ("pensionFile", "adjunto_pension", 300, "el certificado de afiliación a pensión"),
    "arl": ("arlFile", "adjunto_arl", 300, "el certificado de afiliación a la ARL"),
    "rut": ("rutFile", "adjunto_rut", 300, "su RUT"),
    "titulos": ("titlesFiles", "adjunto_titulos", 300, "su título"),  # lista: un PDF por título
    "rethus": ("rethusFile", "adjunto_rethus", 300, "el certificado del RETHUS"),
}
MAX_TITLES = 5  # títulos que puede adjuntar un cuidador (clases «titulos-1» … «titulos-5»)
# Roles que adjuntan PDF al registrarse.
ATTACHMENT_ROLES = ("colaborador", "cuidador")

ATTACHMENTS = Table("attachments.txt", ["id", "usuario", "clase", "nombre_archivo", "fecha", "contenido"])

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

SERVICES = Table(
    "services.txt",
    ["id", "nombre", "descripcion", "precio", "activo"],
    seed=[  # catálogo de ejemplo; el administrador lo edita en la pestaña «Catálogo»
        ("s1", "Compañía y paseos", "Una persona de confianza acompaña al adulto mayor en casa o de paseo.", "", "si"),
        ("s2", "Compras y recados", "Hacemos la compra del supermercado y la farmacia y la llevamos a casa.", "", "si"),
        ("s3", "Ayuda con la tecnología", "Enseñamos a usar el celular, las videollamadas y las aplicaciones.", "", "si"),
        ("s4", "Trámites y citas", "Acompañamiento a citas médicas, bancos y gestiones.", "", "si"),
        ("s5", "App SilverAid", "Recordatorio de medicamentos, agenda de citas y botón de pánico con aviso a la familia.", "", "si"),
    ],
)


def public_service(s):
    return {"id": s["id"], "name": s["nombre"], "description": s["descripcion"], "price": s["precio"], "active": s["activo"] != "no"}


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
            "email": u.get("email", ""), "bloodType": u.get("tipo_sangre", ""), "client": u.get("cliente", ""),
            "docType": u.get("tipo_documento", ""), "document": u.get("documento", ""),
            "hasPassword": bool(u.get("contraseña")), "catalogSent": u.get("catalogo_enviado", ""),
            "education": u.get("escolaridad", ""), "license": u.get("pase_conduccion", ""),
            "licenseVehicle": u.get("pase_vehiculo", ""),
            "licenseCategories": [c for c in u.get("pase_categorias", "").split(",") if c],
            "socialSecurity": u.get("seguridad_social", ""),
            "attachments": user_attachments(u)}


def user_attachments(u):
    """{clase: nombre del archivo}. Los títulos se guardan como «a.pdf|b.pdf» y salen como titulos-1, titulos-2…"""
    out = {k: u[col] for k, (_, col, _, _) in ATTACHMENT_KINDS.items() if k != "titulos" and u.get(col)}
    titles = [t for t in (u.get("adjunto_titulos") or "").split("|") if t]
    out.update({f"titulos-{i}": name for i, name in enumerate(titles, 1)})
    return out


def validate_document(doc_type, number, whose):
    """Valida tipo y número de documento. Quita puntos y espacios (1.234.567 → 1234567). Devuelve (tipo, número, error)."""
    doc_type = str(doc_type or "").upper()
    number = re.sub(r"[.\s]", "", str(number or "")).upper()
    if doc_type not in DOC_TYPES:
        return None, None, f"Seleccione el tipo de documento {whose}."
    if doc_type in ("CC", "CE"):
        if not re.fullmatch(r"[0-9]{4,12}", number):
            return None, None, f"El número de documento {whose} debe tener de 4 a 12 dígitos."
    elif not re.fullmatch(r"[A-Z0-9]{4,20}", number):
        return None, None, f"El número de documento {whose} debe tener de 4 a 20 letras o números."
    return doc_type, number, None


def document_owner(users, doc_type, number):
    return next((u for u in users if u.get("tipo_documento") == doc_type and u.get("documento") == number), None)


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


def collaborator_profile(data):
    """Valida la ficha del colaborador y sus PDF. Devuelve (campos, {clase: adjunto}, error)."""
    education = str(data.get("education") or "")
    if education not in EDUCATION:
        return None, None, "Seleccione su grado de escolaridad."
    fields = {"escolaridad": education, "pase_conduccion": "", "pase_vehiculo": "", "pase_categorias": "",
              "seguridad_social": ""}
    fields.update({column: "" for _, column, _, _ in ATTACHMENT_KINDS.values()})
    kinds = ["documento"]  # adjuntos obligatorios según las respuestas
    license_ = data.get("license")
    if license_ not in ("si", "no"):
        return None, None, "Indique si tiene pase de conducción."
    fields["pase_conduccion"] = license_
    if license_ == "si":
        vehicle = data.get("licenseVehicle")
        if vehicle not in VEHICLES:
            return None, None, "Indique si su pase es para carro, moto o ambos."
        categories = data.get("licenseCategories") or []
        allowed = [c for v in VEHICLES[vehicle] for c in LICENSE_CATEGORIES[v]]
        chosen = [c for c in allowed if c in categories]  # en orden y sin repetidos
        for v in VEHICLES[vehicle]:
            if not any(c in LICENSE_CATEGORIES[v] for c in chosen):
                return None, None, f"Seleccione la categoría de su pase para {v}."
        fields.update(pase_vehiculo=vehicle, pase_categorias=",".join(chosen))
        kinds.append("pase")
    social = data.get("socialSecurity")
    if social not in ("si", "no"):
        return None, None, "Indique si está afiliado a seguridad social como independiente."
    fields["seguridad_social"] = social
    if social == "si":  # afiliado como independiente: salud, pensión y ARL
        kinds += ["salud", "pension", "arl"]
    return attach_files(data, fields, kinds)


def caregiver_profile(data):
    """Ficha del cuidador que se registra: escolaridad, títulos (opcionales, uno o varios), RUT, certificados de
    salud, pensión y ARL como independiente y certificado del RETHUS. Devuelve (campos, {clase: adjunto}, error)."""
    education = str(data.get("education") or "")
    if education not in EDUCATION:
        return None, None, "Seleccione su nivel de escolaridad."
    fields = {"escolaridad": education, "seguridad_social": "si"}
    fields.update({column: "" for _, column, _, _ in ATTACHMENT_KINDS.values()})
    titles = data.get("titlesFiles") or []
    if not isinstance(titles, list):
        return None, None, "Los títulos adjuntos no son válidos."
    if len(titles) > MAX_TITLES:
        return None, None, f"Puede adjuntar como máximo {MAX_TITLES} títulos."
    title_files = {}
    for i, value in enumerate(titles, 1):
        title, error = decode_pdf(value, "titulos")
        if error:
            return None, None, f"Título {i}: {error}"
        title_files[f"titulos-{i}"] = {**title, "clase": f"titulos-{i}"}
    fields, files, error = attach_files(data, fields, ["rut", "salud", "pension", "arl", "rethus"])
    if error:
        return None, None, error
    fields["adjunto_titulos"] = "|".join(t["nombre_archivo"] for t in title_files.values())
    return fields, {**title_files, **files}, None


def attach_files(data, fields, kinds):
    """Valida los PDF obligatorios de esas clases y anota su nombre en `fields`."""
    files = {}
    for kind in kinds:
        key, column, _, _ = ATTACHMENT_KINDS[kind]
        files[kind], error = decode_pdf(data.get(key), kind)
        if error:
            return None, None, error
        fields[column] = files[kind]["nombre_archivo"]
    return fields, files, None


def decode_pdf(value, kind):
    """{name, data (base64)} → fila de ATTACHMENTS sin usuario. Solo PDF, con el tamaño máximo de su clase."""
    import base64
    import binascii
    _, _, max_kb, what = ATTACHMENT_KINDS[kind]
    if not isinstance(value, dict) or not value.get("data"):
        return None, f"Adjunte {what} en PDF."
    try:
        raw = base64.b64decode(str(value["data"]), validate=True)
    except (binascii.Error, ValueError):
        return None, f"El archivo con {what} no es válido."
    if not raw.startswith(b"%PDF"):
        return None, f"El archivo con {what} debe ser un PDF."
    if len(raw) > max_kb * 1024:
        return None, f"El PDF con {what} no puede pesar más de {max_kb} KB."
    stem = re.sub(r"[^\w\-. ]", "", Path(str(value.get("name") or "")).stem, flags=re.UNICODE).strip()[:60]
    return {"clase": kind, "nombre_archivo": f"{stem or kind}.pdf", "fecha": now(),
            "contenido": base64.b64encode(raw).decode("ascii")}, None


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


def sign_up(data, role, registered_by=""):
    """Alta de un familiar responsable (con su adulto mayor, pendiente de alta), de un cuidador o de un colaborador.
    La usan el registro público y el administrador. Devuelve (cuenta, error)."""
    # Todos los roles del registro: dirección, celular y correo obligatorios.
    extra = {"direccion": clean(data.get("address"), 120), "celular": clean(data.get("mobile"), 20),
             "email": clean(data.get("email"), 80)}
    if not extra["direccion"]:
        return None, "Escriba su dirección."
    if not PHONE_RE.match(extra["celular"]):
        return None, "Escriba un número de celular válido (7 a 20 dígitos)."
    if not EMAIL_RE.match(extra["email"]):
        return None, "Escriba un correo electrónico válido."
    elder = files = None
    if role in DOCUMENT_ROLES:
        whose = "del familiar responsable" if role == "cliente" else "del colaborador"
        doc_type, doc, error = validate_document(data.get("docType"), data.get("document"), whose)
        if error:
            return None, error
        extra.update({"tipo_documento": doc_type, "documento": doc})
    if role in ATTACHMENT_ROLES:
        profile, files, error = (collaborator_profile if role == "colaborador" else caregiver_profile)(data)
        if error:
            return None, error
        extra.update(profile)
    if role == "cliente":
        # Datos del adulto mayor a cargo del familiar responsable.
        elder_name = str(data.get("elderName") or "").strip()
        error = validate_name(elder_name) and "Escriba el nombre completo del usuario (adulto mayor)."
        if error:
            return None, error
        e_type, e_doc, error = validate_document(data.get("elderDocType"), data.get("elderDocument"), "del usuario")
        if error:
            return None, error
        if (e_type, e_doc) == (doc_type, doc):
            return None, "El documento del usuario no puede ser el mismo que el del familiar responsable."
        elder = {"nombre": elder_name[:80], "tipo_documento": e_type, "documento": e_doc,
                 "direccion": clean(data.get("elderAddress"), 120), "celular": clean(data.get("elderMobile"), 20),
                 "email": clean(data.get("elderEmail"), 80), "tipo_sangre": str(data.get("elderBloodType") or "")}
        if not elder["direccion"]:
            return None, "Escriba la dirección del usuario (adulto mayor)."
        if not PHONE_RE.match(elder["celular"]):
            return None, "Escriba un celular válido para el usuario (7 a 20 dígitos)."
        if elder["tipo_sangre"] not in BLOOD_TYPES:
            return None, "Seleccione el tipo de sangre del usuario."
        if elder["email"] and not EMAIL_RE.match(elder["email"]):
            return None, "El correo electrónico del usuario no es válido."
    with lock:
        users = read_users()
        error = None
        if role in DOCUMENT_ROLES and document_owner(users, extra["tipo_documento"], extra["documento"]):
            error = "Ya hay una cuenta registrada con su documento de identidad."
        elif role == "cliente":
            if document_owner(users, elder["tipo_documento"], elder["documento"]):
                error = "Ese adulto mayor ya está registrado en SilverAid."
            else:
                # El adulto mayor entra con su número de documento; la contraseña se la asigna el administrador.
                elder["usuario"] = next((n for n in (elder["documento"].lower(),
                                                     (elder["tipo_documento"] + elder["documento"]).lower())
                                         if not find_user(users, n)), None)
                if not elder["usuario"]:
                    error = "Ese adulto mayor ya está registrado en SilverAid."
                elif elder["usuario"] == str(data.get("username", "")).strip().lower():
                    error = "Elija un nombre de usuario distinto al documento del adulto mayor."
        user = None
        if not error:
            user, error = new_account(users, data, role, "activo", registered_by)
        if user:
            user.update(extra)
            if elder:
                row = {field: "" for field in USERS.fields}
                row.update(elder, rol="usuario", estado="pendiente", registrado_por=user["usuario"],
                           fecha_registro=now(), cliente=user["usuario"])
                users.append(row)
            if files:
                key = user["usuario"].lower()
                rows = [a for a in ATTACHMENTS.read() if a["usuario"].lower() != key]
                ATTACHMENTS.write(rows + [{**f, "id": f"{key}:{kind}", "usuario": user["usuario"]} for kind, f in files.items()])
            USERS.write(users)
    if error:
        return None, error
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

    def read_json(self, limit=20_000):
        length = int(self.headers.get("Content-Length") or 0)
        if length > limit:
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

    def end_headers(self):
        # Páginas, estilos y scripts: el navegador debe comprobar si cambiaron (si no, responde 304),
        # para que nunca muestre una versión antigua después de actualizar SilverAid.
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

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

        elif path == "/api/admin/services":
            if self.auth("admin"):
                with lock:
                    rows = SERVICES.read()
                self.send_json(HTTPStatus.OK, {"services": [public_service(s) for s in rows]})

        elif path == "/api/admin/caregivers":
            if self.auth("admin"):
                with lock:
                    rows = CAREGIVERS.read()
                self.send_json(HTTPStatus.OK, {"caregivers": [full_caregiver(c) for c in rows]})

        elif m := re.fullmatch(r"/api/admin/users/([^/]+)/attachments/([a-z]+(?:-[0-9]+)?)", path):
            if self.auth("admin"):
                key = f"{m.group(1).lower()}:{m.group(2)}"
                with lock:
                    doc = next((a for a in ATTACHMENTS.read() if a["id"] == key), None)
                if not doc:
                    return self.fail(HTTPStatus.NOT_FOUND, "Esa persona no adjuntó ese archivo.")
                self.send_json(HTTPStatus.OK, {"name": doc["nombre_archivo"], "type": "application/pdf",
                                               "date": doc["fecha"], "data": doc["contenido"]})

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
        # El registro de colaboradores y cuidadores trae sus PDF (cuidador: hasta 5 + 5 × 300 KB, en base64).
        data = self.read_json(4_500_000 if path == "/api/register" else 20_000)
        if data is None:
            return self.fail(HTTPStatus.BAD_REQUEST, "Petición no válida o demasiado grande.")

        if path == "/api/login":
            return self.login(data)

        if path == "/api/logout":
            sessions.pop(self.token(), None)
            return self.send_json(HTTPStatus.OK, {"ok": True})

        if path == "/api/register":
            role = data.get("role")
            if role not in SELF_SIGNUP_ROLES:
                return self.fail(HTTPStatus.BAD_REQUEST,
                                 "Elija «Familiar responsable», «Cuidador/a» o «Colaborador/a». "
                                 "Las cuentas de adultos mayores las crea su familiar.")
            user, error = sign_up(data, role)
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

        if path == "/api/admin/clients":
            # El administrador crea un cliente con los mismos datos que el registro público.
            admin = self.auth("admin")
            if not admin:
                return
            user, error = sign_up(data, "cliente", admin["usuario"])
            if error:
                return self.fail(HTTPStatus.BAD_REQUEST, error)
            return self.send_json(HTTPStatus.CREATED, {"user": public_user(user)})

        m = re.fullmatch(r"/api/admin/users/([^/]+)/catalog", path)
        if m:
            # Se ha enviado el catálogo por WhatsApp o correo (desde el navegador del admin): se anota.
            if not self.auth("admin"):
                return
            channel = {"whatsapp": "WhatsApp", "email": "correo"}.get(data.get("channel"))
            if not channel:
                return self.fail(HTTPStatus.BAD_REQUEST, "Canal no válido.")
            with lock:
                users = read_users()
                user = find_user(users, m.group(1))
                if not user or user["rol"] != "cliente":
                    return self.fail(HTTPStatus.NOT_FOUND, "El cliente no existe.")
                user["catalogo_enviado"] = f"{now()} · {channel}"
                USERS.write(users)
            return self.send_json(HTTPStatus.OK, {"user": public_user(user)})

        if path == "/api/admin/services":
            if not self.auth("admin"):
                return
            return self.save_service(data)

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
                if status == "activo" and not user["contraseña"]:
                    return self.fail(HTTPStatus.BAD_REQUEST,
                                     f"{user['nombre']} todavía no tiene contraseña. Pulse «Editar» en Usuarios, "
                                     "asígnele una y complete su ficha antes de darle de alta.")
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

        m = re.fullmatch(r"/api/admin/services/([^/]+)", path)
        if m:
            if not self.auth("admin"):
                return
            return self.save_service(data, m.group(1))

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
                if user["rol"] in ATTACHMENT_ROLES:
                    ATTACHMENTS.write([a for a in ATTACHMENTS.read() if a["usuario"].lower() != target.lower()])
            drop_sessions(target)
            return self.send_json(HTTPStatus.OK, {"ok": True})

        m = re.fullmatch(r"/api/admin/services/([^/]+)", path)
        if m:
            if not self.auth("admin"):
                return
            with lock:
                rows = SERVICES.read()
                service = next((s for s in rows if s["id"] == m.group(1)), None)
                if not service:
                    return self.fail(HTTPStatus.NOT_FOUND, "El servicio no existe.")
                rows.remove(service)
                SERVICES.write(rows)
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
                        ATTACHMENTS.write([a for a in ATTACHMENTS.read() if a["usuario"].lower() != cg["usuario"].lower()])
                        drop_sessions(cg["usuario"])
            return self.send_json(HTTPStatus.OK, {"ok": True})

        self.fail(HTTPStatus.NOT_FOUND, "Ruta no encontrada.")

    # --- acciones
    def login(self, data):
        username = str(data.get("username", "")).strip()
        password = str(data.get("password", ""))
        with lock:
            user = find_user(read_users(), username)
        if not user or not user["contraseña"] or not secrets.compare_digest(user["contraseña"].encode(), password.encode()):
            return self.fail(HTTPStatus.UNAUTHORIZED, "Usuario o contraseña incorrectos.")
        if user["estado"] == "pendiente":
            return self.fail(HTTPStatus.FORBIDDEN, "Su cuenta está pendiente de alta. El administrador de SilverAid la revisará pronto.")
        if user["estado"] != "activo":
            return self.fail(HTTPStatus.FORBIDDEN, "Su cuenta está desactivada. Contacte con el administrador.")
        token = secrets.token_urlsafe(32)
        sessions[token] = user["usuario"].lower()
        self.send_json(HTTPStatus.OK, {"token": token, "user": public_user(user)})

    def save_service(self, data, service_id=None):
        """Crea (service_id=None) o actualiza un servicio del catálogo."""
        name = clean(data.get("name"), 80)
        description = clean(data.get("description"), 400)
        price = clean(data.get("price"), 40)
        if not name:
            return self.fail(HTTPStatus.BAD_REQUEST, "Escriba el nombre del servicio.")
        with lock:
            rows = SERVICES.read()
            if service_id:
                service = next((s for s in rows if s["id"] == service_id), None)
                if not service:
                    return self.fail(HTTPStatus.NOT_FOUND, "El servicio no existe.")
            else:
                service = {"id": "s" + secrets.token_hex(4)}
                rows.append(service)
            service.update({"nombre": name, "descripcion": description, "precio": price,
                            "activo": "no" if data.get("active") is False else "si"})
            SERVICES.write(rows)
        return self.send_json(HTTPStatus.OK if service_id else HTTPStatus.CREATED, {"service": public_service(service)})

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
    if STORAGE == "mysql":
        wait_for_mysql()
    with lock:
        # Crea los archivos o tablas si no existen y actualiza los datos de versiones anteriores.
        for table in (USERS, CAREGIVERS, SOS, SERVICES, ATTACHMENTS):
            table.setup()
        users = read_users()
        for u in users:  # adultos mayores registrados por un cliente antes de existir el campo «cliente»
            if u["rol"] == "usuario" and not u["cliente"] and u["registrado_por"]:
                u["cliente"] = u["registrado_por"]
        USERS.write(users)
        migrate_caregivers()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    where = f"MySQL {MYSQL['user']}@{MYSQL['host']}:{MYSQL['port']}/{MYSQL['database']}" if STORAGE == "mysql" else DATA
    print(f"SilverAid en http://{'localhost' if HOST in ('127.0.0.1', '0.0.0.0') else HOST}:{PORT}   (datos en {where})")
    print("Pulse Ctrl+C para detener.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detenido.")


if __name__ == "__main__":
    main()
