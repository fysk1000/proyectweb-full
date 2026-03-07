import jwt from 'jsonwebtoken';

export function signToken(user) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('JWT_SECRET missing or too short (min 16 chars)');
  }
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    secret,
    { expiresIn: '7d' }
  );
}

export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

export function adminRequired(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'No autorizado' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'No permitido' });
  return next();
}
