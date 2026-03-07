# Checklist de pruebas para entrega

Usar en orden. Incluye comandos y URLs de ejemplo (ajustar puerto/host si cambian).

---

## 1. Levantar backend

```bash
cd backend
npm install
npm run dev
# o: npm start / node src/server.js
```

- **URL API:** `http://localhost:5050` (o el puerto en `.env` `PORT`).
- Comprobar: `GET http://localhost:5050/health` o `GET http://localhost:5050/api/health` → `{"ok":true}`.
- **Frontend (sin Live Server):** abrir http://localhost:5050/ → redirige a `/frontend/index.html`; JS/CSS se sirven desde el mismo backend.

---

## 2. Seed (datos iniciales)

Si existe script de seed:

```bash
cd backend
npm run seed
# o el comando que tengáis documentado
```

Si no hay seed: crear al menos un usuario admin y productos desde el panel o vía API/DB.

---

## 3. Login admin / cliente

- **Frontend:** abrir `http://127.0.0.1:5500/frontend/index.html` (Live Server) o la URL que uses.
- **Login admin:** email/contraseña de un usuario con `role: admin` → debe aparecer botón “Admin” y redirigir a `admin.html`.
- **Login cliente:** email/contraseña con `role: cliente` → no debe aparecer “Admin”; “Mi cuenta” / pedidos según esté implementado.

**API (opcional):**

```bash
curl -X POST http://localhost:5050/api/auth/login -H "Content-Type: application/json" -d "{\"email\":\"admin@ejemplo.com\",\"password\":\"TU_PASSWORD\"}"
```

---

## 4. CRUD productos + upload imagen

- Abrir **Admin** → sección **Productos**.
- Crear producto (nombre, precio, stock, categoría, imagen si aplica).
- Editar y eliminar (o desactivar) un producto.
- Subir imagen si el flujo lo permite (PUT/POST con multipart o URL de imagen según backend).

**API (ejemplo):**

```bash
# Listar (requiere token admin)
curl -H "Authorization: Bearer ADMIN_TOKEN" http://localhost:5050/api/products
```

---

## 5. Crear orden + checkout Mercado Pago

- En el frontend: añadir productos al carrito → **Pagar con Mercado Pago** (solo visible con backend y usuario logueado).
- Completar checkout (nombre, email, teléfono, dirección) → redirección a Mercado Pago (`init_point`).
- Pagar en sandbox de MP (tarjeta de prueba) o cancelar para probar failure.

**URLs de retorno (backend debe configurarlas con `FRONTEND_PUBLIC_URL`):**

- Success: `{FRONTEND_URL}/frontend/index.html?mp=success&orderId=ORD-...`
- Failure: `...?mp=failure&orderId=...`
- Pending: `...?mp=pending&orderId=...`

---

## 6. Retorno success / failure / pending

- Tras pagar (o cancelar), MP redirige a `index.html?mp=success|failure|pending&orderId=...`.
- **Success:** debe mostrar confirmación de compra y vaciar carrito.
- **Failure / pending:** mensaje adecuado; no vaciar carrito en pending (según reglas de negocio).

---

## 7. Webhook Mercado Pago (con ngrok)

Solo si se usa notificación en tiempo real (no solo retorno al navegador):

1. Exponer el backend con ngrok:
   ```bash
   ngrok http 5050
   ```
2. En el panel de Mercado Pago (o en la preferencia): URL de notificación = `https://TU_SUBDOMINIO.ngrok.io/api/mp/webhook` (o la ruta configurada con `MP_WEBHOOK_PATH`).
3. Realizar un pago de prueba y comprobar en logs del backend que llega el POST y se actualiza el pedido (estado APPROVED, stock, etc.).

---

## 8. Admin pedidos + tracking

- En **Admin** → **Pedidos**: listar pedidos, ver detalle, cambiar estado (PENDING → APPROVED, etc.).
- Añadir **tracking** (número de guía / mensaje) si el endpoint existe (ej. `PUT /api/admin/tracking` o similar).
- Comprobar que el cliente ve el pedido en “Mis pedidos” cuando corresponda.

---

## 9. Admin usuarios CRUD

- **Admin** → **Usuarios**: listar, crear (email, nombre, contraseña, rol), editar (nombre, email, rol, activo), desactivar, reset de contraseña.
- No debe permitir desactivarse a sí mismo (ni eliminarse) desde la UI/API.

**API (ejemplo):**

```bash
curl -H "Authorization: Bearer ADMIN_TOKEN" http://localhost:5050/api/admin/users
```

---

## Modo demo sin backend (recomendación)

- Si existe un modo “solo frontend” sin API (carrito/checkout simulado), que quede **detrás de un flag claro**, por ejemplo:
  - `DEMO_MODE=true` en `.env` del frontend, o
  - `?demo=1` en la URL, o
  - detección explícita: sin `VITE_API_URL` / sin health del backend → `useBackend = false`.
- **No debe** activarse solo por fallo de red ni sobrescribir comportamiento cuando el backend está arriba (health OK → siempre usar backend).

---

## Resumen rápido de URLs

| Recurso        | URL ejemplo |
|----------------|-------------|
| Backend health | `http://localhost:5050/api/health` |
| Frontend       | `http://127.0.0.1:5500/frontend/index.html` |
| Admin panel    | `http://127.0.0.1:5500/frontend/admin.html` |
| MP webhook     | `https://xxx.ngrok.io/api/mp/webhook` |
