# Checklist de pruebas — Admin CRUD

Verificación del panel de administrador: usuarios, productos y pedidos. Sin reestructurar diseño ni rutas.

---

## Requisitos previos

- Backend levantado: `cd backend && npm run dev`
- Usuario admin: `admin@proyectweb.local` / `admin123` (o ejecutar `npm run seed`)
- Abrir: http://localhost:5050/ (o /frontend/index.html) e iniciar sesión como admin

---

## 1. Usuarios (listar / crear / editar / desactivar / reset contraseña)

| # | Paso | Resultado esperado |
|---|------|--------------------|
| 1.1 | Login como admin → ir a sección "Gestión de Usuarios" | Tabla con columnas: Email, Nombre, Rol, Estado, Acciones. Lista de usuarios cargada desde GET /api/admin/users. |
| 1.2 | Clic en "Nuevo usuario" | Se abre modal con campos: Email, Contraseña, Nombre, Rol (Cliente/Administrador). |
| 1.3 | Rellenar email, contraseña (mín. 6), nombre, rol Cliente → Guardar | POST /api/admin/users 201. Toast "Usuario creado". Tabla se actualiza con el nuevo usuario. Modal se cierra. |
| 1.4 | Clic en "Editar" de un usuario (no admin) | Modal con título "Editar usuario". Campos rellenados; sin campo contraseña. |
| 1.5 | Cambiar nombre y/o email y/o rol → Guardar | PUT /api/admin/users/:id 200. Toast "Usuario actualizado". Tabla actualizada. |
| 1.6 | Clic en "Desactivar" de un usuario | PUT con { active: false }. Toast "Usuario desactivado". Estado pasa a "Inactivo". |
| 1.7 | Con ese usuario desactivado, intentar login en otra pestaña/ventana | Login devuelve 401 "Cuenta desactivada". |
| 1.8 | Clic en "Activar" del mismo usuario | PUT con { active: true }. Toast "Usuario activado". Estado "Activo". |
| 1.9 | Clic en "Reset contraseña" | Aparece prompt para nueva contraseña. Al introducir mín. 6 caracteres: POST /api/admin/users/:id/reset-password 200. Toast "Contraseña actualizada". |

---

## 2. Productos (crear / editar / eliminar / imagen / stock)

| # | Paso | Resultado esperado |
|---|------|--------------------|
| 2.1 | En "Gestión de Productos" comprobar tabla | Columnas: ID, Nombre, Precio, **Stock**, Acciones (Editar, Eliminar). |
| 2.2 | Clic en "Nuevo Producto" | Modal con: Nombre, Precio, **Stock**, Descripción, Imagen (subir archivo o URL). |
| 2.3 | Rellenar todos los campos (incl. URL de imagen o subir archivo) → Guardar | POST /api/admin/products 201. Toast "Producto agregado". Tabla y catálogo actualizados. Stock visible en tabla. |
| 2.4 | Subir imagen (archivo JPG/PNG/WebP, &lt; 3 MB) en nuevo producto | POST /api/uploads/image 200 → url. Esa URL se usa en el producto. Imagen se ve en catálogo. |
| 2.5 | Clic en "Editar" de un producto | Modal con datos actuales; Stock editable. |
| 2.6 | Cambiar stock (ej. 5) y guardar | PUT /api/admin/products/:id 200. Tabla muestra nuevo stock. |
| 2.7 | Clic en "Eliminar" → confirmar | DELETE (soft) 200. Toast "Producto eliminado". Producto deja de aparecer en tabla y en catálogo. |

---

## 3. Pedidos (listar / ver detalle / tracking y reflejo en cliente)

| # | Paso | Resultado esperado |
|---|------|--------------------|
| 3.1 | En "Pedidos recientes" | Lista de pedidos (ID, fecha, cliente, total, estado). Cada uno con inputs "Paquetería" y "Número de guía" y botón "Guardar guía". Botón "Ver detalle". |
| 3.2 | Clic en "Ver detalle" de un pedido | GET /api/orders/:id. Modal con: Fecha, Estado, Cliente (nombre, email, teléfono, dirección), Total, Guía (si existe), listado de productos. |
| 3.3 | Rellenar Paquetería (ej. DHL) y Número de guía → "Guardar guía" | PUT /api/admin/orders/:id/tracking 200. Toast "Guía guardada". El mismo pedido muestra la guía en el bloque. |
| 3.4 | Iniciar sesión como **cliente** que hizo ese pedido → ir a "Mis pedidos" | El pedido aparece con la misma guía (Paquetería y número). Texto tipo "Paquetería: DHL · Guía: XXXXX". |

---

## 4. Resumen de endpoints usados

| Recurso | Método | Ruta | Uso |
|---------|--------|------|-----|
| Usuarios | GET | /api/admin/users | Listar (admin) |
| Usuarios | POST | /api/admin/users | Crear (admin) |
| Usuarios | PUT | /api/admin/users/:id | Editar / activar-desactivar (admin) |
| Usuarios | POST | /api/admin/users/:id/reset-password | Reset contraseña (admin) |
| Productos | POST | /api/admin/products | Crear (admin) |
| Productos | PUT | /api/admin/products/:id | Editar (admin) |
| Productos | DELETE | /api/admin/products/:id | Eliminar soft (admin) |
| Imagen | POST | /api/uploads/image | Subir imagen (admin) |
| Pedidos | GET | /api/orders | Listar (admin: todos; cliente: propios) |
| Pedidos | GET | /api/orders/:id | Detalle (admin o dueño) |
| Tracking | PUT | /api/admin/orders/:id/tracking | Actualizar guía (admin) |

---

## 5. Criterios de éxito

- **Usuarios:** listar, crear, editar, desactivar/activar y reset contraseña funcionan con la API; usuarios desactivados no pueden hacer login.
- **Productos:** crear, editar (incl. stock), eliminar y subir imagen; columna Stock visible en tabla admin.
- **Pedidos:** listar, ver detalle (modal con GET /api/orders/:id), guardar tracking; el cliente ve la guía en "Mis pedidos".
