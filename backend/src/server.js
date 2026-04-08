import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import multer from 'multer';
import nodemailer from 'nodemailer';
import { z } from 'zod';

import { openDb } from './db.js';
import { signToken, authRequired, adminRequired, optionalBearerAuth } from './auth.js';
import { createPreference, getPayment } from './mp.js';
import chatRouter from './routes/chat.js';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5050;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

const corsAllowAll = ['1', 'true', 'yes'].includes(String(process.env.CORS_ALLOW_ALL || '').toLowerCase());

const corsWhitelist = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5050',
  'http://127.0.0.1:5050'
];
if (process.env.FRONTEND_URL) {
  const url = String(process.env.FRONTEND_URL).trim().replace(/\/$/, '');
  if (url && !corsWhitelist.includes(url)) corsWhitelist.push(url);
}

const corsOptions = {
  origin(origin, callback) {
    if (corsAllowAll) return callback(null, true);
    if (!origin) return callback(null, true);
    if (corsWhitelist.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

function nowISO(){ return new Date().toISOString(); }
function centsFromMXN(val){ return Math.round(Number(val) * 100); }
function mxnFromCents(c){ return Number(c) / 100; }

function requireSecret(){
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 16) throw new Error('JWT_SECRET missing/too short');
}

function mapProduct(p){
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: mxnFromCents(p.price_cents),
    stock: p.stock,
    image: p.image_url || '',
    active: p.active !== false,
    updatedAt: p.updated_at
  };
}

function safeLower(v){ return String(v || '').toLowerCase(); }

// ---- Middleware ----
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "https:"],
        "frame-src": ["'self'", "https://www.google.com"],
        "font-src": ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      },
    },
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '2mb' }));
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(rateLimit({ windowMs: 60_000, max: 120 }));

// Carpeta backend/uploads: crear si no existe y servir estática
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', (req, res, next) => {
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}, express.static(uploadsDir));

// Frontend estático: /frontend/* → carpeta frontend (sin Live Server)
const frontendDir = path.join(__dirname, '..', '..', 'frontend');
if (fs.existsSync(frontendDir)) {
  app.use('/frontend', express.static(frontendDir, { index: false }));
}

app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.get('/', (req, res) => res.redirect(302, '/frontend/index.html'));

// ---- Open DB ----
const dbPromise = openDb();

app.use('/api', chatRouter);

async function dbReadWrite(fn){
  const db = await dbPromise;
  await db.read();
  db.data ||= { users: [], products: [], orders: [], contact_messages: [], mp_notifications: [] };
  const result = await fn(db);
  await db.write();
  return result;
}

const isDev = (process.env.NODE_ENV || 'development') !== 'production';

