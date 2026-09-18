// ── Acceso a datos LOCAL — POS "La Lupita" (offline) ────────────────────────
// Misma API (nombres y firmas) que el lib/db.js del producto oficial, pero contra
// IndexedDB local en vez de Supabase. La lógica de negocio que en la nube vivía en
// triggers de Postgres (FEFO, total, afectación de stock, validación de pagos) se
// reimplementa aquí. Las estructuras que se devuelven imitan las que producían los
// `select` anidados de Supabase, para que las pantallas no cambien.

import { getAll, get, put, del, conTx, nuevoId, ahoraISO, hoyFecha } from "./almacen.js";
import { perfil } from "./auth.js";
import { CONFIG } from "../config.js";
import { getConfig } from "./config-runtime.js";

// Depósitos vigentes por clave de envase (desde la config de la tienda). Con
// respaldo a los defaults de config.js por si config-runtime aún no cargó.
function depositosPorClave() {
  const lista = (getConfig?.().ENVASES) || CONFIG.ENVASES || [];
  return new Map(lista.map((t) => [t.clave, Number(t.deposito) || 0]));
}

export const yo = () => perfil();

// ── Utilidades de enriquecimiento (joins manuales en JS) ────────────────────
const porId = (filas) => new Map(filas.map((f) => [f.id, f]));
const num = (x) => Number(x) || 0;

// Reconstruye el objeto `presentaciones` anidado (con su `productos`) tal como lo
// devolvía Supabase, para las pantallas que leen p.presentaciones?.productos?.nombre.
function presAnidada(presId, presById, prodById) {
  const pr = presById.get(presId);
  if (!pr) return null;
  const prod = prodById.get(pr.producto_id);
  return { nombre: pr.nombre, precio: pr.precio, productos: prod ? { nombre: prod.nombre, categoria: prod.categoria } : null };
}

// Categorías conocidas = semilla (config) ∪ las ya usadas por algún producto.
// Así la lista "crece": una categoría nueva se recuerda en cuanto se guarda un
// producto con ella.
export async function categoriasConocidas() {
  const usadas = (await getAll("productos")).map((p) => p.categoria).filter(Boolean);
  const set = new Map(); // clave en minúsculas → etiqueta original (evita duplicados por mayúsculas)
  for (const c of [...(CONFIG.CATEGORIAS || []), ...usadas]) {
    const k = String(c).trim().toLowerCase();
    if (k && !set.has(k)) set.set(k, String(c).trim());
  }
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

// ── Catálogo para la pantalla de Venta ──────────────────────────────────────
export async function catalogoVenta() {
  const [productos, presentaciones, promociones, promocionPresentaciones, combos, comboItems] = await Promise.all([
    getAll("productos"), getAll("presentaciones"), getAll("promociones"),
    getAll("promocion_presentaciones"), getAll("combos"), getAll("combo_items"),
  ]);
  return {
    productos: productos.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)),
    presentaciones: presentaciones.filter((p) => p.activo),
    promociones: promociones.filter((p) => p.activo),
    promocionPresentaciones,
    combos: combos.filter((c) => c.activo),
    comboItems,
  };
}

// ── Turnos ───────────────────────────────────────────────────────────────────
export async function turnoActivoDe(cajeroId) {
  const turnos = (await getAll("turnos"))
    .filter((t) => t.cajero_id === cajeroId && t.activo)
    .sort((a, b) => String(b.abierto_en).localeCompare(String(a.abierto_en)));
  const t = turnos[0];
  return t ? { id: t.id, abierto_en: t.abierto_en, activo: t.activo, fondo_inicial: num(t.fondo_inicial) } : null;
}

export async function abrirTurno(cajeroId, fondoInicial = 0) {
  const existente = await turnoActivoDe(cajeroId);
  if (existente) return existente;
  const row = { id: nuevoId(), cajero_id: cajeroId, abierto_en: ahoraISO(), cerrado_en: null, activo: true, fondo_inicial: num(fondoInicial), created_at: ahoraISO() };
  await put("turnos", row);
  return { id: row.id, abierto_en: row.abierto_en, activo: row.activo, fondo_inicial: row.fondo_inicial };
}

export async function cerrarTurno(turnoId) {
  const t = await get("turnos", turnoId);
  if (!t) throw new Error("Turno no encontrado.");
  t.activo = false; t.cerrado_en = ahoraISO();
  await put("turnos", t);
}

