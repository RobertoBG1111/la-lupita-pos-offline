// ── Motor de carrito, promociones y combos — POS Modelorama "La Lupita" ─────
//
// IMPORTANTE: la base NO aplica el precio de promo/combo (no hay trigger para eso).
// Este módulo calcula el precio final por línea y produce las filas de venta_detalle
// que se escriben. La base sí garantiza: descuento de inventario/FEFO, total = suma
// de subtotales, y que los pagos cuadren con el total.
//
// Reglas (CONTEXTO.md §2):
//  - Promociones por cantidad: se aplican AUTOMÁTICAMENTE sobre un grupo de
//    presentaciones equivalentes. "N por $X". El sobrante va a precio normal.
//  - Combos: productos DISTINTOS a precio de paquete. Son SUGERENCIA: solo se
//    aplican si el cajero los acepta. El sobrante va a precio normal.
//  - Orden de aplicación: primero combos aceptados, luego promos sobre lo que quede.
//
// Todo el dinero se maneja en CENTAVOS enteros para evitar corrimientos de flotante.

const cent = (x) => Math.round(Number(x) * 100);
export const pesos = (c) => c / 100;

/** Reparte `total` (centavos) entre partes con los `pesos` dados, sin perder centavos. */
function distribuir(total, ponderaciones) {
  const suma = ponderaciones.reduce((a, b) => a + b, 0) || 1;
  const base = ponderaciones.map((w) => Math.floor((total * w) / suma));
  let resto = total - base.reduce((a, b) => a + b, 0);
  const orden = [...ponderaciones.keys()].sort((a, b) => ponderaciones[b] - ponderaciones[a]);
  for (let i = 0; resto > 0 && orden.length; i++, resto--) base[orden[i % orden.length]]++;
  return base;
}

/**
 * Calcula el estado completo de una venta.
 * @param items  [{ presentacion_id, cantidad }]  (líneas que agregó el cajero)
 * @param cat    resultado de db.catalogoVenta()
 * @param combosAceptados  Set de combo_id que el cajero decidió aplicar
 * @returns {
 *   rows,            // filas listas para venta_detalle (subtotales exactos)
 *   totalCentavos, total,
 *   porPresentacion, // Map presentacion_id -> { cantidad, subtotalCent, etiquetas:Set }
 *   promosAplicadas, // [{ promo, bundles, unidades, monto }]
 *   combos           // [{ combo, nPosible, aplicado }]  (para sugerir/mostrar)
 * }
 */