// ---- Products public (fuente única: data.json vía db) ----
app.get('/api/products', async (req, res) => {
  const db = await dbPromise;
  await db.read();
  db.data ||= { users: [], products: [], orders: [], contact_messages: [], mp_notifications: [] };
  const products = (db.data.products || []).filter(p => p.active !== false);
  products.sort((a,b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  if (isDev) console.log('[dev] GET /api/products:', products.length, 'activos desde data.json');
  return res.json(products.map(mapProduct));
});
const registerSchema = z.object({
  email: z.string().trim().email().transform(s => s.toLowerCase()),
  password: z.string().min(6),
  name: z.string().max(80).optional().default('')
});

app.post('/api/auth/register', async (req, res) => {
  try {
    requireSecret();
  } catch {
    return res.status(503).json({ error: 'Servicio no configurado' });
  }
  const body = req.body || {};
  const normalized = {
    email: body.email ?? body.usuario ?? body.correo,
    password: body.password ?? body.pass ?? body.contrasena,
    name: body.name ?? body.nombre ?? ''
  };
  const parsed = registerSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  }
  const { email, password, name: nameRaw } = parsed.data;
  const name = (typeof nameRaw === 'string' && nameRaw.trim()) ? nameRaw.trim() : ((email || '').split('@')[0] || email || '');

  try {
    const db = await dbPromise;
    await db.read();
    db.data ||= { users: [], products: [], orders: [], contact_messages: [], mp_notifications: [] };
    const exists = (db.data.users || []).find(u => u.email === email);
    if (exists) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    const verificationToken = nanoid();
    const user = {
      id: nanoid(),
      email,
      name,
      password_hash: bcrypt.hashSync(password, 10),
      role: 'CLIENT',
      isVerified: false,
      verificationToken,
      created_at: nowISO()
    };

    try {
      await sendVerificationEmail(user.email, verificationToken);
    } catch (mailErr) {
      console.error('[register] SMTP:', mailErr && mailErr.message, mailErr && mailErr.code);
      const mapped = mapMailErrorToHttp(mailErr);
      return res.status(mapped.status).json({
        error: mapped.message,
        code: mapped.code
      });
    }

    let raceConflict = false;
    await dbReadWrite(async (dbInner) => {
      if ((dbInner.data.users || []).some(u => u.email === email)) {
        raceConflict = true;
        return;
      }
      dbInner.data.users.push(user);
    });

    if (raceConflict) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: false
      },
      message: 'Registro exitoso. Revisa tu correo y pulsa el enlace para verificar tu cuenta antes de iniciar sesión.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

const loginSchema = z.object({
  email: z.string().trim().email().transform(s => s.toLowerCase()),
  password: z.string().min(1, 'La contraseña es obligatoria')
});
app.post('/api/auth/login', async (req, res) => {
  try {
    requireSecret();
  } catch {
    return res.status(503).json({ error: 'Servicio no configurado' });
  }
  const body = req.body || {};
  const normalized = {
    email: body.email ?? body.usuario ?? body.correo,
    password: body.password ?? body.pass ?? body.contrasena
  };
  const parsed = loginSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  }
  const { email, password } = parsed.data;

  try {
    const db = await dbPromise;
    await db.read();
    const emailLower = String(email || '').toLowerCase();
    const user = (db.data.users || []).find(u => String(u.email || '').toLowerCase() === emailLower);
    if (!user) {
      if (isDev) console.log('[dev] login', email, false);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const hash = user.password_hash;
    if (typeof hash !== 'string' || !hash.trim()) {
      if (isDev) console.log('[dev] login', email, false);
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }
    const ok = await bcrypt.compare(password, hash);
    if (isDev) console.log('[dev] login', email, ok);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });
    if (user.active === false) {
      if (isDev) console.log('[dev] login', email, 'inactive');
      return res.status(401).json({ error: 'Cuenta desactivada' });
    }
    if (user.isVerified === false) {
      return res.status(403).json({ error: 'Por favor, verifica tu correo antes de iniciar sesión', code: 'EMAIL_NOT_VERIFIED' });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isVerified: user.isVerified !== false
    });
    return res.status(200).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isVerified: user.isVerified !== false
      }
    });
  } catch (err) {
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/auth/me', authRequired, (req, res) => {
  const u = req.user;
  return res.json({
    user: {
      id: u.sub,
      email: u.email,
      name: u.name,
      role: u.role,
      isVerified: u.emailVerified !== false
    }
  });
});

const verifyEmailQuerySchema = z.object({
  token: z.string().min(8).max(128)
});

app.get('/api/auth/verify', async (req, res) => {
  const parsed = verifyEmailQuerySchema.safeParse({ token: req.query.token });
  if (!parsed.success) {
    return res.status(400).json({ error: 'Enlace de verificación inválido.' });
  }
  const { token } = parsed.data;
  let ok = false;
  await dbReadWrite(async (db) => {
    const user = (db.data.users || []).find(u => u.verificationToken === token);
    if (!user) return;
    user.isVerified = true;
    user.verificationToken = null;
    ok = true;
  });
  if (!ok) {
    return res.status(400).json({ error: 'Enlace inválido o ya utilizado.' });
  }
  const base = String(FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '');
  return res.redirect(302, `${base}/frontend/index.html?verified=1`);
});

/** Lee variables de entorno sin espacios accidentales (salvo que se documente lo contrario). */
function readEnvTrim(name) {
  const v = process.env[name];
  if (v == null) return '';
  return String(v).trim();
}

/**
 * Cliente SMTP orientado a Gmail / Render: puerto 587 (STARTTLS), timeouts cortos, TLS flexible en el servidor.
 */
function getTransport() {
  const host = readEnvTrim('SMTP_HOST');
  const user = readEnvTrim('SMTP_USER');
  const pass = process.env.SMTP_PASS != null ? String(process.env.SMTP_PASS).trim() : '';
  if (!host || !user || !pass) return null;

  const port = 587;
  return nodemailer.createTransport({
    host,
    port,
    secure: false,
    requireTLS: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    tls: { rejectUnauthorized: false },
    auth: { user, pass }
  });
}

/** URL pública del API (obligatoria en producción) para enlaces del correo de verificación. */
function getBackendPublicUrlForVerification() {
  const explicit = readEnvTrim('BACKEND_PUBLIC_URL');
  if (explicit) return explicit.replace(/\/$/, '');
  if (isDev) return `http://localhost:${PORT}`.replace(/\/$/, '');
  const err = new Error('BACKEND_PUBLIC_URL no está definida');
  err.code = 'BACKEND_PUBLIC_URL_MISSING';
  throw err;
}