// v_resumen_turno: total_vendido = Σ ventas.total del turno; los totales por método
// se agregan desde venta_pagos POR SEPARADO para no inflar el total.
export async function resumenTurno(turnoId) {
  const [turno, ventasAll, pagosAll, cajaAll, devsAll] = await Promise.all([
    get("turnos", turnoId), getAll("ventas"), getAll("venta_pagos"), getAll("movimientos_caja"), getAll("devoluciones")]);
  const ventas = ventasAll.filter((v) => v.turno_id === turnoId);
  const ids = new Set(ventas.map((v) => v.id));
  const pagos = pagosAll.filter((p) => ids.has(p.venta_id));
  const porMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const p of pagos) porMetodo[p.metodo_pago] = (porMetodo[p.metodo_pago] || 0) + num(p.monto);
  const fondo = num(turno?.fondo_inicial);
  const caja = cajaAll.filter((m) => m.turno_id === turnoId);
  const entradas = caja.filter((m) => m.tipo === "entrada").reduce((s, m) => s + num(m.monto), 0);
  const salidas = caja.filter((m) => m.tipo === "salida").reduce((s, m) => s + num(m.monto), 0);
  // Devoluciones del turno (reembolso siempre en efectivo → sale del cajón).
  const devoluciones = devsAll.filter((d) => d.turno_id === turnoId).reduce((s, d) => s + num(d.total), 0);
  const total_vendido = ventas.reduce((s, v) => s + num(v.total), 0);
  return {
    turno_id: turnoId,
    num_ventas: ventas.length,
    total_vendido,
    total_efectivo: porMetodo.efectivo,
    total_tarjeta: porMetodo.tarjeta,
    total_transferencia: porMetodo.transferencia,
    fondo_inicial: fondo,
    entradas_caja: entradas,
    salidas_caja: salidas,
    devoluciones_total: devoluciones,
    ventas_netas: total_vendido - devoluciones,
    // Efectivo que debería haber físicamente en el cajón al cerrar.
    efectivo_esperado: fondo + porMetodo.efectivo + entradas - salidas - devoluciones,
  };
}

// ── Movimientos de caja (entradas/salidas de dinero del cajón) ──────────────
export async function registrarMovimientoCaja({ tipo, monto, motivo, turnoId = null }) {
  if (tipo !== "entrada" && tipo !== "salida") throw new Error("Tipo de movimiento inválido.");
  const m = num(monto);
  if (!(m > 0)) throw new Error("El monto debe ser mayor a 0.");
  const row = { id: nuevoId(), turno_id: turnoId, cajero_id: perfil()?.id ?? null, tipo, monto: m, motivo: motivo || null, fecha: ahoraISO(), created_at: ahoraISO() };
  await put("movimientos_caja", row);
  return row.id;
}