export function calcular(items, cat, combosAceptados = new Set(), genericos = []) {
  const presById = new Map(cat.presentaciones.map((p) => [p.id, p]));
  const prodById = new Map(cat.productos.map((p) => [p.id, p]));

  // Cantidad restante por presentación (agregando líneas repetidas).
  const rem = new Map();
  for (const it of items) {
    if (!presById.has(it.presentacion_id)) continue;
    rem.set(it.presentacion_id, (rem.get(it.presentacion_id) || 0) + Number(it.cantidad));
  }

  const precioCent = (pid) => cent(presById.get(pid).precio);
  const rows = [];
  const porPresentacion = new Map();
  function acumula(pid, cantidad, subtotalCent, etiqueta, extra) {
    rows.push({ presentacion_id: pid, cantidad, subtotal: pesos(subtotalCent),
      precio_unitario: pesos(Math.round(subtotalCent / cantidad)), ...extra });
    const acc = porPresentacion.get(pid) || { cantidad: 0, subtotalCent: 0, etiquetas: new Set() };
    acc.cantidad += cantidad; acc.subtotalCent += subtotalCent;
    if (etiqueta) acc.etiquetas.add(etiqueta);
    porPresentacion.set(pid, acc);
  }

  // ── 1) Combos ──────────────────────────────────────────────────────────────
  const combos = [];
  for (const combo of cat.combos) {
    const its = cat.comboItems.filter((ci) => ci.combo_id === combo.id);
    if (!its.length) continue;
    // ¿Cuántos combos completos alcanzan con lo que hay en el carrito ahora?
    const nPosible = Math.min(...its.map((ci) => Math.floor((rem.get(ci.presentacion_id) || 0) / Number(ci.cantidad_requerida))));
    const aplicado = combosAceptados.has(combo.id) && nPosible > 0;
    combos.push({ combo, nPosible: Number.isFinite(nPosible) ? nPosible : 0, aplicado });
    if (!aplicado) continue;

    const N = nPosible;
    const montoCent = N * cent(combo.precio_promocional);
    // Reparte el precio del combo entre sus componentes según su valor normal.
    const ponder = its.map((ci) => precioCent(ci.presentacion_id) * Number(ci.cantidad_requerida) * N);
    const partes = distribuir(montoCent, ponder);
    its.forEach((ci, i) => {
      const cantidad = N * Number(ci.cantidad_requerida);
      rem.set(ci.presentacion_id, (rem.get(ci.presentacion_id) || 0) - cantidad);
      acumula(ci.presentacion_id, cantidad, partes[i], "combo", { combo_id: combo.id });
    });
  }

  // ── 1.5) Empaques del mismo producto (piezas sueltas → precio de six/cartón) ──
  // Si el cajero acepta un empaque (six/cartón), las piezas de la presentación base
  // (factor 1) se cobran en grupos completos al precio del empaque (el más grande
  // primero); lo que no complete un grupo queda a precio de pieza. También calculamos
  // qué empaques SE PODRÍAN aplicar, para sugerirlos en la interfaz. Útil cuando el
  // six no tiene código y el cajero teclea piezas.
  const pressPorProducto = new Map();
  for (const p of cat.presentaciones) {
    if (!pressPorProducto.has(p.producto_id)) pressPorProducto.set(p.producto_id, []);
    pressPorProducto.get(p.producto_id).push(p);
  }
  const paquetes = []; // [{ pres, base, nPosible, aplicado }]
  for (const [, lista] of pressPorProducto) {
    const base = lista.find((p) => Number(p.factor_conversion) === 1);
    if (!base) continue;
    const mayores = lista
      .filter((p) => Number(p.factor_conversion) > 1 && Number(p.precio) > 0)
      .sort((a, b) => Number(b.factor_conversion) - Number(a.factor_conversion)); // mayor primero
    for (const may of mayores) {
      const f = Number(may.factor_conversion);
      const baseQty = rem.get(base.id) || 0;
      const nPosible = Math.floor(baseQty / f);
      // AUTOMÁTICO: al completar un empaque (ej. 6 piezas → six) se cobra al precio
      // del empaque; el sobrante queda a precio de pieza. El empaque más grande primero.
      const aplicado = nPosible > 0;
      paquetes.push({ pres: may, base, nPosible, aplicado });
      if (!aplicado) continue;
      const unidades = nPosible * f;
      const montoCent = nPosible * cent(may.precio);
      rem.set(base.id, baseQty - unidades);
      acumula(base.id, unidades, montoCent, may.nombre, {}); // etiqueta = nombre del empaque
    }
  }

  // ── 2) Promociones automáticas ──────────────────────────────────────────────
  const promosAplicadas = [];
  for (const promo of cat.promociones) {
    const pids = cat.promocionPresentaciones
      .filter((pp) => pp.promocion_id === promo.id)
      .map((pp) => pp.presentacion_id)
      .filter((pid) => (rem.get(pid) || 0) > 0);
    if (!pids.length) continue;

    const req = Number(promo.cantidad_requerida);
    const Q = pids.reduce((s, pid) => s + (rem.get(pid) || 0), 0);
    const bundles = Math.floor(Q / req);
    if (bundles < 1) continue;

    let unidades = bundles * req;
    const montoCent = bundles * cent(promo.precio_promocional);
    // Toma 'unidades' repartidas entre las presentaciones participantes.
    const alloc = [];
    for (const pid of pids) {
      if (unidades <= 0) break;
      const toma = Math.min(rem.get(pid), unidades);
      if (toma > 0) { rem.set(pid, rem.get(pid) - toma); unidades -= toma; alloc.push({ pid, toma }); }
    }
    const partes = distribuir(montoCent, alloc.map((a) => a.toma));
    alloc.forEach((a, i) => acumula(a.pid, a.toma, partes[i], "promo", { promocion_id: promo.id }));
    promosAplicadas.push({ promo, bundles, unidades: bundles * req, monto: pesos(montoCent) });
  }

  // ── 3) Sobrante a precio normal ──────────────────────────────────────────────
  for (const [pid, q] of rem) {
    if (q > 0) acumula(pid, q, q * precioCent(pid), null, {});
  }

  // ── Ventas genéricas (código 0): artículo/servicio libre, sin catálogo ──────
  for (const g of genericos) {
    const subCent = cent(g.precio) * Number(g.cantidad);
    rows.push({ generico: true, uid: g.uid, descripcion: g.descripcion, presentacion_id: null,
      cantidad: Number(g.cantidad), precio_unitario: g.precio, subtotal: pesos(subCent) });
  }

  const totalCentavos = rows.reduce((s, r) => s + cent(r.subtotal), 0);
  return {
    rows, totalCentavos, total: pesos(totalCentavos),
    porPresentacion, promosAplicadas, combos, paquetes,
    // Datos de presentación/producto para pintar el carrito.
    presById, prodById,
  };
}