/** Traduce fallos de nodemailer / red a HTTP 503 (servicio correo) o 504 (timeout). */
function mapMailErrorToHttp(err) {
  const c = err && err.code;
  const msg = (err && err.message) || '';
  if (c === 'SMTP_NOT_CONFIGURED') {
    return { status: 503, message: 'Correo no configurado. Define SMTP_HOST, SMTP_USER y SMTP_PASS.', code: 'SMTP_NOT_CONFIGURED' };
  }
  if (c === 'BACKEND_PUBLIC_URL_MISSING') {
    return { status: 503, message: 'Configura BACKEND_PUBLIC_URL en el servidor (URL pública del backend).', code: 'BACKEND_PUBLIC_URL_MISSING' };
  }
  if (c === 'ETIMEDOUT' || c === 'ESOCKETTIMEDOUT' || /timeout/i.test(msg)) {
    return { status: 504, message: 'Tiempo de espera al conectar con el servidor de correo. Inténtalo de nuevo.', code: 'SMTP_TIMEOUT' };
  }
  if (c === 'ECONNRESET' || c === 'ECONNREFUSED' || c === 'ENOTFOUND' || c === 'EAI_AGAIN') {
    return { status: 503, message: 'No se pudo conectar al servidor de correo. Revisa red y credenciales SMTP.', code: 'SMTP_CONNECTION' };
  }
  return { status: 503, message: 'No se pudo enviar el correo de verificación. Inténtalo más tarde.', code: 'SMTP_SEND_FAILED' };
}

/** Envía enlace GET /api/auth/verify?token=… (usa BACKEND_PUBLIC_URL para el href). */
async function sendVerificationEmail(toEmail, verificationToken) {
  const transport = getTransport();
  if (!transport) {
    const e = new Error('SMTP no configurado');
    e.code = 'SMTP_NOT_CONFIGURED';
    throw e;
  }

  const base = getBackendPublicUrlForVerification();
  const verifyUrl = `${base}/api/auth/verify?token=${encodeURIComponent(verificationToken)}`;
  const fromAddr = readEnvTrim('SMTP_USER');
  await transport.sendMail({
    from: fromAddr,
    to: toEmail,
    subject: 'Verifica tu cuenta en ProyectWeb',
    text: `Hola,\n\nConfirma tu correo abriendo este enlace:\n${verifyUrl}\n\nSi no creaste esta cuenta, ignora este mensaje.`,
    html: `<p>Hola,</p><p>Confirma tu correo pulsando el siguiente enlace:</p><p><a href="${verifyUrl}">Verificar mi cuenta</a></p><p>Si no creaste esta cuenta, ignora este mensaje.</p>`
  });
}

// ---- Uploads ----
const ALLOWED_MIMES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const SAFE_EXT = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_IMAGE_MB = 3;

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const ext = SAFE_EXT[file.mimetype] || '.jpg';
      cb(null, `${Date.now()}-${nanoid(8)}${ext}`);
    }
  }),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMES.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Solo se permiten imágenes (jpg, jpeg, png, webp)'));
  }
});

app.post('/api/uploads/image', authRequired, adminRequired, upload.single('image'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });
  const base = (process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
  const url = `${base}/uploads/${encodeURIComponent(req.file.filename)}`;
  return res.json({ url });
}, (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Archivo demasiado grande (máx. 3MB)' });
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Solo se permiten imágenes (jpg, jpeg, png, webp)') return res.status(415).json({ error: err.message });
  next(err);
});

// ---- Admin products ----
function normalizeProductBody(body) {
  const b = body || {};
  return {
    name: b.name ?? b.nombre,
    description: b.description ?? b.descripcion ?? '',
    price: Number(b.price ?? b.precio),
    stock: Number(b.stock ?? b.existencias ?? b.cantidad),
    image: b.image ?? b.imageUrl ?? b.imagen ?? b.url
  };
}

const productSchema = z.object({
  name: z.string().min(2, 'Nombre mínimo 2 caracteres').max(120),
  description: z.string().max(2000),
  price: z.number().positive('El precio debe ser mayor que 0'),
  stock: z.number().int().min(0, 'Stock debe ser entero >= 0'),
  image: z.string().min(1, 'Imagen requerida').refine(
    (v) => v.startsWith('http://') || v.startsWith('https://') || v.startsWith('/uploads/'),
    { message: 'Imagen debe ser URL http(s) o ruta /uploads/...' }
  )
});

app.post('/api/admin/products', authRequired, adminRequired, async (req, res) => {
  const normalized = normalizeProductBody(req.body);
  const parsed = productSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: parsed.error.issues,
      received: normalized
    });
  }

  const { name, description, price, stock, image } = parsed.data;
  return dbReadWrite(async (db) => {
    const ts = nowISO();
    const p = {
      id: nanoid(),
      name,
      description,
      price_cents: centsFromMXN(price),
      stock,
      image_url: image || '',
      active: true,
      created_at: ts,
      updated_at: ts
    };
    db.data.products.push(p);
    if (isDev) console.log('[dev] POST /api/admin/products: creado', p.id, '→ data.json');
    return res.status(201).json(mapProduct(p));
  });
});

