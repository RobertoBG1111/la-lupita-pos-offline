// ── Autenticación y sesión LOCAL — POS "La Lupita" (offline) ────────────────
// Login sin correo y sin nube: el usuario entra con nombre + contraseña. Se busca
// su perfil por nombre en IndexedDB y se verifica la contraseña contra un hash
// PBKDF2 (Web Crypto) guardado localmente. La sesión vive solo en memoria.

import { getAll, get, put, contar, nuevoId, ahoraISO } from "./almacen.js";

// ── Hash de contraseña (PBKDF2 / Web Crypto) ────────────────────────────────
// Igual que el cache.js del producto oficial: SHA-256, 100k iteraciones, salt de
// 16 bytes. Nunca se guarda la contraseña en claro.
async function derivar(password, saltBytes) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const desb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function hashNuevo(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: b64(salt), password_hash: await derivar(password, salt) };
}
async function verificarHash(password, perfilRow) {
  if (!perfilRow?.salt || !perfilRow?.password_hash) return false;
  const hash = await derivar(password, desb64(perfilRow.salt));
  return hash === perfilRow.password_hash;
}

// ── Estado de sesión ─────────────────────────────────────────────────────────
// La sesión vive en memoria, pero recordamos el id del último usuario en
// localStorage para restaurarla al recargar (como el POS oficial). El hash de la
// contraseña NUNCA se guarda fuera de IndexedDB.
const CLAVE_SESION = "pos-lupita-sesion";
let _sesion = null; // { perfil: {id, nombre, rol, activo} }
const _oyentes = new Set();
export function alCambiarSesion(fn) { _oyentes.add(fn); return () => _oyentes.delete(fn); }
function notificar() { for (const fn of _oyentes) { try { fn(_sesion); } catch (e) { console.warn(e); } } }

export function sesion() { return _sesion; }
export function perfil() { return _sesion?.perfil ?? null; }
export function rol() { return _sesion?.perfil?.rol ?? null; }
export const esAdmin = () => rol() === "admin";
export const esCajero = () => rol() === "cajero";

// Perfil "público" (sin hash/salt) para exponer en la sesión y a las pantallas.
function publico(row) {
  if (!row) return null;
  return { id: row.id, nombre: row.nombre, rol: row.rol, activo: row.activo, created_at: row.created_at, desactivado_en: row.desactivado_en ?? null };
}

async function buscarPorNombre(nombre) {
  const objetivo = String(nombre).trim().toLowerCase();
  const todos = await getAll("perfiles");
  return todos.find((p) => String(p.nombre).trim().toLowerCase() === objetivo) || null;
}

// ── Bootstrap: primer admin ──────────────────────────────────────────────────
export async function bootstrapNecesario() {
  try { return (await contar("perfiles")) === 0; } catch { return false; }
}

export async function crearPrimerAdmin(nombre, password) {
  const n = String(nombre).trim();
  if (!n) return { ok: false, error: "Escribe un nombre." };
  if (!password || password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  if (!(await bootstrapNecesario())) return { ok: false, error: "Ya existe al menos un usuario." };
  const { salt, password_hash } = await hashNuevo(password);
  const row = { id: nuevoId(), nombre: n, rol: "admin", activo: true, desactivado_en: null, created_at: ahoraISO(), salt, password_hash };
  await put("perfiles", row);
  return { ok: true, perfil: publico(row) };
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function entrar(nombre, password) {
  const row = await buscarPorNombre(nombre);
  if (!row || !(await verificarHash(password, row))) return { ok: false, error: "Nombre o contraseña incorrectos." };
  if (row.activo === false) return { ok: false, error: "Tu cuenta está desactivada. Contacta al administrador." };
  _sesion = { perfil: publico(row) };
  try { localStorage.setItem(CLAVE_SESION, row.id); } catch { /* modo privado: no persiste */ }
  notificar();
  return { ok: true, perfil: _sesion.perfil };
}

export async function salir() {
  _sesion = null;
  try { localStorage.removeItem(CLAVE_SESION); } catch { /* noop */ }
  notificar();
}

// Restaura la sesión del último usuario (si su perfil sigue activo). Se llama al
// arrancar la app; tolerante a fallos (si no hay nada guardado, no hace nada).
export async function iniciarSesionPersistida() {
  let id = null;
  try { id = localStorage.getItem(CLAVE_SESION); } catch { /* noop */ }
  if (!id) return null;
  const row = await get("perfiles", id).catch(() => null);
  if (!row || row.activo === false) { try { localStorage.removeItem(CLAVE_SESION); } catch { /* noop */ } return null; }
  _sesion = { perfil: publico(row) };
  notificar();
  return _sesion.perfil;
}

// ── Gestión de usuarios (solo admin; la pantalla Usuarios lo verifica) ──────
// Mismas 3 acciones que consume usuarios.js: crear / set_activo / reset_password.
export async function crearUsuario({ nombre, rol: rolNuevo, password }) {
  const n = String(nombre).trim();
  if (!n) return { ok: false, error: "Escribe el nombre del integrante." };
  if (!password || password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  if (rolNuevo !== "admin" && rolNuevo !== "cajero") return { ok: false, error: "Rol inválido." };
  if (await buscarPorNombre(n)) return { ok: false, error: "Ya existe un usuario con ese nombre." };
  const { salt, password_hash } = await hashNuevo(password);
  const row = { id: nuevoId(), nombre: n, rol: rolNuevo, activo: true, desactivado_en: null, created_at: ahoraISO(), salt, password_hash };
  await put("perfiles", row);
  return { ok: true, perfil: publico(row) };
}

export async function setUsuarioActivo(nombre, activo) {
  const row = await buscarPorNombre(nombre);
  if (!row) return { ok: false, error: "Usuario no encontrado." };
  row.activo = !!activo;
  row.desactivado_en = activo ? null : ahoraISO();
  await put("perfiles", row);
  return { ok: true };
}

export async function resetPassword(nombre, password) {
  const row = await buscarPorNombre(nombre);
  if (!row) return { ok: false, error: "Usuario no encontrado." };
  if (!password || password.length < 6) return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  const { salt, password_hash } = await hashNuevo(password);
  row.salt = salt; row.password_hash = password_hash;
  await put("perfiles", row);
  return { ok: true };
}
