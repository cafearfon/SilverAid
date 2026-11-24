"""SilverAid — almacenamiento en MongoDB (STORAGE=mongo).

server.py trabaja con filas planas en español (las mismas de los .txt y de MySQL): read() → lista de diccionarios
y write(lista). Aquí cada tabla tiene un «codec» que convierte esas filas en documentos de MongoDB con nombres en
inglés y tipos reales (fechas, booleanos, listas, ObjectId), y al revés. write() no reescribe la colección: compara
con lo guardado y solo inserta, reemplaza o borra los documentos que cambiaron.

Colecciones (base de datos MONGO_DATABASE, por defecto «silveraid»):

    users        una cuenta por persona: username (único, sin distinguir mayúsculas), passwordHash, name, role,
                 status, registeredBy, registeredAt, idDocument {type, number},
                 contact {address, phone, mobile, email},
                 elder {bloodType, clientId, health {diseases[], mobility}}        (adulto mayor)
                 worker {education, driving {license, vehicle, categories[]}, socialSecurity}  (cuidador, colaborador)
                 catalogSent {at, channel}                                          (cliente)
                 documents {documento|pase|salud|pension|arl|rut|rethus|pago: {fileName}, titulos: [{fileName}]}
    caregivers   ficha pública de cada cuidador: code, name, idNumber, birthDate, contact, zone, title,
                 yearsExperience, skills[], availability {lun: [8, 9], …}, userId, registeredAt
    family       adulto mayor ↔ familiar responsable: elderId, memberId, relation, status, requestedBy, requestedAt
    attachments  PDF: userId, kind, fileName, uploadedAt, contentType, data (binario)
    appStates    datos de la app de cada usuario (sincronizados desde IndexedDB): userId, updatedAt (ms), data {…}
    sosCalls     llamadas del botón de pánico: code, createdAt, userId, username, name, reason,
                 location (GeoJSON Point), status, attendedBy, attendedAt, note
    services     catálogo: code, name, description, price, active
    sessions     sesiones abiertas: _id (SHA-256 del token), userId, createdAt (caducan solas a los 30 días)

Las referencias a otra cuenta (registeredBy, elder.clientId, userId, elderId…) son el ObjectId de users. Si la fila
apunta a una cuenta que no existe, se guarda el nombre de usuario como texto para no perder el dato. Lo mismo con
las fechas: un texto que no tiene el formato «AAAA-MM-DD hh:mm:ss» se guarda tal cual.

Variables: MONGO_URI (si se indica, manda), o MONGO_HOST (127.0.0.1), MONGO_PORT (27017), MONGO_USER,
           MONGO_PASSWORD, MONGO_AUTH_SOURCE (admin); MONGO_DATABASE (silveraid).
"""
import base64
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus

from bson import ObjectId
from pymongo import MongoClient, ASCENDING, DESCENDING, InsertOne, ReplaceOne, DeleteMany
from pymongo.collation import Collation
from pymongo.errors import CollectionInvalid


def _uri():
    if os.environ.get("MONGO_URI"):
        return os.environ["MONGO_URI"]
    host = os.environ.get("MONGO_HOST", "127.0.0.1")
    port = os.environ.get("MONGO_PORT", "27017")
    user = os.environ.get("MONGO_USER", "")
    auth = f"{quote_plus(user)}:{quote_plus(os.environ.get('MONGO_PASSWORD', ''))}@" if user else ""
    return f"mongodb://{auth}{host}:{port}/?authSource={os.environ.get('MONGO_AUTH_SOURCE', 'admin')}"


DATABASE = os.environ.get("MONGO_DATABASE", "silveraid")
CI = Collation("en", strength=2)  # comparación sin distinguir mayúsculas (nombres de usuario)
SESSION_TTL = 30 * 24 * 3600
_client = None


def db():
    global _client
    if _client is None:  # MongoClient es seguro entre hilos: uno para todo el servidor
        _client = MongoClient(_uri(), serverSelectionTimeoutMS=10_000, connectTimeoutMS=10_000)
    return _client[DATABASE]


def describe():
    host = re.sub(r"//[^@/]*@", "//", _uri())  # sin la contraseña
    return f"MongoDB {host.split('?')[0]}{DATABASE}"


