/**
 * Cuentas de WebBox OS: contraseñas con scrypt y sesiones firmadas (HMAC-SHA256).
 * Sin dependencias: solo "node:crypto".
 *
 * - Las contraseñas nunca se guardan: solo su hash con sal aleatoria (scrypt).
 * - La sesión es un token firmado que dura SESSION_DAYS y deja de valer si el usuario se
 *   borra o cambia su contraseña (el token lleva una huella del hash vigente).
 */
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

export const ROLES = ['admin', 'user'];
const USERNAME = /^[a-z0-9._-]{3,32}$/;
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

/** Usuario en minúsculas, o null si no es válido. */
export function normalizeUsername(value) {
  if (typeof value !== 'string') return null;
  const clean = value.trim().toLowerCase();
  return USERNAME.test(clean) ? clean : null;
}

/** @returns {string|null} mensaje de error, o null si es válida */
export function passwordProblem(value) {
  if (typeof value !== 'string') return 'La contraseña debe ser texto.';
  if (value.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (value.length > PASSWORD_MAX) return `La contraseña admite como máximo ${PASSWORD_MAX} caracteres.`;
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, keyB64] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Hash de relleno: se compara contra él cuando el usuario no existe, para no delatar si existe. */
let dummyHash = null;
export async function verifyAgainstDummy(password) {
  dummyHash ??= await hashPassword('relleno-que-nunca-coincide');
  await verifyPassword(password, dummyHash);
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fingerprint = (passHash) => createHash('sha256').update(String(passHash)).digest('base64url').slice(0, 12);

/** Token de sesión firmado para un usuario { id, hash }. */
export function signSession(user, secret, days = 30, now = Date.now()) {
  const payload = b64url(JSON.stringify({ u: user.id, f: fingerprint(user.hash), e: now + days * 86_400_000 }));
  const sig = b64url(createHmac('sha256', secret).update(payload).digest());
  return `${payload}.${sig}`;
}

/** @returns {{userId:number, fp:string}|null} null si la firma o la fecha no valen */
export function readSession(token, secret, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!Number.isInteger(data.u) || typeof data.f !== 'string' || !(data.e > now)) return null;
    return { userId: data.u, fp: data.f };
  } catch {
    return null;
  }
}

/** ¿La huella del token coincide con la contraseña actual del usuario? */
export const sessionMatches = (session, user) => session.fp === fingerprint(user.hash);

export const publicUser = (u) => ({ id: u.id, username: u.username, role: u.role });
