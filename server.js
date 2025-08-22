require("dotenv").config();
const express = require("express");
const mysql = require("mysql2/promise");
const fs = require("fs");
const session = require("express-session");

const MySQLStore = require("express-mysql-session")(session);

const path = require("path");
const cors = require("cors");
const multer = require("multer");
const nodemailer = require("nodemailer");
const bcrypt = require("bcrypt");
const ExcelJS = require("exceljs");
const saltRounds = 10;
const helmet = require("helmet");
const app = express();

function fail500(res, label, err) {
  console.error(`[${label}]`, err);
  return res.status(500).json({ success: false, message: "Error de servidor" });
}

/* ---------- NUEVO: confiar en proxy (Render) y CORS por variable ---------- */

app.set("trust proxy", 1); // cookies secure detrás de proxy (Render/Nginx)

const allowed = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// CORS más estricto: si no hay CORS_ORIGIN, no se permite desde otros orígenes
const allowAllIfEmpty = false;
app.use(
  cors({
    origin: (origin, cb) => {
      // llamadas del mismo origen / curl sin origin
      if (!origin) return cb(null, true);
      if (allowed.length === 0 && !allowAllIfEmpty)
        return cb(new Error("CORS blocked"));
      return allowed.includes(origin)
        ? cb(null, true)
        : cb(new Error("CORS blocked"));
    },
    credentials: true,
    exposedHeaders: ["Content-Disposition"], // <- para leer el nombre del archivo si usas fetch
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
const helmetOptions = {};
if (process.env.UPLOADS_CROSS_ORIGIN === "1") {
  // permite que otros dominios consuman /uploads (si tu frontend está en otro origen)
  helmetOptions.crossOriginResourcePolicy = { policy: "cross-origin" };
}
app.use(helmet(helmetOptions));
// ⬆️  FIN del bloque de helmet

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  createDatabaseTable: true, // crea tabla "sessions" si no existe
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000, // 15 min
  expiration: 7 * 24 * 60 * 60 * 1000, // 7 días
});

/* ---------- SESIONES (ajusta cookie para producción y posible cross-site) ---------- */
app.use(
  session({
    secret: process.env.SESSION_SECRET || "change-me",
    resave: false,
    saveUninitialized: false,
    store: sessionStore, // ⬅️ usar MySQL
    cookie: {
      maxAge: 3600000,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAMESITE || "lax",
    },
  })
);

/* ---------- NUEVO: uploads a carpeta configurable y servida estáticamente ---------- */
// En Render el FS es efímero; usa disco persistente y apunta UPLOAD_DIR, ej: /data/uploads
const UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, "public/form/uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allow = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (allow.includes(file.mimetype)) return cb(null, true);
    const byExt = /\.(pdf|png|jpe?g|docx?|xlsx?)$/i.test(
      file.originalname || ""
    );
    return cb(byExt ? null : new Error("Tipo de archivo no permitido"), byExt);
  },
});

// MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  ...(process.env.DB_SSL === "1" ? { ssl: { rejectUnauthorized: true } } : {}),
});
// Servir los adjuntos aunque estén fuera de /public
app.get("/uploads/:filename", ensureAuth, async (req, res) => {
  try {
    // 1) Normaliza y valida el nombre de archivo (evita traversal)
    const raw = String(req.params.filename || "");
    const filename = path.basename(raw); // corta cualquier "../"
    if (!/^[\w.\-\s]+$/.test(filename)) {
      return res.status(400).send("Nombre de archivo no válido");
    }

    // 2) Busca por ruta EXACTA (así la guardas en submit: `/uploads/${req.file.filename}`)
    const archivoRuta = `/uploads/${filename}`;
    const [rows] = await pool.query(
      "SELECT seq, responsable FROM respuestas_formulario WHERE archivo_ruta = ? LIMIT 1",
      [archivoRuta]
    );
    if (!rows.length) return res.status(404).send("No encontrado");

    // 3) Compara roles como NÚMERO (clave!)
    const rol = Number(req.session.rol_id);
    const uid = Number(req.session.userId);
    const { responsable } = rows[0];

    // Admin/Analista/Auditor ven todo; Responsable solo si es suyo
    if (rol === 3 && Number(responsable) !== uid) {
      return res.status(403).send("No autorizado");
    }

    // 4) Resuelve ruta física de forma segura y verifica que esté dentro de UPLOAD_DIR
    const abs = path.resolve(UPLOAD_DIR, filename);
    const base = path.resolve(UPLOAD_DIR) + path.sep;
    if (!abs.startsWith(base)) return res.status(400).send("Ruta inválida");
    if (!fs.existsSync(abs)) return res.status(404).send("No encontrado");

    // 5) Cabeceras útiles para descarga
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store");

    return res.sendFile(abs);
  } catch (e) {
    console.error("GET /uploads error:", e);
    return res.status(500).send("Error");
  }
});

// Nodemailer
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: +process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

/* ---------- NUEVO: health & db-ping para Render ---------- */
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "pqrsRender", time: new Date().toISOString() });
});
app.get("/api/db-ping", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows[0].ok });
  } catch (e) {
    console.error("[DB-PING]", e);
    res.status(500).json({ ok: false, error: "Error de base de datos" });
  }
});

