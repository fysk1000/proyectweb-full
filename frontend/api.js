/**
 * ProyectWebAPI
 * Adaptador Frontend -> Backend
 * - Mantiene el contrato que ya usa script.js
 */
(function(){
  /** Vacío = mismo origen (recomendado en Render u otro despliegue unificado). */
  const DEFAULT_BASE = '';

  function getBase(){
    try {
      if (window.__ENV__ && window.__ENV__.API_BASE) return String(window.__ENV__.API_BASE).replace(/\/$/, '');
      const ls = localStorage.getItem('proyectweb_api_base');
      if (ls) return String(ls).replace(/\/$/, '');
    } catch(_) {}
    return DEFAULT_BASE;
  }

  async function request(path, { method='GET', token=null, json=null, form=null, signal=null, credentials='omit' } = {}){
    const base = getBase();
    const url = base + path;
    const headers = {};
    let body;

    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (json) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (form) {
      body = form;
    }

    const res = await fetch(url, { method, headers, body, credentials, signal: signal || undefined });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const err = new Error((data && (data.error || data.message)) || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // ---- API pública: firmas usadas por script.js ----
  window.ProyectWebAPI = {
    getBase,

    getProducts() {
      return request('/api/products');
    },

    register(email, password, name, captcha) {
      return request('/api/auth/register', {
        method: 'POST',
        json: { email, password, name: name || '', captcha: captcha != null ? String(captcha) : '' },
        credentials: 'include'
      });
    },

    login(email, password, captcha) {
      return request('/api/auth/login', {
        method: 'POST',
        json: { email, password, captcha: captcha != null ? String(captcha) : '' },
        credentials: 'include'
      });
    },

    verify2FA(email, code) {
      return request('/api/auth/verify-2fa', { method: 'POST', json: { email, code } });
    },

    getMe(token) {
      return request('/api/auth/me', { token });
    },

    createOrderAndPayment(token, payload) {
      return request('/api/orders', { method: 'POST', token, json: payload });
    },

    /** Crea una sesión de Stripe Checkout y devuelve la URL de pago (modo prueba). */
    createCheckoutSession(items, token) {
      return request('/api/checkout', { method: 'POST', token: token || undefined, json: { items } });
    },

    getMyOrders(token) {
      return request('/api/my/orders', { token });
    },

    getOrders(token) {
      return request('/api/orders', { token });
    },

    getOrderById(token, id) {
      return request('/api/orders/' + encodeURIComponent(id), { token });
    },

    getAdminStats(token) {
      return request('/api/admin/stats', { token });
    },

    getAdminExport(token) {
      return request('/api/admin/export', { token });
    },

    createProduct(payload, token) {
      return request('/api/admin/products', { method: 'POST', json: payload, token });
    },

    updateProduct(id, payload, token) {
      return request('/api/admin/products/' + encodeURIComponent(id), { method: 'PUT', json: payload, token });
    },

    deleteProduct(id, token) {
      return request('/api/admin/products/' + encodeURIComponent(id), { method: 'DELETE', token });
    },

    uploadImage(file, token) {
      const form = new FormData();
      form.append('image', file);
      return request('/api/uploads/image', { method: 'POST', form, token });
    },

    updateOrderTracking(token, orderId, carrier, trackingNumber) {
      return request('/api/admin/orders/' + encodeURIComponent(orderId) + '/tracking', {
        method: 'PUT',
        token,
        json: { carrier, tracking_number: trackingNumber }
      });
    },

    getAdminUsers(token) {
      return request('/api/admin/users', { token });
    },

    createUser(payload, token) {
      return request('/api/admin/users', { method: 'POST', json: payload, token });
    },

    updateUser(id, payload, token) {
      return request('/api/admin/users/' + encodeURIComponent(id), { method: 'PUT', json: payload, token });
    },

    resetUserPassword(id, newPassword, token) {
      return request('/api/admin/users/' + encodeURIComponent(id) + '/reset-password', {
        method: 'POST',
        token,
        json: { newPassword }
      });
    },

    deleteUser(id, token) {
      return request('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE', token });
    },

    sendContact(payload) {
      return request('/api/contact', { method: 'POST', json: payload });
    },

    chat(message, token, userContext, options) {
      const body = { message: String(message || ''), token: token || undefined };
      if (userContext && typeof userContext === 'object') {
        body.userContext = { role: userContext.role, name: userContext.name };
      }
      return request('/api/chat', { method: 'POST', json: body, signal: (options && options.signal) || null });
    }
  };
})();