app.put('/api/admin/products/:id', authRequired, adminRequired, async (req, res) => {
  const normalized = normalizeProductBody(req.body);
  const parsed = productSchema.safeParse(normalized);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Datos inválidos',
      details: parsed.error.issues,
      received: normalized
    });
  }
  const id = req.params.id;

  const { name, description, price, stock, image } = parsed.data;
  return dbReadWrite(async (db) => {
    const p = db.data.products.find(x => x.id === id && x.active !== false);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    p.name = name;
    p.description = description;
    p.price_cents = centsFromMXN(price);
    p.stock = stock;
    p.image_url = image || '';
    p.updated_at = nowISO();
    if (isDev) console.log('[dev] PUT /api/admin/products:', id, '→ data.json');
    return res.json(mapProduct(p));
  });
});

app.delete('/api/admin/products/:id', authRequired, adminRequired, async (req, res) => {
  const id = req.params.id;
  return dbReadWrite(async (db) => {
    const p = db.data.products.find(x => x.id === id && x.active !== false);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    p.active = false;
    p.updated_at = nowISO();
    if (isDev) console.log('[dev] DELETE /api/admin/products:', id, '(soft) → data.json');
    return res.json({ ok: true });
  });
});

function getMpAccessToken() {
  const t = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!t || !String(t).trim()) return null;
  return String(t).trim();
}

function getFrontendPublicUrl() {
  const u = process.env.FRONTEND_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  return String(u).replace(/\/$/, '');
}

/** Ruta del HTML de la tienda para callbacks Stripe/MP (mismo backend en 5050 o en Render). */
function getStripeReturnPathSuffix() {
  const explicit = process.env.STRIPE_RETURN_PATH;
  if (explicit != null && String(explicit).trim()) return String(explicit).trim();
  const pub = getFrontendPublicUrl();
  if (/localhost:5050|127\.0\.0\.1:5050/.test(pub)) return '/frontend/index.html';
  if (/^https?:\/\//i.test(pub) && !/localhost|127\.0\.0\.1/i.test(pub)) return '/frontend/index.html';
  return '';
}

// ---- Stripe Checkout (Test Mode) ----
const checkoutItemsSchema = z.object({
  items: z.array(z.object({
    id: z.string().min(1),
    quantity: z.number().int().min(1)
  })).min(1),
  token: z.string().optional()
});

app.post('/api/checkout', async (req, res) => {
  const stripeSecret = process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim();
  if (!stripeSecret || !stripeSecret.startsWith('sk_')) {
    return res.status(503).json({ error: 'Stripe no configurado. Añade STRIPE_SECRET_KEY (sk_test_...) en .env' });
  }
  const parsed = checkoutItemsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  }
  const { items: cartItems } = parsed.data;

  const db = await dbPromise;
  await db.read();
  db.data ||= { users: [], products: [], orders: [], contact_messages: [], mp_notifications: [] };

  const lineItems = [];
  for (const it of cartItems) {
    const p = (db.data.products || []).find(x => x.id === it.id && x.active !== false);
    if (!p) return res.status(400).json({ error: 'Producto no válido: ' + it.id });
    if ((p.stock || 0) < it.quantity) return res.status(409).json({ error: `Sin stock para ${p.name}. Disponible: ${p.stock}` });
    const priceCents = Math.max(1, Number(p.price_cents) || 0);
    const productName = (String(p.name || '').trim() || 'Producto');
    const productDesc = (p.description && String(p.description).trim()) ? String(p.description).slice(0, 500) : 'Producto de excelente calidad de ProyectWeb';
    lineItems.push({
      price_data: {
        currency: 'mxn',
        unit_amount: priceCents,
        product_data: {
          name: productName,
          description: productDesc,
          images: p.image_url ? [p.image_url] : []
        }
      },
      quantity: it.quantity
    });
  }

  const baseUrl = getFrontendPublicUrl();
  const pathSuffix = baseUrl.indexOf('5050') !== -1 ? '/frontend/index.html' : '';
  const successUrl = baseUrl.replace(/\/$/, '') + pathSuffix + '?stripe=success';
  const cancelUrl = baseUrl.replace(/\/$/, '') + pathSuffix + '?stripe=cancel';

  try {
    const stripe = new Stripe(stripeSecret);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      locale: 'es'
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[checkout] Stripe error:', err.message);
    return res.status(500).json({ error: err.message || 'Error al crear la sesión de pago' });
  }
});

const mpPreferenceSchema = z.object({
  items: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    price: z.number().positive(),
    quantity: z.number().int().min(1)
  })).min(1),
  orderId: z.string().optional(),
  customer: z.object({ email: z.string().email().optional(), name: z.string().optional() }).optional()
});

