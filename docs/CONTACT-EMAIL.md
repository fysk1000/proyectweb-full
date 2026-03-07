# Formulario de contacto — Enviar email

El formulario **Contáctanos** llama a **POST /api/contact** con `{ name, email, message }`. El backend valida con Zod y envía un correo a `CONTACT_TO` usando nodemailer (SMTP).

## Configurar .env (backend)

En `backend/.env` (copiar desde `backend/.env.example` y rellenar):

```env
# Dirección que recibe los mensajes del formulario
CONTACT_TO=alejandrofys01@gmail.com

# SMTP (Gmail: smtp.gmail.com, puerto 587)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false

# Cuenta desde la que se envía
SMTP_USER=tu_correo@gmail.com

# Contraseña de aplicación (App Password), no la contraseña de la cuenta.
# En Gmail: Cuenta Google → Seguridad → Contraseñas de aplicaciones → generar una.
SMTP_PASS=xxxx xxxx xxxx xxxx
```

| Variable     | Descripción |
|-------------|-------------|
| **CONTACT_TO** | Email donde recibir los mensajes (ej. `alejandrofys01@gmail.com`) |
| **SMTP_USER**  | Email del remitente (ej. tu Gmail) |
| **SMTP_PASS**  | App Password del proveedor (Gmail: Seguridad → Contraseñas de aplicaciones) |
| **SMTP_HOST**  | Servidor SMTP (ej. `smtp.gmail.com`) |
| **SMTP_PORT**  | Puerto (587 para TLS, 465 para SSL) |

Si falta `CONTACT_TO` o alguna variable SMTP, el backend responde **503** con mensaje de configuración. Si todo está bien, **200** `{ "ok": true }`. El frontend muestra toast de éxito o error.
