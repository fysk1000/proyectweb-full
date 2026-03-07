# ProyectWeb — Full Stack (Frontend + Backend + Mercado Pago)

## 1) Local (para validar todo hoy)

### Backend
```bash
cd backend
npm install
cp .env.example .env
# pega MP_ACCESS_TOKEN y JWT_SECRET
npm run seed
npm run dev
```
Backend: http://localhost:5050

### Frontend
Abre `frontend/index.html` con Live Server (VS Code) en:
- http://localhost:3000

> Si tu Live Server usa otro puerto, cambia `FRONTEND_URL` en `backend/.env`.

## 2) Credenciales demo
- Admin: `admin@proyectweb.local` / `admin123`

## 3) Mercado Pago (Checkout Pro)
- `MP_ACCESS_TOKEN` va SOLO en backend.
- Webhook: `BACKEND_PUBLIC_URL + MP_WEBHOOK_PATH`.

En local, Mercado Pago no siempre pega al webhook si no es URL pública.
Para pruebas reales de webhook usa **ngrok** o deploy.

## 4) Contacto por correo
Configura SMTP en `backend/.env`.

### Gmail (recomendado para rápido)
- Activa 2FA
- Crea App Password
- Ponlo en `SMTP_PASS`

## 5) Deploy recomendado (simple)

### Backend (Render o Railway)
- Sube la carpeta `backend` como servicio Node.
- Variables:
  - `PORT=5050` (Render lo pone solo)
  - `NODE_ENV=production`
  - `JWT_SECRET=...`
  - `MP_ACCESS_TOKEN=...`
  - `FRONTEND_URL=https://tu-frontend...`
  - `BACKEND_PUBLIC_URL=https://tu-backend...`
  - `CONTACT_TO=alejandrofys01@gmail.com`
  - SMTP si usarás correo

### Frontend (Netlify o Vercel)
- Sube `frontend/` como sitio estático.
- En `frontend/api.js` puedes setear la base desde consola del navegador:
  ```js
  localStorage.setItem('proyectweb_api_base', 'https://tu-backend...');
  ```

