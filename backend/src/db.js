import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Configuramos el __dirname para ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LA CLAVE: Subimos un nivel desde 'src' para encontrar 'data.json' en la raíz de 'backend'
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.json');

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