def ping():
    db().command("ping")


# ------------------------------------------------------------------ conversiones
STAMP = "%Y-%m-%d %H:%M:%S"
DAY = "%Y-%m-%d"
DAYS = ("lun", "mar", "mie", "jue", "vie", "sab", "dom")


def to_date(text, fmt=STAMP):
    if not text:
        return None
    try:
        return datetime.strptime(text, fmt)
    except ValueError:
        return text  # formato desconocido: se conserva el texto


def from_date(value, fmt=STAMP):
    if value is None or value == "":
        return ""
    return value.strftime(fmt) if isinstance(value, datetime) else str(value)


def to_bool(value):
    """«si»/«no» → True/False; vacío → None; otro texto se conserva."""
    return {"si": True, "no": False}.get(value, value or None)


def from_bool(value):
    return "si" if value is True else "no" if value is False else (value or "")


def to_int(text):
    if text in (None, ""):
        return None
    return int(text) if re.fullmatch(r"-?[0-9]+", str(text)) else text


def split(text, sep=","):
    return [p for p in (text or "").split(sep) if p.strip()]


def prune(doc):
    """Quita los campos vacíos (None, "", {} y []), también dentro de los subdocumentos. False y 0 se conservan."""
    out = {}
    for key, value in doc.items():
        if isinstance(value, dict):
            value = prune(value)
        if value is None or (isinstance(value, (str, dict, list)) and not value):
            continue
        out[key] = value
    return out


def dig(doc, *path):
    for key in path:
        if not isinstance(doc, dict):
            return None
        doc = doc.get(key)
    return doc


def text(value):
    return "" if value is None else str(value)


class UserIds:
    """Nombre de usuario ↔ ObjectId de las cuentas guardadas (se carga en cada lectura o escritura)."""

    def __init__(self):
        self.by_name, self.by_id = {}, {}
        for u in db().users.find({}, {"username": 1}):
            self.add(u["username"], u["_id"])

    def add(self, name, oid):
        self.by_name[name.lower()] = oid
        self.by_id[oid] = name

    def ref(self, name):
        """Nombre → ObjectId (o el propio nombre si esa cuenta no existe); vacío → None."""
        if not name:
            return None
        return self.by_name.get(name.lower(), name)

    def name(self, ref):
        if ref is None:
            return ""
        return self.by_id.get(ref, "") if isinstance(ref, ObjectId) else str(ref)


# ------------------------------------------------------------------ codecs
# Cada codec: collection, encode(fila, ids) → documento, decode(documento, ids) → fila, key(documento) → clave
# natural (para emparejar filas y documentos al escribir), owner (campo del usuario dueño, si lo hay), schema
# ($jsonSchema) e indexes.

STR = {"bsonType": "string"}
STR_LIST = {"bsonType": "array", "items": STR}
DATE = {"bsonType": ["date", "string"]}
REF = {"bsonType": ["objectId", "string"]}
CONTACT = {"bsonType": "object", "properties": {"address": STR, "phone": STR, "mobile": STR, "email": STR}}

ROLES = ["usuario", "cliente", "familiar", "cuidador", "colaborador", "admin", "user"]  # «user»: versión antigua
STATUSES = ["activo", "pendiente", "inactivo", "verificacion"]
# Documento adjunto → columna de users donde se anota el nombre del archivo (los títulos van aparte).
DOC_COLUMNS = {"documento": "adjunto_documento", "pase": "adjunto_pase", "salud": "certificado",
               "pension": "adjunto_pension", "arl": "adjunto_arl", "rut": "adjunto_rut",
               "rethus": "adjunto_rethus", "pago": "adjunto_pago"}
CATALOG_RE = re.compile(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) · (.+)")