app.post('/api/payments/mercadopago/preference', authRequired, async (req, res) => {
  const token = getMpAccessToken();
  if (!token) return res.status(503).json({ error: 'Mercado Pago no configurado' });
  const parsed = mpPreferenceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  const { items, orderId, customer } = parsed.data;
  const baseUrl = getFrontendPublicUrl();
  const externalRef = orderId || ('PW-' + Date.now());
  const body = {
    items: items.map(i => ({ title: i.name, quantity: i.quantity, unit_price: Number(i.price) })),
    external_reference: externalRef,
    back_urls: { success: `${baseUrl}/frontend/index.html?mp=success`, failure: `${baseUrl}/frontend/index.html?mp=failure`, pending: `${baseUrl}/frontend/index.html?mp=pending` },
    auto_return: 'approved'
  };
  if (customer && customer.email) body.payer = { email: customer.email, name: customer.name || undefined };
  try {
    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await mpRes.json();
    if (!mpRes.ok) return res.status(mpRes.status >= 500 ? 502 : 400).json({ error: data.message || 'Error al crear preferencia de Mercado Pago' });
    const paymentUrl = data.init_point || data.sandbox_init_point || null;
    if (!paymentUrl) return res.status(502).json({ error: 'Mercado Pago no devolvió URL de pago' });
    return res.json({ paymentUrl, preferenceId: data.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Error al conectar con Mercado Pago' });
  }
});

// ---- Orders ----
const orderSchema = z.object({
  customer: z.object({
    nombre: z.string().min(1).max(80),
    email: z.string().trim().email().transform(s => s.toLowerCase()),
    telefono: z.string().min(6).max(30),
    direccion: z.string().min(5).max(300)
  }),
  items: z.array(z.object({
    id: z.string().min(1),
    quantity: z.number().int().positive()
  })).min(1),
  paymentMethod: z.string().optional()
});

app.post('/api/orders', optionalBearerAuth, async (req, res) => {
  const parsed = orderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  }

  const bearer = req.bearerUser;
  const userId = bearer ? bearer.id : null;
  const userEmail = bearer ? bearer.email : (parsed.data.customer && parsed.data.customer.email) || null;
  const { customer, items, paymentMethod } = parsed.data;

  const db = await dbPromise;
  await db.read();

  // Recalcular total con productos
  const orderItems = [];
  let totalCents = 0;

  for (const it of items) {
    const p = db.data.products.find(x => x.id === it.id && x.active !== false);
    if (!p) return res.status(400).json({ error: 'Producto no válido: ' + it.id });
    if (p.stock < it.quantity) return res.status(409).json({ error: `Sin stock para ${p.name}. Disponible: ${p.stock}` });
    orderItems.push({
      product_id: p.id,
      name: p.name,
      price_cents: p.price_cents,
      qty: it.quantity,
      image_url: p.image_url || ''
    });
    totalCents += p.price_cents * it.quantity;
  }

  const orderId = 'ORD-' + nanoid(10).toUpperCase();
  const ts = nowISO();

  if (paymentMethod === 'stripe' || paymentMethod === 'mercadopago') {
    const stripeSecret = process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim();
    if (!stripeSecret || !stripeSecret.startsWith('sk_')) {
      if (isDev) console.log('[dev] Stripe: falta STRIPE_SECRET_KEY');
      return res.status(503).json({ error: 'Stripe no configurado. Añade STRIPE_SECRET_KEY (sk_test_...) en .env' });
    }
  }

  // Guardar orden
  const initialStatus = (paymentMethod === 'stripe' || paymentMethod === 'mercadopago') ? 'PENDING' : 'PENDING';
  db.data.orders.push({
    id: orderId,
    user_id: userId,
    user_email: userEmail,
    customer,
    items: orderItems,
    address_json: { direccion: customer.direccion },
    total_cents: totalCents,
    status: initialStatus,
    stock_deducted: false,
    paid_at: null,
    mp_preference_id: null,
    mp_init_point: null,
    mp_payment_id: null,
    tracking: null,
    created_at: ts,
    updated_at: ts
  });
  await db.write();

  if (paymentMethod === 'stripe' || paymentMethod === 'mercadopago') {
    const stripeSecret = process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim();
    if (!stripeSecret || !stripeSecret.startsWith('sk_')) {
      return res.status(503).json({ error: 'Stripe no configurado. Añade STRIPE_SECRET_KEY en .env' });
    }
    const baseUrl = getFrontendPublicUrl();
    const pathSuffix = getStripeReturnPathSuffix();
    const successUrl = baseUrl.replace(/\/$/, '') + pathSuffix + '?stripe=success';
    const cancelUrl = baseUrl.replace(/\/$/, '') + pathSuffix + '?stripe=cancel';
    const lineItems = orderItems.map(it => {
      const amount = Math.max(1, Number(it.price_cents) || 0);
      const name = (String(it.name || '').trim() || 'Producto');
      const description = (it.description && String(it.description).trim()) ? String(it.description).slice(0, 500) : 'Producto de excelente calidad de ProyectWeb';
      return {
        price_data: {
          currency: 'mxn',
          unit_amount: amount,
          product_data: {
            name,
            description,
            images: it.image_url ? [it.image_url] : []
          }
        },
        quantity: it.qty
      };
    });
    try {
      const stripe = new Stripe(stripeSecret);
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        locale: 'es'
      });
      const payUrl = session.url || undefined;
      return res.json({
        orderId,
        total: mxnFromCents(totalCents),
        url: payUrl,
        paymentUrl: payUrl,
        init_point: payUrl,
        sandbox_init_point: payUrl
      });
    } catch (err) {
      console.error('[orders] Stripe error:', err.message);
      return res.status(500).json({ error: 'No se pudo iniciar el pago con Stripe' });
    }
  }
  return res.json({ orderId, total: mxnFromCents(totalCents) });
});

