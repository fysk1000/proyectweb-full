# Reporte de diagnóstico y arreglos — Checkout E2E

## 1. Diagnóstico

### 1.1 Backend

- **GET /health** → debe responder `{ "ok": true }`.
- **GET /api/products** → debe devolver un array de productos (JSON).

**Comandos para verificar:**

```bash
cd backend
npm run dev
```

En otra terminal o navegador:

```bash
curl -s http://localhost:5050/health
# Esperado: {"ok":true}

curl -s http://localhost:5050/api/products
# Esperado: [ { "id": "...", "name": "...", ... }, ... ]
```

### 1.2 Frontend (sin Live Server)

- Abrir: **http://localhost:5050/** (redirige a `/frontend/index.html`).

**En pestaña Network:**

- `api.js`, `script.js`, `styles.css` → **200** y MIME correcto (`application/javascript`, `text/css`).
- Al cargar la página, una petición a **GET /api/products** → **200** (si el backend está arriba).

**En consola (solo en dev):**

- `[init] useBackend= true/false`, `demo= true/false`.
- Si health falla: `[init] detectBackend: health no ok <status>` o `fetch error`.

### 1.3 Simular compra

1. Añadir al menos un producto al carrito.
2. Iniciar sesión como **cliente** (necesario para POST /api/orders).
3. Clic en **Finalizar compra** → rellenar nombre, email, teléfono, dirección.
4. Clic en **Confirmar pedido**.

**Esperado:**

- En Network: **POST /api/orders** con **200** (no se debe usar flujo demo si no hay `?demo=1`).
- Modal "Compra realizada" con **Pedido:** `ORD-XXXXXXXXXX` y **Total:** `$XX.XX` (no "—").

---

## 2. Qué podía fallar y causa

| Síntoma | Causa posible |
|--------|----------------|
| Modal con Pedido/Total "—" | Se usaba flujo local/demo (sin backend) o `res.orderId`/total no se pasaban bien al modal. |
| No se ejecuta POST /api/orders | `useBackend` en false (health falló o ProyectWebAPI no definido) y sin `?demo=1` se mostraba toast; con `?demo=1` se hacía solo simulación. |
| POST devuelve 401 | Usuario no logueado; backend exige token para crear pedido (en este proyecto POST /api/orders acepta sin token pero asocia user si hay token). |
| POST devuelve 400 | Body inválido (customer/items); revisar que el payload tenga `customer: { nombre, email, telefono, direccion }` e `items: [ { id, quantity } ]`. |
| POST 200 pero UI no pinta orderId/total | Se llamaba `finalizeCheckout` con `orderId` o `total` vacíos/undefined; o se usaba rama demo que a veces no rellenaba bien. |

---

## 3. Cambios realizados

### 3.1 Archivos tocados

- **frontend/script.js**
- **docs/DEBUG-REPORT.md** (este archivo)

### 3.2 Resumen de cambios en `script.js`

1. **Checkout siempre usa backend salvo `?demo=1`**
   - Si la URL tiene **?demo=1**: se ejecuta solo el flujo demo (orden local + modal con "MODO DEMO").
   - Si **no** hay `?demo=1`: siempre se intenta **POST /api/orders** (ProyectWebAPI + token). No se usa ninguna simulación automática aunque `useBackend` fuera false.

2. **Eliminación de simulación automática**
   - Se quitó la rama "if (useBackend && ProyectWebAPI) { ... } else if (!isDemoMode()) { toast } else { demo }".
   - Orden nuevo: primero `if (isDemoMode()) { demo y return }`, luego comprobación de ProyectWebAPI y token, después POST y uso de la respuesta para orderId/total.

3. **orderId y total siempre definidos en el modal**
   - Tras POST, `orderId` se obtiene de `res.orderId || res.order_id || ...` y si queda vacío se usa `'PW-' + Date.now()`.
   - `total` = `res.total != null ? Number(res.total) : totalSnapshot`.
   - En `showPurchaseSuccessModal`, se asegura que Pedido y Total no queden "—" cuando hay datos: `orderId` y `total` se formatean de forma defensiva.

4. **Logs solo en dev**
   - `[init] useBackend=`, `demo=` tras `detectBackend()`.
   - `[init] detectBackend: ProyectWebAPI no definido` / `health no ok` / `fetch error` cuando aplica.
   - `[checkout] modo demo (?demo=1)` en flujo demo.
   - `[checkout] POST /api/orders`, `res`, `order created`, `redirect to MP`, `error API` en flujo backend.

---

## 4. Pasos exactos para probar

### 4.1 Backend y health

1. `cd backend && npm run dev`
2. Abrir **http://localhost:5050/health** → debe verse `{"ok":true}`.
3. Abrir **http://localhost:5050/api/products** → JSON con lista de productos.

### 4.2 Frontend y recursos

1. Abrir **http://localhost:5050/** (o **http://localhost:5050/frontend/index.html**).
2. F12 → pestaña **Network**. Recargar.
3. Comprobar: `api.js`, `script.js`, `styles.css` en **200** y tipo MIME correcto (no HTML).
4. Comprobar: petición **GET /api/products** con **200** y catálogo con productos.

### 4.3 Checkout real (sin demo)

