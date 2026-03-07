# ProyectWeb — Checklist de entrega

## Requisitos

- **Node.js** 18+ (recomendado 20 LTS)
- Navegador moderno
- (Opcional) Extensión Live Server si prefieres abrir el front por separado; por defecto el front se abre desde el backend.

---

## Cómo correr el proyecto

### Backend

```bash
cd backend
npm install
cp .env.example .env
# Editar .env: JWT_SECRET (mín. 16 caracteres) y opcionales (MP, SMTP, etc.)
npm run dev
```

- **URL:** http://localhost:5050  
- **Health:** http://localhost:5050/api/health  

### Seed (crear admin y productos de ejemplo)

```bash
cd backend
npm run seed
```

Crea/actualiza el usuario admin y productos de ejemplo en `backend/data.json`.

### Frontend (servido por el mismo backend — sin Live Server)

El backend sirve la carpeta `frontend` en la ruta `/frontend`. No hace falta Live Server.

1. Con el backend levantado (`npm run dev` en `backend`), abre en el navegador:
   - **http://localhost:5050/** (redirige a `/frontend/index.html`)
   - o **http://localhost:5050/frontend/index.html**
2. El catálogo carga productos desde `GET /api/products`.
3. Las imágenes en `/uploads/*` se sirven desde el mismo origen (ej. `http://localhost:5050/uploads/...`).

*(Opcional: si quieres usar Live Server en otro puerto, añade esa URL en `backend/.env` como `FRONTEND_URL` para CORS.)*

---

## Flujo demo

### 1) Login admin

- En el frontend, clic en **Login**.
- Usuario: `admin@proyectweb.local`  
- Contraseña: `admin123`  
- Enviar.

**Ejemplo de payload (API):**

```json
POST http://localhost:5050/api/auth/login
Content-Type: application/json

{
  "email": "admin@proyectweb.local",
  "password": "admin123"
}
```

También se aceptan: `usuario`/`password`, `correo`/`contrasena`, etc. Respuesta incluye `token` y `user` (con `role: "ADMIN"`).

---

### 2) Crear producto con imagen (upload)

- Con sesión de admin, ir al **Panel de Administrador**.
- **Nuevo Producto**.
- Completar: nombre, precio, stock, descripción.
- **Subir imagen:** elegir archivo (JPG/PNG/WebP, máx. 3 MB) o pegar URL.
- **Guardar**. El backend devuelve la URL de la imagen subida y se asocia al producto.

---

### 3) Ver catálogo y carrito

- Ir a **Catálogo** (o sección correspondiente).
- Comprobar que los productos se listan con imagen, precio y botón **Añadir al carrito**.
- Añadir varios productos al carrito y abrir el **Carrito** (icono). Verificar subtotal y cantidades.

---

### 4) Editar y eliminar producto

- En el panel admin, tabla **Gestión de Productos**.
- **Editar:** clic en Editar de un producto, cambiar datos o imagen (subir otra o URL), Guardar.
- **Eliminar:** clic en Eliminar, confirmar. El producto deja de mostrarse en el catálogo.

---

### 5) Exportar datos y resetear catálogo

- En **Acciones Rápidas** del panel admin:
  - **Exportar datos:** descarga un JSON con productos, carrito, pedidos y fecha.
  - **Resetear productos:** restaura el catálogo por defecto (pide confirmación). Los productos añadidos se pierden.

---

## URLs de referencia

| Recurso        | URL                          |
|----------------|------------------------------|
| Backend        | http://localhost:5050        |
| Health (rápido)| http://localhost:5050/health |
| API health     | http://localhost:5050/api/health |
| Frontend       | http://localhost:5050/ o http://localhost:5050/frontend/index.html |
| Login          | POST http://localhost:5050/api/auth/login |
| Imágenes       | http://localhost:5050/uploads/... |

---

## Credenciales demo

| Rol    | Email                     | Contraseña |
|--------|---------------------------|------------|
| Admin  | admin@proyectweb.local    | admin123   |

El seed crea este usuario si no existe y actualiza rol y contraseña.

---

## Cómo probar (sin Live Server)

1. **Levantar backend:** `cd backend && npm run dev`
2. **Abrir en el navegador:** http://localhost:5050/
   - La raíz redirige a `/frontend/index.html`.
3. **Comprobar:**
   - El catálogo carga productos desde `GET /api/products`.
   - Las imágenes de productos en `/uploads/*` se ven (misma origen: `http://localhost:5050/uploads/...`).
   - Health rápido: http://localhost:5050/health → `{"ok":true}`.

No hace falta Live Server; todo funciona abriendo solo http://localhost:5050/.

---

## Checkout real (paso a paso)

1. Backend levantado y usuario **cliente** logueado.
2. Añadir productos al carrito → **Finalizar compra** (o **Pagar con Mercado Pago** si aplica).
3. Rellenar nombre, email, teléfono, dirección → **Confirmar pedido**.
4. El front llama a **POST /api/orders** con `{ customer, items, total }`; si el backend devuelve `paymentUrl` o `init_point`, se redirige a Mercado Pago.
5. Tras pagar/cancelar, MP redirige a `?mp=success|pending|failure&orderId=...`. El front consulta **GET /api/orders/:id** y muestra en el modal **Pedido** y **Total** reales; solo en `mp=success` se vacía el carrito.

**Cómo activar modo demo:** abrir la web con **?demo=1** (ej. `http://localhost:5050/frontend/index.html?demo=1`). Solo entonces, si el backend no está disponible, se permite “Confirmar pedido” y se simula una compra local; el modal mostrará la etiqueta **MODO DEMO**. Sin `?demo=1`, si no hay backend se muestra: *Conecta el backend para realizar la compra.*

Ver **docs/CONTACT-EMAIL.md** para configurar el envío de email del formulario de contacto (SMTP_USER, SMTP_PASS, CONTACT_TO).