async function gateDashboard(req, res, next) {
  if (!req.session?.userId) return res.redirect("/auth/index.html");
  try {
    const [[u]] = await pool.query("SELECT activo FROM usuarios WHERE id = ?", [
      req.session.userId,
    ]);
    if (!u || u.activo !== 1) {
      req.session.destroy(() => {});
      return res.redirect("/auth/index.html");
    }
    next();
  } catch (e) {
    console.error("gateDashboard error:", e);
    res.redirect("/auth/index.html");
  }
}

// Estáticos
app.use("/", express.static(path.join(__dirname, "public/form")));
app.use("/auth", express.static(path.join(__dirname, "public/auth")));
app.use(
  "/dashboard",
  gateDashboard,
  express.static(path.join(__dirname, "public/dashboard"))
);

async function ensureAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, message: "No autorizado" });
  }
  try {
    const [[u]] = await pool.query("SELECT activo FROM usuarios WHERE id = ?", [
      req.session.userId,
    ]);
    if (!u || u.activo !== 1) {
      req.session.destroy(() => {});
      return res
        .status(403)
        .json({ success: false, message: "Usuario inactivo" });
    }
    next();
  } catch (e) {
    console.error("ensureAuth error:", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
}

function normEstado(s) {
  return (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // si tu Node no soporta \p{...}, usa la versión de abajo
    .replace(/\s+/g, " ");
}
// Login / Logout
// LOGIN
app.post("/api/login", async (req, res) => {
  const { usuario, clave } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.clave_hash, u.nombre, u.activo, u.rol_id, r.nombre AS rol
       FROM usuarios u
       LEFT JOIN roles r ON u.rol_id = r.id
       WHERE u.usuario = ?`,
      [usuario]
    );

    if (rows.length !== 1) {
      return res
        .status(401)
        .json({ success: false, message: "Credenciales inválidas" });
    }

    const u = rows[0];

    if (u.activo !== 1) {
      return res
        .status(403)
        .json({ success: false, message: "Usuario inactivo" });
    }

    const match = await bcrypt.compare(clave, u.clave_hash);
    if (!match) {
      return res
        .status(401)
        .json({ success: false, message: "Credenciales inválidas" });
    }

    if (!u.rol_id || !u.rol) {
      return res
        .status(403)
        .json({ success: false, message: "Usuario sin rol asignado" });
    }

    req.session.regenerate((err) => {
      if (err) {
        console.error("Error al regenerar sesión:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error de servidor" });
      }

      req.session.userId = u.id;
      req.session.rol_id = u.rol_id;
      req.session.rol = u.rol;
      req.session.nombre = u.nombre;

      // 🔒 Importante: guarda la sesión ANTES de responder
      req.session.save((err2) => {
        if (err2) {
          console.error("Error al guardar sesión:", err2);
          return res
            .status(500)
            .json({ success: false, message: "Error de servidor" });
        }
        return res.json({
          success: true,
          rol: u.rol,
          rol_id: u.rol_id,
          user_id: u.id,
        });
      });
    });
  } catch (e) {
    console.error("[LOGIN]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

// CREAR USUARIO (ADMIN/ANALISTA)
app.post("/api/usuarios", ensureAuth, async (req, res) => {
  if (![1, 2].includes(req.session.rol_id)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }
  const { usuario, clave, nombre, correo, rol_id, sede } = req.body;
  if (!usuario || !clave || !nombre || !correo || !rol_id || !sede) {
    return res.status(400).json({ success: false, message: "Faltan campos" });
  }
  try {
    const [exist] = await pool.query(
      "SELECT id FROM usuarios WHERE usuario=?",
      [usuario]
    );
    if (exist.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Usuario ya existe" });
    }
    const clave_hash = await bcrypt.hash(clave, saltRounds);
    await pool.query(
      "INSERT INTO usuarios (usuario, clave_hash, nombre, correo, rol_id, sede) VALUES (?, ?, ?, ?, ?, ?)",
      [usuario, clave_hash, nombre, correo, rol_id, sede]
    );
    res.json({ success: true, message: "Usuario creado" });
  } catch (e) {
    console.error("[USUARIOS:CREATE]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      return res.sendStatus(500);
    }
    res.clearCookie("connect.sid", {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.COOKIE_SAMESITE || "lax",
    });
    res.sendStatus(200);
  });
});

// Submit Form
app.post("/api/submit", upload.single("adjunto"), async (req, res) => {
  try {
    const campos = [
      "persona",
      "tipo",
      "documeto_paciente",
      "nombre",
      "sexo",
      "origen",
      "departamento",
      "municipio",
      "direccion",
      "celular",
      "correo",
      "descripcion",
    ];
    const valores = campos.map((c) => req.body[c] || "");
    const archivoNombre = req.file?.originalname || null;
    const archivoRuta = req.file ? `/uploads/${req.file.filename}` : null;
    valores.push(archivoNombre, archivoRuta);

    const sql = `INSERT INTO respuestas_formulario
      (persona,tipo,documeto_paciente,nombre,
       sexo,origen,departamento,municipio,
       direccion,celular,correo,descripcion,
       archivo_nombre,archivo_ruta)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const [r] = await pool.execute(sql, valores);
    res.status(201).json({ success: true, insertId: r.insertId });
  } catch (e) {
    console.error("[SUBMIT]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

// Perfil y Usuarios por rol
app.get("/api/perfil", ensureAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT usuario,nombre,correo,rol_id, sede FROM usuarios WHERE id=?",
      [req.session.userId]
    );
    if (!rows.length)
      return res.status(404).json({ success: false, message: "No encontrado" });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
  console.error('[PERFIL]', e);
  res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});
app.get("/api/usuarios-por-rol/:rol_id", ensureAuth, async (req, res) => {
  if (![1, 2, 4].includes(req.session.rol_id)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }
  try {
    const [rows] = await pool.query(
      "SELECT id,usuario,nombre FROM usuarios WHERE rol_id=?",
      [req.params.rol_id]
    );
    res.json(rows);
  } catch (e) {
    console.error("[USUARIOS:POR_ROL]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

// Listar / Obtener Respuestas
app.get("/api/respuestas", ensureAuth, async (req, res) => {
  const limit = Number(req.query.limit || 10);
  const offset = Number(req.query.offset || 0);
  const estadoQ = (req.query.estado || "").toString();

  try {
    const [[u]] = await pool.query(
      "SELECT id, rol_id FROM usuarios WHERE id=?",
      [req.session.userId]
    );

    const userId = Number(u?.id);
    const userRole = Number(u?.rol_id); // <- CAST SEGURO

    const where = [];
    const params = [];

    // --- Estado (soporta "en gestion" y "en gestión") ---
    if (estadoQ) {
      const e = estadoQ.toLowerCase();
      if (e === "pendiente") {
        where.push("(estado IS NULL OR LOWER(estado)='pendiente')");
      } else if (e === "en gestion") {
        // acepta con y sin tilde
        where.push(
          "(LOWER(estado)='en gestion' OR LOWER(estado)='en gestión')"
        );
      } else if (e === "resuelta") {
        where.push("LOWER(estado)='resuelta'");
      } else {
        where.push("estado=?");
        params.push(estadoQ);
      }
    }

    // --- FILTRO CLAVE: solo sus casos si es Responsable ---
    if (userRole === 3) {
      where.push("responsable = ?");
      params.push(userId);
    }

    // --- Filtros extra ---
    if (req.query.documeto_paciente) {
      where.push("documeto_paciente LIKE ?");
      params.push(`%${req.query.documeto_paciente}%`);
    }
    if (req.query.correo) {
      where.push("correo LIKE ?");
      params.push(`%${req.query.correo}%`);
    }
    if (req.query.fecha_desde) {
      where.push("enviado_at >= ?");
      params.push(`${req.query.fecha_desde} 00:00:00`);
    }
    if (req.query.fecha_hasta) {
      where.push("enviado_at <= ?");
      params.push(`${req.query.fecha_hasta} 23:59:59`);
    }

    let countSQL = "SELECT COUNT(*) AS total FROM respuestas_formulario";
    let dataSQL = `SELECT seq,persona,tipo,documeto_paciente,nombre,correo,
                           descripcion,enviado_at,fecha_de_cierre,fecha_limite_de_rta,
                           estado,observaciones,responsable
                    FROM respuestas_formulario`;

    if (where.length) {
      const c = " WHERE " + where.join(" AND ");
      countSQL += c;
      dataSQL += c;
    }

    dataSQL += " ORDER BY enviado_at ASC LIMIT ? OFFSET ?";

    const listParams = [...params, limit, offset];

    const [[{ total }]] = await pool.query(countSQL, params);
    const [rows] = await pool.query(dataSQL, listParams);

    res.json({ success: true, total, data: rows });
  } catch (e) {
    console.error("[RESPUESTAS:LIST]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

// IMPORTANTE: Responsables pueden VER su PQRS aunque esté resuelta, pero SOLO pueden editar si NO está resuelta.
// Analistas y admins pueden ver y editar todo menos cuando está resuelta (chequeo en tipificar).
// Obtener una respuesta por seq (detalle)
// Obtener una respuesta por seq (detalle)
app.get("/api/respuesta/:seq", ensureAuth, async (req, res) => {
  try {
    const seq = Number(req.params.seq);
    if (!Number.isInteger(seq)) {
      return res.status(400).json({ success: false, message: "Seq inválido" });
    }

    const [rows] = await pool.query(
      `SELECT rf.*,
              u.nombre AS enviado_por_nombre,
              u.correo AS enviado_por_correo
         FROM respuestas_formulario rf
    LEFT JOIN usuarios u ON u.id = rf.enviado_por_id
        WHERE rf.seq = ?`,
      [seq]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: "No encontrado" });
    }

    const [[usuario]] = await pool.query(
      "SELECT id, rol_id FROM usuarios WHERE id=?",
      [req.session.userId]
    );
    const rolNum = Number(usuario?.rol_id);
    const uid = Number(usuario?.id);

    // Rol 3 (Responsable) solo puede ver si es el responsable asignado
    if (rolNum === 3 && Number(rows[0].responsable) !== uid) {
      return res
        .status(403)
        .json({ success: false, message: "No autorizado para ver este caso" });
    }

    // IMPORTANTE: devolvemos el objeto plano para no romper el front
    return res.json(rows[0]);
  } catch (e) {
    console.error("GET /api/respuesta/:seq error:", e);
    return res
      .status(500)
      .json({ success: false, message: "Error de servidor" });
  }
});

// Endpoint para exportar a Excel

app.get("/api/exportar-respuestas", ensureAuth, async (req, res) => {
  const rol = Number(req.session.rol_id);
  const uid = Number(req.session.userId);

  if (![1, 2].includes(rol)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }

  try {
    // === Filtros opcionales (mismos que /api/respuestas) ===
    const { documeto_paciente, correo, fecha_desde, fecha_hasta } = req.query;
    const estadoQ = normEstado(req.query.estado || "");

    const where = [];
    const params = [];

    if (estadoQ) {
      if (estadoQ === "pendiente") {
        where.push("(estado IS NULL OR LOWER(estado)='pendiente')");
      } else if (estadoQ === "en gestion") {
        where.push(
          "(LOWER(estado)='en gestion' OR LOWER(estado)='en gestión')"
        );
      } else if (estadoQ === "resuelta") {
        where.push("LOWER(estado)='resuelta'");
      } else {
        where.push("estado = ?");
        params.push(req.query.estado);
      }
    }
    if (documeto_paciente) {
      where.push("documeto_paciente LIKE ?");
      params.push(`%${documeto_paciente}%`);
    }
    if (correo) {
      where.push("correo LIKE ?");
      params.push(`%${correo}%`);
    }
    if (fecha_desde) {
      where.push("enviado_at >= ?");
      params.push(`${fecha_desde} 00:00:00`);
    }
    if (fecha_hasta) {
      where.push("enviado_at <= ?");
      params.push(`${fecha_hasta} 23:59:59`);
    }

    // Defense-in-depth si algún día cambian permisos:
    if (rol === 3) {
      where.push("responsable = ?");
      params.push(uid);
    }

    let sql = `
      SELECT rf.*, u.nombre AS enviado_por_nombre
      FROM respuestas_formulario rf
      LEFT JOIN usuarios u ON u.id = rf.enviado_por_id
    `;
    if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
    sql += " ORDER BY rf.enviado_at ASC";

    const [rows] = await pool.query(sql, params);

    // Map nombres de usuarios
    const [usuarios] = await pool.query("SELECT id, nombre FROM usuarios");
    const usuariosMap = {};
    for (const u of usuarios) usuariosMap[u.id] = u.nombre;

    const columnas = [
      "id",
      "persona",
      "tipo",
      "documeto_paciente",
      "nombre",
      "sexo",
      "origen",
      "departamento",
      "municipio",
      "direccion",
      "celular",
      "correo",
      "descripcion",
      "archivo_nombre",
      "archivo_ruta",
      "enviado_at",
      "estado",
      "observaciones",
      "medio",
      "eps",
      "analista",
      "area_encargada",
      "responsable",
      "tipo_de_requerimiento",
      "tipo_de_servicio",
      "subtipologia",
      "medio_de_contacto",
      "requerimiento_de_la_solicitud",
      "atribuible",
      "por_que",
      "fecha_limite_de_rta",
      "respuesta_al_area_encargada",
      "indicador_ans",
      "oportunidad_real",
      "oportunidad_operativa",
      "fecha_de_cierre",
      "fecha_respuesta_responsable",
      "pregunta_reasignacion",
      "respuesta_al_area_encargada_reasignacion",
      "fecha_respuesta_responsable_reasignacion",
      "mensaje_paciente",
      "fecha_envio_paciente",
      "enviado_por_nombre",
      "vencido",
    ];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Respuestas");
    worksheet.columns = columnas.map((key) => ({ header: key, key }));
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true };

    for (const row of rows) {
      const fila = {};
      for (const col of columnas) {
        if (col === "id") fila.id = `SAC-${row.seq}`;
        else if (col === "analista" || col === "responsable")
          fila[col] = usuariosMap[row[col]] || row[col] || "";
        else fila[col] = row[col] ?? "";
      }
      worksheet.addRow(fila);
    }

    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=respuestas_${fecha}.xlsx`
    );
    res.setHeader("Cache-Control", "no-store");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error al exportar." });
  }
});

app.post("/api/tipificar", ensureAuth, async (req, res) => {
  let {
    seq,
    medio,
    eps,
    analista,
    area_encargada,
    responsable,
    tipo_de_requerimiento,
    tipo_de_servicio,
    subtipologia,
    medio_de_contacto,
    requerimiento_de_la_solicitud,
    atribuible,
    por_que,
    fecha_limite_de_rta,
    respuesta_al_area_encargada = "",
    indicador_ans,
    estado,
    oportunidad_real,
    oportunidad_operativa,
    fecha_de_cierre,
    observaciones,
    fecha_respuesta_responsable = null,
    pregunta_reasignacion = "",
    respuesta_al_area_encargada_reasignacion = "",
    fecha_respuesta_responsable_reasignacion = null,
    vencido,
  } = req.body;

  if (!seq)
    return res.status(400).json({ success: false, message: "Falta seq" });

  try {
    // Consultar estado actual y responsable
    const [[respuesta]] = await pool.query(
      "SELECT estado, responsable, analista AS analista_db, area_encargada AS area_db, fecha_limite_de_rta AS flr_db FROM respuestas_formulario WHERE seq=?",
      [seq]
    );
    if (!respuesta)
      return res.status(404).json({ success: false, message: "No encontrado" });

    // Obtener rol del usuario actual una sola vez
    const [[usuarioRolActual]] = await pool.query(
      "SELECT rol_id, id FROM usuarios WHERE id=?",
      [req.session.userId]
    );

    // Determinar transición de estados
    // Determinar transición de estados (normalizados: minúsculas y sin tildes)
    const nuevoEstadoNorm = normEstado(estado || "");
    const anteriorEstadoNorm = normEstado(respuesta.estado || "");
    const esFinalizada =
      nuevoEstadoNorm === "resuelta" && anteriorEstadoNorm !== "resuelta";
    const esReapertura =
      anteriorEstadoNorm === "resuelta" && nuevoEstadoNorm !== "resuelta";

    // Dentro de /api/tipificar

    // Solo Admin/Analista/Auditor pueden reabrir
    if (esReapertura && ![1, 2, 4].includes(usuarioRolActual.rol_id)) {
      return res.status(403).json({
        success: false,
        message: "No autorizado para reabrir una PQRS resuelta",
      });
    }

    // Corrección: notificar cuando pase de RESUELTA -> EN GESTION
    const esEnGestionTransition =
      anteriorEstadoNorm === "resuelta" && nuevoEstadoNorm === "en gestion";

    // Si estaba resuelta y sigue resuelta: sólo ciertos roles pueden editar estado (early return)
    if (anteriorEstadoNorm === "resuelta" && nuevoEstadoNorm === "resuelta") {
      if (![1, 2, 4].includes(usuarioRolActual.rol_id)) {
        return res.status(403).json({
          success: false,
          message: "No puedes editar una PQRS resuelta.",
        });
      }
      try {
        const [r] = await pool.execute(
          `UPDATE respuestas_formulario SET estado=? WHERE seq=?`,
          [estado, seq]
        );
        if (!r.affectedRows)
          return res
            .status(404)
            .json({ success: false, message: "No encontrado" });
        return res.json({
          success: true,
          message: "Estado actualizado correctamente",
        });
      } catch (e) {
        console.error("[/api/tipificar:update-estado]", e);
        return res
          .status(500)
          .json({ success: false, message: "Error de servidor" });
      }
    }

    // Si el usuario es responsable, solo puede editar si es el asignado
    if (
      usuarioRolActual.rol_id === 3 &&
      Number(respuesta.responsable) !== Number(usuarioRolActual.id)
    ) {
      return res.status(403).json({
        success: false,
        message: "No autorizado para tipificar este caso",
      });
    }
    // 🔒 Campo-level guard para RESPONSABLE (rol 3): no puede reasignar ni mover fecha límite
    // 🔒 Si es RESPONSABLE (rol 3), solo puede registrar sus respuestas.
    // Nada de cambiar estado, reasignar, ni tocar fechas límite/cierre.
    if (usuarioRolActual.rol_id === 3) {
      try {
        // Guardar SOLO los 4 campos que el responsable puede diligenciar
        const [r] = await pool.execute(
          `UPDATE respuestas_formulario SET
         respuesta_al_area_encargada = ?,
         respuesta_al_area_encargada_reasignacion = ?,
         fecha_respuesta_responsable = ?,
         fecha_respuesta_responsable_reasignacion = ?
       WHERE seq = ? AND responsable = ?`,
          [
            respuesta_al_area_encargada || "",
            respuesta_al_area_encargada_reasignacion || "",
            fecha_respuesta_responsable || null,
            fecha_respuesta_responsable_reasignacion || null,
            seq,
            usuarioRolActual.id,
          ]
        );

        if (!r.affectedRows) {
          return res
            .status(404)
            .json({ success: false, message: "No encontrado" });
        }

        // Notificar al analista según corresponda
        const [[info]] = await pool.query(
          "SELECT analista FROM respuestas_formulario WHERE seq=?",
          [seq]
        );
        if (info && info.analista) {
          const [[analistaInfo]] = await pool.query(
            "SELECT nombre, correo FROM usuarios WHERE id=?",
            [info.analista]
          );
          if (analistaInfo) {
            // Si respondió a una reasignación, asunto distinto
            const asunto = respuesta_al_area_encargada_reasignacion
              ? `Reasignación respondida SAC${seq}`
              : `PQRS respondida SAC${seq}`;

            const texto = respuesta_al_area_encargada_reasignacion
              ? `Hola ${analistaInfo.nombre},\n\nEl responsable ha respondido la reasignación de SAC${seq}.\nSaludos.`
              : `Hola ${analistaInfo.nombre},\n\nEl responsable ha respondido SAC${seq}.\nSaludos.`;

            await transporter.sendMail({
              from: process.env.SMTP_USER,
              to: analistaInfo.correo,
              subject: asunto,
              text: texto,
            });
          }
        }

        return res.json({
          success: true,
          message: "Respuesta del responsable registrada.",
        });
      } catch (e) {
  console.error('Tipificar (rol 3):', e);
  return res.status(500).json({ success: false, message: 'Error de servidor' });
      }
    }

    // Actualizar base (manejo de reapertura limpiando fecha_de_cierre)
    let updateSQL;
    let params;
    if (esReapertura) {
      updateSQL = `
        UPDATE respuestas_formulario SET
          medio=?,eps=?,analista=?,area_encargada=?,responsable=?,
          tipo_de_requerimiento=?,tipo_de_servicio=?,subtipologia=?,
          medio_de_contacto=?,requerimiento_de_la_solicitud=?,atribuible=?,por_que=?,
          fecha_limite_de_rta=?,respuesta_al_area_encargada=?,indicador_ans=?,estado=?,
          oportunidad_real=?,oportunidad_operativa=?,fecha_de_cierre=NULL,observaciones=?,
          fecha_respuesta_responsable=?,pregunta_reasignacion=?,
          respuesta_al_area_encargada_reasignacion=?,fecha_respuesta_responsable_reasignacion=?, vencido=?
        WHERE seq=?`;
      params = [
        medio,
        eps,
        analista,
        area_encargada,
        responsable,
        tipo_de_requerimiento,
        tipo_de_servicio,
        subtipologia,
        medio_de_contacto,
        requerimiento_de_la_solicitud,
        atribuible,
        por_que,
        fecha_limite_de_rta,
        respuesta_al_area_encargada,
        indicador_ans,
        estado,
        oportunidad_real,
        oportunidad_operativa,
        // fecha_de_cierre se limpia
        observaciones,
        fecha_respuesta_responsable,
        pregunta_reasignacion,
        respuesta_al_area_encargada_reasignacion,
        fecha_respuesta_responsable_reasignacion,
        vencido,
        seq,
      ];
    } else {
      updateSQL = `
        UPDATE respuestas_formulario SET
          medio=?,eps=?,analista=?,area_encargada=?,responsable=?,
          tipo_de_requerimiento=?,tipo_de_servicio=?,subtipologia=?,
          medio_de_contacto=?,requerimiento_de_la_solicitud=?,atribuible=?,por_que=?,
          fecha_limite_de_rta=?,respuesta_al_area_encargada=?,indicador_ans=?,estado=?,
          oportunidad_real=?,oportunidad_operativa=?,fecha_de_cierre=?,observaciones=?,
          fecha_respuesta_responsable=?,pregunta_reasignacion=?,
          respuesta_al_area_encargada_reasignacion=?,fecha_respuesta_responsable_reasignacion=?, vencido=?
        WHERE seq=?`;
      params = [
        medio,
        eps,
        analista,
        area_encargada,
        responsable,
        tipo_de_requerimiento,
        tipo_de_servicio,
        subtipologia,
        medio_de_contacto,
        requerimiento_de_la_solicitud,
        atribuible,
        por_que,
        fecha_limite_de_rta,
        respuesta_al_area_encargada,
        indicador_ans,
        estado,
        oportunidad_real,
        oportunidad_operativa,
        fecha_de_cierre,
        observaciones,
        fecha_respuesta_responsable,
        pregunta_reasignacion,
        respuesta_al_area_encargada_reasignacion,
        fecha_respuesta_responsable_reasignacion,
        vencido,
        seq,
      ];
    }

    const [r] = await pool.execute(updateSQL, params);
    if (!r.affectedRows)
      return res.status(404).json({ success: false, message: "No encontrado" });

    // === NOTIFICACIONES ===
    // === NOTIFICACIONES ===
    if (esReapertura) {
      // Notificar analista
      // const [[analistaInfo]] = await pool.query(
      //   "SELECT nombre, correo FROM usuarios WHERE id=?",
      //   [analista]
      // );
      // if (analistaInfo) {
      //   await transporter.sendMail({
      //     from: process.env.SMTP_USER,
      //     to: analistaInfo.correo,
      //     subject: `PQRS reabierta SAC${seq}`,
      //     text: `Hola ${analistaInfo.nombre},\n\nLa PQRS SAC${seq} que estaba finalizada ha sido reabierta y está nuevamente en gestión.\n\nGracias.`,
      //   });
      // }
      // Notificar responsable
      const [[responsableInfo]] = await pool.query(
        "SELECT nombre, correo FROM usuarios WHERE id=?",
        [responsable]
      );
      if (responsableInfo) {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: responsableInfo.correo,
          subject: `PQRS reabierta SAC${seq}`,
          text: `Hola ${responsableInfo.nombre},\n\nLa PQRS SAC${seq} fue reabierta y requiere tu gestión nuevamente.\n\nGracias.`,
        });
      }
    } else if (esFinalizada) {
      // Notificar al responsable que está finalizada
      const [[responsableFinal]] = await pool.query(
        "SELECT nombre, correo FROM usuarios WHERE id=?",
        [responsable]
      );
      if (responsableFinal) {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: responsableFinal.correo,
          subject: `PQRS finalizada SAC${seq}`,
          text: `Hola ${responsableFinal.nombre},\n\nLa PQRS SAC${seq} ha sido marcada como finalizada.\n\nGracias.`,
        });
      }
    } else if (esEnGestionTransition) {
      // Avisar al responsable que la PQRS pasó a "en gestion" solo si venía de finalizada
      const [[responsableGestion]] = await pool.query(
        "SELECT nombre, correo FROM usuarios WHERE id=?",
        [responsable]
      );
      if (responsableGestion) {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to: responsableGestion.correo,
          subject: `PQRS en gestión SAC${seq}`,
          text: `Hola ${responsableGestion.nombre},\n\nLa PQRS SAC${seq} ha cambiado su estado a "En gestión".\n\nGracias.`,
        });
      }
    } else {
      // Flujos normales (no es transición especial)
      if (respuesta_al_area_encargada_reasignacion) {
        const [[analistaReasig]] = await pool.query(
          "SELECT nombre,correo FROM usuarios WHERE id=?",
          [analista]
        );
        if (analistaReasig) {
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: analistaReasig.correo,
            subject: `Reasignación respondida SAC${seq}`,
            text: `Hola ${analistaReasig.nombre},\n\nEl responsable ha respondido la reasignación de SAC${seq}.\nSaludos.`,
          });
        }
      } else if (pregunta_reasignacion === "SI") {
        const [[responsableReasig]] = await pool.query(
          "SELECT nombre,correo FROM usuarios WHERE id=?",
          [responsable]
        );
        if (responsableReasig) {
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: responsableReasig.correo,
            subject: `REASIGNACIÓN SAC${seq}`,
            text: `Hola ${responsableReasig.nombre},\n\nLa respuesta no fue satisfactoria. Debes volver a dar respuesta. \nFecha limite de Respuesta: ${fecha_limite_de_rta}. \nObservacion: ${observaciones}   \n\nGracias.`,
          });
        }
      } else if (respuesta_al_area_encargada) {
        const [[analistaInicial]] = await pool.query(
          "SELECT nombre,correo FROM usuarios WHERE id=?",
          [analista]
        );
        if (analistaInicial) {
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: analistaInicial.correo,
            subject: `PQRS respondida SAC${seq}`,
            text: `Hola ${analistaInicial.nombre},\n\nEl responsable ha respondido SAC${seq}.\nSaludos.`,
          });
        }
      } else {
        const [[responsableInicial]] = await pool.query(
          "SELECT nombre,correo FROM usuarios WHERE id=?",
          [responsable]
        );
        if (responsableInicial) {
          await transporter.sendMail({
            from: process.env.SMTP_USER,
            to: responsableInicial.correo,
            subject: `PQRS asignada SAC${seq}`,
            text: `Hola ${responsableInicial.nombre},\n\nTienes asignada la PQRS SAC${seq}. Con Fecha Limite de Respuesta ${fecha_limite_de_rta} \nSaludos.`,
          });
        }
      }
    }

    res.json({
      success: true,
      message: "Tipificación y notificaciones completadas",
    });
  } catch (e) {
    console.error("[/api/tipificar]", e);
    res.status(500).json({ success: false, message: "Error de servidor" });
  }
});

// Endpoint: Enviar mensaje al paciente
// Endpoint: Enviar mensaje al paciente

app.post(
  "/api/enviar-paciente",
  ensureAuth,
  upload.single("archivoAdjunto"),
  async (req, res) => {
    // Solo Admin/Analista
    if (![1, 2].includes(req.session.rol_id)) {
      return res.status(403).json({ success: false, message: "No autorizado" });
    }
    const { seq, mensaje } = req.body;
    if (!seq || !mensaje) {
      return res
        .status(400)
        .json({ success: false, message: "Falta seq o mensaje" });
    }
    try {
      // 0) Analista que envía (el logueado)
      const [[yo]] = await pool.query(
        "SELECT nombre, correo FROM usuarios WHERE id=?",
        [req.session.userId]
      );
      const analistaNombre = yo?.nombre || req.session.nombre || "Equipo MTD";
      const analistaCorreo = yo?.correo || process.env.SMTP_USER;

      // 1) Guardar mensaje
      await pool.query(
        "UPDATE respuestas_formulario SET mensaje_paciente=?, fecha_envio_paciente=NOW(), enviado_por_id=? WHERE seq = ?",
        [mensaje, req.session.userId, seq]
      );

      // 2) Datos del paciente
      const [[row]] = await pool.query(
        "SELECT correo, nombre, mensaje_paciente FROM respuestas_formulario WHERE seq = ?",
        [seq]
      );
      if (!row || !row.correo) {
        return res
          .status(404)
          .json({ success: false, message: "Paciente no encontrado" });
      }

      // 3) Plantillas con firma del analista
      const plantillaText = `Buen día ${row.nombre}, cordial saludo.

Muchas gracias por ponerse en contacto con MTD, para nosotros es muy importante mantener una comunicación asertiva con nuestros usuarios, por esta razón damos respuesta a su requerimiento interpuesto.

${row.mensaje_paciente}

Atentamente,
${analistaNombre}
Analista PQRS - MTD
${analistaCorreo}

Para cualquier inquietud y/o solicitud debe ser diligenciada nuevamente por el formulario.
Este correo es únicamente para envío de información; por favor NO RESPONDER a este correo.
Gracias por comunicarse con nosotros.`;

      const plantillaHTML = `
      <div style="font-family:Arial, sans-serif; line-height:1.5; color:#222;">
        <p>Buen día <strong>${row.nombre}</strong>, cordial saludo.</p>
        <p>Muchas gracias por ponerse en contacto con MTD, para nosotros es muy importante mantener una comunicación asertiva con nuestros usuarios,<br>
        por esta razón damos respuesta a su requerimiento interpuesto.</p>
        <p style="white-space:pre-line">${row.mensaje_paciente || ""}</p>

        <p style="margin-top:24px">
          Atentamente,<br/>
          <strong>${analistaNombre}</strong><br/>
          Analista PQRS - MTD<br/>
        </p>

        <p style="font-size:12px;color:#666">
          Para cualquier inquietud y/o solicitud debe ser diligenciada nuevamente por el formulario.<br/>
          Este correo es únicamente para envío de información; por favor no responder a este correo.
        </p>

        <div style="text-align:left; margin:16px 0;">
          <img
            src="cid:mtd-logo"
            alt="MTD"
            width="900"
            style="display:block;width:900px;max-width:100%;height:auto;margin:0;"
          />
        </div>

        
      </div>`;

      // 4) Adjuntos (opcional + imagen inline)
      const attachments = [];
      if (req.file) {
        attachments.push({
          filename: req.file.originalname,
          path: req.file.path,
        });
      }
      const firmaPath = path.join(
        __dirname,
        "public",
        "auth",
        "files",
        "Firma de PQRS.jpg"
      );
      if (fs.existsSync(firmaPath)) {
        attachments.push({
          filename: "firma-pqrs.jpg",
          path: firmaPath,
          cid: "mtd-logo",
          contentType: "image/jpeg",
        });
      }

      // 5) Envío (muestra el nombre del analista en el "from")
      await transporter.sendMail({
        from: `"${analistaNombre} - MTD" <${process.env.SMTP_USER}>`,
        to: row.correo,
        subject: `Respuesta a tu PQRS SAC-${seq}`,
        text: plantillaText,
        html: plantillaHTML,
        attachments,
      });

      res.json({ success: true, message: "Correo enviado al paciente" });
    } catch (err) {
  console.error('[/api/enviar-paciente]', err);
  res.status(500).json({ success: false, message: 'Error de servidor' });
    }
  }
);

// Estadísticas PQRS
app.get("/api/estadisticas-pqrs", ensureAuth, async (req, res) => {
  try {
    const rol = Number(req.session.rol_id);
    const uid = Number(req.session.userId);

    let extra = "",
      params = [];
    if (rol === 3) {
      // Responsable: solo los suyos
      extra = " AND responsable = ? ";
      params = [uid];
    }

    const [[pendientes]] = await pool.query(
      "SELECT COUNT(*) AS count FROM respuestas_formulario WHERE (estado IS NULL OR LOWER(estado)='pendiente')" +
        extra,
      params
    );
    const [[gestion]] = await pool.query(
      // acepta en gestion y en gestión
      "SELECT COUNT(*) AS count FROM respuestas_formulario WHERE (LOWER(estado)='en gestion' OR LOWER(estado)='en gestión')" +
        extra,
      params
    );
    const [[resueltas]] = await pool.query(
      "SELECT COUNT(*) AS count FROM respuestas_formulario WHERE LOWER(estado)='resuelta'" +
        extra,
      params
    );
    const [[vencido]] = await pool.query(
      "SELECT COUNT(*) AS count FROM respuestas_formulario WHERE vencido='SI'" +
        extra,
      params
    );
    const [[total]] = await pool.query(
      "SELECT COUNT(*) AS count FROM respuestas_formulario WHERE 1=1" + extra,
      params
    );

    res.json({
      pendientes: pendientes.count,
      gestion: gestion.count,
      resueltas: resueltas.count,
      vencido: vencido.count,
      total: total.count,
    });
  } catch (e) {
  console.error('[ESTADISTICAS:PQRS]', e);
  res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});

// Buscar usuario por usuario/correo/nombre (solo admin o analista)
app.get("/api/buscar-usuario", ensureAuth, async (req, res) => {
  if (![1, 2].includes(req.session.rol_id)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }
  const { q } = req.query;
  if (!q)
    return res
      .status(400)
      .json({ success: false, message: "Falta query de búsqueda" });
  // Puedes ajustar el WHERE según lo que necesites
  const [rows] = await pool.query(
    `SELECT id, usuario, nombre, correo, rol_id, sede, activo
     FROM usuarios
     WHERE usuario = ? OR correo = ? OR nombre LIKE ?`,
    [q, q, `%${q}%`]
  );
  if (!rows.length)
    return res.status(404).json({ success: false, message: "No encontrado" });
  res.json(rows[0]);
});
// Cambia el estado activo (1 = activo, 0 = inactivo)
app.patch("/api/inactivar-usuario/:id", ensureAuth, async (req, res) => {
  if (![1, 2].includes(req.session.rol_id)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }
  const { id } = req.params;
  const { activo } = req.body;
  if (typeof activo === "undefined") {
    return res.status(400).json({ success: false, message: "Falta estado" });
  }
  const [r] = await pool.query("UPDATE usuarios SET activo=? WHERE id=?", [
    activo ? 1 : 0,
    id,
  ]);
  if (!r.affectedRows)
    return res.status(404).json({ success: false, message: "No encontrado" });
  res.json({
    success: true,
    message: activo ? "Usuario activado" : "Usuario inactivado",
  });
});

// Modificar datos personales de un usuario (sólo Admin/Analista)
app.patch("/api/usuarios/:id", ensureAuth, async (req, res) => {
  if (![1, 2].includes(req.session.rol_id)) {
    return res.status(403).json({ success: false, message: "No autorizado" });
  }
  const { nombre, correo, rol_id, sede } = req.body;
  if (!nombre || !correo || !rol_id || !sede) {
    return res
      .status(400)
      .json({ success: false, message: "Faltan campos obligatorios" });
  }
  try {
    const [r] = await pool.query(
      "UPDATE usuarios SET nombre=?, correo=?, rol_id=?, sede=? WHERE id=?",
      [nombre, correo, rol_id, sede, req.params.id]
    );
    if (!r.affectedRows) {
      return res
        .status(404)
        .json({ success: false, message: "Usuario no encontrado" });
    }
    res.json({ success: true, message: "Usuario actualizado" });
  } catch (e) {
  console.error('[USUARIOS:PATCH]', e);
  res.status(500).json({ success: false, message: 'Error de servidor' });
  }
});

/* ---------- Start ---------- */
const PORT = Number(process.env.PORT || 1000);

// al final, antes del app.listen:
app.use((err, req, res, next) => {
  if (err && err.message === "CORS blocked") {
    return res
      .status(403)
      .json({ success: false, message: "Origen no permitido por CORS" });
  }
  if (err && err.message === "Tipo de archivo no permitido") {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(400)
      .json({ success: false, message: "Archivo supera el límite (10MB)" });
  }
  next(err);
});
app.use((err, req, res, next) => {
  console.error("[UNHANDLED]", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, message: "Error de servidor" });
});

app.listen(PORT, () => console.log(`Servidor escuchando en :${PORT}`));