export async function movimientosCajaDe(turnoId) {
  return (await getAll("movimientos_caja"))
    .filter((x) => x.turno_id === turnoId)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// ── Corte del día (por fecha de calendario, junta todos los turnos) ─────────
// Los límites se calculan en hora LOCAL (el día del mostrador) y se comparan
// contra ventas.fecha, que es UTC. cajeroId opcional: si se pasa, solo cuenta las
// ventas de ese cajero (para que un cajero vea su propio día).
function limitesDia(fecha) {
  const d = new Date(fecha);
  const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
  return { inicio, fin };
}

export async function resumenDia({ fecha = new Date(), cajeroId = null } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const [ventasAll, pagosAll] = await Promise.all([getAll("ventas"), getAll("venta_pagos")]);
  let ventas = ventasAll.filter((v) => { const t = new Date(v.fecha); return t >= inicio && t <= fin; });
  if (cajeroId) ventas = ventas.filter((v) => v.cajero_id === cajeroId);
  const ids = new Set(ventas.map((v) => v.id));
  const pagos = pagosAll.filter((p) => ids.has(p.venta_id));
  const porMetodo = { efectivo: 0, tarjeta: 0, transferencia: 0 };
  for (const p of pagos) porMetodo[p.metodo_pago] = (porMetodo[p.metodo_pago] || 0) + num(p.monto);
  // Devoluciones del día (reembolso siempre en efectivo).
  let devs = (await getAll("devoluciones")).filter((d) => { const t = new Date(d.fecha); return t >= inicio && t <= fin; });
  if (cajeroId) devs = devs.filter((d) => d.cajero_id === cajeroId);
  const devoluciones_total = devs.reduce((s, d) => s + num(d.total), 0);
  const total_vendido = ventas.reduce((s, v) => s + num(v.total), 0);
  return {
    fecha: inicio.toISOString().slice(0, 10),
    num_ventas: ventas.length,
    num_turnos: new Set(ventas.map((v) => v.turno_id).filter(Boolean)).size,
    total_vendido,
    total_efectivo: porMetodo.efectivo,
    total_tarjeta: porMetodo.tarjeta,
    total_transferencia: porMetodo.transferencia,
    devoluciones_total,
    ventas_netas: total_vendido - devoluciones_total,
  };
}

/** Líneas de venta del día (para el desglose por producto del corte del día). */
export async function detalleDia({ fecha = new Date(), cajeroId = null } = {}) {
  const { inicio, fin } = limitesDia(fecha);
  const [ventasAll, detAll, presById, prodById] = await Promise.all([
    getAll("ventas"), getAll("venta_detalle"), getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  let ventas = ventasAll.filter((v) => { const t = new Date(v.fecha); return t >= inicio && t <= fin; });
  if (cajeroId) ventas = ventas.filter((v) => v.cajero_id === cajeroId);
  const ids = new Set(ventas.map((v) => v.id));
  return detAll.filter((d) => ids.has(d.venta_id)).map((d) => ({
    cantidad: d.cantidad, subtotal: d.subtotal, descripcion: d.descripcion ?? null,
    presentaciones: presAnidada(d.presentacion_id, presById, prodById),
  }));
}

/** Líneas de venta del turno, con nombre de producto/presentación (para el corte). */
export async function detalleTurno(turnoId) {
  const ventas = (await getAll("ventas")).filter((v) => v.turno_id === turnoId);
  const ids = new Set(ventas.map((v) => v.id));
  const [detalle, presById, prodById] = await Promise.all([
    getAll("venta_detalle"), getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  return detalle.filter((d) => ids.has(d.venta_id)).map((d) => ({
    cantidad: d.cantidad, subtotal: d.subtotal, descripcion: d.descripcion ?? null,
    presentaciones: presAnidada(d.presentacion_id, presById, prodById),
    ventas: { turno_id: turnoId },
  }));
}

// ── Venta (atómica) ──────────────────────────────────────────────────────────
// lineas: [{ presentacion_id?, cantidad, precio_unitario, subtotal, combo_id?, promocion_id?, descripcion? }]
// pagos:  [{ metodo_pago, monto }]   envases: { clave: cantidad } | null
// Devuelve { id }. El depósito de envases se calcula con los montos por clave de
// la configuración vigente (getConfig().ENVASES) y se suma al total.
export async function registrarVenta({ lineas, pagos, turnoId = null, envases = null, recibidoEfectivo = 0, cambio = 0 }) {
  const cent = (x) => Math.round(num(x) * 100);
  const mapa = envases && typeof envases === "object" ? envases : {};
  const depoPorClave = depositosPorClave();
  const limpio = {};
  let depositoCent = 0;
  for (const [clave, cant] of Object.entries(mapa)) {
    const c = num(cant);
    if (c > 0) { limpio[clave] = c; depositoCent += c * cent(depoPorClave.get(clave) || 0); }
  }
  const productosCent = lineas.reduce((s, l) => s + cent(l.subtotal), 0);
  const totalCent = productosCent + depositoCent;
  const pagadoCent = pagos.reduce((s, p) => s + cent(p.monto), 0);
  if (pagadoCent !== totalCent) throw new Error("Los pagos no cuadran con el total.");

  const cajeroId = perfil()?.id ?? null;
  const ventaId = nuevoId();
  const total = totalCent / 100;
  const ahora = ahoraISO();

  await conTx(
    ["ventas", "venta_detalle", "venta_pagos", "productos", "presentaciones", "lotes", "movimientos_inventario"],
    "readwrite",
    async (api) => {
      await api.add("ventas", { id: ventaId, fecha: ahora, total, cajero_id: cajeroId, turno_id: turnoId,
        envases: limpio, deposito_envases: depositoCent / 100,
        recibido_efectivo: num(recibidoEfectivo), cambio: num(cambio), created_at: ahora });

      for (const l of lineas) {
        await api.add("venta_detalle", {
          id: nuevoId(), venta_id: ventaId, presentacion_id: l.presentacion_id ?? null,
          cantidad: num(l.cantidad), precio_unitario: num(l.precio_unitario), subtotal: num(l.subtotal),
          combo_id: l.combo_id ?? null, promocion_id: l.promocion_id ?? null,
          descripcion: l.descripcion ?? null, created_at: ahora,
        });
      }
      for (const p of pagos) {
        await api.add("venta_pagos", { id: nuevoId(), venta_id: ventaId, metodo_pago: p.metodo_pago, monto: num(p.monto), created_at: ahora });
      }

      // Afectación de inventario por línea (equivale a fn_venta_detalle_afecta_inventario).
      for (const l of lineas) {
        if (!l.presentacion_id) continue; // ventas genéricas (código 0) no tocan inventario
        const pres = await api.get("presentaciones", l.presentacion_id);
        if (!pres) continue;
        const producto = await api.get("productos", pres.producto_id);
        if (!producto) continue;
        const factor = num(pres.factor_conversion) || 1;
        let necesario = num(l.cantidad) * factor;

        if (producto.lleva_vencimiento) {
          const lotes = (await api.porIndice("lotes", "by_producto", producto.id))
            .filter((x) => num(x.cantidad) > 0)
            .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento))); // FEFO
          for (const lote of lotes) {
            if (necesario <= 0) break;
            const tomado = Math.min(num(lote.cantidad), necesario);
            if (tomado <= 0) continue;
            lote.cantidad = num(lote.cantidad) - tomado;
            await api.put("lotes", lote);
            await api.add("movimientos_inventario", { id: nuevoId(), producto_id: producto.id, tipo: "venta", cantidad: -tomado, motivo: null, fecha: ahora, lote_id: lote.id, fecha_vencimiento: null });
            necesario -= tomado;
          }
          if (necesario > 0) {
            // Faltó stock en lotes: registra el remanente sin lote (igual que la nube).
            await api.add("movimientos_inventario", { id: nuevoId(), producto_id: producto.id, tipo: "venta", cantidad: -necesario, motivo: null, fecha: ahora, lote_id: null, fecha_vencimiento: null });
          }
        } else {
          await api.add("movimientos_inventario", { id: nuevoId(), producto_id: producto.id, tipo: "venta", cantidad: -necesario, motivo: null, fecha: ahora, lote_id: null, fecha_vencimiento: null });
        }

        producto.stock_actual = num(producto.stock_actual) - num(l.cantidad) * factor;
        await api.put("productos", producto);
      }
    },
  );

  return { id: ventaId };
}

// Lista de tickets/ventas para el historial. Más recientes primero.
// cajeroId: si se pasa, solo las de ese cajero. soloHoy: solo las del día de hoy.
export async function listarVentas({ cajeroId = null, soloHoy = false, limite = 300 } = {}) {
  const [ventasAll, detAll, perfilesAll, devsAll] = await Promise.all([getAll("ventas"), getAll("venta_detalle"), getAll("perfiles"), getAll("devoluciones")]);
  const nombrePorId = new Map(perfilesAll.map((p) => [p.id, p.nombre]));
  const piezasPorVenta = new Map();
  const lineasPorVenta = new Map();
  for (const d of detAll) {
    piezasPorVenta.set(d.venta_id, (piezasPorVenta.get(d.venta_id) || 0) + num(d.cantidad));
    lineasPorVenta.set(d.venta_id, (lineasPorVenta.get(d.venta_id) || 0) + 1);
  }
  const devueltoPorVenta = new Map();
  for (const d of devsAll) devueltoPorVenta.set(d.venta_id, (devueltoPorVenta.get(d.venta_id) || 0) + num(d.total));
  let ventas = ventasAll;
  if (cajeroId) ventas = ventas.filter((v) => v.cajero_id === cajeroId);
  if (soloHoy) {
    const { inicio, fin } = limitesDia(new Date());
    ventas = ventas.filter((v) => { const t = new Date(v.fecha); return t >= inicio && t <= fin; });
  }
  return ventas
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, limite)
    .map((v) => ({
      id: v.id, fecha: v.fecha, total: v.total,
      cajero_nombre: nombrePorId.get(v.cajero_id) || "—",
      num_piezas: piezasPorVenta.get(v.id) || 0,
      num_lineas: lineasPorVenta.get(v.id) || 0,
      devuelto: devueltoPorVenta.get(v.id) || 0,
    }));
}

/** Reconstruye una venta (para el ticket) a partir de su id. */
export async function ventaCompleta(ventaId) {
  const [venta, detalleAll, pagosAll, presById, prodById] = await Promise.all([
    get("ventas", ventaId), getAll("venta_detalle"), getAll("venta_pagos"),
    getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  if (!venta) throw new Error("Venta no encontrada.");
  const detalle = detalleAll.filter((d) => d.venta_id === ventaId).map((d) => ({
    id: d.id, cantidad: d.cantidad, precio_unitario: d.precio_unitario, subtotal: d.subtotal,
    combo_id: d.combo_id, promocion_id: d.promocion_id, presentacion_id: d.presentacion_id, descripcion: d.descripcion ?? null,
    presentaciones: presAnidada(d.presentacion_id, presById, prodById),
  }));
  const pagos = pagosAll.filter((p) => p.venta_id === ventaId).map((p) => ({ metodo_pago: p.metodo_pago, monto: p.monto }));
  return {
    venta: { id: venta.id, fecha: venta.fecha, total: venta.total, turno_id: venta.turno_id, cajero_id: venta.cajero_id,
      envases: venta.envases || {}, deposito_envases: venta.deposito_envases ?? 0,
      recibido_efectivo: venta.recibido_efectivo ?? 0, cambio: venta.cambio ?? 0 },
    detalle, pagos,
  };
}

// ── Devoluciones / cancelaciones ────────────────────────────────────────────
// lineas: [{ venta_detalle_id, cantidad, reingresar }]. El reembolso es SIEMPRE en
// efectivo (sale del cajón del turno activo). Reingresa inventario salvo `reingresar:false`
// (producto dañado) o líneas genéricas (sin presentación). Devuelve { id, total }.
export async function registrarDevolucion({ ventaId, lineas, motivo = null }) {
  const cent = (x) => Math.round(num(x) * 100);
  const cajeroId = perfil()?.id ?? null;
  const turnoActivo = await turnoActivoDe(cajeroId);
  const turnoId = turnoActivo?.id ?? null;
  const devolucionId = nuevoId();
  const ahora = ahoraISO();
  let total = 0;

  await conTx(
    ["devoluciones", "devolucion_detalle", "venta_detalle", "presentaciones", "productos", "movimientos_inventario"],
    "readwrite",
    async (api) => {
      let totalCent = 0;
      const filas = [];
      for (const l of lineas) {
        const det = await api.get("venta_detalle", l.venta_detalle_id);
        if (!det) continue;
        const cantDev = num(l.cantidad);
        if (cantDev <= 0) continue;
        const unitCent = Math.round(cent(det.subtotal) / (num(det.cantidad) || 1));
        totalCent += unitCent * cantDev;
        filas.push({ det, cantDev, reingresar: l.reingresar !== false });
      }
      total = totalCent / 100;

      await api.add("devoluciones", { id: devolucionId, venta_id: ventaId, turno_id: turnoId, cajero_id: cajeroId,
        total, motivo: motivo || null, fecha: ahora, created_at: ahora });

      for (const { det, cantDev, reingresar } of filas) {
        await api.add("devolucion_detalle", { id: nuevoId(), devolucion_id: devolucionId,
          venta_detalle_id: det.id, cantidad: cantDev, reingresar, created_at: ahora });
        // Reingreso de inventario (las líneas genéricas no tienen presentación).
        if (!reingresar || !det.presentacion_id) continue;
        const pres = await api.get("presentaciones", det.presentacion_id);
        if (!pres) continue;
        const producto = await api.get("productos", pres.producto_id);
        if (!producto) continue;
        const cantidadBase = cantDev * (num(pres.factor_conversion) || 1);
        await api.add("movimientos_inventario", { id: nuevoId(), producto_id: producto.id, tipo: "devolucion",
          cantidad: cantidadBase, motivo: "Devolución", fecha: ahora, lote_id: null, fecha_vencimiento: null });
        producto.stock_actual = num(producto.stock_actual) + cantidadBase;
        await api.put("productos", producto);
      }
    },
  );

  return { id: devolucionId, total };
}

/** Cuánto se ha devuelto ya por cada línea de una venta (mapa venta_detalle_id → cantidad). */
export async function devolucionesDeVenta(ventaId) {
  const [devs, detAll] = await Promise.all([getAll("devoluciones"), getAll("devolucion_detalle")]);
  const idsDev = new Set(devs.filter((d) => d.venta_id === ventaId).map((d) => d.id));
  const porLinea = {};
  for (const d of detAll) {
    if (!idsDev.has(d.devolucion_id)) continue;
    porLinea[d.venta_detalle_id] = (porLinea[d.venta_detalle_id] || 0) + num(d.cantidad);
  }
  return porLinea;
}

// ── Configuración de la tienda (fila única id=1) ────────────────────────────
export async function obtenerConfig() {
  const row = await get("configuracion", 1);
  return row?.datos || {};
}

/** Guarda el blob de configuración (solo admin; la pantalla lo verifica). */
export async function guardarConfig(datos) {
  await put("configuracion", { id: 1, datos, updated_at: ahoraISO() });
  return true;
}

// ── Inventario ───────────────────────────────────────────────────────────────
// v_lotes_por_vencer: lotes con cantidad>0, con dias_para_vencer y estado.
function lotesPorVencer(lotes, prodById) {
  const hoy = new Date(hoyFecha() + "T00:00:00");
  return lotes.filter((l) => num(l.cantidad) > 0).map((l) => {
    const venc = new Date(String(l.fecha_vencimiento) + "T00:00:00");
    const dias = Math.ceil((venc - hoy) / 86400000);
    const estado = dias < 0 ? "vencido" : dias <= 30 ? "por_vencer" : "vigente";
    return {
      id: l.id, producto_id: l.producto_id, cantidad: l.cantidad,
      fecha_vencimiento: l.fecha_vencimiento, fecha_recepcion: l.fecha_recepcion,
      producto: prodById.get(l.producto_id)?.nombre ?? "—",
      dias_para_vencer: dias, estado,
    };
  }).sort((a, b) => a.dias_para_vencer - b.dias_para_vencer);
}

export async function inventario() {
  const [productos, presentaciones, lotes] = await Promise.all([getAll("productos"), getAll("presentaciones"), getAll("lotes")]);
  const prodById = porId(productos);
  return {
    productos: productos.sort((a, b) => a.nombre.localeCompare(b.nombre)),
    presentaciones,
    lotes: lotesPorVencer(lotes, prodById),
  };
}

export async function ultimosMovimientos(limite = 8) {
  const [movs, prodById] = await Promise.all([getAll("movimientos_inventario"), getAll("productos").then(porId)]);
  return movs.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, limite).map((m) => ({
    id: m.id, tipo: m.tipo, cantidad: m.cantidad, motivo: m.motivo, fecha: m.fecha,
    productos: { nombre: prodById.get(m.producto_id)?.nombre ?? "—" },
  }));
}

export async function lotesDe(productoId) {
  return (await getAll("lotes"))
    .filter((l) => l.producto_id === productoId && num(l.cantidad) > 0)
    .sort((a, b) => String(a.fecha_vencimiento).localeCompare(String(b.fecha_vencimiento)))
    .map((l) => ({ id: l.id, cantidad: l.cantidad, fecha_vencimiento: l.fecha_vencimiento, fecha_recepcion: l.fecha_recepcion }));
}

// Verifica que un código de barras no choque con otra presentación (excluye la
// propia, `exceptoId`). Ignora nulos. Lanza si hay conflicto.
async function verificarCodigoUnico(codigo, exceptoId = null) {
  if (!codigo) return;
  const choca = (await getAll("presentaciones")).some((p) => p.codigo_barras === codigo && p.id !== exceptoId);
  if (choca) throw new Error(`El código de barras ${codigo} ya existe.`);
}

/** Alta de producto (+ presentaciones). El stock inicial lo mete la pantalla vía registrarMovimiento. */
export async function crearProducto({ nombre, categoria, unidad_base, stock_minimo, lleva_vencimiento, retornable, tipo_envase, presentaciones }) {
  const id = nuevoId();
  const ahora = ahoraISO();
  await put("productos", {
    id, nombre, categoria: categoria || null, unidad_base: unidad_base || "pieza",
    stock_actual: 0, stock_minimo: num(stock_minimo), activo: true,
    lleva_vencimiento: !!lleva_vencimiento,
    retornable: !!retornable, tipo_envase: retornable ? (tipo_envase || null) : null,
    created_at: ahora,
  });
  if (presentaciones?.length) {
    const existentes = (await getAll("presentaciones")).map((p) => p.codigo_barras).filter(Boolean);
    for (const p of presentaciones) {
      const codigo = p.codigo_barras || null;
      if (codigo && existentes.includes(codigo)) throw new Error(`El código de barras ${codigo} ya existe.`);
      if (codigo) existentes.push(codigo);
      await put("presentaciones", {
        id: nuevoId(), producto_id: id, nombre: p.nombre,
        factor_conversion: num(p.factor_conversion) || 1, precio: num(p.precio), costo: num(p.costo),
        codigo_barras: codigo, activo: true, created_at: ahora,
      });
    }
  }
  return id;
}

/** Edita los campos de un producto (no toca stock ni presentaciones). Solo admin. */
export async function actualizarProducto(id, { nombre, categoria, stock_minimo, lleva_vencimiento, retornable, tipo_envase, activo }) {
  const p = await get("productos", id);
  if (!p) throw new Error("Producto no encontrado.");
  if (nombre !== undefined) p.nombre = nombre;
  if (categoria !== undefined) p.categoria = categoria || null;
  if (stock_minimo !== undefined) p.stock_minimo = num(stock_minimo);
  if (lleva_vencimiento !== undefined) p.lleva_vencimiento = !!lleva_vencimiento;
  if (retornable !== undefined) p.retornable = !!retornable;
  if (tipo_envase !== undefined) p.tipo_envase = p.retornable ? (tipo_envase || null) : null;
  if (activo !== undefined) p.activo = !!activo;
  await put("productos", p);
}

/** Edita una presentación (precio, costo, código, nombre, activo). Solo admin. */
export async function actualizarPresentacion(id, { nombre, precio, costo, codigo_barras, factor_conversion, activo }) {
  const pr = await get("presentaciones", id);
  if (!pr) throw new Error("Presentación no encontrada.");
  if (codigo_barras !== undefined) {
    const codigo = codigo_barras || null;
    await verificarCodigoUnico(codigo, id);
    pr.codigo_barras = codigo;
  }
  if (nombre !== undefined) pr.nombre = nombre;
  if (precio !== undefined) pr.precio = num(precio);
  if (costo !== undefined) pr.costo = num(costo);
  if (factor_conversion !== undefined) pr.factor_conversion = num(factor_conversion) || 1;
  if (activo !== undefined) pr.activo = !!activo;
  await put("presentaciones", pr);
}

/** Agrega una presentación a un producto existente (ej. sumar el six más tarde). Solo admin. */
export async function agregarPresentacion(productoId, { nombre, factor_conversion, precio, costo, codigo_barras }) {
  const prod = await get("productos", productoId);
  if (!prod) throw new Error("Producto no encontrado.");
  const codigo = codigo_barras || null;
  await verificarCodigoUnico(codigo);
  const id = nuevoId();
  await put("presentaciones", {
    id, producto_id: productoId, nombre, factor_conversion: num(factor_conversion) || 1,
    precio: num(precio), costo: num(costo), codigo_barras: codigo, activo: true, created_at: ahoraISO(),
  });
  return id;
}

/**
 * Borra productos en duro (solo admin). Un producto que YA se vendió NO se puede
 * borrar (protege el historial de ventas): esos se conservan y vienen en
 * `conservados`. Los nunca vendidos se borran con sus presentaciones, lotes y
 * movimientos. Devuelve { borrados:[{id,nombre}], conservados:[{id,nombre,motivo}] }.
 */
export async function eliminarProductos(ids) {
  const lista = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!lista.length) return { borrados: [], conservados: [] };
  const [productos, presentaciones, detAll] = await Promise.all([
    getAll("productos").then(porId), getAll("presentaciones"), getAll("venta_detalle"),
  ]);
  const presVendidas = new Set(detAll.map((d) => d.presentacion_id).filter(Boolean));
  const borrados = [], conservados = [];
  for (const id of lista) {
    const prod = productos.get(id);
    if (!prod) continue;
    const susPres = presentaciones.filter((p) => p.producto_id === id);
    const vendido = susPres.some((p) => presVendidas.has(p.id));
    if (vendido) { conservados.push({ id, nombre: prod.nombre, motivo: "tiene ventas registradas" }); continue; }
    await conTx(["productos", "presentaciones", "lotes", "movimientos_inventario"], "readwrite", async (api) => {
      for (const p of susPres) await api.del("presentaciones", p.id);
      for (const l of await api.porIndice("lotes", "by_producto", id)) await api.del("lotes", l.id);
      for (const m of await api.porIndice("movimientos_inventario", "by_producto", id)) await api.del("movimientos_inventario", m.id);
      await api.del("productos", id);
    });
    borrados.push({ id, nombre: prod.nombre });
  }
  return { borrados, conservados };
}

/** Movimiento de inventario (equivale a fn_movimiento_manual_afecta_stock).
 * entrada: SUMA `cantidad` (crea lote si es perecedero).
 * merma:   RESTA (llega con signo negativo).
 * ajuste:  SOBRESCRIBE — `cantidad` es la existencia REAL contada; el stock queda
 *          en ese número (para perecederos, fija la cantidad del lote elegido). El
 *          movimiento registra el delta neto para que el historial cuadre. */
export async function registrarMovimiento({ producto_id, tipo, cantidad, motivo, lote_id = null, fecha_vencimiento = null }) {
  if (tipo === "venta") return; // los movimientos de venta los crea registrarVenta
  const ahora = ahoraISO();
  await conTx(["productos", "lotes", "movimientos_inventario"], "readwrite", async (api) => {
    const producto = await api.get("productos", producto_id);
    if (!producto) throw new Error("Producto no encontrado.");
    let loteId = lote_id;
    let delta; // cambio neto sobre el stock del producto

    if (producto.lleva_vencimiento) {
      if (tipo === "entrada") {
        if (!fecha_vencimiento) throw new Error("La entrada de un perecedero necesita fecha de vencimiento.");
        loteId = nuevoId();
        await api.put("lotes", { id: loteId, producto_id, cantidad: num(cantidad), fecha_vencimiento, fecha_recepcion: hoyFecha(), created_at: ahora });
        delta = num(cantidad);
      } else if (tipo === "merma" || tipo === "ajuste") {
        if (!lote_id) throw new Error("Este movimiento necesita elegir un lote.");
        const lote = await api.get("lotes", lote_id);
        if (!lote) throw new Error("Lote no encontrado.");
        if (tipo === "ajuste") {
          delta = num(cantidad) - num(lote.cantidad); // cantidad = existencia real del lote
          lote.cantidad = num(cantidad);
        } else { // merma (cantidad ya viene negativa)
          delta = num(cantidad);
          lote.cantidad = num(lote.cantidad) + delta;
        }
        await api.put("lotes", lote);
      } else {
        delta = num(cantidad);
      }
    } else {
      // Sin lotes: ajuste sobrescribe el stock; entrada/merma suman/restan.
      delta = tipo === "ajuste" ? (num(cantidad) - num(producto.stock_actual)) : num(cantidad);
    }

    await api.add("movimientos_inventario", {
      id: nuevoId(), producto_id, tipo, cantidad: delta, motivo: motivo ?? null,
      fecha: ahora, lote_id: loteId, fecha_vencimiento: fecha_vencimiento ?? null,
    });

    producto.stock_actual = num(producto.stock_actual) + delta;
    await api.put("productos", producto);
  });
}

/** Presentaciones activas con nombre de producto (para armar combos/promos). */
export async function presentacionesActivas() {
  const [pres, prodById] = await Promise.all([getAll("presentaciones"), getAll("productos").then(porId)]);
  return pres.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({
    id: p.id, nombre: p.nombre, precio: p.precio,
    etiqueta: `${prodById.get(p.producto_id)?.nombre ?? "?"} · ${p.nombre} (${p.precio})`,
  }));
}

