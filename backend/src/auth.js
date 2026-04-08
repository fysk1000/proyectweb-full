import jwt from 'jsonwebtoken';

/** Duración del JWT (p. ej. "2h", "15m"). Por defecto 2 horas. */
const DEFAULT_JWT_EXPIRES = '2h';

export function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET missing or too short (min 16 chars)');
  }
  const expiresIn = (process.env.JWT_EXPIRES_IN && String(process.env.JWT_EXPIRES_IN).trim()) || DEFAULT_JWT_EXPIRES;
  /** Cuentas antiguas sin isVerified se consideran verificadas; solo bloquea isVerified === false */
  const emailVerified = user.isVerified !== false;
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name, emailVerified },
    secret,
    { expiresIn }
  );
}

function rejectIfEmailNotVerified(payload, res) {
  if (payload && payload.emailVerified === false) {
    return res.status(403).json({
      error: 'Por favor, verifica tu correo antes de iniciar sesión',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  return null;
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) {
    return res.status(401).json({
      error: 'No autorizado',
      message: 'Se requiere un token Bearer en la cabecera Authorization.',
      code: 'AUTH_REQUIRED'
    });
  }
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      message: 'JWT no configurado correctamente en el servidor.'
    });
  }
  try {
    const payload = jwt.verify(token, secret);
    const denied = rejectIfEmailNotVerified(payload, res);
    if (denied) return denied;
    req.user = payload;
    return next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: 'No autorizado',
      message: expired
        ? 'El token de sesión ha expirado. Vuelve a iniciar sesión.'
        : 'Token inválido o alterado. Vuelve a iniciar sesión.',
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
    });
  }
}

export function adminRequired(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'No autorizado',
      message: 'Sesión no válida.',
      code: 'AUTH_REQUIRED'
    });
  }
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'No permitido',
      message: 'Se requiere rol de administrador.',
      code: 'FORBIDDEN_ADMIN'
    });
  }
  return next();
}

/**
 * Si no hay cabecera Authorization, continúa con req.bearerUser = null (invitado).
 * Si hay Bearer y el token es inválido o expiró, responde 401 (mismo cuerpo que authRequired).
 * Si el token es válido, req.bearerUser = { id, email, name, role } desde el payload JWT.
 */
export function optionalBearerAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    req.bearerUser = null;
    return next();
  }
  const token = header.slice(7).trim();
  if (!token) {
    req.bearerUser = null;
    return next();
  }
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    return res.status(503).json({
      error: 'Servicio no configurado',
      message: 'JWT no configurado correctamente en el servidor.'
    });
  }
  try {
    const payload = jwt.verify(token, secret);
    const denied = rejectIfEmailNotVerified(payload, res);
    if (denied) return denied;
    req.bearerUser = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role
    };
    return next();
  } catch (err) {
    const expired = err && err.name === 'TokenExpiredError';
    return res.status(401).json({
      error: 'No autorizado',
      message: expired
        ? 'El token de sesión ha expirado. Vuelve a iniciar sesión.'
        : 'Token inválido o alterado. Vuelve a iniciar sesión.',
      code: expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'
    });
  }
}