class Users:
    collection = "users"
    owner = None

    @staticmethod
    def key(doc):
        return doc["username"].lower()

    @staticmethod
    def encode(r, ids):
        m = CATALOG_RE.fullmatch(r.get("catalogo_enviado") or "")
        catalog = {"at": to_date(m.group(1)), "channel": m.group(2)} if m else r.get("catalogo_enviado")
        documents = {kind: {"fileName": r[col]} for kind, col in DOC_COLUMNS.items() if r.get(col)}
        documents["titulos"] = [{"fileName": t} for t in split(r.get("adjunto_titulos"), "|")]
        return prune({
            "username": r["usuario"],
            "passwordHash": r.get("contraseña"),
            "name": r.get("nombre"),
            "role": r.get("rol"),
            "status": r.get("estado"),
            "registeredBy": ids.ref(r.get("registrado_por")),
            "registeredAt": to_date(r.get("fecha_registro")),
            "idDocument": {"type": r.get("tipo_documento"), "number": r.get("documento")},
            "contact": {"address": r.get("direccion"), "phone": r.get("telefono"),
                        "mobile": r.get("celular"), "email": r.get("email")},
            "elder": {"bloodType": r.get("tipo_sangre"), "clientId": ids.ref(r.get("cliente")),
                      "health": {"diseases": split(r.get("enfermedades")), "mobility": r.get("movilidad")}},
            "worker": {"education": r.get("escolaridad"),
                       "driving": {"license": to_bool(r.get("pase_conduccion")), "vehicle": r.get("pase_vehiculo"),
                                   "categories": split(r.get("pase_categorias"))},
                       "socialSecurity": to_bool(r.get("seguridad_social"))},
            "catalogSent": catalog,
            "documents": documents,
        })

    @staticmethod
    def decode(d, ids):
        catalog = d.get("catalogSent")
        if isinstance(catalog, dict):
            catalog = f"{from_date(catalog.get('at'))} · {catalog.get('channel', '')}"
        documents = d.get("documents") or {}
        row = {
            "usuario": d["username"], "contraseña": text(d.get("passwordHash")), "nombre": text(d.get("name")),
            "rol": text(d.get("role")), "estado": text(d.get("status")),
            "registrado_por": ids.name(d.get("registeredBy")), "fecha_registro": from_date(d.get("registeredAt")),
            "tipo_documento": text(dig(d, "idDocument", "type")), "documento": text(dig(d, "idDocument", "number")),
            "direccion": text(dig(d, "contact", "address")), "telefono": text(dig(d, "contact", "phone")),
            "celular": text(dig(d, "contact", "mobile")), "email": text(dig(d, "contact", "email")),
            "tipo_sangre": text(dig(d, "elder", "bloodType")), "cliente": ids.name(dig(d, "elder", "clientId")),
            "enfermedades": ",".join(dig(d, "elder", "health", "diseases") or []),
            "movilidad": text(dig(d, "elder", "health", "mobility")),
            "escolaridad": text(dig(d, "worker", "education")),
            "pase_conduccion": from_bool(dig(d, "worker", "driving", "license")),
            "pase_vehiculo": text(dig(d, "worker", "driving", "vehicle")),
            "pase_categorias": ",".join(dig(d, "worker", "driving", "categories") or []),
            "seguridad_social": from_bool(dig(d, "worker", "socialSecurity")),
            "catalogo_enviado": text(catalog),
            "adjunto_titulos": "|".join(t.get("fileName", "") for t in documents.get("titulos") or []),
        }
        row.update({col: text(dig(documents, kind, "fileName")) for kind, col in DOC_COLUMNS.items()})
        return row

    schema = {
        "bsonType": "object",
        "required": ["username", "role"],
        "properties": {
            "username": {"bsonType": "string", "minLength": 1, "maxLength": 64},
            "passwordHash": {"bsonType": "string", "pattern": "^pbkdf2_sha256\\$"},
            "name": STR,
            "role": {"enum": ROLES},
            "status": {"enum": STATUSES},
            "registeredBy": REF,
            "registeredAt": DATE,
            "idDocument": {"bsonType": "object", "properties": {"type": STR, "number": STR}},
            "contact": CONTACT,
            "elder": {"bsonType": "object", "properties": {
                "bloodType": {"enum": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]},
                "clientId": REF,
                "health": {"bsonType": "object", "properties": {"diseases": STR_LIST, "mobility": STR}},
            }},
            "worker": {"bsonType": "object", "properties": {
                "education": STR,
                "driving": {"bsonType": "object", "properties": {
                    "license": {"bsonType": ["bool", "string"]}, "vehicle": STR, "categories": STR_LIST}},
                "socialSecurity": {"bsonType": ["bool", "string"]},
            }},
            "catalogSent": {"bsonType": ["object", "string"]},
            "documents": {"bsonType": "object"},
        },
    }
    indexes = [
        ([("username", ASCENDING)], {"unique": True, "collation": CI, "name": "username_unique"}),
        ([("idDocument.type", ASCENDING), ("idDocument.number", ASCENDING)], {"name": "id_document"}),
        ([("elder.clientId", ASCENDING)], {"name": "elder_client", "sparse": True}),
        ([("role", ASCENDING), ("status", ASCENDING)], {"name": "role_status"}),
    ]


