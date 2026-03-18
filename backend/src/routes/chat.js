/**
 * Ruta POST /api/chat con Groq.
 * Personalidad por rol (ADMIN, CLIENT, GUEST). Fallback con lenguaje natural, sin mensajes técnicos.
 * Motor de respuestas sin IA (FALLBACK_RESPONSES) para palabras clave concretas.
 */
import Groq from 'groq-sdk';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = express.Router();

const groqApiKey = process.env.GROQ_API_KEY && String(process.env.GROQ_API_KEY).trim();
const groqModel = process.env.GROQ_MODEL && String(process.env.GROQ_MODEL).trim() || 'llama-3.3-70b-versatile';
const groqClient = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null;

/**
 * Lista de respuestas predefinidas (sin IA). Fácil de ampliar: añade un objeto con
 * id, keywords (minúsculas), opcional role, y response (texto o 'dynamic' para lógica especial).
 */
const FALLBACK_RESPONSES = [
  {
    id: 'pagos',
    keywords: ['pago', 'pagar', 'cómo pago', 'como pago', 'pagos', 'pgo', 'pagr', 'stripe'],
    response: '1. Agrega productos al carrito. 2. Ve a Finalizar compra. 3. Completa el formulario y paga con Stripe (tarjeta).'
  },
  {
    id: 'comprar',
    keywords: ['comprar', 'cmprar', 'comprr', 'compra'],
    response: 'Añade productos al carrito y pulsa "Finalizar compra". Pagas con Stripe.'
  },
  {
    id: 'envios',
    keywords: ['envío', 'envios', 'envíos', 'envio'],
    response: 'Realizamos envíos a todo México vía ProyectWeb Express.'
  },
  {
    id: 'seguridad',
    keywords: ['seguridad', 'seguro', 'datos', 'protección'],
    response: 'Tus datos están protegidos con encriptación SSL.'
  },
  {
    id: 'admin_ventas',
    keywords: ['ventas', 'venta'],
    role: 'ADMIN',
    response: 'dynamic'
  },
  {
    id: 'admin_stock',
    keywords: ['stock', 'stok', 'inventario', 'existencias'],
    role: 'ADMIN',
    response: 'dynamic'
  },
  {
    id: 'admin_usuarios',
    keywords: ['usuarios', 'usuario', 'users'],
    role: 'ADMIN',
    response: 'dynamic'
  },
  {
    id: 'admin_ayuda',
    keywords: ['ayuda'],
    role: 'ADMIN',
    response: 'Comandos: "ventas", "stock", "usuarios". Respuestas con datos de data.json.'
  },
  {
    id: 'soporte',
    keywords: ['soporte', 'soport', 'ayuda técnica', 'contacto', 'contactar', 'necesito ayuda'],
    response: 'Nuestro equipo de soporte está disponible de lunes a viernes. Puedes escribirnos por WhatsApp al [Tu Número] o al correo soporte@proyectweb.local'
  },
  {
    id: 'ubicacion',
    keywords: ['ubicacion', 'ubicasion', 'direccion', 'direcion', 'donde estan', 'donde quedan', 'direccion de la tienda', 'ubicacion tienda'],
    response: 'Nuestra tienda física está en Av. Universidad 1200, Ciudad de México, CP 03100. Abrimos de Lunes a Sábado de 10:00 AM a 8:00 PM. [Ver en Maps] https://www.google.com/maps/search/?api=1&query=Av.+Universidad+1200,+Ciudad+de+M%C3%A9xico,+CP+03100'
  },
  {
    id: 'despedida',
    keywords: ['adiós', 'adios', 'gracias', 'bye', 'hasta luego', 'nos vemos', 'chao'],
    response: '¡Fue un gusto! Vuelve pronto.'
  },
  {
    id: 'usuario_pedidos',
    keywords: ['mis pedidos', 'mis órdenes', 'mis ordenes', 'pedidos', 'ordenes'],
    role: 'CLIENT',
    response: 'dynamic'
  }
];

/** Normaliza mensaje antes de procesar: minúsculas, sin acentos, typos corregidos. Así el bot ignora mala ortografía. */
function normalizeMessage(msg) {
  if (!msg || typeof msg !== 'string') return '';
  let s = msg.toLowerCase().trim();
  const accentMap = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u' };
  s = s.replace(/[áéíóúñü]/g, c => accentMap[c] || c);
  const typoReplacements = [
    [/\bpgo\b/g, 'pago'], [/\bpagr\b/g, 'pagar'], [/\bstok\b/g, 'stock'],
    [/\bpresio\b/g, 'precio'], [/\bprecio\b/g, 'precio'],
    [/\bcmprar\b/g, 'comprar'], [/\bcomprr\b/g, 'comprar'], [/\bventa\b/g, 'ventas'],
    [/\busuari\b/g, 'usuarios'], [/\bpedido\b/g, 'pedidos'], [/\borden\b/g, 'ordenes'],
    [/\bstrpe\b/g, 'stripe'], [/\bcatalogo\b/g, 'catalogo'],
    [/\bcarrit\b/g, 'carrito'], [/\bsoport\b/g, 'soporte'], [/\bsoprte\b/g, 'soporte'],
    [/\bubicasion\b/g, 'ubicacion'], [/\bdirecion\b/g, 'direccion'], [/\bdireccion\b/g, 'direccion']
  ];
  for (const [re, replacement] of typoReplacements) {
    s = s.replace(re, replacement);
  }
  return s;
}