// Mis pedidos (usuario autenticado)
app.get('/api/my/orders', authRequired, async (req, res) => {
  const db = await dbPromise;
  await db.read();
  const userId = req.user.sub;
  let orders = (db.data.orders || []).filter(o => o.user_id === userId);
  orders = [...orders].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const out = orders.map(o => ({
    id: o.id,
    date: o.created_at,
    total: mxnFromCents(o.total_cents),
    status: safeLower(o.status),
    customer: o.customer,
    items: (o.items || []).map(i => ({ id: i.product_id, name: i.name, price: mxnFromCents(i.price_cents), quantity: i.qty, image: i.image_url || '' })),
    tracking: o.tracking || null,
    mp: { preferenceId: o.mp_preference_id, paymentId: o.mp_payment_id }
  }));
  return res.json(out);
});

// List orders (admin: todos; cliente: los suyos vía auth)
app.get('/api/orders', authRequired, async (req, res) => {
  const db = await dbPromise;
  await db.read();
  const isAdmin = req.user.role === 'ADMIN';

  let orders = db.data.orders || [];
  if (!isAdmin) orders = orders.filter(o => o.user_id === req.user.sub);
  orders = [...orders].sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)));

  const out = orders.map(o => ({
    id: o.id,
    date: o.created_at,
    total: mxnFromCents(o.total_cents),
    status: safeLower(o.status),
    customer: o.customer,
    items: o.items.map(i => ({ id: i.product_id, name: i.name, price: mxnFromCents(i.price_cents), quantity: i.qty, image: i.image_url || '' })),
    tracking: o.tracking || null,
    mp: { preferenceId: o.mp_preference_id, paymentId: o.mp_payment_id }
  }));

  return res.json(out);
});

// Un pedido por ID (dueño o admin)
app.get('/api/orders/:id', authRequired, async (req, res) => {
  const id = req.params.id;
  const db = await dbPromise;
  await db.read();
  const o = (db.data.orders || []).find(x => x.id === id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const isAdmin = req.user.role === 'ADMIN';
  if (!isAdmin && o.user_id !== req.user.sub) return res.status(403).json({ error: 'Forbidden' });
  return res.json({
    id: o.id,
    date: o.created_at,
    total: mxnFromCents(o.total_cents),
    status: safeLower(o.status),
    customer: o.customer,
    items: (o.items || []).map(i => ({ id: i.product_id, name: i.name, price: mxnFromCents(i.price_cents), quantity: i.qty, image: i.image_url || '' })),
    tracking: o.tracking || null,
    mp: { preferenceId: o.mp_preference_id, paymentId: o.mp_payment_id }
  });
});

// Admin set tracking
const trackingSchema = z.object({
  carrier: z.string().min(1).max(60),
  tracking_number: z.string().min(3).max(80)
});
app.put('/api/admin/orders/:id/tracking', authRequired, adminRequired, async (req, res) => {
  const body = req.body || {};
  const normalized = { carrier: body.carrier, tracking_number: body.tracking_number ?? body.number };
  const parsed = trackingSchema.safeParse(normalized);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });

  const id = req.params.id;
  return dbReadWrite(async (db) => {
    const o = db.data.orders.find(x => x.id === id);
    if (!o) return res.status(404).json({ error: 'Pedido no encontrado' });
    const ts = nowISO();
    o.tracking = { carrier: parsed.data.carrier, tracking_number: parsed.data.tracking_number, updated_at: ts };
    o.updated_at = ts;
    if (String(o.status || '').toUpperCase() === 'PENDING') o.status = 'SHIPPED';
    const mapped = {
      id: o.id,
      date: o.created_at,
      total: mxnFromCents(o.total_cents),
      status: safeLower(o.status),
      customer: o.customer,
      items: (o.items || []).map(i => ({ id: i.product_id, name: i.name, price: mxnFromCents(i.price_cents), quantity: i.qty, image: i.image_url || '' })),
      tracking: o.tracking,
      mp: { preferenceId: o.mp_preference_id, paymentId: o.mp_payment_id }
    };
    return res.status(200).json(mapped);
  });
});