def parse_availability(value):
    """«lun=8,9|mar=14» → {"lun": [8, 9], "mar": [14]}; otro formato se conserva como texto."""
    if not value:
        return None
    out = {}
    for part in value.split("|"):
        day, _, hours = part.partition("=")
        if day not in DAYS or not re.fullmatch(r"[0-9]+(,[0-9]+)*", hours):
            return value
        out[day] = [int(h) for h in hours.split(",")]
    return out


def dump_availability(value):
    if isinstance(value, dict):
        return "|".join(f"{d}={','.join(map(str, value[d]))}" for d in DAYS if value.get(d))
    return text(value)


class Caregivers:
    collection = "caregivers"
    owner = None

    @staticmethod
    def key(doc):
        return doc["code"]

    @staticmethod
    def encode(r, ids):
        return prune({
            "code": r["id"], "name": r.get("nombre"), "idNumber": r.get("documento"),
            "birthDate": to_date(r.get("fecha_nacimiento"), DAY),
            "contact": {"phone": r.get("telefono"), "email": r.get("email"), "address": r.get("direccion")},
            "zone": r.get("zona"), "title": r.get("titulo"), "yearsExperience": to_int(r.get("experiencia")),
            "skills": split(r.get("habilidades")), "availability": parse_availability(r.get("disponibilidad")),
            "userId": ids.ref(r.get("usuario")), "registeredAt": to_date(r.get("fecha_registro")),
        })

    @staticmethod
    def decode(d, ids):
        return {
            "id": d["code"], "nombre": text(d.get("name")), "documento": text(d.get("idNumber")),
            "fecha_nacimiento": from_date(d.get("birthDate"), DAY),
            "telefono": text(dig(d, "contact", "phone")), "email": text(dig(d, "contact", "email")),
            "direccion": text(dig(d, "contact", "address")), "zona": text(d.get("zone")), "titulo": text(d.get("title")),
            "experiencia": text(d.get("yearsExperience")), "habilidades": ",".join(d.get("skills") or []),
            "disponibilidad": dump_availability(d.get("availability")),
            "usuario": ids.name(d.get("userId")), "fecha_registro": from_date(d.get("registeredAt")),
        }

    schema = {
        "bsonType": "object",
        "required": ["code", "name"],
        "properties": {
            "code": STR, "name": STR, "idNumber": STR, "birthDate": DATE, "contact": CONTACT, "zone": STR,
            "title": STR, "yearsExperience": {"bsonType": ["int", "long", "string"]}, "skills": STR_LIST,
            "availability": {"bsonType": ["object", "string"]}, "userId": REF, "registeredAt": DATE,
        },
    }
    indexes = [
        ([("code", ASCENDING)], {"unique": True, "name": "code_unique"}),
        ([("idNumber", ASCENDING)], {"name": "id_number"}),
        ([("userId", ASCENDING)], {"name": "user", "sparse": True}),
    ]


