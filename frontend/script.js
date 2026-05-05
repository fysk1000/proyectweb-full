/**
 * ProyectWeb - Lógica de carrito, login (modal) y drawer.
 * JavaScript Vanilla. Archivo vinculado en index.html antes del cierre de </body>.
 */

const App = (function() {
  // --- Constantes de almacenamiento local ---
  const STORAGE_CART = 'proyectweb_cart';
  const STORAGE_LOGIN = 'proyectweb_login';
  const STORAGE_USER = 'proyectweb_user';
  const STORAGE_PRODUCTS = 'proyectweb_products';
  const STORAGE_ORDERS = 'proyectweb_orders';
  const STORAGE_ADMIN_TOKEN = 'proyectweb_admin_token';
  const STORAGE_CLIENT_TOKEN = 'proyectweb_client_token';
  const STORAGE_ROLE = 'proyectweb_role';
  const STORAGE_LAST_ORDER_ID = 'proyectweb_last_order_id';

  let useBackend = false;
  let adminToken = null;
  let clientToken = null;
  let selectedPaymentMethod = 'none'; // 'none' | 'stripe'
  let ADMIN_USERS = [];
  let adminUserDeleteDelegationAttached = false;
  try {
    adminToken = localStorage.getItem(STORAGE_ADMIN_TOKEN);
    clientToken = localStorage.getItem(STORAGE_CLIENT_TOKEN);
  } catch (_) {}

  const isDev = typeof window !== 'undefined' && (!window.__ENV__ || window.__ENV__.NODE_ENV !== 'production');
  /** Modo demo: solo activo con ?demo=1 en la URL. No simula compra si no está activo. */
  function isDemoMode() {
    try {
      return new URLSearchParams(window.location.search).get('demo') === '1';
    } catch (_) { return false; }
  }

  // --- Catálogo de productos (imágenes Unsplash relacionadas a cada producto) ---
  const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/400x300?text=Sin+imagen';
  const DEFAULT_PRODUCT_IMAGE = PLACEHOLDER_IMAGE;

  function bindImageFallback(imgEl, fallbackSrc) {
    imgEl.addEventListener('error', function onImgError() {
      imgEl.removeEventListener('error', onImgError);
      imgEl.src = fallbackSrc;
    });
  }

  const priceFormat = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  function formatPrice(num) { return priceFormat.format(Number(num)); }

  /** Texto seguro para atributos HTML (alt, aria-label, etc.) */
  function escapeHtmlAttr(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;');
  }

  const DEFAULT_PRODUCTS = [
    { id: '1', name: 'Auriculares inalámbricos', price: 49.99, description: 'Sonido envolvente y cancelación de ruido. Hasta 20h de batería.', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
    { id: '2', name: 'Teclado mecánico RGB', price: 89.99, description: 'Switches mecánicos, retroiluminación RGB y reposamuñecas magnético.', image: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=400&h=300&fit=crop' },
    { id: '3', name: 'Monitor 27" 4K', price: 329.99, description: 'Panel IPS, 60Hz, HDR10. Ideal para trabajo y contenido.', image: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=400&h=300&fit=crop' },
    { id: '4', name: 'Ratón ergonómico', price: 34.99, description: 'Diseño ergonómico, 6 botones programables y sensor preciso.', image: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&h=300&fit=crop' },
    { id: '5', name: 'Webcam Full HD', price: 59.99, description: '1080p 30fps, micrófono integrado y privacidad con tapa.', image: 'https://images.unsplash.com/photo-1587826080692-f439cd0b70da?w=400&h=300&fit=crop' },
    { id: '6', name: 'SSD 1TB NVMe', price: 79.99, description: 'Lectura 3500 MB/s. Ideal para sistema y juegos.', image: 'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?w=400&h=300&fit=crop' },
  ];

  function getProductsSync() {
    try {
      const saved = localStorage.getItem(STORAGE_PRODUCTS);
      return saved ? JSON.parse(saved) : DEFAULT_PRODUCTS;
    } catch {
      return DEFAULT_PRODUCTS;
    }
  }

  function saveProductsLocal(products) {
    localStorage.setItem(STORAGE_PRODUCTS, JSON.stringify(products));
  }

  function saveProducts(products) {
    saveProductsLocal(products);
  }

  function getProducts() {
    return getProductsSync();
  }

  /**
   * Detecta si el backend está disponible (GET /api/health). Actualiza useBackend.
   * El catálogo es público; modo local solo si el backend no responde.
   */
  async function detectBackend() {
    if (typeof window.ProyectWebAPI === 'undefined') {
      useBackend = false;
      if (isDev) console.debug('[init] detectBackend: ProyectWebAPI no definido');
      return false;
    }
    try {
      const base = window.ProyectWebAPI.getBase();
      const res = await fetch(base + '/api/health', { method: 'GET', credentials: 'omit' });
      if (res.ok) {
        useBackend = true;
        return true;
      }
      if (isDev) console.debug('[init] detectBackend: health no ok', res.status);
    } catch (e) {
      if (isDev) console.debug('[init] detectBackend: fetch error', e && e.message);
    }
    useBackend = false;
    return false;
  }

  /** Carga productos: desde API si useBackend, sino desde localStorage/default */
  async function loadProducts() {
    if (useBackend && typeof window.ProyectWebAPI !== 'undefined') {
      try {
        const list = await window.ProyectWebAPI.getProducts();
        if (Array.isArray(list)) return list;
      } catch (_) {}
    }
    return getProductsSync();
  }

  let PRODUCTS = getProductsSync();

  // Estado en memoria del carrito (array de { id, name, price, quantity })
  let cart = [];

  // ========== LÓGICA DEL CARRITO ==========

  /**
   * Obtiene el carrito desde localStorage.
   * Si no hay datos o hay error al parsear, devuelve array vacío.
   */
  function getCart() {
    try {
      const saved = localStorage.getItem(STORAGE_CART);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  /**
   * Persiste el carrito en localStorage, actualiza el contador del menú
   * y vuelve a pintar el contenido del drawer del carrito.
   */
  function saveCart() {
    localStorage.setItem(STORAGE_CART, JSON.stringify(cart));
    updateCartBadges();
    renderCartDrawer();
  }

  /** Vacía el carrito en memoria y localStorage y redibuja badge y drawer */
  function clearCart() {
    cart = [];
    localStorage.setItem(STORAGE_CART, JSON.stringify([]));
    updateCartBadges();
    renderCartDrawer();
  }

  /**
   * Añade un producto al carrito (o incrementa su cantidad si ya está).
   * @param {string} productId - id del producto en PRODUCTS
   * @param {number} quantity - unidades a añadir (por defecto 1)
   * @returns {boolean} true si se añadió correctamente
   */
  function addToCart(productId, quantity = 1) {
    const product = PRODUCTS.find(p => p.id === productId);
    if (!product) return false;

    // Si hay backend y el producto tiene stock, evita excederlo
    const stock = Number.isFinite(Number(product.stock)) ? Number(product.stock) : null;
    const existing = cart.find(item => item.id === productId);
    const currentQty = existing ? existing.quantity : 0;
    if (useBackend && stock !== null && (currentQty + quantity) > stock) {
      toast('No hay stock suficiente. Disponible: ' + stock, 'error');
      return false;
    }

    if (existing) {
      existing.quantity += quantity;
    } else {
      cart.push({ id: product.id, name: product.name, price: product.price, quantity });
    }
    saveCart();
    return true;
  }

  /**
   * Elimina por completo un producto del carrito por su id.
   */
  function removeFromCart(productId) {
    cart = cart.filter(item => item.id !== productId);
    saveCart();
  }

  /**
   * Establece la cantidad de un producto en el carrito.
   * Si quantity <= 0, el producto se elimina del carrito.
   */
  function setQuantity(productId, quantity) {
    if (quantity <= 0) {
      removeFromCart(productId);
      return;
    }
    const item = cart.find(i => i.id === productId);
    if (item) item.quantity = quantity;
    saveCart();
  }

  /**
   * Calcula el subtotal del carrito (suma de precio * cantidad de cada ítem).
   */
  function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  /**
   * Devuelve el número total de unidades en el carrito (suma de todas las quantity).
   */
  function getCartCount() {
    return cart.reduce((sum, item) => sum + item.quantity, 0);
  }

  // ========== PEDIDOS ==========

  function getOrders() {
    try {
      const saved = localStorage.getItem(STORAGE_ORDERS);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  function saveOrders(orders) {
    localStorage.setItem(STORAGE_ORDERS, JSON.stringify(orders));
  }

  function createOrder(customer, items, total, optionalId) {
    const orders = getOrders();
    const id = optionalId || 'PW-' + Date.now();
    const order = {
      id,
      items: items.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
      total,
      createdAt: new Date().toISOString(),
      status: 'PENDING',
      date: new Date().toISOString(),
      customer: { name: customer.nombre, email: customer.email, phone: customer.telefono, address: customer.direccion }
    };
    orders.unshift(order);
    saveOrders(orders);
    return id;
  }

  /**
   * Actualiza el texto del badge del carrito en el navbar (contador dinámico).
   */
  function updateCartBadges() {
    const count = getCartCount();
    const el = document.getElementById('cart-count');
    if (el) el.textContent = count;
  }

  // ========== LOGIN (SIMULADO) ==========

  function isLoggedIn() {
    try {
      return localStorage.getItem(STORAGE_LOGIN) === 'true';
    } catch {
      return false;
    }
  }

  function setLoggedIn(value, userData = '', role = 'CLIENT') {
    if (value) {
      localStorage.setItem(STORAGE_LOGIN, 'true');
      const userVal = typeof userData === 'string' ? userData : (userData && typeof userData === 'object' ? JSON.stringify(userData) : String(userData));
      localStorage.setItem(STORAGE_USER, userVal || '');
      localStorage.setItem(STORAGE_ROLE, role === 'ADMIN' ? 'ADMIN' : 'CLIENT');
    } else {
      localStorage.removeItem(STORAGE_LOGIN);
      localStorage.removeItem(STORAGE_USER);
      localStorage.removeItem(STORAGE_ROLE);
    }
    updateAuthUI();
  }

  function getCurrentUser() {
    try {
      const raw = localStorage.getItem(STORAGE_USER);
      if (!raw) return 'cliente';
      try {
        const parsed = JSON.parse(raw);
        if (parsed && (parsed.name || parsed.email)) return parsed.name || parsed.email;
      } catch (_) {}
      return raw || 'cliente';
    } catch {
      return 'cliente';
    }
  }

  function isAdmin() {
    try {
      return isLoggedIn() && localStorage.getItem(STORAGE_ROLE) === 'ADMIN';
    } catch {
      return false;
    }
  }

  /**
   * Muestra u oculta "Hola, Cliente" / botón Login y el bloque "Vista de Cliente" o "Vista de Admin"
   * según el flag de sesión en localStorage.
   */
  function updateAuthUI() {
    const loggedIn = isLoggedIn();
    const isAdminUser = isAdmin();
    const btnLogin = document.getElementById('btn-login');
    const btnLoginMobile = document.getElementById('btn-login-mobile');
    const holaCliente = document.getElementById('nav-hola-cliente');
    const holaClienteMobile = document.getElementById('nav-hola-cliente-mobile');
    const vistaCliente = document.getElementById('vista-cliente');
    const vistaAdmin = document.getElementById('vista-admin');

    if (loggedIn) {
      // Ocultar botones de Login
      if (btnLogin) {
        btnLogin.classList.add('auth-hidden');
      }
      if (btnLoginMobile) {
        btnLoginMobile.classList.add('auth-hidden');
        btnLoginMobile.classList.remove('auth-visible-block');
      }
      
      // Mostrar botones de Salir y mensaje de bienvenida
      if (holaCliente) {
        const userName = isAdminUser ? 'Admin' : 'Cliente';
        const nameSpan = holaCliente.querySelector('span.text-slate-600');
        if (nameSpan) nameSpan.textContent = `Hola, ${userName}`;
        holaCliente.classList.remove('auth-hidden');
        holaCliente.classList.add('auth-visible');
      }
      if (holaClienteMobile) {
        const userName = isAdminUser ? 'Admin' : 'Cliente';
        const nameSpan = holaClienteMobile.querySelector('span.text-slate-600');
        if (nameSpan) nameSpan.textContent = `Hola, ${userName}`;
        holaClienteMobile.classList.remove('auth-hidden');
        holaClienteMobile.classList.add('auth-visible-block');
      }

      // Mostrar vistas según el tipo de usuario
      if (isAdminUser) {
        if (vistaCliente) vistaCliente.classList.add('hidden');
        if (vistaAdmin) vistaAdmin.classList.remove('hidden');
        updateAdminStats();
        renderAdminProductsTable();
        renderAdminOrders();
        refreshAdminUsers();
      } else {
        if (vistaCliente) vistaCliente.classList.remove('hidden');
        if (vistaAdmin) vistaAdmin.classList.add('hidden');
        renderMisPedidos();
      }
    } else {
      // Ocultar botones de Salir y mensaje de bienvenida
      if (holaCliente) {
        holaCliente.classList.add('auth-hidden');
        holaCliente.classList.remove('auth-visible');
      }
      if (holaClienteMobile) {
        holaClienteMobile.classList.add('auth-hidden');
        holaClienteMobile.classList.remove('auth-visible-block');
      }
      
      // Mostrar botones de Login
      if (btnLogin) {
        btnLogin.classList.remove('auth-hidden');
      }
      if (btnLoginMobile) {
        btnLoginMobile.classList.remove('auth-hidden');
        btnLoginMobile.classList.add('auth-visible-block');
      }
      
      // Ocultar vistas
      if (vistaCliente) vistaCliente.classList.add('hidden');
      if (vistaAdmin) vistaAdmin.classList.add('hidden');
    }
  }

  /**
   * Maneja el cierre de sesión.
   * Oculta el botón Salir y muestra el botón Login.
   */
  function handleLogout() {
    try {
      localStorage.removeItem(STORAGE_LOGIN);
      localStorage.removeItem(STORAGE_USER);
      localStorage.removeItem(STORAGE_ROLE);
      localStorage.removeItem(STORAGE_ADMIN_TOKEN);
      localStorage.removeItem(STORAGE_CLIENT_TOKEN);
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    adminToken = null;
    clientToken = null;

    // Limpieza inmediata del chat (UI) para evitar cualquier rastro visual.
    try {
      const chatContainer = document.getElementById('chat-messages');
      if (chatContainer) chatContainer.innerHTML = '';
    } catch (_) {}

    // Reset del chatbot en el momento del logout.
    try {
      if (typeof window.reiniciarChat === 'function') {
        window.reiniciarChat({
          welcomeText: '¡Hola! Bienvenido a ProyectWeb. Veo que no te has registrado. Si quieres, puedo darte un tour por la tienda o ayudarte a encontrar un producto.'
        });
      }
    } catch (_) {}

    try {
      window.dispatchEvent(new CustomEvent('proyectweb-logout'));
    } catch (_) {}
    updateAuthUI();
    closeLoginModal();
    closeCheckoutModal();
    closeCartDrawer();
    closeProductModal();
    closePurchaseSuccessModal();
    closeRegisterModal();
    const mobileMenu = document.getElementById('mobile-menu');
    if (mobileMenu) mobileMenu.classList.add('hidden');
    toast('Sesión cerrada', 'success');
    detectBackend().then(() => loadProducts()).then(list => {
      PRODUCTS = list;
      renderCatalog(document.getElementById('catalog-grid'));
    }).catch(() => {
      PRODUCTS = getProductsSync();
      saveProducts(PRODUCTS);
      renderCatalog(document.getElementById('catalog-grid'));
    });
  }

  /**
   * Restaura sesión al cargar: si hay token, llama a /api/auth/me para obtener user y role.
   * Si 200: actualiza storage con user y role real del backend.
   * Si 401: limpia storage y deja UI como no logueado (el rol solo viene del backend, no de localStorage manual).
   */
  async function restoreSession() {
    const token = adminToken || clientToken;
    if (!token || typeof window.ProyectWebAPI === 'undefined') return;
    try {
      const res = await window.ProyectWebAPI.getMe(token);
      if (res && res.user) {
        const role = res.user.role === 'ADMIN' ? 'ADMIN' : 'CLIENT';
        try {
          localStorage.setItem(STORAGE_LOGIN, 'true');
          localStorage.setItem(STORAGE_USER, typeof res.user === 'string' ? res.user : JSON.stringify(res.user));
          localStorage.setItem(STORAGE_ROLE, role);
        } catch (_) {}
        if (role === 'ADMIN') {
          adminToken = token;
          clientToken = null;
        } else {
          clientToken = token;
          adminToken = null;
        }
        useBackend = true;
      }
    } catch (err) {
      if (err && err.status === 401) {
        adminToken = null;
        clientToken = null;
        try {
          localStorage.removeItem(STORAGE_ADMIN_TOKEN);
          localStorage.removeItem(STORAGE_CLIENT_TOKEN);
          localStorage.removeItem(STORAGE_LOGIN);
          localStorage.removeItem(STORAGE_USER);
          localStorage.removeItem(STORAGE_ROLE);
        } catch (_) {}
        updateAuthUI();
      }
    }
  }

  // ========== MODAL LOGIN ==========

  function openLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('login-user')?.focus();
    }
  }

  function closeLoginModal() {
    const modal = document.getElementById('login-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  // ========== DRAWER CARRITO ==========

  function openCartDrawer() {
    const overlay = document.getElementById('cart-drawer-overlay');
    const drawer = document.getElementById('cart-drawer');
    if (overlay) overlay.classList.remove('hidden');
    if (drawer) drawer.classList.add('cart-drawer-open');
  }

  function closeCartDrawer() {
    const overlay = document.getElementById('cart-drawer-overlay');
    const drawer = document.getElementById('cart-drawer');
    if (overlay) overlay.classList.add('hidden');
    if (drawer) drawer.classList.remove('cart-drawer-open');
  }

  /**
   * Rellena el panel lateral del carrito (drawer):
   * - Si el carrito está vacío: muestra mensaje y subtotal $0.00 MXN.
   * - Si hay ítems: genera una fila por producto (imagen, nombre, precio, controles +/- y quitar),
   *   recalcula el subtotal y enlaza los botones a addToCart/setQuantity/removeFromCart.
   */
  function renderCartDrawer() {
    const listEl = document.getElementById('cart-drawer-list');
    const subtotalEl = document.getElementById('cart-drawer-subtotal');
    if (!listEl) return;

    if (cart.length === 0) {
      listEl.innerHTML = '<p class="text-slate-500 text-center py-8">Tu carrito está vacío.</p>';
      if (subtotalEl) subtotalEl.textContent = formatPrice(0);
      return;
    }

    const productMap = Object.fromEntries(PRODUCTS.map(p => [p.id, p]));
    listEl.innerHTML = cart.map(item => {
      const product = productMap[item.id];
      const img = product ? product.image : DEFAULT_PRODUCT_IMAGE;
      const nameEsc = escapeHtmlAttr(item.name || 'Producto');
      const imgAlt = escapeHtmlAttr(`Imagen de ${item.name || 'producto'}`);
      return `
        <div class="cart-drawer-item" data-id="${item.id}">
          <img src="${img}" alt="${imgAlt}" class="cart-drawer-item-img">
          <div class="cart-drawer-item-body">
            <p class="font-medium text-slate-900 text-sm">${item.name}</p>
            <p class="text-indigo-600 font-semibold text-sm">${formatPrice(item.price)} × ${item.quantity}</p>
            <div class="flex items-center gap-2 mt-1">
              <button type="button" class="cart-qty-btn text-slate-500 hover:text-slate-700 text-sm" data-id="${item.id}" data-delta="-1" aria-label="Disminuir cantidad de ${nameEsc}">−</button>
              <span class="text-sm font-medium">${item.quantity}</span>
              <button type="button" class="cart-qty-btn text-slate-500 hover:text-slate-700 text-sm" data-id="${item.id}" data-delta="1" aria-label="Aumentar cantidad de ${nameEsc}">+</button>
              <button type="button" class="cart-remove ml-2 text-red-600 text-sm hover:underline" data-id="${item.id}" aria-label="Quitar ${nameEsc} del carrito">Quitar</button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Botones +/-: modifican cantidad y saveCart() vuelve a pintar el drawer
    listEl.querySelectorAll('.cart-qty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.id;
        const delta = parseInt(btn.dataset.delta, 10);
        const item = cart.find(i => i.id === id);
        if (item) setQuantity(id, item.quantity + delta);
      });
    });
    listEl.querySelectorAll('.cart-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromCart(btn.dataset.id);
        toast('Producto eliminado', 'success');
      });
    });
    listEl.querySelectorAll('.cart-drawer-item-img').forEach(img => bindImageFallback(img, PLACEHOLDER_IMAGE));

    if (subtotalEl) subtotalEl.textContent = formatPrice(getCartTotal());
  }

  // ========== MODAL CHECKOUT ==========

  function openCheckoutModal() {
    if (getCartCount() === 0) {
      toast('El carrito está vacío', 'error');
      return;
    }
    renderCheckoutSummary();
    updateCheckoutModalPaymentUI();
    const popupWarningEl = document.getElementById('checkout-popup-warning');
    if (popupWarningEl) popupWarningEl.classList.add('hidden');
    const modal = document.getElementById('checkout-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('checkout-name')?.focus();
    }
  }

  function updateCheckoutModalPaymentUI() {
    const submitBtn = document.getElementById('checkout-form-submit');
    const badge = document.getElementById('checkout-payment-badge');
    if (submitBtn) submitBtn.textContent = selectedPaymentMethod === 'stripe' ? 'Pagar con Stripe' : 'Confirmar pedido';
    if (badge) badge.classList.toggle('hidden', selectedPaymentMethod !== 'stripe');
  }

  function resetCheckoutPaymentUI() {
    selectedPaymentMethod = 'none';
    const submitBtn = document.getElementById('checkout-form-submit');
    const badge = document.getElementById('checkout-payment-badge');
    if (submitBtn) submitBtn.textContent = 'Confirmar pedido';
    if (badge) badge.classList.add('hidden');
  }

  function closeCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    const popupWarningEl = document.getElementById('checkout-popup-warning');
    if (popupWarningEl) popupWarningEl.classList.add('hidden');
    resetCheckoutPaymentUI();
  }

  let purchaseSuccessAutoCloseTimer = null;

  function closePurchaseSuccessModal() {
    const modal = document.getElementById('purchase-success-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    if (purchaseSuccessAutoCloseTimer) {
      clearTimeout(purchaseSuccessAutoCloseTimer);
      purchaseSuccessAutoCloseTimer = null;
    }
  }

  function showPurchaseSuccessModal(opts) {
    const { orderId = '—', total = 0, items = [], demoMode = false } = opts || {};
    const idEl = document.getElementById('purchase-success-order-id');
    const totalEl = document.getElementById('purchase-success-total');
    const itemsEl = document.getElementById('purchase-success-items');
    const demoBanner = document.getElementById('purchase-success-demo-banner');
    if (idEl) idEl.textContent = (orderId != null && String(orderId).trim()) ? String(orderId).trim() : '—';
    if (totalEl) totalEl.textContent = (total != null && total !== '') ? formatPrice(Number(total)) : '—';
    if (demoBanner) {
      demoBanner.classList.toggle('hidden', !demoMode);
      if (demoMode) demoBanner.textContent = 'MODO DEMO';
    }
    if (itemsEl) {
      if (Array.isArray(items) && items.length > 0) {
        const lines = items.map(i => {
          const name = i.name || 'Producto';
          const qty = i.quantity || 1;
          const price = Number(i.price) || 0;
          const subtotal = price * qty;
          return `<li class="flex justify-between gap-2"><span>${name} × ${qty}</span><span>${formatPrice(subtotal)}</span></li>`;
        });
        itemsEl.innerHTML = '<ul class="space-y-0.5">' + lines.join('') + '</ul>';
        itemsEl.classList.remove('hidden');
      } else {
        itemsEl.innerHTML = '';
        itemsEl.classList.add('hidden');
      }
    }
    const modal = document.getElementById('purchase-success-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
    if (purchaseSuccessAutoCloseTimer) clearTimeout(purchaseSuccessAutoCloseTimer);
    purchaseSuccessAutoCloseTimer = setTimeout(closePurchaseSuccessModal, 4000);
  }

  /**
   * Finaliza el flujo de checkout: vaciar carrito, cerrar modales, mostrar "Compra realizada" y actualizar UI.
   * Llamar cuando el pedido se haya creado (backend o local).
   */
  function finalizeCheckout(opts) {
    const { orderId = '', total, items = [], skipSuccessModal = false, demoMode = false } = opts || {};
    clearCart();
    closeCheckoutModal();
    closeCartDrawer();
    resetCheckoutPaymentUI();
    const form = document.getElementById('checkout-form');
    if (form) form.reset();
    if (!skipSuccessModal) showPurchaseSuccessModal({ orderId, total, items, demoMode });
    if (isAdmin()) {
      updateAdminStats();
      refreshAdminOrders();
    } else {
      renderMisPedidos();
    }
    const inicio = document.getElementById('inicio');
    if (inicio) inicio.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderCheckoutSummary() {
    const el = document.getElementById('checkout-summary');
    if (!el) return;
    const lines = cart.map(i => `${i.name} × ${i.quantity}: ${formatPrice(i.price * i.quantity)}`);
    el.innerHTML = '<p class="font-medium text-slate-800 mb-2">Resumen del carrito</p><ul class="list-disc list-inside space-y-1">' +
      lines.map(l => '<li>' + l + '</li>').join('') +
      '</ul><p class="mt-2 font-semibold text-indigo-600">Total: ' + formatPrice(getCartTotal()) + '</p>';
  }

  function initCheckoutModal() {
    const modal = document.getElementById('checkout-modal');
    const form = document.getElementById('checkout-form');
    const closeBtn = document.getElementById('checkout-modal-close');
    const cancelBtn = document.getElementById('checkout-modal-cancel');

    if (closeBtn) closeBtn.addEventListener('click', closeCheckoutModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeCheckoutModal);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closeCheckoutModal();
      });
    }
    const successCatalogBtn = document.getElementById('purchase-success-btn-catalog');
    const successCloseBtn = document.getElementById('purchase-success-btn-close');
    const successModal = document.getElementById('purchase-success-modal');
    if (successCatalogBtn) successCatalogBtn.addEventListener('click', closePurchaseSuccessModal);
    if (successCloseBtn) successCloseBtn.addEventListener('click', closePurchaseSuccessModal);
    if (successModal) {
      successModal.addEventListener('click', function(e) {
        if (e.target === successModal) closePurchaseSuccessModal();
      });
    }
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const nombre = form.querySelector('[name="nombre"]')?.value?.trim();
        const email = form.querySelector('[name="email"]')?.value?.trim();
        const telefono = form.querySelector('[name="telefono"]')?.value?.trim();
        const direccion = form.querySelector('[name="direccion"]')?.value?.trim();
        if (!nombre || !email || !telefono || !direccion) {
          toast('Completa todos los campos', 'error');
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          toast('Correo electrónico no válido', 'error');
          return;
        }
        const customer = { nombre, email, telefono, direccion };
        const itemsSnapshot = cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity }));
        const totalSnapshot = getCartTotal();
        const itemsForApi = itemsSnapshot.map(i => ({ id: i.id, quantity: i.quantity }));

        if (isDev) {
          console.debug('[checkout] step 0', { useBackend, hasClientToken: !!clientToken, hasAdminToken: !!adminToken, cartLength: cart.length, total: totalSnapshot });
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : '';

        if (isDemoMode()) {
          if (isDev) console.debug('[checkout] modo demo (?demo=1)');
          const orderId = 'ORD-DEMO-' + Date.now();
          createOrder(customer, cart, totalSnapshot, orderId);
          finalizeCheckout({ orderId, total: totalSnapshot, items: itemsSnapshot, demoMode: true });
          return;
        }

        if (typeof window.ProyectWebAPI === 'undefined') {
          toast('No se puede conectar con el servidor. Prueba con el backend levantado.', 'error');
          if (isDev) console.debug('[checkout] ProyectWebAPI no definido');
          return;
        }
        if (!clientToken && !adminToken) {
          toast('Inicia sesión para finalizar la compra', 'info');
          openLoginModal();
          return;
        }

        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Procesando...'; }
        try {
          if (isDev) console.debug('[checkout] POST /api/orders', { cartLength: cart.length, total: totalSnapshot });
          const token = adminToken || clientToken;
          const payload = {
            customer: { nombre, email, telefono, direccion },
            items: itemsForApi
          };
          if (selectedPaymentMethod === 'stripe') payload.paymentMethod = 'stripe';
          const response = await window.ProyectWebAPI.createOrderAndPayment(token, payload);
          const result = response && typeof response === 'object' ? response : {};
          if (isDev) console.debug('[checkout] result', result);

          const orderId = String(result.orderId || result.order_id || result.id || (result.order && (result.order.id || result.order.orderId)) || '').trim() || ('PW-' + Date.now());
          try { localStorage.setItem(STORAGE_LAST_ORDER_ID, orderId); } catch (_) {}
          const totalFromBackend = result.total != null ? Number(result.total) : (result.total_cents != null ? Number(result.total_cents) / 100 : totalSnapshot);
          const paymentUrl = (result.url || result.paymentUrl || result.init_point || result.sandbox_init_point);
          const payUrl = paymentUrl && String(paymentUrl).trim() ? String(paymentUrl).trim() : null;

          if (payUrl) {
            if (isDev) console.debug('[checkout] open Stripe in popup', orderId);
            const popupWarningEl = document.getElementById('checkout-popup-warning');
            if (popupWarningEl) popupWarningEl.classList.add('hidden');
            toast('Abriendo la ventana de pago...', 'info');
            const popup = window.open(payUrl, 'Pago', 'width=500,height=700,top=100,left=100');
            if (popup && !popup.closed) {
              closeCheckoutModal();
              return;
            }
            console.warn('[checkout] Pop-up bloqueado por el navegador');
            if (popupWarningEl) {
              popupWarningEl.classList.remove('hidden');
            }
            try {
              window.dispatchEvent(new CustomEvent('proyectweb-chat-warning', { detail: { text: 'Por favor, permite las ventanas emergentes para pagar' } }));
            } catch (_) {}
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
            return;
          }
          if (isDev) console.debug('[checkout] order created', orderId, totalFromBackend);
          finalizeCheckout({ orderId, total: totalFromBackend, items: itemsSnapshot });
        } catch (err) {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
          const msg = (err.data && err.data.error) || err.message || 'Error al crear el pedido';
          toast(msg, 'error');
          if (isDev) console.debug('[checkout] error API', err.status, err.data);
        }
      });
    }
  }

  /**
   * Pinta el grid del catálogo con productos (imagen, nombre, precio, descripción, botón Añadir).
   * Al hacer clic en "Añadir al carrito": addToCart, toast y se abre el drawer.
   */
  /**
   * Muestra skeleton/loader en el contenedor del catálogo mientras carga.
   */
  function renderCatalogSkeleton(container) {
    if (!container) return;
    const skeletonCard = `
      <article class="product-card">
        <div class="w-full h-48 bg-slate-200 rounded-t-lg animate-pulse"></div>
        <div class="p-4 space-y-2">
          <div class="h-4 bg-slate-200 rounded w-3/4 animate-pulse"></div>
          <div class="h-4 bg-slate-200 rounded w-1/4 animate-pulse"></div>
          <div class="h-3 bg-slate-100 rounded w-full animate-pulse"></div>
          <div class="h-9 bg-slate-200 rounded mt-3 animate-pulse"></div>
        </div>
      </article>
    `;
    container.innerHTML = Array(6).fill(skeletonCard).join('');
  }

  function renderCatalog(container) {
    if (!container) return;
    if (PRODUCTS.length === 0) {
      container.innerHTML = '<p class="col-span-full text-center text-slate-500 py-12">Aún no hay productos disponibles.</p>';
      return;
    }
    container.innerHTML = PRODUCTS.map(p => {
      const imgSrc = p.image || DEFAULT_PRODUCT_IMAGE;
      const altText = escapeHtmlAttr(p.name ? `Fotografía de ${p.name}` : 'Producto del catálogo');
      return `
      <article class="product-card">
        <img src="${imgSrc}" alt="${altText}" loading="lazy" class="catalog-product-img">
        <div class="p-4">
          <h3 class="product-card-title">${p.name}</h3>
          <p class="product-card-price">${formatPrice(p.price)}</p>
          <p class="product-card-desc">${p.description}</p>
          <button type="button" class="btn btn-primary btn-sm w-full mt-3 add-to-cart" data-id="${p.id}" aria-label="${escapeHtmlAttr(`Añadir ${p.name || 'producto'} al carrito`)}">Añadir al carrito</button>
        </div>
      </article>
    `;
    }).join('');

    container.querySelectorAll('.add-to-cart').forEach(btn => {
      btn.addEventListener('click', () => {
        addToCart(btn.dataset.id);
        toast('Añadido al carrito', 'success');
        openCartDrawer();
      });
    });
    container.querySelectorAll('.catalog-product-img').forEach(img => bindImageFallback(img, PLACEHOLDER_IMAGE));
  }

  function toast(message, type = 'success') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  function initLoginModal() {
    const modal = document.getElementById('login-modal');
    const form = document.getElementById('login-form');
    const closeBtn = document.getElementById('login-modal-close');
    const btnLogin = document.getElementById('btn-login');
    const btnLoginMobile = document.getElementById('btn-login-mobile');

    [btnLogin, btnLoginMobile].forEach(btn => {
      if (btn) btn.addEventListener('click', openLoginModal);
    });
    const btnLogout = document.getElementById('btn-logout');
    const btnLogoutMobile = document.getElementById('btn-logout-mobile');
    if (btnLogout) btnLogout.addEventListener('click', handleLogout);
    if (btnLogoutMobile) btnLogoutMobile.addEventListener('click', handleLogout);
    if (closeBtn) closeBtn.addEventListener('click', closeLoginModal);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closeLoginModal();
      });
    }

    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const user = form.querySelector('[name="usuario"]')?.value?.trim();
        const password = form.querySelector('[name="password"]')?.value;
        if (!user || !password) {
          toast('Introduce usuario y contraseña.', 'error');
          return;
        }

        if (typeof window.ProyectWebAPI === 'undefined' || !useBackend) {
          toast('Se necesita conexión al servidor para iniciar sesión.', 'error');
          return;
        }

        try {
          const res = await window.ProyectWebAPI.login(user, password);
          if (!res || !res.token || !res.user) {
            toast('Credenciales inválidas', 'error');
            return;
          }
          if (isDev) console.debug('[login] ok', res.user.role);
          useBackend = true;
          const role = res.user.role === 'ADMIN' ? 'ADMIN' : 'CLIENT';
          const userToStore = { id: res.user.id, email: res.user.email, name: res.user.name, role: res.user.role };
          try {
            localStorage.setItem(STORAGE_LOGIN, 'true');
            localStorage.setItem(STORAGE_USER, JSON.stringify(userToStore));
            localStorage.setItem(STORAGE_ROLE, role);
            if (role === 'ADMIN') {
              adminToken = res.token;
              clientToken = null;
              localStorage.setItem(STORAGE_ADMIN_TOKEN, res.token);
              localStorage.removeItem(STORAGE_CLIENT_TOKEN);
            } else {
              clientToken = res.token;
              adminToken = null;
              localStorage.setItem(STORAGE_CLIENT_TOKEN, res.token);
              localStorage.removeItem(STORAGE_ADMIN_TOKEN);
            }
          } catch (_) {}
          setLoggedIn(true, userToStore, role);
          closeLoginModal();
          form.reset();
          toast(role === 'ADMIN' ? 'Sesión iniciada como Administrador.' : 'Sesión iniciada. Hola, Cliente.', 'success');
          if (role === 'ADMIN') {
            try {
              PRODUCTS = await loadProducts();
              renderCatalog(document.getElementById('catalog-grid'));
              await refreshAdminOrders();
              await refreshAdminStats();
              refreshAdminUsers();
            } catch (_) {
              PRODUCTS = getProductsSync();
              renderCatalog(document.getElementById('catalog-grid'));
            }
          } else {
            renderMisPedidos();
          }
        } catch (err) {
          toast((err && err.data && err.data.error) || 'Credenciales inválidas', 'error');
          if (isDev) console.debug('[login] fail', err.status, err.data);
        }
      });
    }
  }

  function initCartDrawer() {
    const btnCart = document.getElementById('btn-cart');
    const overlay = document.getElementById('cart-drawer-overlay');
    const closeBtn = document.getElementById('cart-drawer-close');
    const checkoutBtn = document.getElementById('cart-drawer-checkout');

    if (btnCart) btnCart.addEventListener('click', openCartDrawer);
    if (closeBtn) closeBtn.addEventListener('click', closeCartDrawer);
    if (overlay) overlay.addEventListener('click', closeCartDrawer);
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => {
        if (getCartCount() === 0) {
          toast('El carrito está vacío', 'error');
          return;
        }
        selectedPaymentMethod = 'stripe';
        closeCartDrawer();
        openCheckoutModal();
      });
    }
  }

  function initContactForm() {
    const form = document.getElementById('contact-form');
    if (!form) return;

    form.addEventListener('submit', async function(e) {
      e.preventDefault();

      const nombre = form.querySelector('[name="nombre"]')?.value?.trim() || '';
      const email = form.querySelector('[name="email"]')?.value?.trim() || '';
      const mensaje = form.querySelector('[name="mensaje"]')?.value?.trim() || '';

      if (!nombre || !email || !mensaje) {
        toast('Completa nombre, correo y mensaje.', 'error');
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        toast('Introduce un correo electrónico válido.', 'error');
        return;
      }

      try {
        if (typeof window.ProyectWebAPI !== 'undefined') {
          await window.ProyectWebAPI.sendContact({ name: nombre, email, message: mensaje });
          toast('Mensaje enviado. Te responderemos pronto.', 'success');
        } else {
          toast('Sin conexión al servidor. Intenta más tarde.', 'error');
        }
        form.reset();
      } catch (err) {
        toast((err.data && err.data.error) || 'No se pudo enviar el mensaje. Intenta más tarde.', 'error');
      }
    });
  }

  function initMenu() {
    const toggle = document.getElementById('menu-toggle');
    const menu = document.getElementById('mobile-menu');
    if (toggle && menu) {
      toggle.addEventListener('click', () => menu.classList.toggle('hidden'));
    }
  }

  function openRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      document.getElementById('register-name')?.focus();
    }
  }

  function closeRegisterModal() {
    const modal = document.getElementById('register-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function openStripeInfoModal() {
    const modal = document.getElementById('mp-info-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
    }
  }

  function closeStripeInfoModal() {
    const modal = document.getElementById('mp-info-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
  }

  function initMpInfoModal() {
    const modal = document.getElementById('mp-info-modal');
    const closeBtn = document.getElementById('mp-info-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', closeStripeInfoModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeStripeInfoModal(); });
  }

  /** Scroll suave a una sección por id y opcionalmente refresca el catálogo si es #catalogo */
  function scrollToSection(sectionId) {
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Scroll al catálogo y refresca renderCatalog (para Quick Reply y enlaces) */
  function scrollToCatalogAndRefresh() {
    scrollToSection('catalogo');
    const grid = document.getElementById('catalog-grid');
    if (grid) renderCatalog(grid);
  }

  /**
   * Abre la pasarela de pago de Stripe en una ventana centrada (500x700, sin barra de menú/herramientas).
   * Usado por Visitante y Usuario al hacer clic en "Pagar".
   */
  function openStripePaymentWindow(url) {
    if (!url || typeof url !== 'string') return null;
    const w = 500;
    const h = 700;
    const left = Math.max(0, Math.floor((window.screen.width - w) / 2));
    const top = Math.max(0, Math.floor((window.screen.height - h) / 2));
    const features = 'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top +
      ',menubar=no,toolbar=no,location=no,status=no';
    return window.open(url, 'StripeCheckout', features);
  }

  function initRegisterModal() {
    const modal = document.getElementById('register-modal');
    const form = document.getElementById('register-form');
    const closeBtn = document.getElementById('register-modal-close');
    const openLoginBtn = document.getElementById('btn-open-login');
    const openRegisterBtn = document.getElementById('btn-open-register');

    if (openRegisterBtn) openRegisterBtn.addEventListener('click', () => { closeLoginModal(); openRegisterModal(); });
    if (openLoginBtn) openLoginBtn.addEventListener('click', () => { closeRegisterModal(); openLoginModal(); });
    if (closeBtn) closeBtn.addEventListener('click', closeRegisterModal);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeRegisterModal(); });

    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const email = form.querySelector('[name="email"]')?.value?.trim();
        const password = form.querySelector('[name="password"]')?.value;
        const nombre = form.querySelector('[name="nombre"]')?.value?.trim();
        if (!email || !password) {
          toast('Email y contraseña son obligatorios.', 'error');
          return;
        }
        if (password.length < 6) {
          toast('La contraseña debe tener al menos 6 caracteres.', 'error');
          return;
        }
        if (!useBackend || typeof window.ProyectWebAPI === 'undefined') {
          toast('Registro disponible solo con el servidor conectado.', 'error');
          return;
        }
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : '';
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creando cuenta...'; }
        try {
          const res = await window.ProyectWebAPI.register(email, password, nombre || '');
          const token = res.token;
          const user = res.user;
          if (user && res.message && !token) {
            closeRegisterModal();
            form.reset();
            toast(res.message, 'success');
            openLoginModal();
            return;
          }
          if (token && user) {
            try {
              localStorage.setItem(STORAGE_CLIENT_TOKEN, token);
              localStorage.removeItem(STORAGE_ADMIN_TOKEN);
            } catch (_) {}
            clientToken = token;
            adminToken = null;
            setLoggedIn(true, user, 'CLIENT');
            closeRegisterModal();
            closeLoginModal();
            form.reset();
            toast('Cuenta creada', 'success');
            renderMisPedidos();
          } else {
            toast('Error al crear la cuenta.', 'error');
          }
        } catch (err) {
          const msg = (err.data && err.data.error) || 'Error al registrarse';
          toast(msg, 'error');
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
      });
    }
  }

  async function renderMisPedidos() {
    const listEl = document.getElementById('mis-pedidos-list');
    const emptyEl = document.getElementById('mis-pedidos-empty');
    const loadingEl = document.getElementById('mis-pedidos-loading');
    if (!listEl) return;
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.innerHTML = '';

    let orders = [];
    if (useBackend && typeof window.ProyectWebAPI !== 'undefined') {
      if (clientToken) {
        try {
          orders = await window.ProyectWebAPI.getMyOrders(clientToken);
        } catch (_) {
          orders = [];
        }
      } else if (adminToken) {
        try {
          orders = await window.ProyectWebAPI.getOrders(adminToken);
        } catch (_) {
          orders = [];
        }
      } else {
        if (loadingEl) loadingEl.classList.add('hidden');
        if (emptyEl) { emptyEl.textContent = 'Inicia sesión para ver tus pedidos.'; emptyEl.classList.remove('hidden'); }
        return;
      }
    } else {
      orders = getOrders();
    }

    if (!Array.isArray(orders)) orders = [];
    orders = orders.filter(o => o != null);
    if (loadingEl) loadingEl.classList.add('hidden');

    if (orders.length === 0) {
      if (emptyEl) { emptyEl.textContent = 'Aún no tienes pedidos.'; emptyEl.classList.remove('hidden'); }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.innerHTML = orders.slice(0, 20).map(o => {
      if (!o) return '';
      const carrier = o.tracking?.carrier || o.tracking?.tracking_carrier || '';
      const tn = o.tracking?.tracking_number || o.tracking?.number || '';
      const trackingBlock = (carrier || tn) ? `<div class="mt-1 text-xs text-slate-600">${carrier ? `Paquetería: ${carrier}` : ''}${carrier && tn ? ' · ' : ''}${tn ? `Guía: ${tn}` : ''}</div>` : '';
      const date = new Date(o.date || o.createdAt);
      const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
      const name = (o.customer && (o.customer.name || o.customer.nombre)) || '—';
      const status = String(o.status || 'pending').toLowerCase();
      const statusClass = status === 'approved' ? 'bg-green-100 text-green-800' : status === 'rejected' ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600';
      return `<div class="p-3 border border-slate-200 rounded-lg text-sm"><p class="font-semibold text-slate-800">${o.id}</p><p class="text-slate-600">${dateStr}</p><p class="text-indigo-600 font-medium">${formatPrice(o.total)}</p><span class="text-xs px-2 py-0.5 rounded ${statusClass}">${status}</span>${trackingBlock}</div>`;
    }).join('');
  }

  /** Vista previa de imagen: archivo (FileReader) o URL en el formulario de producto */
  function updateProductImagePreview() {
    const wrap = document.getElementById('product-image-preview');
    const img = document.getElementById('product-image-preview-img');
    const urlInput = document.getElementById('product-image');
    const fileInput = document.getElementById('product-image-file');
    if (!wrap || !img) return;
    const file = fileInput?.files?.[0];
    const urlVal = (urlInput?.value || '').trim();
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        img.src = reader.result;
        wrap.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
      return;
    }
    if (urlVal) {
      img.onerror = () => wrap.classList.add('hidden');
      img.onload = () => wrap.classList.remove('hidden');
      img.src = urlVal;
      wrap.classList.remove('hidden');
      return;
    }
    wrap.classList.add('hidden');
  }

  function initProductImagePreview() {
    const urlInput = document.getElementById('product-image');
    const fileInput = document.getElementById('product-image-file');
    if (!urlInput || !fileInput) return;
    urlInput.addEventListener('input', updateProductImagePreview);
    fileInput.addEventListener('change', updateProductImagePreview);
  }

  /** Resultado al volver de Stripe: stripe=success|cancel en la URL. En success se muestra mensaje en el chat y se vacía el carrito si aplica. */
  function initPaymentResult() {
    const params = new URLSearchParams(window.location.search);
    const mp = params.get('mp');
    let orderId = (params.get('orderId') || '').trim();
    if (!orderId) try { orderId = (localStorage.getItem(STORAGE_LAST_ORDER_ID) || '').trim(); } catch (_) {}
    if (!mp) return;

    const token = adminToken || clientToken;
    const showOrderBanner = (statusText) => {
      if (!orderId) return;
      toast('Pedido ' + orderId + ': ' + statusText, mp === 'success' ? 'success' : mp === 'failure' ? 'error' : 'info');
    };

    if (mp === 'success') {
      const doFinalize = (orderIdVal, totalVal, itemsVal) => {
        finalizeCheckout({ orderId: orderIdVal, total: totalVal, items: itemsVal });
      };
      if (token && orderId && window.ProyectWebAPI && window.ProyectWebAPI.getOrderById) {
        window.ProyectWebAPI.getOrderById(token, orderId)
          .then(o => {
            if (o) {
              const total = o.total != null ? Number(o.total) : (o.total_cents != null ? Number(o.total_cents) / 100 : getCartTotal());
              const items = (o.items || []).map(i => ({ name: i.name || i.productName, quantity: i.quantity || i.qty, price: i.price }));
              if (o.status) showOrderBanner(o.status);
              doFinalize(orderId, total, items.length ? items : cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })));
            } else {
              doFinalize(orderId, getCartTotal(), cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })));
            }
          })
          .catch(() => {
            doFinalize(orderId, getCartTotal(), cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })));
          });
      } else {
        const itemsSnapshot = cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity }));
        doFinalize(orderId || ('MP-' + Date.now()), getCartTotal(), itemsSnapshot);
      }
    } else if (mp === 'pending') {
      toast('Pago pendiente. Te notificaremos cuando se confirme.', 'info');
      if (token && orderId && window.ProyectWebAPI && window.ProyectWebAPI.getOrderById) {
        window.ProyectWebAPI.getOrderById(token, orderId).then(o => { if (o && o.status) showOrderBanner(o.status); }).catch(() => {});
      }
    } else if (mp === 'failure') {
      toast('Pago fallido. Puedes intentar de nuevo desde el carrito.', 'error');
      if (token && orderId && window.ProyectWebAPI && window.ProyectWebAPI.getOrderById) {
        window.ProyectWebAPI.getOrderById(token, orderId).then(o => { if (o && o.status) showOrderBanner(o.status); }).catch(() => {});
      }
    }

    const cleanUrl = window.location.pathname + (window.location.hash || '');
    history.replaceState({}, '', cleanUrl);
  }

  async function refreshAdminOrders() {
    if (!isAdmin()) return;
    if (useBackend && typeof window.ProyectWebAPI !== 'undefined') {
      if (!adminToken) {
        renderAdminOrdersList([], 'Inicia sesión como admin');
        return;
      }
      try {
        const orders = await window.ProyectWebAPI.getOrders(adminToken);
        renderAdminOrdersList(orders);
        return;
      } catch (_) {
        renderAdminOrdersList([]);
        return;
      }
    }
    renderAdminOrdersList(getOrders());
  }

  // ========== FUNCIONES DE ADMINISTRADOR ==========

  /**
   * Actualiza las estadísticas en el panel de administrador
   */
  async function refreshAdminStats() {
    if (!isAdmin() || !useBackend || !adminToken || typeof window.ProyectWebAPI === 'undefined') return;
    try {
      const stats = await window.ProyectWebAPI.getAdminStats(adminToken);
      const elTotal = document.getElementById('admin-total-productos');
      const elUsers = document.getElementById('admin-usuarios-activos');
      const elVentas = document.getElementById('admin-ventas-totales');
      if (elTotal && stats.totalProducts != null) elTotal.textContent = stats.totalProducts;
      if (elUsers && stats.totalUsers != null) elUsers.textContent = stats.totalUsers;
      if (elVentas && stats.totalSales != null) elVentas.textContent = formatPrice(stats.totalSales);
    } catch (_) {}
  }

  function updateAdminStats() {
    if (!isAdmin()) return;
    const totalProductos = PRODUCTS.length;
    const itemsCarrito = getCartCount();
    const valorTotal = getCartTotal();
    const elTotal = document.getElementById('admin-total-productos');
    const elCarrito = document.getElementById('admin-items-carrito');
    const elValor = document.getElementById('admin-valor-total');
    const elUsers = document.getElementById('admin-usuarios-activos');
    const elVentas = document.getElementById('admin-ventas-totales');
    if (elTotal) elTotal.textContent = totalProductos;
    if (elCarrito) elCarrito.textContent = itemsCarrito;
    if (elValor) elValor.textContent = formatPrice(valorTotal);
    if (elUsers && !useBackend) elUsers.textContent = '—';
    if (elVentas && !useBackend) elVentas.textContent = formatPrice(0);
    if (useBackend && adminToken) refreshAdminStats();
  }

  /**
   * Renderiza la tabla de productos en el panel de administrador
   */
  function renderAdminProductsTable() {
    if (!isAdmin()) return;
    const tbody = document.getElementById('admin-tabla-productos');
    if (!tbody) return;

    if (PRODUCTS.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">No hay productos</td></tr>';
      return;
    }

    tbody.innerHTML = PRODUCTS.map(p => `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 text-slate-700">${p.id}</td>
        <td class="px-4 py-3 font-medium text-slate-900">${p.name}</td>
        <td class="px-4 py-3 text-indigo-600 font-semibold">${formatPrice(p.price)}</td>
        <td class="px-4 py-3 text-slate-700">${p.stock != null ? p.stock : '—'}</td>
        <td class="px-4 py-3">
          <div class="flex gap-2">
            <button type="button" class="admin-edit-btn text-blue-600 hover:text-blue-800 text-sm font-medium" data-id="${p.id}">
              <i class="fa-solid fa-edit mr-1"></i>Editar
            </button>
            <button type="button" class="admin-delete-btn text-red-600 hover:text-red-800 text-sm font-medium" data-id="${p.id}">
              <i class="fa-solid fa-trash mr-1"></i>Eliminar
            </button>
          </div>
        </td>
      </tr>
    `).join('');

    // Event listeners para editar
    tbody.querySelectorAll('.admin-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const product = PRODUCTS.find(p => p.id === btn.dataset.id);
        if (product) openProductModal(product);
      });
    });

    // Event listeners para eliminar
    tbody.querySelectorAll('.admin-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('¿Estás seguro de eliminar este producto?')) {
          deleteProduct(btn.dataset.id);
        }
      });
    });
  }

  /**
   * Renderiza la lista de pedidos en el panel de administrador
   */
  function renderAdminOrdersList(orders, emptyMessage) {
    if (!isAdmin()) return;
    const listEl = document.getElementById('admin-pedidos-list');
    const emptyEl = document.getElementById('admin-pedidos-empty');
    if (!listEl) return;
    if (!Array.isArray(orders)) orders = [];
    const list = orders.filter(o => o != null);

    if (list.length === 0) {
      listEl.innerHTML = '';
      if (emptyEl) {
        emptyEl.textContent = emptyMessage || 'Aún no hay pedidos.';
        emptyEl.classList.remove('hidden');
      }
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');
    listEl.innerHTML = list.slice(0, 10).map(o => {
      if (!o) return '';
      const carrier = o.tracking?.carrier || o.tracking?.tracking_carrier || '';
      const tn = o.tracking?.tracking_number || o.tracking?.number || '';
      const trackingBlock = (carrier || tn) ? `<div class="mt-1 text-xs text-slate-600">${carrier ? `Paquetería: ${carrier}` : ''}${carrier && tn ? ' · ' : ''}${tn ? `Guía: ${tn}` : ''}</div>` : '';
      const date = new Date(o.date);
      const dateStr = date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const name = (o.customer && (o.customer.name || o.customer.nombre)) || '—';
      const email = (o.customer && o.customer.email) || '—';
      const statusVal = (o.status || '').toLowerCase();
      const status = o.status ? `<span class="text-xs px-2 py-0.5 rounded ${statusVal === 'approved' ? 'bg-green-100 text-green-800' : statusVal === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-slate-100 text-slate-600'}">${o.status}</span>` : '';

      return `
        <div class="p-3 border border-slate-200 rounded-lg bg-slate-50 text-sm">
          <div class="flex items-center justify-between gap-2">
            <p class="font-semibold text-slate-800">${o.id} ${status}</p>
            <span class="text-slate-500 text-xs">${dateStr}</span>
          </div>
          <p class="text-slate-600">${name} · ${email}</p>
          <p class="text-indigo-600 font-medium">${formatPrice(o.total)}</p>
          ${trackingBlock}

          <div class="mt-2 flex flex-wrap gap-2 items-center">
            <button type="button" class="btn btn-secondary btn-sm" data-order-detail="${o.id}">Ver detalle</button>
          </div>
          <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input class="input-field !py-2" placeholder="Paquetería (DHL, Estafeta...)" data-track-carrier="${o.id}" value="${carrier || ''}">
            <input class="input-field !py-2" placeholder="Número de guía" data-track-number="${o.id}" value="${tn || ''}">
            <button type="button" class="btn btn-primary btn-sm" data-track-save="${o.id}">Guardar guía</button>
          </div>

          <p class="text-xs text-slate-500 mt-1">La guía se muestra al cliente en “Mis pedidos”.</p>
        </div>
      `;
    }).join('');

    // listeners de tracking
    listEl.querySelectorAll('[data-track-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const orderId = btn.getAttribute('data-track-save');
        const carrierEl = listEl.querySelector('[data-track-carrier="' + orderId + '"]');
        const numberEl = listEl.querySelector('[data-track-number="' + orderId + '"]');
        const carrier = carrierEl ? carrierEl.value.trim() : '';
        const trackingNumber = numberEl ? numberEl.value.trim() : '';
        if (!carrier || !trackingNumber) { toast('Completa paquetería y número de guía.', 'error'); return; }
        if (!useBackend) {
          toast('Solo modo servidor', 'info');
          return;
        }
        if (!adminToken || typeof window.ProyectWebAPI === 'undefined') { toast('Backend no disponible.', 'error'); return; }
        try {
          btn.disabled = true;
          await window.ProyectWebAPI.updateOrderTracking(adminToken, orderId, carrier, trackingNumber);
          toast('Guía guardada', 'success');
          await refreshAdminOrders();
        } catch (err) {
          toast((err.data && err.data.error) || 'No se pudo guardar la guía.', 'error');
        } finally {
          btn.disabled = false;
        }
      });
    });

    listEl.querySelectorAll('[data-order-detail]').forEach(btn => {
      btn.addEventListener('click', () => {
        const orderId = btn.getAttribute('data-order-detail');
        if (orderId) openOrderDetailModal(orderId);
      });
    });
  }

  function renderAdminOrders() {
    renderAdminOrdersList(getOrders());
  }

  async function refreshAdminUsers() {
    if (!isAdmin() || !adminToken || typeof window.ProyectWebAPI === 'undefined') {
      renderAdminUsersTable([]);
      return;
    }
    try {
      const list = await window.ProyectWebAPI.getAdminUsers(adminToken);
      ADMIN_USERS = Array.isArray(list) ? list : [];
      renderAdminUsersTable(ADMIN_USERS);
    } catch (_) {
      ADMIN_USERS = [];
      renderAdminUsersTable([]);
    }
  }

  function initAdminUserDeleteDelegation() {
    if (adminUserDeleteDelegationAttached) return;
    adminUserDeleteDelegationAttached = true;
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('.btn-delete');
      if (!btn) return;
      const tbody = document.getElementById('admin-tabla-usuarios');
      if (!tbody || !tbody.contains(btn)) return;
      const userId = btn.getAttribute('data-id');
      if (!userId) return;
      if (!confirm('¿Estás seguro de eliminar este usuario?')) return;
      if (!adminToken || typeof window.ProyectWebAPI === 'undefined') {
        toast('Backend no disponible', 'error');
        return;
      }
      const base = typeof window.ProyectWebAPI.getBase === 'function' ? window.ProyectWebAPI.getBase() : '';
      const url = base + '/api/admin/users/' + encodeURIComponent(userId);
      try {
        const res = await fetch(url, {
          method: 'DELETE',
          headers: { Authorization: 'Bearer ' + adminToken },
          credentials: 'omit'
        });
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch (_) {
          data = {};
        }
        if (!res.ok) {
          toast((data && data.error) || 'Error al eliminar usuario', 'error');
          return;
        }
        toast('Usuario eliminado', 'success');
        await refreshAdminUsers();
      } catch (_) {
        toast('Error de red al eliminar usuario', 'error');
      }
    });
  }

  function renderAdminUsersTable(users) {
    if (!isAdmin()) return;
    const tbody = document.getElementById('admin-tabla-usuarios');
    if (!tbody) return;
    const list = Array.isArray(users) ? users : [];
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="px-4 py-8 text-center text-slate-500">No hay usuarios o no se pudo cargar</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(user => `
      <tr class="hover:bg-slate-50">
        <td class="px-4 py-3 text-slate-700">${(user.email || '').replace(/</g, '&lt;')}</td>
        <td class="px-4 py-3 font-medium text-slate-900">${(user.name || '—').replace(/</g, '&lt;')}</td>
        <td class="px-4 py-3 text-slate-700">${user.role || 'CLIENT'}</td>
        <td class="px-4 py-3">${user.active !== false ? '<span class="text-green-600">Activo</span>' : '<span class="text-slate-500">Inactivo</span>'}</td>
        <td class="px-4 py-3">
          <div class="flex flex-wrap gap-2">
            <button type="button" class="admin-user-edit text-blue-600 hover:text-blue-800 text-sm font-medium" data-id="${user.id}">Editar</button>
            <button type="button" class="admin-user-toggle text-sm font-medium" data-id="${user.id}" data-active="${user.active !== false}">${user.active !== false ? 'Desactivar' : 'Activar'}</button>
            <button class="btn-delete" data-id="${user.id}">Eliminar</button>
            <button type="button" class="admin-user-reset text-amber-600 hover:text-amber-800 text-sm font-medium" data-id="${user.id}">Reset contraseña</button>
          </div>
        </td>
      </tr>
    `).join('');
    tbody.querySelectorAll('.admin-user-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = ADMIN_USERS.find(x => x.id === btn.dataset.id);
        if (u) openUserModal(u);
      });
    });
    tbody.querySelectorAll('.admin-user-toggle').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const active = btn.dataset.active === 'true';
        if (!adminToken || typeof window.ProyectWebAPI === 'undefined') { toast('Backend no disponible', 'error'); return; }
        try {
          await window.ProyectWebAPI.updateUser(id, { active: !active }, adminToken);
          toast(active ? 'Usuario desactivado' : 'Usuario activado', 'success');
          refreshAdminUsers();
        } catch (err) {
          toast((err.data && err.data.error) || 'Error al actualizar', 'error');
        }
      });
    });
    tbody.querySelectorAll('.admin-user-reset').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const newPassword = prompt('Nueva contraseña (mín. 6 caracteres):');
        if (newPassword == null) return;
        if (String(newPassword).length < 6) { toast('Mínimo 6 caracteres', 'error'); return; }
        if (!adminToken || typeof window.ProyectWebAPI === 'undefined') { toast('Backend no disponible', 'error'); return; }
        try {
          await window.ProyectWebAPI.resetUserPassword(id, newPassword, adminToken);
          toast('Contraseña actualizada', 'success');
        } catch (err) {
          toast((err.data && err.data.error) || 'Error al actualizar contraseña', 'error');
        }
      });
    });
  }

  async function openOrderDetailModal(orderId) {
    const modal = document.getElementById('order-detail-modal');
    const titleEl = document.getElementById('order-detail-title');
    const contentEl = document.getElementById('order-detail-content');
    if (!modal || !contentEl) return;
    contentEl.innerHTML = '<p class="text-slate-500">Cargando...</p>';
    titleEl.textContent = 'Pedido ' + orderId;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    if (!adminToken || typeof window.ProyectWebAPI === 'undefined') {
      contentEl.innerHTML = '<p class="text-slate-500">Backend no disponible.</p>';
      return;
    }
    try {
      const o = await window.ProyectWebAPI.getOrderById(adminToken, orderId);
      const date = o.date ? new Date(o.date).toLocaleString('es-MX') : '—';
      const cust = o.customer || {};
      const name = cust.name || cust.nombre || '—';
      const email = cust.email || '—';
      const tel = cust.telefono || cust.phone || '—';
      const addr = cust.direccion || cust.address || '—';
      const tracking = o.tracking ? (o.tracking.carrier || o.tracking.tracking_carrier || '') + ' ' + (o.tracking.tracking_number || o.tracking.number || '') : '—';
      let itemsHtml = '';
      if (Array.isArray(o.items) && o.items.length) {
        itemsHtml = '<ul class="list-disc list-inside mt-1">' + o.items.map(i => `<li>${i.name || 'Producto'} × ${i.quantity || 0} — ${formatPrice((i.price || 0) * (i.quantity || 0))}</li>`).join('') + '</ul>';
      } else {
        itemsHtml = '<p class="text-slate-500">Sin ítems.</p>';
      }
      contentEl.innerHTML = `
        <p><strong>Fecha:</strong> ${date}</p>
        <p><strong>Estado:</strong> ${o.status || '—'}</p>
        <p><strong>Cliente:</strong> ${name} — ${email}</p>
        <p><strong>Teléfono:</strong> ${tel}</p>
        <p><strong>Dirección:</strong> ${addr}</p>
        <p><strong>Total:</strong> ${formatPrice(o.total)}</p>
        <p><strong>Guía:</strong> ${tracking}</p>
        <div><strong>Productos:</strong> ${itemsHtml}</div>
      `;
    } catch (err) {
      contentEl.innerHTML = '<p class="text-red-600">' + (err.data && err.data.error || 'No se pudo cargar el pedido') + '</p>';
    }
  }

  function closeOrderDetailModal() {
    const modal = document.getElementById('order-detail-modal');
    if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
  }

  function openUserModal(user = null) {
    const modal = document.getElementById('user-modal');
    const form = document.getElementById('user-form');
    const titleEl = document.getElementById('user-modal-title');
    const passwordWrap = document.getElementById('user-password-wrap');
    const passwordInput = document.getElementById('user-password');
    if (!modal || !form) return;
    if (user) {
      if (titleEl) titleEl.textContent = 'Editar usuario';
      document.getElementById('user-id').value = user.id;
      document.getElementById('user-email').value = user.email || '';
      document.getElementById('user-name').value = user.name || '';
      document.getElementById('user-role').value = user.role === 'ADMIN' ? 'ADMIN' : 'CLIENT';
      if (passwordWrap) passwordWrap.classList.add('hidden');
      if (passwordInput) passwordInput.removeAttribute('required');
    } else {
      if (titleEl) titleEl.textContent = 'Nuevo usuario';
      form.reset();
      document.getElementById('user-id').value = '';
      if (passwordWrap) passwordWrap.classList.remove('hidden');
      if (passwordInput) passwordInput.setAttribute('required', 'required');
    }
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('user-email')?.focus();
  }

  function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden', 'true'); }
  }

  function initUserModal() {
    const modal = document.getElementById('user-modal');
    const form = document.getElementById('user-form');
    const closeBtn = document.getElementById('user-modal-close');
    const cancelBtn = document.getElementById('user-modal-cancel');
    const btnNuevo = document.getElementById('btn-nuevo-usuario');
    if (btnNuevo) btnNuevo.addEventListener('click', () => openUserModal());
    if (closeBtn) closeBtn.addEventListener('click', closeUserModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeUserModal);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeUserModal(); });
    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('user-id').value.trim();
        const email = document.getElementById('user-email').value.trim();
        const password = document.getElementById('user-password').value;
        const name = document.getElementById('user-name').value.trim();
        const role = document.getElementById('user-role').value;
        if (!email || !name) { toast('Completa email y nombre', 'error'); return; }
        if (!id && !password) { toast('Contraseña requerida para nuevo usuario', 'error'); return; }
        if (!id && password.length < 6) { toast('Contraseña mínimo 6 caracteres', 'error'); return; }
        if (!adminToken || typeof window.ProyectWebAPI === 'undefined') { toast('Backend no disponible', 'error'); return; }
        try {
          if (id) {
            const payload = { name, email, role: role || 'CLIENT' };
            await window.ProyectWebAPI.updateUser(id, payload, adminToken);
            toast('Usuario actualizado', 'success');
          } else {
            await window.ProyectWebAPI.createUser({ email, password, name, role: role || 'CLIENT' }, adminToken);
            toast('Usuario creado', 'success');
          }
          closeUserModal();
          form.reset();
          refreshAdminUsers();
        } catch (err) {
          toast((err.data && err.data.error) || 'Error al guardar usuario', 'error');
        }
      });
    }
  }

  function initOrderDetailModal() {
    const modal = document.getElementById('order-detail-modal');
    const closeBtn = document.getElementById('order-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', closeOrderDetailModal);
    if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeOrderDetailModal(); });
  }

  /**
   * Abre el modal de producto (nuevo o edición)
   */
  function openProductModal(product = null) {
    const modal = document.getElementById('product-modal');
    const form = document.getElementById('product-form');
    const title = document.getElementById('product-modal-title');
    
    if (!modal || !form) return;

    if (product) {
      // Modo edición
      if (title) title.textContent = 'Editar Producto';
      document.getElementById('product-id').value = product.id;
      document.getElementById('product-name').value = product.name;
      document.getElementById('product-price').value = product.price;
      document.getElementById('product-description').value = product.description;
      const stockEl = document.getElementById('product-stock');
      if (stockEl) stockEl.value = (product.stock != null ? product.stock : 0);
      const fileEl = document.getElementById('product-image-file');
      if (fileEl) fileEl.value = '';
      const urlEl = document.getElementById('product-image');
      if (urlEl) urlEl.value = product.image || '';
      updateProductImagePreview();
    } else {
      // Modo nuevo
      if (title) title.textContent = 'Nuevo Producto';
      form.reset();
      document.getElementById('product-id').value = '';
      const fileEl = document.getElementById('product-image-file');
      if (fileEl) fileEl.value = '';
      updateProductImagePreview();
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('product-name')?.focus();
  }

  /**
   * Cierra el modal de producto
   */
  function closeProductModal() {
    const modal = document.getElementById('product-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    const fileEl = document.getElementById('product-image-file');
    const urlEl = document.getElementById('product-image');
    const previewWrap = document.getElementById('product-image-preview');
    const previewImg = document.getElementById('product-image-preview-img');
    if (fileEl) fileEl.value = '';
    if (urlEl) urlEl.value = '';
    if (previewWrap) previewWrap.classList.add('hidden');
    if (previewImg) previewImg.src = '';
  }

  /**
   * Agrega un nuevo producto (API o local)
   */
  async function addProduct(productData) {
    const payload = {
      name: productData.name,
      description: productData.description,
      price: productData.price,
      stock: productData.stock,
      image: productData.image
    };
    if (useBackend && adminToken && typeof window.ProyectWebAPI !== 'undefined') {
      try {
        await window.ProyectWebAPI.createProduct(payload, adminToken);
        PRODUCTS = await loadProducts();
        renderCatalog(document.getElementById('catalog-grid'));
        renderAdminProductsTable();
        updateAdminStats();
        toast('Producto agregado correctamente', 'success');
        return;
      } catch (err) {
        const msg = (err.data && err.data.error) || 'Error al agregar producto';
        toast(msg, 'error');
        throw err;
      }
    }
    const newId = String(Math.max(0, ...PRODUCTS.map(p => parseInt(p.id, 10) || 0)) + 1);
    const newProduct = { id: newId, ...payload };
    PRODUCTS.push(newProduct);
    saveProducts(PRODUCTS);
    renderCatalog(document.getElementById('catalog-grid'));
    renderAdminProductsTable();
    updateAdminStats();
    toast('Producto agregado correctamente', 'success');
  }

  /**
   * Actualiza un producto existente (API o local)
   */
  async function updateProduct(productId, productData) {
    const payload = {
      name: productData.name,
      description: productData.description,
      price: productData.price,
      stock: productData.stock,
      image: productData.image
    };
    if (useBackend && adminToken && typeof window.ProyectWebAPI !== 'undefined') {
      try {
        await window.ProyectWebAPI.updateProduct(productId, payload, adminToken);
        PRODUCTS = await loadProducts();
        renderCatalog(document.getElementById('catalog-grid'));
        renderAdminProductsTable();
        updateAdminStats();
        toast('Producto actualizado correctamente', 'success');
        return;
      } catch (err) {
        const msg = (err.data && err.data.error) || 'Error al actualizar producto';
        toast(msg, 'error');
        throw err;
      }
    }
    const index = PRODUCTS.findIndex(p => p.id === productId);
    if (index === -1) return;
    PRODUCTS[index] = { id: productId, ...payload };
    saveProducts(PRODUCTS);
    renderCatalog(document.getElementById('catalog-grid'));
    renderAdminProductsTable();
    updateAdminStats();
    toast('Producto actualizado correctamente', 'success');
  }

  /**
   * Elimina un producto (API o local)
   */
  async function deleteProduct(productId) {
    if (useBackend && adminToken && typeof window.ProyectWebAPI !== 'undefined') {
      try {
        await window.ProyectWebAPI.deleteProduct(productId, adminToken);
        PRODUCTS = await loadProducts();
        renderCatalog(document.getElementById('catalog-grid'));
        renderAdminProductsTable();
        updateAdminStats();
        toast('Producto eliminado', 'success');
        return;
      } catch (err) {
        const msg = (err.data && err.data.error) || 'Error al eliminar producto';
        toast(msg, 'error');
        return;
      }
    }
    PRODUCTS = PRODUCTS.filter(p => p.id !== productId);
    saveProducts(PRODUCTS);
    renderCatalog(document.getElementById('catalog-grid'));
    renderAdminProductsTable();
    updateAdminStats();
    toast('Producto eliminado', 'success');
  }

  /**
   * Inicializa el modal de productos y formulario
   */
  function initProductModal() {
    const modal = document.getElementById('product-modal');
    const form = document.getElementById('product-form');
    const closeBtn = document.getElementById('product-modal-close');
    const cancelBtn = document.getElementById('product-modal-cancel');
    const addBtn = document.getElementById('btn-agregar-producto');

    if (addBtn) {
      addBtn.addEventListener('click', () => openProductModal());
    }
    if (closeBtn) closeBtn.addEventListener('click', closeProductModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeProductModal);
    if (modal) {
      modal.addEventListener('click', function(e) {
        if (e.target === modal) closeProductModal();
      });
    }

    if (form) {
      form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('product-id').value;

        const name = document.getElementById('product-name').value.trim();
        const priceInput = document.getElementById('product-price');
        const stockInput = document.getElementById('product-stock');
        const description = document.getElementById('product-description').value.trim();
        const imageUrlRaw = document.getElementById('product-image')?.value?.trim() || '';
        const imageFile = document.getElementById('product-image-file')?.files?.[0] || null;

        const price = Number(String(priceInput?.value ?? '').replace(/[^0-9.]/g, ''));
        const stock = Number(String(stockInput?.value ?? '').replace(/[^0-9]/g, ''));

        if (!name || !description) {
          toast('Completa todos los campos', 'error');
          return;
        }
        if (Number.isNaN(price) || price <= 0) {
          toast('Precio inválido', 'error');
          return;
        }
        if (Number.isNaN(stock) || stock < 0) {
          toast('Stock inválido', 'error');
          return;
        }

        // Imagen: archivo (subir) o URL. Al menos uno debe estar presente.
        const MAX_FILE_MB = 3;
        if (imageFile) {
          if (!imageFile.type.startsWith('image/')) {
            toast('El archivo debe ser una imagen (JPG, PNG, WebP).', 'error');
            return;
          }
          if (imageFile.size > MAX_FILE_MB * 1024 * 1024) {
            toast('La imagen no puede superar 3 MB.', 'error');
            return;
          }
        }
        if (!imageFile && !imageUrlRaw) {
          toast('Sube una imagen o pega una URL.', 'error');
          return;
        }
        if (imageUrlRaw && !imageFile) {
          try {
            new URL(imageUrlRaw);
          } catch {
            toast('La URL de la imagen no es válida.', 'error');
            return;
          }
        }

        let finalImageUrl = imageUrlRaw;
        const submitBtn = form.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.textContent : '';

        try {
          if (imageFile && useBackend && adminToken && typeof window.ProyectWebAPI !== 'undefined') {
            if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Subiendo...'; }
            try {
              const up = await window.ProyectWebAPI.uploadImage(imageFile, adminToken);
              if (up && up.url) finalImageUrl = up.url;
            } catch (err) {
              toast((err.data && err.data.error) || 'Error al subir la imagen. Revisa que el archivo sea válido.', 'error');
              return;
            } finally {
              if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
            }
          } else if (imageFile && (!useBackend || !adminToken || typeof window.ProyectWebAPI === 'undefined')) {
            toast('Para subir un archivo el servidor debe estar conectado y debes estar logueado como admin. Usa una URL de imagen.', 'error');
            return;
          }

          const formData = { name, description, price, stock, image: finalImageUrl };
          if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Guardando...'; }
          try {
            if (id) {
              await updateProduct(id, formData);
            } else {
              await addProduct(formData);
            }
            closeProductModal();
            form.reset();
            document.getElementById('product-image-preview')?.classList.add('hidden');
          } catch (err) {
            if (!(err && err.data && err.data.error)) toast('Error al guardar el producto.', 'error');
          } finally {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
          }
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalText; }
        }
      });
    }
  }

  /**
   * Inicializa las acciones rápidas del administrador
   */
  function initAdminActions() {
    // Limpiar carrito
    const btnLimpiar = document.getElementById('btn-limpiar-carrito');
    if (btnLimpiar) {
      btnLimpiar.addEventListener('click', () => {
        if (confirm('¿Estás seguro de limpiar todo el carrito?')) {
          clearCart();
          updateAdminStats();
          toast('Carrito limpiado', 'success');
        }
      });
    }

    // Exportar datos (desde API si hay backend, si no desde localStorage)
    const btnExportar = document.getElementById('btn-exportar-datos');
    if (btnExportar) {
      btnExportar.addEventListener('click', async () => {
        if (useBackend && adminToken && typeof window.ProyectWebAPI !== 'undefined') {
          try {
            const data = await window.ProyectWebAPI.getAdminExport(adminToken);
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `proyectweb-datos-${Date.now()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            toast('Datos exportados correctamente', 'success');
            return;
          } catch (_) {}
        }
        const data = { productos: PRODUCTS, carrito: cart, pedidos: getOrders(), fecha: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proyectweb-datos-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('Datos exportados correctamente', 'success');
      });
    }

    // Resetear productos
    const btnReset = document.getElementById('btn-reset-productos');
    if (btnReset) {
      btnReset.addEventListener('click', () => {
        if (useBackend) {
          toast('En modo servidor, el reset se hace desde backend', 'info');
          return;
        }
        if (!confirm('Esto borrará cambios y restaurará catálogo original. ¿Continuar?')) return;
        PRODUCTS = [...DEFAULT_PRODUCTS];
        saveProducts(PRODUCTS);
        renderCatalog(document.getElementById('catalog-grid'));
        renderAdminProductsTable();
        updateAdminStats();
        toast('Catálogo restaurado', 'success');
      });
    }
  }

  /**
   * Inicialización principal: carga productos (API o local), carrito, UI y mensaje de pago si aplica.
   */
  async function init() {
    cart = getCart();
    const catalogGrid = document.getElementById('catalog-grid');
    if (catalogGrid) renderCatalogSkeleton(catalogGrid);
    await detectBackend();
    if (isDev) console.debug('[init] useBackend=', useBackend, 'demo=', isDemoMode());

    adminToken = localStorage.getItem(STORAGE_ADMIN_TOKEN) || null;
    clientToken = localStorage.getItem(STORAGE_CLIENT_TOKEN) || null;
    await restoreSession();
    updateAuthUI();
    if (useBackend && clientToken) renderMisPedidos();
    if (useBackend && adminToken) {
      await refreshAdminOrders();
      updateAdminStats();
    }

    try {
      const list = await loadProducts();
      PRODUCTS = list;
    } catch (_) {
      PRODUCTS = getProductsSync();
    }
    updateCartBadges();
    initMenu();
    initLoginModal();
    initCartDrawer();
    initCheckoutModal();
    initContactForm();
    initRegisterModal();
    initProductModal();
    initMpInfoModal();
    initProductImagePreview();
    initAdminActions();
    initUserModal();
    initAdminUserDeleteDelegation();
    initOrderDetailModal();
    initPaymentResult();
    renderCartDrawer();

    if (catalogGrid) renderCatalog(catalogGrid);
    if (isAdmin()) {
      await refreshAdminOrders();
      await refreshAdminStats();
    }
  }

  // Disponibilidad global para el chatbot: funciones que ejecutarAccionChat() puede llamar
  window.renderProducts = function() {
    const el = document.getElementById('productos') || document.getElementById('catalogo');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const grid = document.getElementById('catalog-grid');
    if (grid) renderCatalog(grid);
  };
  window.abrirModalRegistro = openRegisterModal;
  window.abrirCarrito = openCartDrawer;
  window.mostrarEstadisticasAdmin = function() {
    refreshAdminStats();
    scrollToSection('vista-admin');
  };

  window.agregarAlCarrito = function(id) {
    if (!id) return false;
    return addToCart(id, 1);
  };

  window.mostrarSeccionProductos = function() {
    if (typeof scrollToCatalogAndRefresh === 'function') scrollToCatalogAndRefresh();
    if (typeof renderCatalog === 'function') {
      const grid = document.getElementById('catalog-grid');
      if (grid) renderCatalog(grid);
    }
    const el = document.getElementById('productos') || document.getElementById('catalogo');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window.mostrarSoporte = function() {
    if (typeof scrollToSection === 'function') {
      scrollToSection('contacto');
      setTimeout(function() { scrollToSection('footer'); }, 1200);
    }
  };

  window.abrirVentanaPagoStripe = openStripePaymentWindow;

  return {
    init,
    getCart: () => cart,
    getCartTotal,
    getCartCount,
    addToCart,
    removeFromCart,
    setQuantity,
    openCartDrawer,
    openCheckoutModal,
    openRegisterModal,
    openStripeInfoModal,
    openMercadoPagoInfoModal: openStripeInfoModal,
    scrollToSection,
    scrollToCatalogAndRefresh,
    refreshAdminStats,
    refreshAdminUsers,
    initAdminUserDeleteDelegation,
    renderMisPedidos,
    toast,
  };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', function() {
  App.init();
});
