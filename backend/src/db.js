import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data.json');

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
  const dir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