class Family:
    collection = "family"
    owner = None

    @staticmethod
    def key(doc):
        return doc.get("elderId"), doc.get("memberId")

    @staticmethod
    def encode(r, ids):
        return prune({
            "elderId": ids.ref(r.get("adulto")), "memberId": ids.ref(r.get("familiar")),
            "relation": r.get("parentesco"), "status": r.get("estado"),
            "requestedBy": ids.ref(r.get("solicitado_por")), "requestedAt": to_date(r.get("fecha")),
        })

    @staticmethod
    def decode(d, ids):
        elder, member = ids.name(d.get("elderId")), ids.name(d.get("memberId"))
        return {"id": f"{elder.lower()}:{member.lower()}", "adulto": elder, "familiar": member,
                "parentesco": text(d.get("relation")), "estado": text(d.get("status")),
                "solicitado_por": ids.name(d.get("requestedBy")), "fecha": from_date(d.get("requestedAt"))}

    schema = {
        "bsonType": "object",
        "required": ["elderId", "memberId", "status"],
        "properties": {"elderId": REF, "memberId": REF, "relation": STR, "status": {"enum": ["activo", "pendiente"]},
                       "requestedBy": REF, "requestedAt": DATE},
    }
    indexes = [
        ([("elderId", ASCENDING), ("memberId", ASCENDING)], {"unique": True, "name": "elder_member_unique"}),
        ([("memberId", ASCENDING)], {"name": "member"}),
    ]


class Attachments:
    collection = "attachments"
    owner = "userId"

    @staticmethod
    def key(doc):
        return doc.get("userId"), doc["kind"]

    @staticmethod
    def encode(r, ids):
        return prune({
            "userId": ids.ref(r.get("usuario")), "kind": r["clase"], "fileName": r.get("nombre_archivo"),
            "uploadedAt": to_date(r.get("fecha")), "contentType": "application/pdf",
            "data": base64.b64decode(r.get("contenido") or ""),
        })

    @staticmethod
    def decode(d, ids):
        user = ids.name(d.get("userId"))
        return {"id": f"{user.lower()}:{d['kind']}", "usuario": user, "clase": d["kind"],
                "nombre_archivo": text(d.get("fileName")), "fecha": from_date(d.get("uploadedAt")),
                "contenido": base64.b64encode(d.get("data") or b"").decode("ascii")}

    schema = {
        "bsonType": "object",
        "required": ["userId", "kind", "fileName", "data"],
        "properties": {"userId": REF, "kind": {"bsonType": "string", "pattern": "^[a-z]+(-[0-9]+)?$"},
                       "fileName": STR, "uploadedAt": DATE, "contentType": STR, "data": {"bsonType": "binData"}},
    }
    indexes = [([("userId", ASCENDING), ("kind", ASCENDING)], {"unique": True, "name": "user_kind_unique"})]


class AppStates:
    collection = "appStates"
    owner = "userId"

    @staticmethod
    def key(doc):
        return doc.get("userId")

    @staticmethod
    def encode(r, ids):
        # «data» es el estado de la app tal cual (no se poda: lo vacío también es dato del usuario)
        return {"userId": ids.ref(r.get("usuario")), "updatedAt": int(r.get("actualizado") or 0),
                "data": json.loads(base64.b64decode(r.get("contenido") or "") or b"{}")}

    @staticmethod
    def decode(d, ids):
        content = json.dumps(d.get("data") or {}, ensure_ascii=False).encode("utf-8")
        return {"usuario": ids.name(d.get("userId")).lower(), "actualizado": str(d.get("updatedAt") or 0),
                "contenido": base64.b64encode(content).decode("ascii")}

    schema = {
        "bsonType": "object",
        "required": ["userId", "updatedAt", "data"],
        "properties": {"userId": REF, "updatedAt": {"bsonType": ["long", "int"]}, "data": {"bsonType": "object"}},
    }
    indexes = [([("userId", ASCENDING)], {"unique": True, "name": "user_unique"})]


def to_point(lat, lng):
    try:
        return {"type": "Point", "coordinates": [float(lng), float(lat)]}
    except (TypeError, ValueError):
        return None