// ---- Mercado Pago webhook (idempotente: stock se descuenta una sola vez) ----
/** Webhook externo: cuerpo JSON arbitrario (objeto o array). */
const mpWebhookBodySchema = z.union([z.record(z.string(), z.unknown()), z.array(z.unknown())]);

function mapMpStatusToOrder(mpStatus) {
  const s = String(mpStatus || '').toLowerCase();
  if (s === 'approved') return 'APPROVED';
  if (s === 'rejected' || s === 'cancelled' || s === 'refunded') return 'REJECTED';
  return 'PENDING';
}

app.post('/api/mp/webhook', express.json({ type: '*/*' }), async (req, res) => {
  const parsedWebhook = mpWebhookBodySchema.safeParse(req.body ?? {});
  if (!parsedWebhook.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsedWebhook.error.issues });
  }
  const topic = req.query.topic || req.query.type || req.body?.type || 'unknown';
  const notificationId = req.query.id || req.body?.data?.id || req.body?.id || null;
  let paymentId = null;
  if (String(topic).includes('payment')) paymentId = notificationId;
  else if (req.body?.data?.id) paymentId = req.body.data.id;

  try {
    await dbReadWrite(async (db) => {
      db.data.mp_notifications.push({ id: nanoid(), topic: String(topic), notification_id: String(notificationId || ''), payment_id: String(paymentId || ''), created_at: nowISO() });
    });

    if (!paymentId) return res.json({ ok: true });

    const pay = await getPayment(paymentId);
    const orderId = pay.external_reference || (pay.metadata && pay.metadata.orderId);
    if (!orderId) return res.json({ ok: true });

    const mappedStatus = mapMpStatusToOrder(pay.status);

    await dbReadWrite(async (db) => {
      const o = db.data.orders.find(x => x.id === orderId);
      if (!o) return;
      o.status = mappedStatus;
      o.mp_payment_id = String(paymentId);
      o.updated_at = nowISO();

      if (mappedStatus === 'APPROVED') {
        if (o.stock_deducted !== true) {
          for (const it of o.items) {
            const p = db.data.products.find(x => x.id === it.product_id && x.active !== false);
            if (p) p.stock = Math.max(0, Number(p.stock) - Number(it.qty));
          }
          o.stock_deducted = true;
          o.paid_at = nowISO();
        }
      }
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error('webhook error', err);
    return res.json({ ok: true });
  }
});

// ---- Admin stats/export ----
app.get('/api/admin/stats', authRequired, adminRequired, async (req, res) => {
  const db = await dbPromise;
  await db.read();
  const totalProducts = (db.data.products || []).filter(p => p.active !== false).length;
  const totalUsers = (db.data.users || []).length;
  const totalSalesCents = (db.data.orders || []).filter(o => String(o.status).toUpperCase() === 'APPROVED').reduce((acc, o) => acc + Number(o.total_cents || 0), 0);
  return res.json({ totalProducts, totalUsers, totalSales: mxnFromCents(totalSalesCents) });
});

app.get('/api/admin/export', authRequired, adminRequired, async (req, res) => {
  const db = await dbPromise;
  await db.read();
  return res.json({
    exportedAt: nowISO(),
    products: (db.data.products || []).filter(p => p.active !== false).map(mapProduct),
    orders: (db.data.orders || []).map(stripSensitiveFields)
  });
});

// ---- Admin users ----
function mapUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role || 'CLIENT',
    active: u.active !== false,
    isVerified: u.isVerified !== false,
    created_at: u.created_at
  };
}

/** Elimina password_hash / password en cualquier nivel (exportaciones, objetos anidados). */
function stripSensitiveFields(value) {
  if (Array.isArray(value)) return value.map(stripSensitiveFields);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'password_hash' || k === 'password' || k === 'verificationToken') continue;
      out[k] = stripSensitiveFields(v);
    }
    return out;
  }
  return value;
}

app.get('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  const db = await dbPromise;
  await db.read();
  const list = (db.data.users || []).map(mapUser);
  return res.json(list);
});

const createUserSchema = z.object({
  email: z.string().trim().email().transform(s => s.toLowerCase()),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
  name: z.string().min(1).max(80),
  role: z.enum(['ADMIN', 'CLIENT']).default('CLIENT')
});

app.post('/api/admin/users', authRequired, adminRequired, async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  const { email, password, name, role } = parsed.data;
  return dbReadWrite(async (db) => {
    const emailLower = String(email).toLowerCase();
    if ((db.data.users || []).some(u => String(u.email || '').toLowerCase() === emailLower)) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }
    const user = {
      id: nanoid(),
      email: emailLower,
      name: String(name).trim(),
      password_hash: bcrypt.hashSync(password, 10),
      role: role,
      active: true,
      isVerified: true,
      verificationToken: null,
      created_at: nowISO()
    };
    db.data.users.push(user);
    return res.status(201).json(mapUser(user));
  });
});

const updateUserSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().trim().email().transform(s => s.toLowerCase()).optional(),
  role: z.enum(['ADMIN', 'CLIENT']).optional(),
  active: z.boolean().optional()
});

app.put('/api/admin/users/:id', authRequired, adminRequired, async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  const id = req.params.id;
  if (req.user.sub === id && parsed.data.active === false) {
    return res.status(403).json({ error: 'No puedes desactivar tu propia cuenta' });
  }
  return dbReadWrite(async (db) => {
    const user = (db.data.users || []).find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (parsed.data.name !== undefined) user.name = String(parsed.data.name).trim();
    if (parsed.data.email !== undefined) {
      const emailLower = String(parsed.data.email).toLowerCase();
      if ((db.data.users || []).some(u => u.id !== id && String(u.email || '').toLowerCase() === emailLower)) {
        return res.status(409).json({ error: 'El correo ya está en uso' });
      }
      user.email = emailLower;
    }
    if (parsed.data.role !== undefined) user.role = parsed.data.role;
    if (parsed.data.active !== undefined) user.active = !!parsed.data.active;
    return res.json(mapUser(user));
  });
});

const resetPasswordSchema = z.object({ newPassword: z.string().min(6, 'Mínimo 6 caracteres') });

app.post('/api/admin/users/:id/reset-password', authRequired, adminRequired, async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  const id = req.params.id;
  return dbReadWrite(async (db) => {
    const user = (db.data.users || []).find(u => u.id === id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    user.password_hash = bcrypt.hashSync(parsed.data.newPassword, 10);
    return res.json({ ok: true });
  });
});

// ---- Contact ----
const contactSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  message: z.string().min(3).max(3000)
});

app.post('/api/contact', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Datos inválidos', details: parsed.error.issues });
  const { name, email, message } = parsed.data;

  await dbReadWrite(async (db) => {
    db.data.contact_messages.push({ id: nanoid(), name, email, message, created_at: nowISO() });
  });

  const to = readEnvTrim('CONTACT_TO');
  const transport = getTransport();
  if (!to || !transport) {
    return res.status(503).json({ error: 'Correo no configurado. Configura CONTACT_TO y SMTP_* en .env' });
  }

  try {
    await transport.sendMail({
      from: readEnvTrim('SMTP_USER'),
      to,
      subject: `Contacto ProyectWeb — ${name}`,
      replyTo: email,
      text: `Nombre: ${name}\nEmail: ${email}\n\nMensaje:\n${message}`
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact email error', err);
    const mapped = mapMailErrorToHttp(err);
    return res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  }
});

// ---- Seed (solo dev) ----
const devSeedBodySchema = z.object({}).passthrough();

app.post('/api/dev/seed', async (req, res) => {
  if ((process.env.NODE_ENV || 'development') === 'production') return res.status(404).end();
  const parsedSeed = devSeedBodySchema.safeParse(req.body ?? {});
  if (!parsedSeed.success) {
    return res.status(400).json({ error: 'Datos inválidos', details: parsedSeed.error.issues });
  }

  return dbReadWrite(async (db) => {
    const adminEmail = 'admin@proyectweb.local';
    if (!db.data.users.find(u => u.email === adminEmail)) {
      db.data.users.push({
        id: nanoid(),
        email: adminEmail,
        name: 'Admin',
        password_hash: bcrypt.hashSync('admin123', 10),
        role: 'ADMIN',
        isVerified: true,
        verificationToken: null,
        created_at: nowISO()
      });
    }

    if ((db.data.products || []).length === 0) {
      const ts = nowISO();
      const defaults = [
        { name: 'Auriculares inalámbricos', price: 49.99, stock: 10, description: 'Sonido envolvente y cancelación de ruido. Hasta 20h de batería.', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
        { name: 'Teclado mecánico RGB', price: 89.99, stock: 8, description: 'Switches mecánicos, retroiluminación RGB y reposamuñecas magnético.', image: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=400&h=300&fit=crop' }
      ];
      db.data.products = defaults.map(d => ({
        id: nanoid(),
        name: d.name,
        description: d.description,
        price_cents: centsFromMXN(d.price),
        stock: d.stock,
        image_url: d.image,
        active: true,
        created_at: ts,
        updated_at: ts
      }));
    }

    if (isDev) {
      console.log('[dev/seed] Usuario admin: admin@proyectweb.local (contraseña por defecto en código de seed; no exponer en producción)');
    }
    return res.json({ ok: true, message: 'Datos de ejemplo cargados correctamente.' });
  });
});

app.listen(PORT, () => {
  const publicUrl = process.env.BACKEND_PUBLIC_URL || `http://localhost:${PORT}`;
  console.log(`Backend listo en ${publicUrl}`);
  console.log(corsAllowAll ? 'CORS: cualquier origen (CORS_ALLOW_ALL)' : 'CORS permitido para: ' + corsWhitelist.join(', '));
});