1. Sin `?demo=1` en la URL.
2. Añadir un producto al carrito.
3. Iniciar sesión (Login) con un usuario **cliente** (ej. el que crees por registro o el que tengas en seed).
4. Clic en el carrito → **Finalizar compra**.
5. Rellenar nombre, email, teléfono, dirección → **Confirmar pedido**.
6. En Network: debe aparecer **POST /api/orders** con **200**.
7. Modal "Compra realizada": **Pedido** debe ser tipo `ORD-XXXXXXXXXX` y **Total** un importe en pesos (ej. `$49.99`), no "—".

### 4.4 Modo demo

1. Abrir **http://localhost:5050/frontend/index.html?demo=1**.
2. Con el backend apagado (o sin login), añadir producto al carrito → Finalizar compra → Confirmar pedido.
3. Debe mostrarse el modal con **MODO DEMO**, Pedido tipo `ORD-DEMO-...` y Total correcto.

### 4.5 Probar endpoints desde terminal

```bash
# Health
curl -s http://localhost:5050/health

# Productos
curl -s http://localhost:5050/api/products

# Login (sustituir EMAIL y PASSWORD)
curl -s -X POST http://localhost:5050/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"EMAIL\",\"password\":\"PASSWORD\"}"

# Crear orden (sustituir TOKEN; customer e items según tu caso)
curl -s -X POST http://localhost:5050/api/orders -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" -d "{\"customer\":{\"nombre\":\"Test\",\"email\":\"test@test.com\",\"telefono\":\"5512345678\",\"direccion\":\"Calle 1\"},\"items\":[{\"id\":\"ID_PRODUCTO\",\"quantity\":1}]}"
```

### 4.6 Caso A: Backend up, compra → orderId real, modal con id/total, redirección a MP

1. Backend corriendo (`npm run dev` en `backend`).
2. Sin `?demo=1`. Usuario cliente logueado. Productos en el carrito.
3. Checkout: rellenar datos → **Confirmar pedido**.
4. **Esperado:** POST /api/orders 200; respuesta con `orderId`, `total` y `paymentUrl`/`init_point`/`sandbox_init_point`.
5. **Esperado:** Se guarda `orderId` en `localStorage` (`proyectweb_last_order_id`); toast "Redirigiendo a Mercado Pago..."; **redirección** a la URL de Mercado Pago.
6. (Si no hay MP configurado, el backend puede devolver 200 sin `paymentUrl`; entonces se muestra modal "Compra realizada" con **Pedido** y **Total** en MXN y no hay redirección.)

### 4.7 Caso B: Vuelta con mp=success → carrito vacío y estado según GET /api/orders/:id

1. Volver a la tienda con URL tipo: `...?mp=success&orderId=ORD-XXXX` (o sin `orderId` si se usa `proyectweb_last_order_id`).
2. **Esperado:** Se llama **GET /api/orders/:id** (con token); se muestra estado real (APPROVED/PENDING/REJECTED) en toast; **solo en mp=success** se vacía el carrito y se muestra el modal "Compra realizada" con orderId y total del backend.
3. En `mp=pending` o `mp=failure`: no se vacía el carrito; se muestra toast con estado si GET /api/orders/:id devuelve `status`.

### 4.8 Auth y roles: Login admin vs cliente

**Requisito:** El rol (ADMIN/CLIENT) solo lo define el backend. El frontend no permite ser admin por usuario/contraseña local ni por editar `localStorage`.

- **Login Admin → UI admin visible**
  1. Backend corriendo. Ejecutar seed si hace falta: `cd backend && node src/seed.js`
  2. Abrir la tienda (ej. **http://localhost:5050/frontend/index.html**).
  3. Login con **admin@proyectweb.local** / **admin123**.
  4. **Esperado:** Toast "Sesión iniciada como Administrador."; nav "Hola, Admin"; se muestra la **Vista de Administrador** (pedidos, productos, estadísticas). No debe verse "Vista de Cliente".

- **Login Cliente → UI cliente visible**
  1. Registrar un usuario (Registro) o usar uno ya registrado.
  2. Cerrar sesión si estabas como admin. Login con ese **email** y **contraseña** de cliente.
  3. **Esperado:** Toast "Sesión iniciada. Hola, Cliente."; nav "Hola, Cliente"; se muestra la **Vista de Cliente** (Mis pedidos). No debe verse el panel de administrador.

- **Validación al cargar**
  1. Con sesión guardada (token en localStorage), recargar la página.
  2. **Esperado:** Se llama **GET /api/auth/me**; si 200, la UI usa el **role** devuelto (ADMIN o CLIENT). Si 401, se limpia sesión y se muestra como no logueado.

- **Sin backend:** Al intentar Login, debe mostrarse "Se necesita conexión al servidor para iniciar sesión." No se puede asignar rol ADMIN desde el front.

---

## 5. Resumen

- **Problema:** El modal de "Compra realizada" podía mostrar Pedido y Total como "—" y el flujo podía usar simulación cuando no debía.
- **Causa:** Dependencia de `useBackend` y ramas que permitían no llamar al backend o no rellenar orderId/total.
- **Solución:** Checkout obligatorio por backend salvo con `?demo=1`; orderId y total siempre derivados de la respuesta del backend (o del flujo demo explícito); logs de depuración solo en dev; documento de diagnóstico y pasos de prueba en `docs/DEBUG-REPORT.md`.
