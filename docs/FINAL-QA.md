# QA final — ProyectWeb

Proyecto alineado entre backend y frontend. Sin reestructurar carpetas ni cambiar diseño.

---

## 1. Levantar el backend

```bash
cd backend
npm install
cp .env.example .env
# Editar .env: JWT_SECRET (mín. 16 caracteres), opcional: MERCADOPAGO_ACCESS_TOKEN, FRONTEND_PUBLIC_URL, CONTACT_TO, SMTP_*
npm run dev
```

- Backend: **http://localhost:5050**
- Health: **http://localhost:5050/health** → `{"ok":true}`

---

## 2. URL de prueba del frontend

**http://localhost:5050/frontend/index.html**

(La raíz http://localhost:5050/ puede redirigir a esta URL.)

---

## 3. Credenciales

| Rol     | Email                     | Contraseña |
|--------|---------------------------|------------|
| Admin  | admin@proyectweb.local    | admin123   |

Crear admin si no existe:

```bash
cd backend
node src/seed.js
```

Clientes: registrarse desde el front (Registrarse) o crear desde panel admin.

---

## 4. Probar login (admin y cliente)

1. Abrir **http://localhost:5050/frontend/index.html**
2. **Login admin:** Login → `admin@proyectweb.local` / `admin123` → Entrar.
   - Debe verse "Hola, Admin" y el **Panel de Administrador** (estadísticas, productos, usuarios, pedidos).
3. Cerrar sesión (Salir).
4. **Login cliente:** Registrarse con email, contraseña y nombre → luego Login con ese email/contraseña.
   - Debe verse "Hola, Cliente" y la sección **Mis pedidos** (sin panel admin).

---

## 5. Probar CRUD usuarios (admin)

1. Login como admin.
2. En **Gestión de Usuarios**:
   - **Listar:** tabla con Email, Nombre, Rol, Estado, Acciones.
   - **Crear:** "Nuevo usuario" → email, contraseña (mín. 6), nombre, rol → Guardar. Debe aparecer en la tabla.
   - **Editar:** "Editar" en un usuario → cambiar nombre/email/rol → Guardar.
   - **Desactivar:** "Desactivar" → el usuario pasa a Inactivo y no puede hacer login.
   - **Activar:** "Activar" en usuario inactivo.
   - **Reset contraseña:** "Reset contraseña" → introducir nueva contraseña (mín. 6) → el usuario puede entrar con la nueva.
3. No se puede desactivar la cuenta con la que estás logueado (error claro).

---

## 6. Probar CRUD productos (admin)

1. Login como admin.
2. **Gestión de Productos:**
   - **Crear:** "Nuevo Producto" → nombre, precio, stock, descripción, imagen (URL o subir archivo) → Guardar. Debe verse en tabla y en catálogo.
   - **Editar:** "Editar" en un producto → cambiar datos/stock/imagen → Guardar.
   - **Eliminar:** "Eliminar" → confirmar. El producto deja de verse en tabla y catálogo (soft delete).
3. Columna **Stock** visible en la tabla.

---

## 7. Probar checkout y Mercado Pago

1. Login como **cliente**.
2. Añadir productos al carrito → **Finalizar compra** (o "Pagar con Mercado Pago" si aplica).
3. Rellenar nombre, email, teléfono, dirección → **Confirmar pedido**.
4. **Si Mercado Pago está configurado** (MERCADOPAGO_ACCESS_TOKEN y FRONTEND_PUBLIC_URL en .env):
   - No debe mostrarse el modal "Compra realizada".
   - Debe mostrarse toast "Pedido creado. Redirigiendo a Mercado Pago...".
   - Redirección a la URL de pago de MP.
   - El carrito **no** se vacía hasta volver con `?mp=success`.
5. **Al volver con ?mp=success&orderId=...**:
   - Se consulta GET /api/orders/:id.
   - Se muestra el modal "Compra realizada" con orderId y total.
   - El carrito se vacía.
6. **Al volver con ?mp=pending o ?mp=failure**: no se vacía el carrito; toast informativo.

---

## 8. Probar webhook (Mercado Pago)

- El webhook es **idempotente**: el stock se descuenta **una sola vez** por orden (campo `stock_deducted`).
- Estados MP: `approved` → APPROVED, `rejected`/`cancelled`/`refunded` → REJECTED, otros → PENDING.
- En APPROVED: si `stock_deducted` es false, se descuenta stock, se pone `stock_deducted = true` y `paid_at`.
- Para simular: enviar POST a **http://localhost:5050/api/mp/webhook** con el payload que envía MP (o usar la URL pública del backend si está desplegado). En local, MP puede no poder llamar al webhook; ver documentación de MP para pruebas.

---

## 9. Probar contacto (formulario y SMTP)

1. Ir a **Contáctanos**.
2. Rellenar nombre, email y mensaje → Enviar.
3. **Si SMTP está configurado** (CONTACT_TO, SMTP_HOST, SMTP_USER, SMTP_PASS en .env): respuesta 200, toast de éxito.
4. **Si no está configurado:** respuesta 503, toast de error indicando configurar .env.

---

## 10. Checklist manual breve

- [ ] Backend levanta y /health responde ok.
- [ ] Frontend carga en http://localhost:5050/frontend/index.html.
- [ ] Login admin muestra panel admin.
- [ ] Login cliente muestra "Mis pedidos", no panel admin.
- [ ] Admin: listar/crear/editar/desactivar/activar/reset contraseña de usuarios.
- [ ] Admin: crear/editar/eliminar productos; columna Stock; subir imagen.
- [ ] Admin: listar pedidos, ver detalle, guardar guía de envío.
- [ ] Cliente: checkout con payload correcto; si hay paymentUrl, redirección a MP sin vaciar carrito; en vuelta con mp=success se vacía carrito y se muestra modal de éxito.
- [ ] Formulario de contacto envía y responde según configuración SMTP.

---

## Archivos modificados en esta alineación

| Archivo | Cambios |
|---------|---------|
| **frontend/api.js** | Firmas alineadas con script.js: getBase, getProducts, register(email, password, name), login, getMe, createOrderAndPayment, getMyOrders, getOrders, getOrderById, getAdminStats, getAdminExport, createProduct, updateProduct, deleteProduct, uploadImage, updateOrderTracking, getAdminUsers, createUser, updateUser, resetUserPassword, sendContact. Eliminado setOrderTracking. |
| **frontend/script.js** | Checkout: payload solo customer { nombre, email, telefono, direccion } e items [{ id, quantity }]; paymentMethod solo si mercadopago. Si hay paymentUrl: no modal "Compra realizada", solo toast "Pedido creado. Redirigiendo a Mercado Pago...", no vaciar carrito, redirección 1.5s. |
| **backend/src/server.js** | Órdenes: al crear se añade stock_deducted: false y paid_at: null; status inicial PENDING (mayúsculas). Webhook: mapeo de estados MP (approved→APPROVED, rejected/cancelled/refunded→REJECTED, otros→PENDING); solo si APPROVED y !stock_deducted se descuenta stock y se pone stock_deducted=true y paid_at. Tracking: status a SHIPPED (mayúsculas). Admin usuarios: no permitir desactivar la cuenta propia (403). |
| **docs/FINAL-QA.md** | Este documento: pasos para levantar backend, URL de prueba, credenciales, cómo probar login, CRUD usuarios, CRUD productos, checkout MP, webhook y contacto; checklist breve. |