class SosCalls:
    collection = "sosCalls"
    owner = None

    @staticmethod
    def key(doc):
        return doc["code"]

    @staticmethod
    def encode(r, ids):
        return prune({
            "code": r["id"], "createdAt": to_date(r.get("fecha")),
            "userId": ids.ref(r.get("usuario")), "username": r.get("usuario"), "name": r.get("nombre"),
            "reason": r.get("motivo"), "location": to_point(r.get("lat"), r.get("lng")), "status": r.get("estado"),
            "attendedBy": ids.ref(r.get("atendido_por")), "attendedAt": to_date(r.get("fecha_atencion")),
            "note": r.get("nota"),
        })

    @staticmethod
    def decode(d, ids):
        lng, lat = dig(d, "location", "coordinates") or ("", "")
        return {"id": d["code"], "fecha": from_date(d.get("createdAt")),
                # el nombre de usuario se guarda también como texto: la llamada sigue legible si se borra la cuenta
                "usuario": ids.name(d.get("userId")) or text(d.get("username")), "nombre": text(d.get("name")),
                "motivo": text(d.get("reason")),
                "lat": f"{lat:.5f}" if lat != "" else "", "lng": f"{lng:.5f}" if lng != "" else "",
                "estado": text(d.get("status")), "atendido_por": ids.name(d.get("attendedBy")),
                "fecha_atencion": from_date(d.get("attendedAt")), "nota": text(d.get("note"))}

    schema = {
        "bsonType": "object",
        "required": ["code", "createdAt", "status"],
        "properties": {
            "code": STR, "createdAt": DATE, "userId": REF, "username": STR, "name": STR, "reason": STR,
            "location": {"bsonType": "object", "required": ["type", "coordinates"], "properties": {
                "type": {"enum": ["Point"]},
                "coordinates": {"bsonType": "array", "minItems": 2, "maxItems": 2, "items": {"bsonType": "double"}}}},
            "status": {"enum": ["pendiente", "atendida"]}, "attendedBy": REF, "attendedAt": DATE, "note": STR,
        },
    }
    indexes = [
        ([("code", ASCENDING)], {"unique": True, "name": "code_unique"}),
        ([("status", ASCENDING), ("createdAt", DESCENDING)], {"name": "status_date"}),
        ([("location", "2dsphere")], {"name": "location"}),
    ]


class Services:
    collection = "services"
    owner = None

    @staticmethod
    def key(doc):
        return doc["code"]

    @staticmethod
    def encode(r, ids):
        return prune({"code": r["id"], "name": r.get("nombre"), "description": r.get("descripcion"),
                      "price": r.get("precio"), "active": r.get("activo") != "no"})

    @staticmethod
    def decode(d, ids):
        return {"id": d["code"], "nombre": text(d.get("name")), "descripcion": text(d.get("description")),
                "precio": text(d.get("price")), "activo": "no" if d.get("active") is False else "si"}

    schema = {
        "bsonType": "object",
        "required": ["code", "name", "active"],
        # price es texto libre («$ 80.000 al mes», «Consultar»): así lo escribe el administrador
        "properties": {"code": STR, "name": STR, "description": STR, "price": STR, "active": {"bsonType": "bool"}},
    }
    indexes = [([("code", ASCENDING)], {"unique": True, "name": "code_unique"})]


CODECS = {"users": Users, "caregivers": Caregivers, "family": Family, "attachments": Attachments,
          "states": AppStates, "sos": SosCalls, "services": Services}


def ensure_collection(name, schema=None, indexes=()):
    """Crea la colección (o actualiza su validador) y sus índices. Devuelve True si la acaba de crear."""
    database = db()
    options = {"validator": {"$jsonSchema": schema}, "validationLevel": "strict",
               "validationAction": "error"} if schema else {}
    created = True
    try:
        database.create_collection(name, **options)
    except CollectionInvalid:  # ya existe
        created = False
        if schema:
            database.command("collMod", name, **options)
    for keys, opts in indexes:
        database[name].create_index(keys, **opts)
    return created


