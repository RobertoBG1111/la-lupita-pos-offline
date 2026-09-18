// ── Pantalla: Promociones (solo admin) ──────────────────────────────────────
import { h, limpiar, dinero, exito, falla, modal, selectorPresentaciones } from "../lib/ui.js";
import { promocionesConPresentaciones, crearPromocion, setPromocionActiva, presentacionesActivas, actualizarPromocion, setPromocionPresentaciones } from "../lib/datos.js";

export const promociones = {
  id: "promociones", etiqueta: "Promociones", titulo: "Promociones", roles: ["admin"], enNav: true,
  async render({ contenido }) {
    limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando promociones…"));
    let lista, pres;
    try { [lista, pres] = await Promise.all([promocionesConPresentaciones(), presentacionesActivas()]); }
    catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudieron cargar las promociones.")); return; }
    const rerender = () => promociones.render({ contenido });

    const cards = lista.length ? lista.map((p) => h("div", { class: "glass card" + (p.activo ? "" : " inactivo") },
      h("div", { class: "fila entre" },
        h("h3", {}, p.nombre),
        h("span", { class: "chip " + (p.activo ? "chip-ok" : "chip-tenue") }, p.activo ? "activa" : "inactiva")),
      h("p", { class: "mono", style: "margin:6px 0;font-size:18px" }, `${Number(p.cantidad_requerida)} × ${dinero(p.precio_promocional)}`),
      h("ul", { class: "combo-items" }, ...(p.promocion_presentaciones || []).map((pp) =>
        h("li", {}, `${pp.presentaciones?.productos?.nombre ?? "?"} · ${pp.presentaciones?.nombre ?? ""}`))),
      h("div", { class: "fila", style: "justify-content:flex-end;gap:6px;margin-top:8px" },
        h("button", { class: "btn btn-mini", onClick: () => editarPromoModal(p, pres, rerender) }, "Editar"),
        h("button", { class: "btn btn-mini", onClick: async () => { await setPromocionActiva(p.id, !p.activo); rerender(); } }, p.activo ? "Desactivar" : "Activar")),
    )) : [h("div", { class: "glass card tenue centrado", style: "padding:40px" }, "Aún no hay promociones.")];

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Promociones"),
        h("p", {}, "Descuento por juntar cantidad de una o varias presentaciones equivalentes: mismo precio normal y misma promo, así que cualquier combinación entre ellas cuenta. El sobrante se cobra a precio normal."))),
      h("div", { class: "admin-grid" },
        h("div", { class: "grid", style: "gap:var(--sp-4)" }, ...cards),
        formCrearPromo(pres, rerender),
      ),
    );
  },
};

function editarPromoModal(promo, pres, onSaved) {
  modal((caja, cerrar) => {
    const nombre = h("input", { class: "input", value: promo.nombre });
    const cantidad = h("input", { class: "input mono", inputmode: "numeric", value: String(promo.cantidad_requerida) });
    const precio = h("input", { class: "input mono", inputmode: "decimal", value: String(promo.precio_promocional) });
    // Preserva presentaciones inactivas ya ligadas (no aparecen en `pres` activas).
    const idsPres = new Set(pres.map((p) => p.id));
    const extra = (promo.promocion_presentaciones || [])
      .filter((pp) => !idsPres.has(pp.presentacion_id))
      .map((pp) => ({ id: pp.presentacion_id, etiqueta: `${pp.presentaciones?.productos?.nombre ?? "?"} · ${pp.presentaciones?.nombre ?? ""} (inactiva)` }));
    const selector = selectorPresentaciones([...pres, ...extra], {
      iniciales: (promo.promocion_presentaciones || []).map((pp) => pp.presentacion_id),
    });
    const opciones = selector.node;
    const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Guardar cambios");
    async function guardar() {
      const n = nombre.value.trim();
      const req = parseInt(cantidad.value, 10);
      const pp = parseFloat(precio.value);
      const ids = selector.seleccionadas();
      if (!n) { falla("Ponle nombre a la promoción."); return; }
      if (!Number.isFinite(req) || req < 2) { falla("La cantidad requerida debe ser 2 o más."); return; }
      if (!Number.isFinite(pp) || pp < 0) { falla("Precio de promoción inválido."); return; }
      if (ids.length < 1) { falla("Elige al menos una presentación."); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await actualizarPromocion(promo.id, { nombre: n, cantidad_requerida: req, precio_promocional: pp });
        await setPromocionPresentaciones(promo.id, ids);
        exito("Promoción actualizada"); cerrar(); onSaved();
      } catch (e) { console.error(e); falla("No se pudo guardar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Guardar cambios"; }
    }
    caja.append(
      h("h3", {}, "Editar promoción"),
      h("div", { class: "grid2", style: "margin:12px 0" },
        h("div", { class: "campo span2" }, h("label", {}, "Nombre"), nombre),
        h("div", { class: "campo" }, h("label", {}, "Cantidad requerida"), cantidad),
        h("div", { class: "campo" }, h("label", {}, "Precio promo"), precio)),
      h("label", { style: "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-tenue)" }, "Aplica a estas presentaciones"),
      pres.length ? opciones : h("p", { class: "tenue" }, "No hay productos activos."),
      h("div", { class: "fila entre", style: "margin-top:16px" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
    );
  }, { ancho: 520 });
}

function formCrearPromo(pres, onSaved) {
  const nombre = h("input", { class: "input", placeholder: "Victoria sabores 2x$46" });
  const cantidad = h("input", { class: "input mono", inputmode: "numeric", placeholder: "2" });
  const precio = h("input", { class: "input mono", inputmode: "decimal", placeholder: "46" });

  const selector = selectorPresentaciones(pres, {});
  const opciones = selector.node;

  const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Crear promoción");
  async function guardar() {
    const n = nombre.value.trim();
    const req = parseInt(cantidad.value, 10);
    const pp = parseFloat(precio.value);
    const ids = selector.seleccionadas();
    if (!n) { falla("Ponle nombre a la promoción."); return; }
    if (!Number.isFinite(req) || req < 2) { falla("La cantidad requerida debe ser 2 o más."); return; }
    if (!Number.isFinite(pp) || pp < 0) { falla("Precio de promoción inválido."); return; }
    if (ids.length < 1) { falla("Elige al menos una presentación a la que aplica."); return; }
    btn.disabled = true; btn.textContent = "Creando…";
    try { await crearPromocion({ nombre: n, cantidad_requerida: req, precio_promocional: pp, presentacionIds: ids }); exito("Promoción creada"); onSaved(); }
    catch (e) { console.error(e); falla("No se pudo crear: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Crear promoción"; }
  }

  return h("aside", { class: "glass card admin-form" },
    h("h3", {}, "Crear promoción"),
    h("div", { class: "grid2", style: "margin:12px 0" },
      h("div", { class: "campo span2" }, h("label", {}, "Nombre"), nombre),
      h("div", { class: "campo" }, h("label", {}, "Cantidad requerida"), cantidad),
      h("div", { class: "campo" }, h("label", {}, "Precio promo"), precio)),
    h("label", { style: "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-tenue)" }, "Aplica a estas presentaciones equivalentes"),
    pres.length ? opciones : h("p", { class: "tenue", style: "margin:8px 0;font-size:12px" }, "No hay productos activos todavía. Da de alta el catálogo en Inventario."),
    h("div", { style: "height:12px" }), btn,
  );
}
