// ── Almacén local (IndexedDB) — POS "La Lupita" (offline) ───────────────────
// Base de datos de la tienda en ESTA computadora. Un object store por cada
// "tabla" del producto oficial (mismos nombres/columnas), para mantener el hilo
// con la nube y permitir sincronización futura 1:1.
//
// Todo es local y persistente: no hay red, no hay nube. El riesgo es real: si se
// daña/formatea la máquina se pierde todo → por eso existe exportarTodo/importarTodo
// (respaldo a .json). Recomendar respaldar seguido a USB o a la nube.

const DB = "pos-lupita-local";
const VER = 3;
let _db = null;

// Definición de stores: keyPath e índices. El filtrado/orden general se hace en
// JS con getAll (el catálogo de una tienda es chico); los índices solo cubren lo
// que se consulta dentro de la transacción de venta o en accesos frecuentes.
const STORES = {
  productos: { keyPath: "id" },
  presentaciones: { keyPath: "id", indices: { by_producto: "producto_id" } },
  combos: { keyPath: "id" },
  combo_items: { keyPath: "id", indices: { by_combo: "combo_id" } },
  promociones: { keyPath: "id" },
  promocion_presentaciones: { keyPath: ["promocion_id", "presentacion_id"], indices: { by_promocion: "promocion_id" } },
  lotes: { keyPath: "id", indices: { by_producto: "producto_id" } },
  perfiles: { keyPath: "id", indices: { by_nombre: "nombre" } },
  turnos: { keyPath: "id", indices: { by_cajero: "cajero_id" } },
  ventas: { keyPath: "id", indices: { by_turno: "turno_id", by_fecha: "fecha" } },
  venta_detalle: { keyPath: "id", indices: { by_venta: "venta_id" } },
  venta_pagos: { keyPath: "id", indices: { by_venta: "venta_id" } },
  movimientos_inventario: { keyPath: "id", indices: { by_producto: "producto_id", by_fecha: "fecha" } },
  movimientos_caja: { keyPath: "id", indices: { by_turno: "turno_id" } },
  // Devoluciones/cancelaciones (equivale a las tablas homónimas del oficial).
  devoluciones: { keyPath: "id", indices: { by_venta: "venta_id", by_fecha: "fecha" } },
  devolucion_detalle: { keyPath: "id", indices: { by_devolucion: "devolucion_id", by_venta_detalle: "venta_detalle_id" } },
  // Configuración de la tienda (fila única id=1); la lee/mergea lib/config-runtime.js.
  configuracion: { keyPath: "id" },
};

export const NOMBRES_STORE = Object.keys(STORES);

function abrir() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const [nombre, def] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(nombre)) continue;
        const s = db.createObjectStore(nombre, { keyPath: def.keyPath });
        for (const [idx, campo] of Object.entries(def.indices || {})) s.createIndex(idx, campo);
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function db() { return _db || (_db = await abrir()); }
function pedir(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }

// ── Helpers simples (una sola operación) ─────────────────────────────────────
export async function getAll(store) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readonly");
    pedir(tx.objectStore(store).getAll()).then(res, rej);
  });
}
export async function get(store, k) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readonly");
    pedir(tx.objectStore(store).get(k)).then(res, rej);
  });
}
export async function put(store, v) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    const rq = tx.objectStore(store).put(v);
    tx.oncomplete = () => res(rq.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
export async function del(store, k) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
export async function contar(store) { return (await getAll(store)).length; }

// ── Transacción multi-store (para atomicidad de la venta) ───────────────────
// fn recibe un `api` con métodos que devuelven Promesas encadenadas SOBRE la
// misma transacción. Es crítico no `await` nada fuera de estas promesas dentro de
// fn, o la transacción de IndexedDB se auto-cierra. Si fn lanza, la tx se aborta
// (rollback) y conTx rechaza.
export async function conTx(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    let tx;
    try { tx = d.transaction(stores, mode); }
    catch (e) { rej(e); return; }
    const api = {
      get: (store, k) => pedir(tx.objectStore(store).get(k)),
      getAll: (store) => pedir(tx.objectStore(store).getAll()),
      porIndice: (store, indice, valor) => pedir(tx.objectStore(store).index(indice).getAll(valor)),
      add: (store, v) => pedir(tx.objectStore(store).add(v)),
      put: (store, v) => pedir(tx.objectStore(store).put(v)),
      del: (store, k) => pedir(tx.objectStore(store).delete(k)),
    };
    let salida;
    Promise.resolve()
      .then(() => fn(api))
      .then((v) => { salida = v; })
      .catch((e) => { try { tx.abort(); } catch { /* noop */ } rej(e); });
    tx.oncomplete = () => res(salida);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error || new Error("Transacción abortada"));
  });
}

// ── Respaldo (exportar / importar toda la base) ─────────────────────────────
export async function exportarTodo() {
  const data = {};
  for (const store of NOMBRES_STORE) data[store] = await getAll(store);
  return { formato: "pos-lupita-local", version: VER, exportado_en: new Date().toISOString(), data };
}

/** Reemplaza TODA la base con el contenido del respaldo. Borra lo actual primero. */
export async function importarTodo(json) {
  const data = json?.data;
  if (!data || typeof data !== "object") throw new Error("Archivo de respaldo inválido: falta 'data'.");
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(NOMBRES_STORE, "readwrite");
    for (const store of NOMBRES_STORE) {
      const os = tx.objectStore(store);
      os.clear();
      for (const fila of data[store] || []) os.put(fila);
    }
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

/** Borra TODA la base (deja la tienda en cero). No se puede deshacer. */
export async function borrarTodo() {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(NOMBRES_STORE, "readwrite");
    for (const store of NOMBRES_STORE) tx.objectStore(store).clear();
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
export const ahoraISO = () => new Date().toISOString();
export const hoyFecha = () => new Date().toISOString().slice(0, 10);
