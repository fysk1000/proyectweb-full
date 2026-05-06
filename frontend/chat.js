/**
 * ProyectWeb - Asistente Contextual de 3 Niveles
 * Nivel Visitante (sin token) | Nivel Cliente (logueado) | Nivel Administrador (admin@proyectweb.local)
 * Búsqueda con tolerancia a faltas de ortografía. Aviso modo demo (?demo=1).
 */
(function() {
  'use strict';

  const STORAGE_USER = 'proyectweb_user';
  const STORAGE_ADMIN_TOKEN = 'proyectweb_admin_token';
  const STORAGE_CLIENT_TOKEN = 'proyectweb_client_token';
  const SESSION_USER_NAME = 'proyectweb_chat_username';
  const SESSION_OFFLINE = 'proyectweb_chat_offline';
  const SESSION_DEMO_WARNED = 'proyectweb_chat_demo_warned';
  const SESSION_LAST_TOKEN = 'proyectweb_chat_last_token';
  const SESSION_CHAT_HISTORY = 'chatHistory';
  const STORAGE_ROLE = 'proyectweb_role';
  const STORAGE_RECENT_IDS = 'proyectweb_chat_recent_product_ids';
  const TYPING_DELAY_MS = 700;
  const TYPEWRITER_DELAY_MS = 28;
  const ADMIN_EMAIL = 'admin@proyectweb.local';

  function escapeHtmlAttr(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  const CHAT_TOGGLE_LABEL_OPEN = 'Abrir asistente de ventas';
  const CHAT_TOGGLE_LABEL_CLOSE = 'Cerrar asistente de ventas';

  let currentChatAbortController = null;

  const API = window.ProyectWebAPI;
  const App = window.App;

  function getBase() {
    return API && typeof API.getBase === 'function' ? API.getBase() : '';
  }

  function getToken() {
    try {
      return localStorage.getItem(STORAGE_ADMIN_TOKEN) || localStorage.getItem(STORAGE_CLIENT_TOKEN) || null;
    } catch (_) { return null; }
  }

  function getUserNameFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return (parsed && (parsed.name || parsed.email)) ? String(parsed.name || parsed.email) : '';
    } catch (_) { return ''; }
  }

  function getStoredChatName() {
    try { return sessionStorage.getItem(SESSION_USER_NAME) || ''; } catch (_) { return ''; }
  }
  function setStoredChatName(name) {
    try {
      if (name) sessionStorage.setItem(SESSION_USER_NAME, String(name));
      else sessionStorage.removeItem(SESSION_USER_NAME);
    } catch (_) {}
  }

  function isDemoMode() {
    try { return new URLSearchParams(window.location.search).get('demo') === '1'; } catch (_) { return false; }
  }

  function setOfflineMode(offline) {
    try {
      if (offline) sessionStorage.setItem(SESSION_OFFLINE, '1');
      else sessionStorage.removeItem(SESSION_OFFLINE);
    } catch (_) {}
  }
  function isOfflineMode() {
    try { return sessionStorage.getItem(SESSION_OFFLINE) === '1'; } catch (_) { return false; }
  }

  function showDemoWarningOnce() {
    if (!isDemoMode()) return;
    try {
      if (sessionStorage.getItem(SESSION_DEMO_WARNED)) return;
      sessionStorage.setItem(SESSION_DEMO_WARNED, '1');
      appendBubble('Estamos en modo de prueba, las compras son simuladas.', false);
    } catch (_) {}
  }

  /** Detecta el rol actual desde localStorage (proyectweb_role) o desde la sesión (tokens). */
  function getCurrentRole() {
    try {
      const storedRole = localStorage.getItem(STORAGE_ROLE);
      if (storedRole === 'ADMIN' || storedRole === 'CLIENT') return storedRole;
      const token = getToken();
      if (token && localStorage.getItem(STORAGE_ADMIN_TOKEN)) return 'ADMIN';
      if (token && localStorage.getItem(STORAGE_CLIENT_TOKEN)) return 'CLIENT';
    } catch (_) {}
    return 'GUEST';
  }

  /** Saludos personalizados por rol. Para visitante/invitado NUNCA se usa nombre personal: siempre "Invitado" o "Amigo de ProyectWeb". */
  function getWelcomeText() {
    const role = getCurrentRole();
    let text;
    if (role === 'ADMIN') {
      text = 'Hola, soy el asistente de ProyectWeb. Puedo ayudarte con ventas, inventario y usuarios. ¿Qué necesitas?';
    } else if (role === 'CLIENT') {
      const name = getUserNameFromStorage() || getStoredChatName();
      const saludo = name ? 'Hola, ' + name + '.' : 'Hola.';
      text = saludo + ' En ProyectWeb puedes ver el catálogo, añadir al carrito y pagar con Stripe. ¿En qué te ayudo?';
    } else {
      text = 'Hola, Invitado. Bienvenido a ProyectWeb. Puedes hacer un tour por la tienda, ver el catálogo o preguntar cómo pagar. ¿Por dónde empezamos?';
    }
    if (isDemoMode()) text += ' (Modo prueba: las compras son simuladas.)';
    return text;
  }

  /** Botón de basura (Reset): limpia contenedor, borra historial temporal y muestra de inmediato el saludo inicial del rol actual. */
  function resetChat() {
    fullCleanup();
    addWelcomeBubble();
    setWelcomeMessage();
    getContext().then(function(c) { renderQuickReplies(c.role); });
  }

  function resetChatWithWelcomeText(welcomeText) {
    fullCleanup();
    addWelcomeBubble();
    if (welcomeText) {
      const el = document.getElementById('chat-welcome-msg');
      if (el) el.textContent = String(welcomeText);
    } else {
      setWelcomeMessage();
    }
    getContext().then(function(c) { renderQuickReplies(c.role); });
  }

  function getVisitorLogoutWelcomeText() {
    return '¡Hola! Bienvenido a ProyectWeb. Veo que no te has registrado. Si quieres, puedo darte un tour por la tienda o ayudarte a encontrar un producto.';
  }

  /** Detiene cualquier petición de chat en curso (IA). */
  function abortCurrentChatRequest() {
    if (currentChatAbortController) {
      try { currentChatAbortController.abort(); } catch (_) {}
      currentChatAbortController = null;
    }
  }

  /** Limpieza total de interfaz y sesión: vacía mensajes, borra historial de sesión y detiene la IA. */
  function fullCleanup() {
    abortCurrentChatRequest();
    hideTypingIndicator();
    const messagesEl = container();
    if (messagesEl) messagesEl.innerHTML = '';
    try {
      sessionStorage.removeItem(SESSION_CHAT_HISTORY);
      sessionStorage.removeItem(SESSION_USER_NAME);
      sessionStorage.removeItem(SESSION_OFFLINE);
      sessionStorage.removeItem(SESSION_DEMO_WARNED);
    } catch (_) {}
  }

  /** Añade la burbuja de bienvenida con el saludo del rol actual (ProyectWeb + funciones disponibles). */
  function addWelcomeBubble() {
    const messagesEl = container();
    if (!messagesEl) return;
    const welcomeWrap = document.createElement('div');
    welcomeWrap.className = 'chat-bubble-wrap chat-bubble-bot flex gap-2 items-start animate-fade-in';
    welcomeWrap.innerHTML =
      '<span class="chat-avatar w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm text-white shrink-0" aria-hidden="true">' +
      '<i class="fa-solid fa-robot" aria-hidden="true"></i></span>' +
      '<div class="chat-bubble max-w-[85%] px-3 py-2.5 rounded-2xl rounded-bl-md bg-white border border-slate-200 shadow-sm text-slate-700 text-sm break-words">' +
      '<p id="chat-welcome-msg" class="chat-bubble-text m-0 break-words"></p></div>';
    messagesEl.appendChild(welcomeWrap);
    const welcomeEl = document.getElementById('chat-welcome-msg');
    if (welcomeEl) welcomeEl.textContent = getWelcomeText();
  }

  /** Session Watcher: vigila el token efectivo (getToken() = admin o client). Si cambia (Admin↔Usuario) o pasa a null (logout), ejecuta limpieza total, cierre/reapertura si estaba abierto y bienvenida del nuevo rol. Retorna true si se hizo reset. */
  function validateSessionAndResetIfNeeded() {
    const current = getToken() || '';
    let last;
    try {
      last = sessionStorage.getItem(SESSION_LAST_TOKEN) || '';
    } catch (_) {
      last = '';
    }
    if ((current || '') === (last || '')) {
      try { sessionStorage.setItem(SESSION_LAST_TOKEN, current); } catch (_) {}
      return false;
    }
    fullCleanup();
    try { sessionStorage.setItem(SESSION_LAST_TOKEN, current); } catch (_) {}
    const panel = document.getElementById('chat-panel');
    const toggle = document.getElementById('chat-toggle');
    const wasOpen = panel && panel.classList.contains('chat-panel-open');
    if (wasOpen && panel && toggle) {
      panel.classList.remove('chat-panel-open');
      panel.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', CHAT_TOGGLE_LABEL_OPEN);
      setTimeout(function() {
        panel.classList.add('chat-panel-open');
        panel.setAttribute('aria-hidden', 'false');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', CHAT_TOGGLE_LABEL_CLOSE);
        addWelcomeBubble();
        setWelcomeMessage();
        getContext().then(function(c) { renderQuickReplies(c.role); });
      }, 150);
    } else {
      addWelcomeBubble();
      setWelcomeMessage();
      getContext().then(function(c) { renderQuickReplies(c.role); });
    }
    return true;
  }

  /** Listener: cambios en localStorage (login/logout en otra pestaña) disparan reset del chat y bienvenida según el nuevo rol. */
  function onStorageChange(e) {
    if (e.key === STORAGE_ADMIN_TOKEN || e.key === STORAGE_CLIENT_TOKEN || e.key === STORAGE_USER) {
      validateSessionAndResetIfNeeded();
    }
  }

  /** Polling cuando el panel está abierto: detecta login/logout en la misma pestaña y resetea el chat. */
  function startSessionPolling() {
    if (window._proyectwebChatSessionPoll) return;
    window._proyectwebChatSessionPoll = setInterval(function() {
      const panel = document.getElementById('chat-panel');
      if (panel && panel.classList.contains('chat-panel-open')) {
        validateSessionAndResetIfNeeded();
      }
    }, 2000);
  }

  async function checkServerHealth() {
    try {
      const res = await fetch(getBase() + '/api/health', { method: 'GET', credentials: 'omit' });
      return res.ok;
    } catch (_) { return false; }
  }

  function getProductImageUrl(product) {
    const img = product && (product.image || product.image_url);
    if (!img) return '';
    const s = String(img).trim();
    if (/^https?:\/\//i.test(s)) return s;
    const base = getBase().replace(/\/$/, '');
    return s.startsWith('/') ? base + s : base + '/uploads/' + encodeURIComponent(s);
  }

  function getProducts() {
    if (API && typeof API.getProducts === 'function') return API.getProducts().catch(() => []);
    return Promise.resolve([]);
  }

  function formatPrice(price) {
    const n = Number(price);
    if (typeof Intl !== 'undefined' && Intl.NumberFormat) {
      return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(isNaN(n) ? 0 : n);
    }
    return '$' + (isNaN(n) ? 0 : n.toFixed(2)) + ' MXN';
  }

  /** Pre-procesamiento del mensaje del usuario: minúsculas, sin acentos, typos/incompletos a palabras clave (pgo→pago, stok→stock, cmprar→comprar). */
  function normalizeUserMessageForApi(str) {
    if (!str || typeof str !== 'string') return '';
    let s = str.toLowerCase().trim();
    const accentMap = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u' };
    s = s.replace(/[áéíóúñü]/g, function(c) { return accentMap[c] || c; });
    const typoReplacements = [
      [/\bpgo\b/g, 'pago'], [/\bpagr\b/g, 'pagar'], [/\bstok\b/g, 'stock'],
      [/\bcmprar\b/g, 'comprar'], [/\bcomprr\b/g, 'comprar'], [/\bventa\b/g, 'ventas'],
      [/\busuari\b/g, 'usuarios'], [/\bpedido\b/g, 'pedidos'], [/\borden\b/g, 'ordenes'],
      [/\bubicasion\b/g, 'ubicacion'], [/\bdirecion\b/g, 'direccion']
    ];
    for (var i = 0; i < typoReplacements.length; i++) {
      s = s.replace(typoReplacements[i][0], typoReplacements[i][1]);
    }
    return s;
  }

  /** Normaliza texto para búsqueda: minúsculas, sin acentos, sustituciones comunes (z→s, x→s, etc.) */
  function normalizeForSearch(str) {
    if (!str || typeof str !== 'string') return '';
    let s = str.toLowerCase().trim();
    const accentMap = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n', ü: 'u' };
    s = s.replace(/[áéíóúñü]/g, c => accentMap[c] || c);
    const typoMap = { z: 's', x: 's', k: 'c', q: 'c', w: 'u', ph: 'f' };
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      out += typoMap[c] !== undefined ? typoMap[c] : c;
    }
    return out;
  }

  /** Genera variantes de una palabra para tolerar faltas (teniz → tenis) */
  function wordVariants(word) {
    const n = normalizeForSearch(word);
    const variants = [n];
    if (n.length >= 2) {
      const withZ = n.replace(/s/g, 'z');
      if (withZ !== n) variants.push(withZ);
    }
    return variants;
  }

  /** Motor de búsqueda con tolerancia a ortografía: filtra productos por nombre/descripción */
  function searchProducts(products, text) {
    const raw = String(text).replace(/\?|¿|\.|,/g, '').trim();
    if (!raw) return [];
    const words = raw.split(/\s+/).filter(w => w.length > 0);
    const normalizedQuery = normalizeForSearch(raw);
    return products.filter(p => {
      const name = (p.name || '').toLowerCase();
      const nameNorm = normalizeForSearch(p.name || '');
      const descNorm = normalizeForSearch(p.description || '');
      const searchNorm = normalizeForSearch(raw);
      if (nameNorm.includes(searchNorm) || descNorm.includes(searchNorm)) return true;
      return words.some(w => {
        const v = wordVariants(w);
        return v.some(vw => vw.length >= 2 && (nameNorm.includes(vw) || descNorm.includes(vw)));
      });
    });
  }

  function getCatalogSearchTerms(text) {
    const t = String(text).toLowerCase()
      .replace(/\?|¿|\.|,/g, '')
      .replace(/(qué tienes de|que tienes de|qué hay de|que hay de|tienes algo de|productos de|busco|buscando|qué productos|que productos|hay algo de|algo de)\s*/gi, '')
      .trim();
    return t ? t.split(/\s+/).filter(w => w.length > 1) : [];
  }

  function parseAddToCart(text, products) {
    const t = text.toLowerCase().trim();
    if (!/añad(e|ir)|agregar|poner|meter|al carrito|al carro/.test(t)) return null;
    const withoutPrefix = t
      .replace(/^(añade|añadir|agrega|agregar|pon|poner|mete|meter)\s+/i, '')
      .replace(/\s+(al carrito|al carro|al carro de compras)$/i, '')
      .replace(/^(los |las |el |la )/i, '')
      .trim();
    if (!withoutPrefix) return null;
    const matches = searchProducts(products, withoutPrefix);
    if (matches.length === 0) return { query: withoutPrefix, products: [] };
    return { query: withoutPrefix, products: matches };
  }

  function saveRecentProductIds(productList) {
    try {
      const ids = (productList || []).map(function(p) { return p.id; }).filter(Boolean).slice(0, 15);
      if (ids.length) localStorage.setItem(STORAGE_RECENT_IDS, JSON.stringify(ids));
    } catch (_) {}
  }
  function getRecentProductIds() {
    try {
      const raw = localStorage.getItem(STORAGE_RECENT_IDS);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function getRecentProducts(products) {
    const ids = getRecentProductIds();
    if (!ids.length || !products.length) return [];
    return products.filter(function(p) { return ids.indexOf(p.id) !== -1; });
  }

  const container = () => document.getElementById('chat-messages');
  const scrollToBottom = () => { const el = container(); if (el) el.scrollTop = el.scrollHeight; };

  function showTypingIndicator() {
    const el = document.getElementById('chat-typing-indicator');
    if (el) { el.classList.remove('hidden'); scrollToBottom(); }
  }
  function hideTypingIndicator() {
    const el = document.getElementById('chat-typing-indicator');
    if (el) el.classList.add('hidden');
  }

  function appendBubble(text, isUser) {
    const messagesEl = container();
    if (!messagesEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap ' + (isUser ? 'chat-bubble-user' : 'chat-bubble-bot') + ' flex gap-2 items-start animate-fade-in';
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar w-8 h-8 rounded-full flex items-center justify-center text-sm text-white shrink-0 ' + (isUser ? 'bg-slate-500' : 'bg-indigo-600');
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = isUser ? '<i class="fa-solid fa-user" aria-hidden="true"></i>' : '<i class="fa-solid fa-robot" aria-hidden="true"></i>';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble max-w-[85%] px-3 py-2.5 rounded-2xl text-sm break-words ' + (isUser ? 'rounded-br-md bg-indigo-600 text-white' : 'rounded-bl-md bg-white border border-slate-200 shadow-sm text-slate-700');
    const p = document.createElement('p');
    p.className = 'chat-bubble-text m-0';
    p.textContent = text;
    bubble.appendChild(p);
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  /** Añade burbuja del bot con efecto de escritura (solo para mensajes de IA) */
  function appendBubbleWithTypewriter(fullText, onDone) {
    const messagesEl = container();
    if (!messagesEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap chat-bubble-bot flex gap-2 items-start animate-fade-in';
    const avatar = document.createElement('span');
    avatar.className = 'chat-avatar w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm text-white shrink-0';
    avatar.innerHTML = '<i class="fa-solid fa-robot"></i>';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble max-w-[85%] px-3 py-2.5 rounded-2xl rounded-bl-md bg-white border border-slate-200 shadow-sm text-slate-700 text-sm break-words';
    const p = document.createElement('p');
    p.className = 'chat-bubble-text m-0 chat-typewriter-text break-words';
    bubble.appendChild(p);
    wrap.appendChild(avatar);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();

    let i = 0;
    function tick() {
      if (i <= fullText.length) {
        p.textContent = fullText.slice(0, i);
        scrollToBottom();
        i++;
        setTimeout(tick, TYPEWRITER_DELAY_MS);
      } else if (typeof onDone === 'function') {
        onDone();
      }
    }
    tick();
  }

  /** Cards interactivas: foto desde /uploads/, precio, botón Añadir */
  function appendProductCards(products, maxShow) {
    const messagesEl = container();
    if (!messagesEl) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap chat-bubble-bot flex gap-2 items-start animate-fade-in';
    wrap.innerHTML = '<span class="chat-avatar w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm text-white shrink-0" aria-hidden="true"><i class="fa-solid fa-robot" aria-hidden="true"></i></span>';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble chat-bubble-cards max-w-full px-3 py-2 rounded-2xl rounded-bl-md bg-white border border-slate-200 shadow-sm text-sm break-words';
    const list = document.createElement('div');
    list.className = 'chat-product-cards flex flex-col gap-2';
    const slice = (products || []).slice(0, maxShow || 5);
    slice.forEach(p => {
      const card = document.createElement('div');
      card.className = 'chat-product-card flex items-center gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl text-sm';
      const imgUrl = getProductImageUrl(p);
      const safeName = (p.name || 'Producto').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      const safeId = (p.id || '').replace(/"/g, '&quot;');
      const addLabel = escapeHtmlAttr('Añadir ' + (p.name || 'producto') + ' al carrito');
      const body = document.createElement('div');
      body.className = 'flex-1 min-w-0';
      body.innerHTML =
        '<p class="font-semibold text-slate-900 m-0 mb-0.5">' + safeName + '</p>' +
        '<p class="text-indigo-600 font-semibold text-xs m-0 mb-1">' + formatPrice(p.price) + '</p>' +
        '<button type="button" class="chat-product-card-add btn btn-primary btn-sm text-xs" data-product-id="' + safeId + '" aria-label="' + addLabel + '">Añadir</button>';
      if (imgUrl) {
        const img = document.createElement('img');
        img.src = imgUrl;
        img.alt = 'Imagen de ' + (p.name || 'producto');
        img.className = 'w-12 h-12 object-cover rounded-lg shrink-0';
        img.addEventListener('error', function() {
          img.style.display = 'none';
        });
        card.appendChild(img);
      }
      card.appendChild(body);
      list.appendChild(card);
    });
    bubble.appendChild(list);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    list.querySelectorAll('.chat-product-card-add').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.getAttribute('data-product-id');
        if (!id) return;
        getContext().then(function(c) {
          const role = (c && c.role) ? String(c.role).toUpperCase() : 'GUEST';
          dispararAccion('Añadir', { id: id, role: role }).then(function(handled) {
            if (handled) {
              if (typeof App.toast === 'function') App.toast('Añadido al carrito', 'success');
              if (typeof App.openCartDrawer === 'function') App.openCartDrawer();
              this.textContent = 'Añadido';
              this.disabled = true;
            } else if (typeof window.agregarAlCarrito === 'function') {
              window.agregarAlCarrito(id);
              if (typeof App.toast === 'function') App.toast('Añadido al carrito', 'success');
              if (typeof App.openCartDrawer === 'function') App.openCartDrawer();
              this.textContent = 'Añadido';
              this.disabled = true;
              renderQuickReplies(role);
            }
          }.bind(this));
        });
      });
    });
    saveRecentProductIds(slice);
    scrollToBottom();
  }

  /** Los botones (Tour, Carrito, etc.) solo aparecen en la barra quick-replies; no se repiten dentro del globo de la respuesta. */
  function appendSuggestionButtons(userCtx, productsForRecent) {}

  /**
   * Tour guiado para visitante: scroll a Categorías/Productos -> Nuevos productos -> Cómo registrarse (abre modal).
   */
  function runTourVisita() {
    appendBubble('¡Vamos! Te guío. Primero: nuestras categorías y productos.', false);
    if (App && typeof App.scrollToSection === 'function') App.scrollToSection('catalogo');
    setTimeout(function() {
      appendBubble('Aquí están los productos. Usa el botón "Añadir" en cada tarjeta para llevar al carrito.', false);
      scrollToBottom();
    }, 2200);
    setTimeout(function() {
      appendBubble('Para comprar y guardar tus pedidos, crea una cuenta. ¡Es rápido! Abriendo el formulario de registro…', false);
      if (App && typeof App.openRegisterModal === 'function') App.openRegisterModal();
      renderQuickReplies('GUEST');
      scrollToBottom();
    }, 4500);
  }

  /**
   * Normaliza el texto del botón/comando a una clave para el switch de dispararAccion.
   * @param {string} comando - Texto del botón (ej. '📦 Catálogo', 'Tour', 'Añadir')
   * @returns {string|null} Clave normalizada o null si no coincide
   */
  function normalizarComando(comando) {
    const t = String(comando || '').toLowerCase().trim().replace(/\s+/g, ' ');
    if (/catálogo|catalogo|ver catálogo/.test(t)) return 'catalogo';
    if (/^tour|tour por la tienda/.test(t) || t === 'tour') return 'tour';
    if (/crear cuenta|registro|registrarme/.test(t)) return 'crear_cuenta';
    if (/soporte|contacto|ayuda|necesito ayuda/.test(t)) return 'soporte';
    if (/stock|revisar stock|productos sin stock/.test(t)) return 'stock';
    if (/añadir|agregar/.test(t)) return 'añadir';
    return null;
  }

  /**
   * Mensaje de éxito mostrado tras ejecutar una acción (persistencia del chatbot).
   */
  function getMensajeExito(key) {
    switch (key) {
      case 'catalogo':
      case 'tour': return '¡Listo! Te mostré la sección de productos.';
      case 'añadir': return 'Producto añadido al carrito.';
      case 'crear_cuenta': return 'Abriendo el formulario de registro.';
      case 'soporte': return 'Te llevé a la sección de contacto y pie de página.';
      case 'stock': return 'Listado de productos con stock bajo (menos de 5 unidades).';
      default: return '¡Listo!';
    }
  }

  /**
   * Filtra productos con stock < 5 y los muestra en el chat (solo Admin).
   */
  function ejecutarStockBajo() {
    return getProducts().then(function(products) {
      const list = Array.isArray(products) ? products : [];
      const low = list.filter(function(p) { return (Number(p.stock) || 0) < 5; });
      if (low.length > 0) {
        appendBubble('Productos con menos de 5 unidades (' + low.length + '):', false);
        appendProductCards(low, 20);
      } else {
        appendBubble('Todos los productos tienen 5 o más unidades en stock.', false);
      }
    }).catch(function() {
      appendBubble('No pude cargar el stock. Revisa tu conexión.', false);
    });
  }

  /**
   * Función ejecutora central: evalúa el comando con un switch y llama a la función global correspondiente.
   * Verifica que la función exista antes de llamarla. Tras ejecutar, muestra mensaje de éxito y re-renderiza botones.
   * @param {string} comando - Texto del botón (ej. 'Catálogo', 'Tour', 'Añadir', 'Crear cuenta', 'Soporte', 'Stock')
   * @param {Object} [opts] - { role: string, id: string } (id obligatorio para 'Añadir')
   * @returns {Promise<boolean>} true si se ejecutó una acción
   */
  async function dispararAccion(comando, opts) {
    opts = opts || {};
    const role = (opts.role && String(opts.role).toUpperCase()) || 'GUEST';
    const id = opts.id;
    const key = normalizarComando(comando);
    if (!key) return false;

    let ejecutado = false;

    switch (key) {
      case 'catalogo':
        if (typeof window.mostrarSeccionProductos === 'function') {
          window.mostrarSeccionProductos();
          ejecutado = true;
        }
        break;
      case 'tour':
        getProducts().then(function(list) {
          const products = Array.isArray(list) ? list : [];
          appendBubble('¡Claro! Elige una categoría y te muestro lo que tenemos:', false);
          appendTourCategories(products);
          renderQuickReplies(role);
          scrollToBottom();
        }).catch(function() {
          appendBubble('No pude cargar el catálogo. Intenta en un momento.', false);
          renderQuickReplies(role);
          scrollToBottom();
        });
        return true;
      case 'añadir':
        if (id && typeof window.agregarAlCarrito === 'function') {
          window.agregarAlCarrito(id);
          ejecutado = true;
        }
        break;
      case 'crear_cuenta':
        if (typeof window.abrirModalRegistro === 'function') {
          window.abrirModalRegistro();
          ejecutado = true;
        }
        break;
      case 'soporte':
        if (typeof window.mostrarSoporte === 'function') {
          window.mostrarSoporte();
          ejecutado = true;
        }
        break;
      case 'stock':
        if (role === 'ADMIN') {
          await ejecutarStockBajo();
          ejecutado = true;
        }
        break;
    }

    if (ejecutado) {
      appendBubble(getMensajeExito(key), false);
      renderQuickReplies(role);
      scrollToBottom();
      return true;
    }
    return false;
  }

  /**
   * Función centralizada que ejecuta la acción real de la app según el texto del botón.
   * Usa las funciones expuestas en window por script.js. Tras ejecutar, muestra mensaje y re-renderiza botones.
   * @param {string} texto - Texto del botón (ej. '📦 Catálogo', '👤 Crear cuenta')
   * @returns {Promise<boolean>} true si se ejecutó una acción, false para dejar que el chat responda por mensaje
   */
  async function ejecutarAccionChat(texto) {
    const ctx = await getContext();
    const role = (ctx && ctx.role) ? String(ctx.role).toUpperCase() : 'GUEST';
    const mensajeConfirmacion = '¡Entendido! Te estoy mostrando lo que pediste';

    if ((texto === '🏪 Tour' || texto === 'Tour') && (role === 'GUEST' || role === 'CLIENT')) {
      getProducts().then(function(list) {
        const products = Array.isArray(list) ? list : [];
        appendBubble('¡Claro! Elige una categoría y te muestro lo que tenemos:', false);
        appendTourCategories(products);
        renderQuickReplies(role);
        scrollToBottom();
      }).catch(function() {
        appendBubble('No pude cargar el catálogo. Intenta en un momento.', false);
        renderQuickReplies(role);
      });
      return true;
    }
    if (texto === '📦 Catálogo') {
      if (typeof window.renderProducts === 'function') window.renderProducts();
      appendBubble(mensajeConfirmacion, false);
      renderQuickReplies(role);
      return true;
    }
    if (texto === '👤 Crear cuenta') {
      if (typeof window.abrirModalRegistro === 'function') window.abrirModalRegistro();
      appendBubble(mensajeConfirmacion, false);
      renderQuickReplies(role);
      return true;
    }
    if (texto === '🛒 Mi Carrito') {
      if (typeof window.abrirCarrito === 'function') window.abrirCarrito();
      else if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
      appendBubble(mensajeConfirmacion, false);
      renderQuickReplies(role);
      return true;
    }
    if (texto === '🚚 Mis Pedidos' && role === 'CLIENT') {
      if (App && typeof App.scrollToSection === 'function') App.scrollToSection('vista-cliente');
      if (App && typeof App.renderMisPedidos === 'function') App.renderMisPedidos();
      appendBubble(mensajeConfirmacion, false);
      renderQuickReplies(role);
      return true;
    }
    if (role === 'ADMIN' && texto === '📊 Reporte Ventas') {
      if (typeof window.mostrarEstadisticasAdmin === 'function') window.mostrarEstadisticasAdmin();
      appendBubble(mensajeConfirmacion, false);
      renderQuickReplies(role);
      return true;
    }
    if (texto === '📱 Redes sociales' || texto === 'Redes sociales') {
      if (App && typeof App.scrollToSection === 'function') App.scrollToSection('footer');
      appendBubble('Síguenos en redes: Facebook, Instagram y Twitter/X. Te llevé al pie de página donde están los enlaces.', false);
      renderQuickReplies(role);
      return true;
    }
    if (texto === '💳 Pagar') {
      const cart = App && typeof App.getCart === 'function' ? App.getCart() : [];
      if (!cart || cart.length === 0) {
        appendBubble('Tu carrito está vacío. Añade productos y vuelve a pulsar 💳 Pagar.', false);
        renderQuickReplies(role);
        return true;
      }
      const items = cart.map(function(i) { return { id: i.id, quantity: i.quantity || 1 }; });
      const token = getToken();
      if (!API || typeof API.createCheckoutSession !== 'function') {
        appendBubble('No se pudo conectar con el servidor de pagos. Intenta de nuevo en un momento.', false);
        renderQuickReplies(role);
        return true;
      }
      API.createCheckoutSession(items, token).then(function(data) {
        if (data && data.url) {
          appendBubble('Abriendo la ventana de pago. Usa la tarjeta de prueba 4242 4242 4242 4242.', false);
          renderQuickReplies(role);
          if (typeof window.abrirVentanaPagoStripe === 'function') {
            window.abrirVentanaPagoStripe(data.url);
          } else {
            var pw = 500, ph = 700;
            var px = Math.max(0, Math.floor((window.screen.width - pw) / 2));
            var py = Math.max(0, Math.floor((window.screen.height - ph) / 2));
            window.open(data.url, 'StripeCheckout', 'width=' + pw + ',height=' + ph + ',left=' + px + ',top=' + py + ',menubar=no,toolbar=no,location=no,status=no');
          }
        } else {
          appendBubble('No se obtuvo la URL de pago. Revisa que Stripe esté configurado en el servidor.', false);
          renderQuickReplies(role);
        }
      }).catch(function(err) {
        const msg = (err && err.data && err.data.error) || (err && err.message) || 'Error al iniciar el pago.';
        appendBubble('No se pudo iniciar el pago: ' + msg, false);
        renderQuickReplies(role);
      });
      return true;
    }

    return false;
  }

  /**
   * Mapeador de acciones universales: al hacer clic en un Quick Reply, ejecuta la función core según rol
   * y muestra mensaje amigable + vuelve a renderizar los botones. Devuelve true si se manejó la acción.
   */
  async function runUniversalAction(label, role) {
    const r = (role && String(role).toUpperCase()) || 'GUEST';
    const msg = function(text) {
      appendBubble(text, false);
      renderQuickReplies(r);
    };

    if (label === '📦 Catálogo') {
      if (App && typeof App.scrollToCatalogAndRefresh === 'function') App.scrollToCatalogAndRefresh();
      msg('📦 Te llevo al catálogo. Ya está actualizado. ¿Buscas algo en concreto?');
      return true;
    }

    /* Soporte: todos los roles */
    if (label === '🆘 Soporte') {
      if (App && typeof App.scrollToSection === 'function') App.scrollToSection('contacto');
      msg('🆘 Te llevé a la sección de contacto. Rellena el formulario o revisa los datos en el pie de página.');
      setTimeout(function() {
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('footer');
      }, 1200);
      return true;
    }

    /* Redes sociales: todos los roles */
    if (label === '📱 Redes sociales') {
      if (App && typeof App.scrollToSection === 'function') App.scrollToSection('footer');
      appendBubble('Síguenos en redes:\n\n• Facebook: facebook.com\n• Instagram: instagram.com\n• Twitter/X: twitter.com\n\nTe llevé al pie de página donde están los enlaces.', false);
      renderQuickReplies(r);
      return true;
    }

    if (r === 'GUEST') {
      if (label === '👤 Crear cuenta') {
        if (App && typeof App.openRegisterModal === 'function') App.openRegisterModal();
        msg('👤 Abriendo el formulario de registro. Completa tus datos para crear tu cuenta.');
        return true;
      }
      if (label === '💳 ¿Cómo pagar?') {
        if (App && typeof App.openStripeInfoModal === 'function') App.openStripeInfoModal();
        msg('💳 Pagos con Stripe. Usa el botón "💳 Pagar" en el chat para ir a la pasarela. En modo prueba: tarjeta 4242 4242 4242 4242.');
        return true;
      }
      return false;
    }

    if (r === 'CLIENT') {
      if (label === '💳 Pagar') {
        const cart = App && typeof App.getCart === 'function' ? App.getCart() : [];
        if (!cart || cart.length === 0) {
          appendBubble('Tu carrito está vacío. Añade productos y pulsa de nuevo 💳 Pagar.', false);
          renderQuickReplies(r);
          return true;
        }
        if (App && typeof App.openCheckoutModal === 'function') {
          App.openCheckoutModal();
          msg('💳 Abre el formulario de finalizar compra. Completa tus datos y confirma para ir a Stripe.');
        } else {
          appendBubble('Completa tu compra desde el botón "Finalizar compra" del carrito.', false);
          if (typeof window.abrirCarrito === 'function') window.abrirCarrito();
          renderQuickReplies(r);
        }
        return true;
      }
      if (label === '🛒 Mi Carrito') {
        if (typeof window.abrirCarrito === 'function') window.abrirCarrito();
        else if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
        msg('🛒 Aquí tienes tu carrito. Añade más productos o finaliza tu compra cuando quieras.');
        return true;
      }
      if (label === '🚚 Mis Pedidos') {
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('vista-cliente');
        if (App && typeof App.renderMisPedidos === 'function') App.renderMisPedidos();
        msg('🚚 Te llevé a la sección de Mis pedidos. Ahí puedes ver el estado de tus órdenes.');
        return true;
      }
      return false;
    }

    if (r === 'ADMIN') {
      if (label === '📊 Reporte Ventas') {
        if (App && typeof App.refreshAdminStats === 'function') App.refreshAdminStats();
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('vista-admin');
        msg('📊 Actualicé las estadísticas y te llevé al panel. Ahí ves ventas, productos y usuarios.');
        return true;
      }
      if (label === '📦 Revisar Stock') {
        getProducts().then(function(products) {
          const list = Array.isArray(products) ? products : [];
          const low = list.filter(function(p) { return (Number(p.stock) || 0) < 5; });
          if (low.length > 0) {
            appendBubble('Productos con menos de 5 unidades (' + low.length + '):', false);
            appendProductCards(low, 20);
          } else {
            appendBubble('Todos los productos tienen 5 o más unidades en stock.', false);
          }
          renderQuickReplies('ADMIN');
        }).catch(function() {
          appendBubble('No pude cargar el stock. Revisa tu conexión.', false);
          renderQuickReplies('ADMIN');
        });
        return true;
      }
      if (label === '📋 Gestión Productos') {
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('admin-gestion-productos');
        msg('📋 Te llevé a Gestión de Productos. Ahí puedes añadir, editar o eliminar productos.');
        return true;
      }
      if (label === '👥 Usuarios') {
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('admin-usuarios');
        msg('👥 Te llevé a Gestión de Usuarios. Ahí puedes ver y administrar las cuentas.');
        return true;
      }
      if (label === '📋 Pedidos recientes') {
        const t = getToken();
        if (!API || !t || typeof API.getOrders !== 'function') {
          appendBubble('Inicia sesión como administrador para ver los pedidos.', false);
          renderQuickReplies('ADMIN');
          return true;
        }
        API.getOrders(t).then(function(orders) {
          const list = Array.isArray(orders) ? orders : [];
          const last3 = list.slice(0, 3);
          if (last3.length === 0) {
            appendBubble('Aún no hay pedidos en la base de datos.', false);
          } else {
            const lines = last3.map(function(o) {
              return (o.id || o._id || '—') + ' — ' + formatPrice(o.total || 0) + ' — ' + (o.status || 'pendiente');
            });
            appendBubble('Últimos 3 pedidos:\n' + lines.join('\n'), false);
          }
          renderQuickReplies('ADMIN');
        }).catch(function() {
          appendBubble('No pude cargar los pedidos. Revisa tu conexión.', false);
          renderQuickReplies('ADMIN');
        });
        return true;
      }
      if (label === '⚙️ Panel Control') {
        if (App && typeof App.scrollToSection === 'function') App.scrollToSection('vista-admin');
        msg('⚙️ Te llevé al panel de administración. Gestiona productos, pedidos y usuarios.');
        return true;
      }
    }

    return false;
  }

  /**
   * Botones de acción persistentes (quick-replies): área fija arriba del input.
   * Se regeneran tras cada respuesta del bot según el rol. Al hacer clic se ejecuta la acción universal o se envía el texto al chat.
   */
  function renderQuickReplies(role) {
    const el = document.getElementById('quick-replies');
    if (!el) return;
    el.innerHTML = '';
    const r = (role && String(role).toUpperCase()) || 'GUEST';
    if (r === 'ADMIN') {
      el.className = 'quick-replies grid grid-cols-2 gap-2';
    } else {
      el.className = 'quick-replies flex flex-wrap gap-2';
    }
    let buttons = [];
    if (r === 'ADMIN') {
      buttons = [
        { label: '📊 Reporte Ventas', message: 'ventas' },
        { label: '📦 Revisar Stock', message: 'productos sin stock' },
        { label: '📋 Gestión Productos', message: 'Gestión de productos' },
        { label: '👥 Usuarios', message: 'Usuarios' },
        { label: '📋 Pedidos recientes', message: 'Pedidos recientes' },
        { label: '⚙️ Panel Control', message: 'ir al panel' },
        { label: '📱 Redes sociales', message: 'Redes sociales' },
        { label: '🆘 Soporte', message: 'soporte' }
      ];
    } else if (r === 'CLIENT') {
      buttons = [
        { label: '🏪 Tour', message: 'Tour' },
        { label: '💳 Pagar', message: 'Pagar' },
        { label: '🛒 Mi Carrito', message: 'Mi carrito' },
        { label: '🚚 Mis Pedidos', message: 'Mis pedidos' },
        { label: '📱 Redes sociales', message: 'Redes sociales' },
        { label: '🆘 Soporte', message: 'soporte' }
      ];
    } else {
      buttons = [
        { label: '📦 Catálogo', message: 'Ver catálogo' },
        { label: '🏪 Tour', message: 'Tour' },
        { label: '💳 ¿Cómo pagar?', message: '¿Cómo pagar?' },
        { label: '👤 Crear cuenta', message: 'Crear cuenta' },
        { label: '📱 Redes sociales', message: 'Redes sociales' },
        { label: '🆘 Soporte', message: 'soporte' }
      ];
    }
    buttons.forEach(function(b, index) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'quick-reply-btn-' + index;
      btn.className = 'quick-reply-btn px-3 py-2 rounded-xl text-sm font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition';
      btn.textContent = b.label;
      btn.setAttribute('aria-label', b.label);
      btn.addEventListener('click', function() {
        getContext().then(function(ctx) {
          const role = (ctx && ctx.role) ? String(ctx.role).toUpperCase() : 'GUEST';
          dispararAccion(b.label, { role: role }).then(function(handled) {
            if (handled) return;
            dispararAccion(b.message, { role: role }).then(function(handled2) {
              if (handled2) return;
              runUniversalAction(b.label, role).then(function(handled3) {
                if (handled3) return;
                ejecutarAccionChat(b.label).then(function(handled4) {
                  if (!handled4 && typeof handleMessage === 'function') handleMessage(b.message);
                });
              });
            });
          });
        });
      });
      el.appendChild(btn);
    });
  }

  /** Tour por la tienda: botones de categorías para visitantes */
  function appendTourCategories(products) {
    const messagesEl = container();
    if (!messagesEl) return;
    const list = Array.isArray(products) ? products : [];
    const categories = [
      { id: 'consolas', label: '🎮 Consolas', filter: function(p) { return /playstation|xbox|consola/i.test(p.name || ''); } },
      { id: 'tecnologia', label: '📱 Tecnología', filter: function(p) { return /iphone|macbook|pantalla|teclado|hisense/i.test(p.name || ''); } },
      { id: 'accesorios', label: '🎧 Accesorios', filter: function(p) { return /auricular|teclado|accesorio/i.test(p.name || ''); } },
      { id: 'todo', label: '📦 Ver todo', filter: function() { return true; } }
    ];
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap chat-bubble-bot flex gap-2 items-start animate-fade-in';
    wrap.innerHTML = '<span class="chat-avatar w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm text-white shrink-0" aria-hidden="true"><i class="fa-solid fa-robot" aria-hidden="true"></i></span>';
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble max-w-full px-3 py-2 rounded-2xl rounded-bl-md bg-white border border-slate-200 shadow-sm text-sm break-words';
    const box = document.createElement('div');
    box.className = 'flex flex-wrap gap-2';
    categories.forEach(function(cat) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-suggestion-btn px-3 py-2 rounded-xl text-sm font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 transition';
      btn.textContent = cat.label;
      btn.setAttribute('data-category', cat.id);
      box.appendChild(btn);
    });
    bubble.appendChild(box);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    box.querySelectorAll('button').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const id = this.getAttribute('data-category');
        const cat = categories.find(function(c) { return c.id === id; });
        if (!cat) return;
        const filtered = list.filter(cat.filter);
        if (filtered.length > 0) {
          appendBubble('Aquí tienes:', false);
          appendProductCards(filtered, 10);
        } else {
          appendBubble('En esta categoría no hay productos ahora. Prueba "Ver todo" para ver el catálogo completo.', false);
        }
      });
    });
    scrollToBottom();
  }

  function showOfflineMessage() {
    appendBubble('El servidor no responde. Para seguir probando, agrega ?demo=1 a la URL y recarga. Las compras se simularán.', false);
    const badge = document.getElementById('chat-offline-badge');
    if (badge) { badge.classList.remove('hidden'); badge.textContent = 'Modo Offline'; }
  }

  /** Retorna { level, name, email, isAdmin, role }. Para visitante/invitado (GUEST) name siempre vacío para no filtrar nombres a la IA. */
  async function getContext() {
    const token = getToken();
    if (!token) return { level: 'visitor', name: '', isAdmin: false, role: 'GUEST' };
    if (!API || typeof API.getMe !== 'function') return { level: 'visitor', name: '', isAdmin: false, role: 'GUEST' };
    try {
      const me = await API.getMe(token);
      if (me && me.user) {
        const email = (me.user.email || '').toLowerCase();
        const isAdminByRole = String(me.user.role || '').toLowerCase() === 'admin';
        const isAdmin = isAdminByRole || email === ADMIN_EMAIL;
        const name = me.user.name || me.user.email || 'Usuario';
        const role = isAdmin ? 'ADMIN' : 'CLIENT';
        setStoredChatName(name);
        return { level: isAdmin ? 'admin' : 'client', name, email, isAdmin, role };
      }
    } catch (_) {}
    return { level: 'visitor', name: '', isAdmin: false, role: 'GUEST' };
  }

  /**
   * Base de conocimientos del Asistente Experto Local.
   * Fácil de editar: añade nuevas líneas como:
   *   { keywords: ['palabra1', 'palabra2'], response: 'Tu respuesta con \\n para saltos de línea y emojis 📌' }
   * Las respuestas se usan cuando la IA no responde (formato amigable, sin errores técnicos).
   */
  const knowledgeBase = {
    general: [
      { keywords: ['hola', 'buenas', 'ayuda', 'qué tal'], response: '¡Hola! 👋\n\nSoy el asistente de ProyectWeb. Puedes preguntarme por pagos, envíos, productos o tu perfil.' },
      { keywords: ['envío', 'envíos', 'enviar', 'envio'], response: '📦 Envíos\n\nRealizamos envíos a todo México vía ProyectWeb Express.\n\nSi ya compraste, puedes preguntar por el estado de tu pedido.' },
      { keywords: ['seguridad', 'seguro', 'datos', 'protección'], response: '🔒 Tus datos están protegidos con encriptación SSL.\n\nLos pagos los procesa Stripe con sus estándares de seguridad.' },
      { keywords: ['catálogo', 'catalogo', 'productos', 'qué venden'], response: '🛍️ Tenemos un catálogo con varios productos.\n\nPuedes usar el botón "Tour por la tienda" o preguntarme por algo concreto.' },
      { keywords: ['ubicacion', 'ubicación', 'ubicasion', 'direccion', 'dirección', 'direcion', 'donde estan', 'dónde están', 'donde quedan'], response: '📍 Nuestra tienda física está en Av. Universidad 1200, Ciudad de México, CP 03100. Abrimos de Lunes a Sábado de 10:00 AM a 8:00 PM.\n\n[Ver en Maps] https://www.google.com/maps/search/?api=1&query=Av.+Universidad+1200,+Ciudad+de+M%C3%A9xico,+CP+03100' }
    ],
    pagos: [
      { keywords: ['pago', 'pagar', 'comprar', 'cómo pago', 'como pago', 'stripe', 'checkout', 'tarjeta'], response: '💳 Cómo pagar:\n\n1️⃣ Agrega productos al carrito.\n2️⃣ Pulsa el botón "💳 Pagar" en el chat o ve a Finalizar compra.\n3️⃣ Serás redirigido a Stripe (pago con tarjeta). En modo prueba usa 4242 4242 4242 4242.\n\n¿Quieres que te abra el carrito?' },
      { keywords: ['precio', 'precios', 'cuánto cuesta', 'cuanto cuesta'], response: '💰 Los precios están en cada producto.\n\nPregúntame por un producto concreto o revisa el catálogo.' }
    ],
    usuario: [
      { keywords: ['mis pedidos', 'mis órdenes', 'pedido', 'pedidos', 'mi pedido'], response: '👤 Para ver tus pedidos puedes usar el botón "Mis pedidos" o escribirlo aquí.\n\nEn tu perfil también tienes acceso a tu historial y datos.' },
      { keywords: ['perfil', 'mi cuenta', 'mi perfil', 'datos personales'], response: '👤 En tu perfil puedes ver y editar tus datos, y revisar el estado de tus pedidos.\n\n¿Quieres que te liste tus pedidos?' }
    ],
    admin: [
      { keywords: ['ayuda', 'comandos', 'qué puedo hacer'], response: '🛠️ Comandos técnicos:\n\n• "ventas" → Total de ventas (data.json)\n• "stock de [producto]" → Consulta stock\n• "generar reporte" → Descarga JSON' },
      { keywords: ['ventas'], response: '__DYNAMIC_VENTAS__' }
    ]
  };

  /**
   * Busca en la base de conocimientos por palabras clave y rol.
   * Devuelve la respuesta encontrada o null. Para ventas ADMIN devuelve '__DYNAMIC_VENTAS__'.
   */
  function searchKnowledgeBase(message, role) {
    const text = String(message || '').toLowerCase().trim();
    if (!text) return null;

    function matchCategory(entries) {
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const found = (entry.keywords || []).some(function(k) { return text.includes(String(k).toLowerCase()); });
        if (found) return entry.response;
      }
      return null;
    }

    var r = matchCategory(knowledgeBase.general);
    if (r) return r;
    r = matchCategory(knowledgeBase.pagos);
    if (r) return r;
    if (role === 'CLIENT') {
      r = matchCategory(knowledgeBase.usuario);
      if (r) return r;
    }
    if (role === 'ADMIN') {
      r = matchCategory(knowledgeBase.admin);
      if (r) return r;
    }
    return null;
  }

  const INTENTS = [
    {
      name: 'demo_warning',
      match: () => isDemoMode(),
      handle: (text, ctx) => {
        showDemoWarningOnce();
        return false;
      }
    },
    {
      name: 'offline',
      match: () => isOfflineMode(),
      handle: async (text, ctx) => {
        if (/demo|offline|servidor/.test(text.toLowerCase())) {
          appendBubble('Estás en Modo Offline. Añade ?demo=1 a la URL y recarga para probar.', false);
          return true;
        }
        let products = [];
        try { products = await getProducts(); } catch (_) {}
        products = Array.isArray(products) ? products : [];
        const terms = getCatalogSearchTerms(text);
        const matches = terms.length ? searchProducts(products, terms.join(' ')) : products.slice(0, 5);
        if (matches.length) {
          appendBubble('En modo offline estos son algunos productos. Usa "Añadir" en cada card.', false);
          appendProductCards(matches, 5);
          return true;
        }
        appendBubble('Modo Offline. Conecta el servidor o usa ?demo=1 en la URL.', false);
        return true;
      }
    },
    {
      name: 'visitante_descuentos',
      match: (text) => /descuentos|ofertas|promociones|rebajas|temporada/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const products = ctx.products || [];
        const ofertas = products.length ? products.slice(0, 5) : [];
        if (ofertas.length > 0) {
          appendBubble('Tenemos ofertas de temporada que te pueden interesar. Aquí van algunas:', false);
          appendProductCards(ofertas, 5);
        } else {
          appendBubble('Estamos preparando nuevas ofertas. Mientras tanto puedes revisar el catálogo y pagar con Stripe de forma segura.', false);
        }
        return true;
      }
    },
    {
      name: 'visitante_tour',
      match: (text, ctx) => {
        const r = (ctx && ctx.role) ? String(ctx.role).toUpperCase() : 'GUEST';
        if (r !== 'GUEST') return false;
        const t = (text || '').toLowerCase().trim();
        return /^(sí|si|tour|dale|ok|vale|por favor|yes)$/.test(t) || /quiero (el )?tour|dame (el )?tour|hazme (el )?tour/.test(t);
      },
      handle: function() {
        runTourVisita();
        return true;
      }
    },
    {
      name: 'visitante_confianza',
      match: (text) => /confianza|seguro|seguridad|cifrado|confiar|datos seguros|pago seguro/.test(text.toLowerCase()),
      handle: (text, ctx) => {
        appendBubble('Tu seguridad nos importa: el sitio usa conexión cifrada y los pagos los procesa Stripe con sus estándares de protección. No guardamos datos de tu tarjeta.', false);
        return true;
      }
    },
    {
      name: 'admin_ventas_hoy',
      match: (text) => /cuántas ventas|cuantas ventas|ventas (de )?hoy|ventas hoy/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) {
          appendBubble('Solo el administrador puede consultar las ventas. Inicia sesión como admin.', false);
          return true;
        }
        const token = getToken();
        if (!API || !token) { appendBubble('No se pudo conectar. Intenta de nuevo.', false); return true; }
        try {
          const orders = await API.getOrders(token);
          const list = Array.isArray(orders) ? orders : [];
          const today = new Date().toISOString().slice(0, 10);
          const todayOrders = list.filter(o => (o.date || o.created_at || '').toString().slice(0, 10) === today);
          const totalToday = todayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
          appendBubble('Hoy se realizaron ' + todayOrders.length + ' venta(s), por un total de ' + formatPrice(totalToday) + '.', false);
          return true;
        } catch (_) {
          appendBubble('No pude obtener las ventas. Revisa tu conexión.', false);
          return true;
        }
      }
    },
    {
      name: 'admin_productos_sin_stock',
      match: (text) => /productos sin stock|sin stock|agotados|stock (en )?cero/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) {
          appendBubble('Solo el administrador puede ver productos sin stock. Inicia sesión como admin.', false);
          return true;
        }
        const products = ctx.products || [];
        const sinStock = products.filter(p => Number(p.stock) === 0);
        if (sinStock.length === 0) {
          appendBubble('Todos los productos tienen stock disponible.', false);
          return true;
        }
        appendBubble('Productos sin stock (' + sinStock.length + '):', false);
        appendProductCards(sinStock, 10);
        return true;
      }
    },
    {
      name: 'admin_producto_mas_vendido',
      match: (text) => /cuál es el producto más vendido|producto más vendido|más vendido|best seller/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) return false;
        const token = getToken();
        if (!API || !token) { appendBubble('No pude conectar. Intenta en un momento.', false); return true; }
        try {
          const orders = await API.getOrders(token);
          const list = Array.isArray(orders) ? orders : [];
          const countByProduct = {};
          list.forEach(function(o) {
            (o.items || []).forEach(function(it) {
              const name = it.name || it.id || 'Producto';
              countByProduct[name] = (countByProduct[name] || 0) + (it.quantity || 1);
            });
          });
          const entries = Object.keys(countByProduct).map(function(name) { return { name, qty: countByProduct[name] }; });
          entries.sort(function(a, b) { return b.qty - a.qty; });
          if (entries.length === 0) {
            appendBubble('Aún no hay ventas registradas. Cuando haya, te diré cuál es el más vendido.', false);
            return true;
          }
          const top = entries[0];
          appendBubble('El producto más vendido hasta ahora es "' + top.name + '" con ' + top.qty + ' unidad(es) vendida(s).', false);
          return true;
        } catch (_) {
          appendBubble('Revisa tu conexión e inténtalo de nuevo.', false);
          return true;
        }
      }
    },
    {
      name: 'admin_stock_de',
      match: (text) => /cuánto stock queda de|stock queda de|stock de (.+)/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) return false;
        const products = ctx.products || [];
        const match = text.match(/stock (?:queda )?de (.+)/i) || text.match(/stock de (.+)/i);
        const query = match ? match[1].trim() : text.replace(/cuánto|cuanto|stock|queda|de/gi, '').trim();
        if (!query) {
          appendBubble('Di el nombre del producto, por ejemplo: "¿Cuánto stock queda de Playstation 5?"', false);
          return true;
        }
        const matches = searchProducts(products, query);
        if (matches.length === 0) {
          appendBubble('No encontré ningún producto con ese nombre. Revisa el catálogo.', false);
          return true;
        }
        const p = matches[0];
        appendBubble('De "' + (p.name || '') + '" hay ' + (p.stock != null ? p.stock : 0) + ' unidad(es) en stock.', false);
        return true;
      }
    },
    {
      name: 'admin_total_ingresos',
      match: (text) => /total de ingresos|total ingresos|dime el total|ingresos totales/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) return false;
        const token = getToken();
        if (!API || !token) { appendBubble('No pude conectar. Intenta en un momento.', false); return true; }
        try {
          const stats = await API.getAdminStats(token);
          const total = stats.totalSales != null ? stats.totalSales : 0;
          appendBubble('El total de ingresos por ventas aprobadas es ' + formatPrice(total) + '.', false);
          return true;
        } catch (_) {
          appendBubble('Revisa tu conexión e inténtalo de nuevo.', false);
          return true;
        }
      }
    },
    {
      name: 'admin_generar_reporte',
      match: (text) => /generar reporte|reporte json|exportar reporte|descargar reporte/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) return false;
        const token = getToken();
        if (!API || !token) { appendBubble('No pude conectar. Intenta en un momento.', false); return true; }
        try {
          const data = await API.getAdminExport(token);
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'proyectweb-reporte-' + (data.exportedAt || new Date().toISOString().slice(0, 10)) + '.json';
          a.click();
          URL.revokeObjectURL(url);
          appendBubble('Listo: el reporte JSON se ha descargado. Revisa tu carpeta de descargas.', false);
          return true;
        } catch (_) {
          appendBubble('No pude generar el reporte. Intenta de nuevo.', false);
          return true;
        }
      }
    },
    {
      name: 'admin_cerrar_sesion_todos',
      match: (text) => /cerrar sesión de todos|cerrar sesión todos los usuarios/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) return false;
        appendBubble('Por seguridad, cada usuario cierra su propia sesión. Tú puedes cerrar la tuya desde el menú cuando quieras.', false);
        return true;
      }
    },
    {
      name: 'admin_panel',
      match: (text) => /ir al panel|ver (el )?panel|panel (de )?admin|acceso (al )?panel|abrir panel/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (!user.isAdmin) {
          appendBubble('Solo el administrador puede acceder al panel. Inicia sesión como admin.', false);
          return true;
        }
        appendBubble('Redirigiendo al panel de administración...', false);
        const inicio = document.getElementById('inicio');
        if (inicio) inicio.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
    },
    {
      name: 'cliente_donde_pedido',
      match: (text) => /dónde está mi pedido|donde esta mi pedido|estado de mi pedido|rastrear pedido|ubicación de mi pedido/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const token = getToken();
        if (!token) {
          appendBubble('Inicia sesión para ver el estado de tu pedido.', false);
          return true;
        }
        try {
          const orders = await API.getMyOrders(token);
          const list = Array.isArray(orders) ? orders : [];
          if (list.length === 0) {
            appendBubble('Aún no tienes pedidos. Cuando hagas una compra podrás ver aquí su estado.', false);
            return true;
          }
          const last = list[0];
          const status = (last.status || 'pendiente').toString();
          const tracking = last.tracking;
          let msg = 'Tu último pedido ' + (last.id || '') + ' está en estado: ' + status + '.';
          if (tracking && tracking.tracking_number) {
            msg += ' Seguimiento: ' + tracking.tracking_number + (tracking.carrier ? ' (' + tracking.carrier + ').' : '.');
          } else if (status === 'pendiente' || status === 'pending') {
            msg += ' Cuando lo enviemos te daremos el número de seguimiento.';
          }
          appendBubble(msg, false);
          return true;
        } catch (_) {
          appendBubble('Revisa tu conexión e inténtalo de nuevo en un momento.', false);
          return true;
        }
      }
    },
    {
      name: 'cliente_necesito_ayuda',
      match: (text) => /necesito ayuda|ayuda técnica|soporte|cambiar contraseña|cambiar dirección|olvidé mi contraseña/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (user.isAdmin) {
          appendBubble('Como administrador puedes cambiar contraseñas desde el panel (usuarios). Para tu dirección de envío, indícala al finalizar tu próxima compra.', false);
        } else {
          appendBubble('Para cambiar tu contraseña o datos, entra a tu cuenta desde el menú. Si olvidaste la contraseña, un administrador puede restablecerla. Para la dirección de envío, indícala al finalizar tu próxima compra.', false);
        }
        appendBubble('También puedes escribirnos desde la sección Contacto de la página.', false);
        return true;
      }
    },
    {
      name: 'cliente_mis_pedidos',
      match: (text) => /mis pedidos|estado de (mis )?pedidos|pedidos|mis órdenes|estado (de )?pedido/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const token = getToken();
        if (!token) {
          appendBubble('Inicia sesión para ver el estado de tus pedidos.', false);
          return true;
        }
        if (!API || typeof API.getMyOrders !== 'function') { appendBubble('No puedo consultar pedidos en este momento.', false); return true; }
        try {
          const orders = await API.getMyOrders(token);
          const list = Array.isArray(orders) ? orders : [];
          if (list.length === 0) {
            appendBubble('Aún no tienes pedidos. Cuando realices una compra aparecerán aquí.', false);
            return true;
          }
          const lines = list.slice(0, 5).map(o => {
            const date = (o.date || o.created_at || '').toString().slice(0, 10);
            const status = (o.status || 'pendiente').toString();
            return '• ' + (o.id || '—') + ' — ' + date + ' — ' + formatPrice(o.total) + ' — ' + status;
          });
          appendBubble('Tus últimos pedidos:\n' + lines.join('\n'), false);
          return true;
        } catch (_) {
          appendBubble('No pude cargar tus pedidos. Intenta de nuevo.', false);
          return true;
        }
      }
    },
    {
      name: 'cliente_pagar_carrito',
      match: (text) => /pagar carrito|pagar (el )?carrito|finalizar (y )?pagar|pagar ahora/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const token = getToken();
        const cartCount = App && typeof App.getCartCount === 'function' ? App.getCartCount() : 0;
        if (cartCount === 0) {
          appendBubble('Tu carrito está vacío. Añade productos y luego di "Pagar carrito".', false);
          return true;
        }
        if (!token) {
          appendBubble('Inicia sesión para poder pagar con Stripe. Es rápido y seguro.', false);
          if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
          return true;
        }
        appendBubble('Abriendo el checkout. Serás redirigido a Stripe para pagar (modo prueba: 4242 4242 4242 4242).', false);
        if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
        if (App && typeof App.openCheckoutModal === 'function') setTimeout(() => App.openCheckoutModal(), 400);
        return true;
      }
    },
    {
      name: 'visitante_envios_pagos',
      match: (text) => /envío|envios|envíos|pago|pagar|stripe|comprar|checkout|entrega/.test(text.toLowerCase()),
      handle: (text, ctx) => {
        appendBubble('Pagos seguros con Stripe. Añade productos al carrito y usa "💳 Pagar" en el chat o Finalizar compra. Los envíos se coordinan después de confirmar.', false);
        return true;
      }
    },
    {
      name: 'add_to_cart',
      match: (text) => /añad(e|ir)|agregar|poner|meter|al carrito|al carro/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const products = ctx.products || [];
        const addCart = parseAddToCart(text, products);
        if (!addCart) return false;
        if (addCart.products.length === 0) {
          appendBubble('No encontré ningún producto con "' + addCart.query + '". Prueba con otro nombre (ej. tenis, auriculares).', false);
          return true;
        }
        if (!App || typeof App.addToCart !== 'function') {
          appendBubble('No puedo añadir al carrito en este momento.', false);
          return true;
        }
        const added = [];
        addCart.products.slice(0, 3).forEach(p => { if (App.addToCart(p.id, 1)) added.push(p.name); });
        const name = getStoredChatName() || getUserNameFromStorage();
        const pref = name ? name + ', ' : '';
        appendBubble(pref + (added.length ? 'Listo, añadí al carrito: ' + added.join(', ') + '.' : 'No pude añadir esos productos.') + ' Revisa el carrito en el menú.', false);
        if (added.length && App.openCartDrawer) App.openCartDrawer();
        return true;
      }
    },
    {
      name: 'comprar_pagar_generic',
      match: (text) => /\b(comprar|pagar|checkout|stripe|finalizar compra)\b/.test(text.toLowerCase()),
      handle: (text, ctx) => {
        const token = getToken();
        const cartCount = App && typeof App.getCartCount === 'function' ? App.getCartCount() : 0;
        if (cartCount === 0) {
          appendBubble('Tu carrito está vacío. Añade productos antes de finalizar. ¿Quieres que busque algo?', false);
          return true;
        }
        if (!token) {
          appendBubble('Para finalizar tu compra con Stripe, inicia sesión. Así podrás pagar de forma segura y hacer seguimiento de tu pedido.', false);
          if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
          return true;
        }
        appendBubble('Abriendo checkout con Stripe...', false);
        if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
        if (App && typeof App.openCheckoutModal === 'function') setTimeout(() => App.openCheckoutModal(), 400);
        return true;
      }
    },
    {
      name: 'quien_soy',
      match: (text) => /quién soy|quien soy|quién eres|mi (cuenta|sesión|usuario)/.test(text.toLowerCase()),
      handle: async (text, ctx) => {
        const user = await getContext();
        if (user.level === 'visitor') {
          appendBubble('Aún no has iniciado sesión. Cuando lo hagas podrás ver tu cuenta y pagar con Stripe.', false);
          return true;
        }
        appendBubble('Eres ' + user.name + ' con rol de ' + (user.isAdmin ? 'Administrador' : 'Cliente') + '.', false);
        if (user.isAdmin) {
          appendBubble('Puedes preguntar por ventas, stock o generar un reporte. También puedes ir al panel desde el menú.', false);
        } else {
          appendBubble('Puedes ver tus pedidos o abrir el carrito cuando quieras.', false);
        }
        return true;
      }
    },
    {
      name: 'catalog_search',
      match: (text) => {
        const t = text.toLowerCase().trim();
        return /qué tienes|que tienes|qué hay|que hay|tienes algo de|productos de|busco|buscando|qué productos|que productos|hay.*de|algo de|catálogo|catalogo/.test(t) || (/^(qué|que)\s/.test(t) && t.length > 5);
      },
      handle: async (text, ctx) => {
        const products = ctx.products || [];
        const terms = getCatalogSearchTerms(text);
        const matches = terms.length ? searchProducts(products, terms.join(' ')) : products.slice(0, 5);
        if (matches.length > 0) {
          const lines = ['Encontré estos productos. Usa "Añadir" en cada tarjeta.', 'Aquí tienes algunas opciones. Puedes añadirlas al carrito.'];
          appendBubble(lines[Math.floor(Math.random() * lines.length)], false);
          appendProductCards(matches, 5);
          return true;
        }
        appendBubble('No tengo productos que coincidan. Prueba con otra palabra (ej. tenis, auriculares, teclado).', false);
        return true;
      }
    },
    {
      name: 'fallback_search',
      match: () => true,
      handle: async (text, ctx) => {
        const products = ctx.products || [];
        const matches = searchProducts(products, text);
        if (matches.length > 0) {
          appendBubble('Encontré estos productos relacionados con tu búsqueda.', false);
          appendProductCards(matches, 3);
          return true;
        }
        const name = getStoredChatName() || getUserNameFromStorage();
        const pref = name ? name + ', ' : '';
        const phrases = [
          pref + '¿Buscas algo concreto? Puedo mostrarte productos, explicarte pagos con Stripe o, si inicias sesión, tus pedidos y el carrito.',
          pref + 'Cuéntame qué necesitas: productos, envíos, pago o tu pedido (si ya tienes cuenta).'
        ];
        appendBubble(phrases[Math.floor(Math.random() * phrases.length)], false);
        return true;
      }
    }
  ];

  async function handleMessage(inputText) {
    const text = (inputText || '').trim();
    if (!text) return;

    validateSessionAndResetIfNeeded();

    const messagesEl = container();
    const inputEl = document.getElementById('chat-input');
    if (!messagesEl || !inputEl) return;

    appendBubble(text, true);
    inputEl.value = '';

    showTypingIndicator();

    const serverOk = await checkServerHealth();
    if (!serverOk) {
      const wasOffline = isOfflineMode();
      setOfflineMode(true);
      if (!wasOffline) showOfflineMessage();
      hideTypingIndicator();
      getContext().then(function(c) { renderQuickReplies(c.role); });
      return;
    }
    setOfflineMode(false);
    const badge = document.getElementById('chat-offline-badge');
    if (badge) badge.classList.add('hidden');

    let products = [];
    try { products = await getProducts(); } catch (_) {}
    if (!Array.isArray(products)) products = [];

    const token = getToken();
    const userCtx = await getContext();
    const ctx = { products, token, userCtx };

    // Modo demo o resiliencia: usar respuestas locales (INTENTS)
    if (isDemoMode()) {
      await new Promise(r => setTimeout(r, TYPING_DELAY_MS));
      hideTypingIndicator();
      for (let i = 0; i < INTENTS.length; i++) {
        const intent = INTENTS[i];
        if (!intent.match(text)) continue;
        const handled = await intent.handle(text, ctx);
        if (handled) return;
      }
      return;
    }

    // Llamar a la API de chat (Gemini) con mensaje normalizado (ortografía y acentos) para mejor detección de palabras clave
    let apiData = null;
    const roleForApi = userCtx.role === 'ADMIN' ? 'ADMIN' : (userCtx.role === 'CLIENT' ? 'CLIENT' : 'GUEST');
    const messageToSend = normalizeUserMessageForApi(text) || text;
    currentChatAbortController = new AbortController();
    try {
      apiData = await API.chat(messageToSend, token, { role: roleForApi, name: userCtx.name }, { signal: currentChatAbortController.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        currentChatAbortController = null;
        return;
      }
      apiData = null;
    }
    currentChatAbortController = null;

    await new Promise(r => setTimeout(r, TYPING_DELAY_MS));
    hideTypingIndicator();

    if (apiData && apiData.reply != null) {
      if (apiData.isFallback) {
        appendBubble(apiData.reply, false);
        appendSuggestionButtons(userCtx, products);
        renderQuickReplies(userCtx.role);
        return;
      }
      appendBubbleWithTypewriter(apiData.reply, function onDone() {
        if (apiData.products && apiData.products.length > 0) {
          appendProductCards(apiData.products, 5);
        } else if (apiData.productNames && apiData.productNames.length > 0 && products.length > 0) {
          const byName = products.filter(function(p) {
            const name = (p.name || '').toLowerCase();
            return apiData.productNames.some(function(n) { return (n || '').toLowerCase() === name; });
          });
          if (byName.length > 0) appendProductCards(byName, 5);
        }
        if (/\b(pagar|comprar|checkout|finalizar compra|stripe)\b/.test(text.toLowerCase())) {
          if (App && typeof App.openCartDrawer === 'function') App.openCartDrawer();
          if (App && typeof App.openCheckoutModal === 'function') setTimeout(function() { App.openCheckoutModal(); }, 400);
        }
        appendSuggestionButtons(userCtx, products);
        renderQuickReplies(userCtx.role);
      });
      return;
    }

    // Asistente Experto Local: cuando la IA no responde, buscar en knowledgeBase
    const roleForKb = userCtx.role === 'ADMIN' ? 'ADMIN' : (userCtx.role === 'CLIENT' ? 'CLIENT' : 'GUEST');
    const kbReply = searchKnowledgeBase(text, roleForKb);
    if (kbReply === '__DYNAMIC_VENTAS__' && userCtx.role === 'ADMIN') {
      const token = getToken();
      if (token && API && typeof API.getOrders === 'function') {
        try {
          const orders = await API.getOrders(token);
          const list = Array.isArray(orders) ? orders : [];
          const totalCents = list.reduce(function(s, o) { return s + (Number(o.total_cents) || Number(o.total) || 0); }, 0);
          const totalFormatted = formatPrice(totalCents / 100);
          appendBubble('📊 Ventas (datos reales)\n\n• Órdenes: ' + list.length + '\n• Total: ' + totalFormatted + '\n\nLos datos provienen de data.json.', false);
          appendSuggestionButtons(userCtx, products);
          renderQuickReplies(userCtx.role);
          return;
        } catch (_) {}
      }
      appendBubble('📊 No pude cargar las ventas ahora. Revisa tu conexión o intenta "generar reporte".', false);
      appendSuggestionButtons(userCtx, products);
      renderQuickReplies(userCtx.role);
      return;
    }
    if (kbReply && kbReply !== '__DYNAMIC_VENTAS__') {
      appendBubble(kbReply, false);
      appendSuggestionButtons(userCtx, products);
      renderQuickReplies(userCtx.role);
      return;
    }

    // Fallback: respuestas locales cuando la API falla o no está configurada
    for (let i = 0; i < INTENTS.length; i++) {
      const intent = INTENTS[i];
      if (!intent.match(text)) continue;
      const handled = await intent.handle(text, ctx);
      if (handled) {
        renderQuickReplies(userCtx.role);
        return;
      }
    }
    // Persistencia de botones: tras cualquier respuesta, mostrar siempre los quick replies del rol actual
    renderQuickReplies(userCtx.role);
  }

  function setWelcomeMessage() {
    const el = document.getElementById('chat-welcome-msg');
    if (!el) return;
    el.textContent = getWelcomeText();
  }

  function init() {
    const panel = document.getElementById('chat-panel');
    const toggle = document.getElementById('chat-toggle');
    const closeBtn = document.getElementById('chat-panel-close');
    const form = document.getElementById('chat-form');
    const input = document.getElementById('chat-input');

    setWelcomeMessage();
    try { sessionStorage.setItem(SESSION_LAST_TOKEN, getToken() || ''); } catch (_) {}
    getContext().then(function(c) { renderQuickReplies(c.role); });

    // Si volvimos de Stripe en un popup, pasar el resultado a la ventana principal y cerrar el popup
    try {
      const params = new URLSearchParams(window.location.search);
      if (window.opener && params.has('stripe')) {
        window.opener.location.href = window.location.pathname + window.location.search;
        window.close();
        return;
      }
    } catch (_) {}

    // Retorno exitoso desde Stripe: mostrar mensaje y volver a mostrar botones
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('stripe') === 'success') {
        appendBubble('¡Pago verificado por la API de Stripe! Tu orden ya está en sistema.', false);
        getContext().then(function(c) { renderQuickReplies(c.role); });
        if (window.history && window.history.replaceState) {
          const url = new URL(window.location.href);
          url.searchParams.delete('stripe');
          window.history.replaceState({}, '', url.toString());
        }
      }
      if (params.get('stripe') === 'cancel') {
        appendBubble('Pago cancelado. Si quieres, puedes volver a intentar cuando lo tengas claro.', false);
        getContext().then(function(c) { renderQuickReplies(c.role); });
        if (window.history && window.history.replaceState) {
          const url = new URL(window.location.href);
          url.searchParams.delete('stripe');
          window.history.replaceState({}, '', url.toString());
        }
      }
    } catch (_) {}

    window.addEventListener('storage', onStorageChange);
    startSessionPolling();
    window.addEventListener('proyectweb-logout', function() {
      // Logout explícito: limpiar UI del chat y forzar saludo de visitante.
      const isGuestNow = !getToken();
      resetChatWithWelcomeText(isGuestNow ? getVisitorLogoutWelcomeText() : '');
    });
    window.addEventListener('proyectweb-chat-warning', function(e) {
      const text = (e && e.detail && e.detail.text) ? String(e.detail.text) : '¡Atención! Por favor permite las ventanas emergentes para completar tu pago.';
      appendBubble(text, false);
      getContext().then(function(c) { renderQuickReplies(c.role); });
    });

    if (toggle && panel) {
      toggle.addEventListener('click', function() {
        const isOpen = panel.classList.contains('chat-panel-open');
        panel.classList.toggle('chat-panel-open', !isOpen);
        panel.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
        toggle.setAttribute('aria-expanded', String(!isOpen));
        toggle.setAttribute('aria-label', !isOpen ? CHAT_TOGGLE_LABEL_CLOSE : CHAT_TOGGLE_LABEL_OPEN);
        if (!isOpen) {
          validateSessionAndResetIfNeeded();
          setTimeout(() => input && input.focus(), 300);
        }
      });
    }
    if (closeBtn && panel) {
      closeBtn.addEventListener('click', function() {
        panel.classList.remove('chat-panel-open');
        panel.setAttribute('aria-hidden', 'true');
        if (toggle) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.setAttribute('aria-label', CHAT_TOGGLE_LABEL_OPEN);
        }
      });
    }
    const resetBtn = document.getElementById('chat-reset-conversation');
    if (resetBtn) {
      resetBtn.addEventListener('click', function() {
        resetChat();
      });
    }
    if (form && input) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        handleMessage(input.value);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // API pública mínima para sincronizar logout/reset desde otros scripts.
  try {
    window.reiniciarChat = function(opts) {
      const o = opts && typeof opts === 'object' ? opts : {};
      const welcomeText = o.welcomeText != null ? String(o.welcomeText) : '';
      resetChatWithWelcomeText(welcomeText);
    };
  } catch (_) {}
})();