// ── Combos ───────────────────────────────────────────────────────────────────
export async function combosConItems() {
  const [combos, items, presById, prodById] = await Promise.all([
    getAll("combos"), getAll("combo_items"), getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  return combos.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((c) => ({
    id: c.id, nombre: c.nombre, descripcion: c.descripcion, precio_promocional: c.precio_promocional, activo: c.activo,
    combo_items: items.filter((it) => it.combo_id === c.id).map((it) => ({
      id: it.id, cantidad_requerida: it.cantidad_requerida, presentacion_id: it.presentacion_id,
      presentaciones: presAnidada(it.presentacion_id, presById, prodById),
    })),
  }));
}

export async function crearCombo({ nombre, descripcion, precio_promocional, items }) {
  const id = nuevoId();
  const ahora = ahoraISO();
  await put("combos", { id, nombre, descripcion: descripcion ?? null, precio_promocional: num(precio_promocional), activo: true, created_at: ahora });
  for (const it of items) {
    await put("combo_items", { id: nuevoId(), combo_id: id, presentacion_id: it.presentacion_id, cantidad_requerida: num(it.cantidad_requerida) || 1 });
  }
  return id;
}

export async function setComboActivo(id, activo) {
  const c = await get("combos", id);
  if (!c) throw new Error("Combo no encontrado.");
  c.activo = !!activo;
  await put("combos", c);
}

/** Edita los campos de un combo (no toca sus ingredientes). */
export async function actualizarCombo(id, { nombre, descripcion, precio_promocional }) {
  const c = await get("combos", id);
  if (!c) throw new Error("Combo no encontrado.");
  if (nombre !== undefined) c.nombre = nombre;
  if (descripcion !== undefined) c.descripcion = descripcion ?? null;
  if (precio_promocional !== undefined) c.precio_promocional = num(precio_promocional);
  await put("combos", c);
}

/** Reemplaza los ingredientes del combo (borra los actuales e inserta los nuevos). */
export async function setComboItems(comboId, items) {
  const actuales = (await getAll("combo_items")).filter((it) => it.combo_id === comboId);
  for (const it of actuales) await del("combo_items", it.id);
  for (const it of items) {
    await put("combo_items", { id: nuevoId(), combo_id: comboId, presentacion_id: it.presentacion_id, cantidad_requerida: num(it.cantidad_requerida) || 1 });
  }
}

// ── Promociones ──────────────────────────────────────────────────────────────
export async function promocionesConPresentaciones() {
  const [promos, puente, presById, prodById] = await Promise.all([
    getAll("promociones"), getAll("promocion_presentaciones"), getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  return promos.sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => ({
    id: p.id, nombre: p.nombre, cantidad_requerida: p.cantidad_requerida, precio_promocional: p.precio_promocional, activo: p.activo,
    promocion_presentaciones: puente.filter((pp) => pp.promocion_id === p.id).map((pp) => ({
      presentacion_id: pp.presentacion_id,
      presentaciones: presAnidada(pp.presentacion_id, presById, prodById),
    })),
  }));
}

export async function crearPromocion({ nombre, cantidad_requerida, precio_promocional, presentacionIds }) {
  const id = nuevoId();
  await put("promociones", { id, nombre, cantidad_requerida: num(cantidad_requerida), precio_promocional: num(precio_promocional), activo: true, created_at: ahoraISO() });
  for (const pid of presentacionIds) {
    await put("promocion_presentaciones", { promocion_id: id, presentacion_id: pid });
  }
  return id;
}

export async function setPromocionActiva(id, activo) {
  const p = await get("promociones", id);
  if (!p) throw new Error("Promoción no encontrada.");
  p.activo = !!activo;
  await put("promociones", p);
}

/** Edita los campos de una promoción. */
export async function actualizarPromocion(id, { nombre, cantidad_requerida, precio_promocional }) {
  const p = await get("promociones", id);
  if (!p) throw new Error("Promoción no encontrada.");
  if (nombre !== undefined) p.nombre = nombre;
  if (cantidad_requerida !== undefined) p.cantidad_requerida = num(cantidad_requerida);
  if (precio_promocional !== undefined) p.precio_promocional = num(precio_promocional);
  await put("promociones", p);
}

/** Reemplaza las presentaciones a las que aplica una promoción. */
export async function setPromocionPresentaciones(promocionId, presentacionIds) {
  const puente = await getAll("promocion_presentaciones");
  for (const row of puente.filter((r) => r.promocion_id === promocionId)) {
    await del("promocion_presentaciones", [row.promocion_id, row.presentacion_id]);
  }
  for (const pid of presentacionIds) {
    await put("promocion_presentaciones", { promocion_id: promocionId, presentacion_id: pid });
  }
}

// ── Usuarios (lectura; alta/edición vive en auth.js) ────────────────────────
export async function listarUsuarios() {
  return (await getAll("perfiles"))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)))
    .map((u) => ({ id: u.id, nombre: u.nombre, rol: u.rol, activo: u.activo, created_at: u.created_at, desactivado_en: u.desactivado_en ?? null }));
}

// ── Reportes (consultas agregadas) ───────────────────────────────────────────
export async function ventasEntre(desdeISO, hastaISO) {
  return (await getAll("ventas"))
    .filter((v) => v.fecha >= desdeISO && v.fecha <= hastaISO)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)))
    .map((v) => ({ id: v.id, fecha: v.fecha, total: v.total }));
}

/** Líneas de venta en un rango de fechas, con nombre de producto (para reportes). */
export async function detalleEntre(desdeISO, hastaISO) {
  const ventas = (await getAll("ventas")).filter((v) => v.fecha >= desdeISO && v.fecha <= hastaISO);
  const fechaPorVenta = new Map(ventas.map((v) => [v.id, v.fecha]));
  const [detalle, presById, prodById] = await Promise.all([
    getAll("venta_detalle"), getAll("presentaciones").then(porId), getAll("productos").then(porId),
  ]);
  return detalle.filter((d) => fechaPorVenta.has(d.venta_id)).map((d) => ({
    cantidad: d.cantidad, subtotal: d.subtotal, descripcion: d.descripcion ?? null,
    presentaciones: presAnidada(d.presentacion_id, presById, prodById),
    ventas: { fecha: fechaPorVenta.get(d.venta_id) },
  }));
}