/** Elimina mensajes de error técnico de la respuesta para que el usuario nunca vea errores crudos. */
function sanitizeReply(text) {
  if (!text || typeof text !== 'string') return '';
  let s = text.trim();
  const technicalPatterns = [
    /error\s*:\s*.+/i,
    /api\s+error/i,
    /exception\s*:\s*.+/i,
    /failed\s+to\s+.+/i,
    /sorry,?\s*i\s+(couldn't|cannot|can't|encountered).+/i,
    /lo\s+siento,?\s*(no\s+pude|hubo\s+un\s+error|ocurrió).+/i,
    /\[error\].+/i,
    /status\s*:\s*\d+/i,
    /traceback\s*:?/i,
    /at\s+\w+\.\w+\s*\(.+\)/i
  ];
  for (const re of technicalPatterns) {
    s = s.replace(re, '').trim();
  }
  if (/^\s*$/.test(s)) return '';
  return s;
}

function matchFallback(message, role) {
  const text = normalizeMessage(message);
  for (const entry of FALLBACK_RESPONSES) {
    if (entry.role && entry.role !== role) continue;
    const found = entry.keywords.some(k => text.includes(normalizeMessage(k)));
    if (found) return entry;
  }
  return null;
}

/** Elimina muletillas del texto (Según el catálogo, He visto que, Basado en la información, etc.). */
function stripMuletillas(text) {
  if (!text || typeof text !== 'string') return text;
  let s = text
    .replace(/\s*Según el catálogo[,\s]*/gi, ' ')
    .replace(/\s*He visto que\s*/gi, ' ')
    .replace(/\s*Basado en la información[,\s]*/gi, ' ')
    .replace(/\s*Según la información[,\s]*/gi, ' ')
    .replace(/\s*En el catálogo[,\s]*/gi, ' ')
    .replace(/\s*Según lo que[^.]*\.\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s;
}

/** Frase de cierre humana aleatoria. name opcional (ej: Gilberto). */
const CLOSING_PHRASES = [
  '¿Te puedo ayudar en algo más?',
  '¿Deseas ver algún otro modelo?',
  '¡Quedo a tus órdenes!',
  '¿Necesitas algo más?',
  '¿Algo más en lo que te ayude?',
  'Aquí estoy si me necesitas.'
];

function getRandomClosing(name) {
  const phrases = [...CLOSING_PHRASES];
  if (name && String(name).trim()) {
    phrases.push('¿Te puedo ayudar en algo más, ' + String(name).trim() + '?');
    phrases.push('¿Deseas ver algún otro modelo, ' + String(name).trim() + '?');
  }
  return phrases[Math.floor(Math.random() * phrases.length)];
}

/** Añade cierre humano (pregunta de seguimiento) para no cortar la conversación de forma seca. Salvo despedida. */
function addHumanClosing(reply, name, isDespedida) {
  if (!reply || isDespedida) return reply;
  const trimmed = (reply || '').trim();
  if (!trimmed) return reply;
  const alreadyHasClosing = /\?[\s.]*$/.test(trimmed) && (/\b(ayudar|modelo|más|algo)\b/i.test(trimmed) || /\b(¿|¡)/.test(trimmed));
  if (alreadyHasClosing) return trimmed;
  const closing = getRandomClosing(name);
  return trimmed + '\n\n' + closing;
}

function resolveDynamicResponse(entryId, productsData, token) {
  const formatPrice = (c) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format((c || 0) / 100);
  const orders = productsData.orders || [];
  const products = (productsData.products || []).filter(p => p.active !== false);

  if (entryId === 'admin_ventas') {
    const totalCents = orders.reduce((sum, o) => sum + (o.total_cents || 0), 0);
    const count = orders.length;
    return `Ventas (data.json): ${count} órdenes, ${formatPrice(totalCents)} MXN.`;
  }

  if (entryId === 'admin_stock') {
    const lines = products.slice(0, 20).map(p => `• ${p.name}: ${p.stock != null ? p.stock : 0} ud.`);
    return `Stock (data.json):\n${lines.join('\n')}${products.length > 20 ? '\n...' : ''}`;
  }

  if (entryId === 'admin_usuarios') {
    const users = productsData.users || [];
    const count = users.length;
    const lines = users.slice(0, 10).map(u => `• ${(u.email || u.name || '').trim() || '—'} (${u.role || 'CLIENT'})`);
    return `Usuarios (data.json): ${count} registrados.\n${lines.join('\n')}${count > 10 ? '\n...' : ''}`;
  }

  if (entryId === 'usuario_pedidos') {
    if (!token || !process.env.JWT_SECRET) {
      return 'Inicia sesión para ver tus pedidos.';
    }
    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (_) {
      return 'Sesión inválida. Vuelve a iniciar sesión para ver tus pedidos.';
    }
    const userId = payload.sub;
    const userEmail = (payload.email || '').toLowerCase();
    const myOrders = orders.filter(o => o.user_id === userId || (o.user_email && o.user_email.toLowerCase() === userEmail));
    if (myOrders.length === 0) {
      return 'No tienes pedidos aún. Cuando hagas una compra aparecerán aquí.';
    }
    const lines = myOrders.slice(0, 10).map(o => `• ${o.id}: ${formatPrice(o.total_cents)} — ${o.status || 'PENDING'}`);
    return `Tus pedidos (${myOrders.length}):\n${lines.join('\n')}${myOrders.length > 10 ? '\n...' : ''}`;
  }

  return null;
}

/** Devuelve la respuesta de fallback por palabra clave o null si no hay coincidencia. */
function getFallbackResponse(message, role, productsData, token) {
  const entry = matchFallback(message, role);
  if (!entry) return null;
  if (entry.response === 'dynamic') {
    return resolveDynamicResponse(entry.id, productsData, token);
  }
  return entry.response;
}

function getFallbackReply(userContext, products) {
  const role = (userContext && userContext.role) ? String(userContext.role).toUpperCase() : 'GUEST';
  const name = (userContext && userContext.name) ? String(userContext.name).trim() : '';
  const intro = '¡Hola! Estoy revisando el almacén ahora mismo: ';

  if (role === 'ADMIN') {
    return intro + 'todo está bajo control. ¿Quieres un reporte de ventas o revisar el stock?';
  }
  if (role === 'CLIENT' && name) {
    return intro + 'qué gusto verte de nuevo, ' + name + '. ¿Buscas algo especial o revisamos tu último pedido?';
  }
  if (role === 'CLIENT') {
    return intro + 'qué gusto verte de nuevo. ¿Buscas algo especial o revisamos tu último pedido?';
  }
  return intro + 'tenemos ofertas y productos listos para ti. ¿Te ayudo a encontrar algo o prefieres un tour por la tienda?';
}

router.post('/chat', async (req, res) => {
  try {
    const { message, userContext, token } = req.body || {};
    const role = (userContext && userContext.role) ? String(userContext.role).toUpperCase() : 'GUEST';
    const name = (userContext && userContext.name) ? String(userContext.name) : '';
    const displayName = (role === 'GUEST') ? 'Invitado' : (name && String(name).trim()) || '';

    const productsPath = path.join(__dirname, '..', '..', 'data.json');
    const productsData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
    const products = (productsData.products || []).filter(p => p.active !== false);
    const formatPrice = (c) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format((c || 0) / 100);
    const catalog = products.map(p => `${p.name} (${formatPrice(p.price_cents)})`).join(', ');

    const fallbackEntry = matchFallback(message, role);
    const keywordReply = fallbackEntry ? (fallbackEntry.response === 'dynamic'
      ? resolveDynamicResponse(fallbackEntry.id, productsData, token)
      : fallbackEntry.response) : null;
    if (keywordReply != null) {
      const isDespedida = fallbackEntry && fallbackEntry.id === 'despedida';
      let reply = stripMuletillas(keywordReply);
      reply = sanitizeReply(reply) || reply;
      reply = addHumanClosing(reply, displayName, isDespedida);
      return res.status(200).json({
        reply,
        isFallback: true,
        role,
        productNames: [],
        products: []
      });
    }

    if (!groqClient) {
      let reply = getFallbackReply({ role, name }, products);
      reply = addHumanClosing(stripMuletillas(reply), displayName, false);
      return res.status(200).json({
        reply,
        isFallback: true,
        role,
        productNames: [],
        products: []
      });
    }

    const userName = (role === 'GUEST') ? 'Invitado' : ((name && String(name).trim()) || 'Gilberto');
    const roleLabel = role === 'ADMIN' ? 'Administrador' : role === 'CLIENT' ? 'Cliente' : 'Visitante';
    const isAdmin = role === 'ADMIN';
    const isVisitante = role === 'GUEST';
    const systemPrompt = `Identidad: Eres el asistente humano de ProyectWeb. Tu tono es amable, directo y breve. Siempre cierras con: "¿Te ayudo en algo más, ${userName}?"

Regla de privacidad: Si el contexto indica que el usuario es un visitante, no asumas nombres personales aunque los veas en el historial previo. Trátalo siempre como "Invitado" o "Amigo de ProyectWeb".

Contexto de la tienda (acceso mental):
- El catálogo está en data.json (productos, precios, stock).
- Los pagos se procesan con Stripe; el botón "Finalizar compra" abre la pasarela de pago.
- Las imágenes de productos están en la carpeta /uploads/ (ej: /uploads/foto.jpg).
- Ubicación física: Av. Universidad 1200, Ciudad de México, CP 03100. Horario: Lunes a Sábado de 10:00 AM a 8:00 PM. Si preguntan "¿dónde están?", "ubicación" o "dirección" (incluso con faltas como "ubicasion", "direcion"), responde con la dirección y ofrece [Ver en Maps] con el enlace: https://www.google.com/maps/search/?api=1&query=Av.+Universidad+1200,+Ciudad+de+México,+CP+03100

Normalización semántica: Ignora errores de escritura e interpreta la intención real. Por ejemplo: "presio" = precio, "stok" = stock, "pgo" = pago, "soprte" = soporte, "catalogo" = catálogo, "ubicasion" = ubicación, "direcion" = dirección, "donde estan" = dónde están. Responde como si hubieran escrito bien.

Lógica de roles (quien te escribe ahora es ${roleLabel}, nombre: ${userName}):
${isAdmin ? '- Es Admin: responde sobre inventario (stock), ventas y reportes. Da datos concretos cuando pida números o listas.' : ''}
${isVisitante ? '- Es Visitante: ofrece el "Tour por la tienda", catálogo y cómo pagar con Stripe. Las imágenes están en /uploads/.' : ''}
${role === 'CLIENT' ? '- Es Cliente: ayúdale con catálogo, carrito y pago (Stripe).' : ''}

Catálogo disponible: ${catalog}.

Despedidas: Si el usuario agradece o se despide (gracias, adiós, bye, hasta luego), responde con calidez humana: "¡Fue un gusto! Vuelve pronto." En ese caso no añadas la pregunta de cierre.

En cualquier otra respuesta, termina siempre con: "¿Te ayudo en algo más, ${userName}?"`;

    const normalizedForModel = normalizeMessage(message || '');
    const userContent = normalizedForModel || message || '';

    let text = '';
    try {
      const completion = await groqClient.chat.completions.create({
        model: groqModel,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        max_tokens: 512,
        temperature: 0.7
      });
      const choice = completion.choices && completion.choices[0];
      if (choice && choice.message && typeof choice.message.content === 'string') {
        text = choice.message.content.trim();
      }
    } catch (e) {
      console.warn('[chat] Groq response failed:', e.message);
    }
    text = stripMuletillas(text || getFallbackReply({ role, name }, products));
    if (!text) text = getFallbackReply({ role, name }, products);
    text = sanitizeReply(text);
    if (!text) text = getFallbackReply({ role, name }, products);
    text = addHumanClosing(text, displayName, false);

    return res.status(200).json({
      reply: text,
      productNames: [],
      products: []
    });
  } catch (error) {
    console.error('[chat] Respuesta por catálogo:', error.message);

    const { userContext, message, token } = req.body || {};
    const productsPath = path.join(__dirname, '..', '..', 'data.json');
    let products = [];
    let productsData = {};
    try {
      productsData = JSON.parse(fs.readFileSync(productsPath, 'utf8'));
      products = (productsData.products || []).filter(p => p.active !== false);
    } catch (_) {}

    const role = (userContext && userContext.role) ? String(userContext.role).toUpperCase() : 'GUEST';
    const name = (userContext && userContext.name) ? String(userContext.name) : '';
    const displayName = (role === 'GUEST') ? 'Invitado' : (name && String(name).trim()) || '';
    const fallbackEntry = matchFallback(message, role);
    const keywordReply = fallbackEntry ? (fallbackEntry.response === 'dynamic' ? resolveDynamicResponse(fallbackEntry.id, productsData, token) : fallbackEntry.response) : null;
    let reply = keywordReply != null ? keywordReply : getFallbackReply(userContext || {}, products);
    const isDespedida = fallbackEntry && fallbackEntry.id === 'despedida';
    reply = stripMuletillas(reply);
    reply = sanitizeReply(reply) || reply;
    reply = addHumanClosing(reply, displayName, isDespedida);

    res.status(200).json({
      reply,
      isFallback: true,
      role,
      productNames: [],
      products: []
    });
  }
});

export default router;
