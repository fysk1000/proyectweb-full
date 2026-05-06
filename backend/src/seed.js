import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { openDb } from './db.js';

function nowISO() {
  return new Date().toISOString();
}
function centsFromMXN(val) {
  return Math.round(Number(val) * 100);
}

const db = await openDb();
await db.read();

db.data ||= { users: [], products: [], orders: [], contact_messages: [], mp_notifications: [] };

const adminEmail = 'admin@proyectweb.local';
const adminName = 'Admin ProyectWeb';
const adminPassword = 'admin123';

let admin = db.data.users.find(u => u.email === adminEmail);
if (!admin) {
  const password_hash = await bcrypt.hash(adminPassword, 10);
  admin = {
    id: nanoid(),
    email: adminEmail,
    name: adminName,
    password_hash,
    role: 'admin',
    isVerified: true,
    verificationToken: null,
    created_at: nowISO()
  };
  db.data.users.push(admin);
  console.log('Admin creado:', adminEmail, 'pass:', adminPassword);
} else {
  let updated = false;
  if (String(admin.role || '').toLowerCase() !== 'admin') {
    admin.role = 'admin';
    updated = true;
  }
  const match = await bcrypt.compare(adminPassword, admin.password_hash || '');
  if (!match) {
    admin.password_hash = await bcrypt.hash(adminPassword, 10);
    updated = true;
  }
  if (admin.name !== adminName) {
    admin.name = adminName;
    updated = true;
  }
  if (updated) console.log('Admin actualizado:', adminEmail);
}

if ((db.data.products || []).length === 0) {
  const ts = nowISO();
  db.data.products = [
    { name: 'Auriculares inalámbricos', price: 49.99, stock: 10, description: 'Sonido envolvente y cancelación de ruido. Hasta 20h de batería.', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&h=300&fit=crop' },
    { name: 'Teclado mecánico RGB', price: 89.99, stock: 8, description: 'Switches mecánicos, retroiluminación RGB y reposamuñecas magnético.', image: 'https://images.unsplash.com/photo-1511467687858-23d96c32e4ae?w=400&h=300&fit=crop' }
  ].map(d => ({
    id: nanoid(),
    name: d.name,
    description: d.description,
    price_cents: centsFromMXN(d.price),
    stock: d.stock,
    image_url: d.image,
    active: true,
    created_at: ts,
    updated_at: ts
  }));
  console.log('Productos seed insertados');
}

await db.write();