# ------------------------------------------------------------------ tabla
class MongoTable:
    """Misma interfaz que TextTable y MySQLTable (read/write de filas planas), sobre una colección de MongoDB.
    read(owner)/write(rows, owner) con owner (nombre de usuario) solo tocan los documentos de ese usuario
    (adjuntos y estados de la app)."""

    def __init__(self, filename, fields, seed=(), *, data_dir, text_reader):
        self.filename = filename
        self.fields = fields
        self.seed = seed
        self.legacy = Path(data_dir) / filename  # .txt a importar la primera vez
        self.text_reader = text_reader
        self.codec = CODECS[Path(filename).stem]
        # Arreglo de las filas importadas o de ejemplo antes de guardarlas (en users: el hash de las contraseñas,
        # que el validador exige).
        self.prepare_rows = None

    @property
    def col(self):
        return db()[self.codec.collection]

    def setup_schema(self):
        return ensure_collection(self.codec.collection, self.codec.schema, self.codec.indexes)

    def count(self):
        return self.col.estimated_document_count()

    def setup(self):
        """Crea la colección con su validador e índices. Solo al crearla importa el .txt o los datos de ejemplo
        (una colección que quedó vacía porque se borró todo no vuelve a importar datos viejos)."""
        if not self.setup_schema():
            return
        if self.legacy.exists():
            rows = self.text_reader(self.legacy, self.fields)
            print(f"  · {self.codec.collection}: importados {len(rows)} registros de {self.legacy.name}")
        else:
            rows = [dict(zip(self.fields, row)) for row in self.seed]
        self.import_rows(rows)

    def import_rows(self, rows):
        """Guarda filas que vienen de otro almacenamiento (reemplaza el contenido de la colección)."""
        if self.prepare_rows:
            self.prepare_rows(rows)
        self.write(rows)

    def _query(self, owner, ids):
        if owner is None or not self.codec.owner:
            return {}
        return {self.codec.owner: ids.ref(owner)}

    def read(self, owner=None):
        ids = UserIds()
        rows = []
        for doc in self.col.find(self._query(owner, ids)).sort("_id", ASCENDING):  # _id: orden de llegada
            row = dict.fromkeys(self.fields, "")
            row.update(self.codec.decode(doc, ids))
            rows.append(row)
        return rows

    def write(self, rows, owner=None):
        ids = UserIds()
        is_users = self.codec is Users
        if is_users:  # las cuentas nuevas reciben su ObjectId antes, para poder referirse unas a otras
            for r in rows:
                if r["usuario"].lower() not in ids.by_name:
                    ids.add(r["usuario"], ObjectId())
        existing = {self.codec.key(d): d for d in self.col.find(self._query(owner, ids))}
        ops, kept = [], set()
        for r in rows:
            doc = self.codec.encode(r, ids)
            key = self.codec.key(doc)
            old = existing.get(key)
            if old:
                doc["_id"] = old["_id"]
                if doc != old:
                    ops.append(ReplaceOne({"_id": old["_id"]}, doc))
            else:
                doc["_id"] = ids.by_name[key] if is_users else ObjectId()
                ops.append(InsertOne(doc))
            kept.add(key)
        gone = [d["_id"] for key, d in existing.items() if key not in kept]
        if gone:
            ops.append(DeleteMany({"_id": {"$in": gone}}))
        if ops:
            self.col.bulk_write(ops, ordered=True)


# ------------------------------------------------------------------ sesiones
SESSIONS_SCHEMA = {
    "bsonType": "object",
    "required": ["userId", "createdAt"],
    "properties": {"userId": {"bsonType": "objectId"}, "createdAt": {"bsonType": "date"}},
}


class MongoSessions:
    """Sesiones guardadas en MongoDB: sobreviven a un reinicio del servidor y caducan solas a los 30 días.
    Se guarda el SHA-256 del token, no el token."""

    def setup(self):
        ensure_collection("sessions", SESSIONS_SCHEMA, [
            ([("createdAt", ASCENDING)], {"expireAfterSeconds": SESSION_TTL, "name": "ttl"}),
            ([("userId", ASCENDING)], {"name": "user"}),
        ])

    @staticmethod
    def _id(token):
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _user(username):
        return db().users.find_one({"username": username}, {"username": 1}, collation=CI)

    def get(self, token):
        if not token:
            return None
        session = db().sessions.find_one({"_id": self._id(token)})
        user = session and db().users.find_one({"_id": session["userId"]}, {"username": 1})
        return user["username"].lower() if user else None

    def add(self, token, username):
        user = self._user(username)
        if user:
            db().sessions.insert_one({"_id": self._id(token), "userId": user["_id"],
                                      "createdAt": datetime.now(timezone.utc)})

    def remove(self, token):
        if token:
            db().sessions.delete_one({"_id": self._id(token)})

    def drop_user(self, username):
        user = self._user(username)
        if user:
            db().sessions.delete_many({"userId": user["_id"]})
