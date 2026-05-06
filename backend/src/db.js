import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Configuramos el __dirname para ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ruta LowDB: DB_URL o DB_PATH desde process.env, o data.json por defecto
const DB_PATH =
  (process.env.DB_URL && String(process.env.DB_URL).trim()) ||
  (process.env.DB_PATH && String(process.env.DB_PATH).trim()) ||
  path.join(__dirname, '..', 'data.json');

const defaultData = {
  users: [],
  products: [],
  orders: [],
  contact_messages: [],
  mp_notifications: []
};

export async function openDb() {
  const adapter = new JSONFile(DB_PATH);
  const db = new Low(adapter, defaultData);
  await db.read();
  db.data ||= { ...defaultData };
  await db.write();
  return db;
}

export function ensureUploadsDir() {
  // También corregimos la ruta de las imágenes para que se guarden en 'backend/uploads'
  const dir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}