// ── Pantalla: Combos (solo admin) ───────────────────────────────────────────
import { h, limpiar, dinero, exito, falla, modal, selectorPresentaciones } from "../lib/ui.js";
import { combosConItems, crearCombo, setComboActivo, actualizarCombo, setComboItems, presentacionesActivas } from "../lib/datos.js";

export const combos = {
  id: "combos", etiqueta: "Combos", titulo: "Combos", roles: ["admin"], enNav: true,
  async render({ contenido }) {
    limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando combos…"));
    let lista, pres;
    try { [lista, pres] = await Promise.all([combosConItems(), presentacionesActivas()]); }
    catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudieron cargar los combos.")); return; }
    const rerender = () => combos.render({ contenido });

    // ── Tarjetas ──────────────────────────────────────────────────────────────
    const cards = lista.length ? lista.map((c) => h("div", { class: "glass card combo-card" + (c.activo ? "" : " inactivo") },
      h("div", { class: "fila entre" },
        h("h3", {}, c.nombre),
        h("span", { class: "chip " + (c.activo ? "chip-ok" : "chip-tenue") }, c.activo ? "activo" : "inactivo")),
      c.descripcion ? h("p", { class: "tenue", style: "margin:6px 0" }, c.descripcion) : null,
      h("ul", { class: "combo-items" }, ...(c.combo_items || []).map((it) =>
        h("li", {}, `${Number(it.cantidad_requerida)}× ${it.presentaciones?.productos?.nombre ?? "?"} · ${it.presentaciones?.nombre ?? ""}`))),
      h("div", { class: "fila entre", style: "margin-top:10px" },
        h("strong", { class: "mono", style: "font-size:18px" }, dinero(c.precio_promocional)),
        h("div", { class: "fila", style: "gap:6px" },
          h("button", { class: "btn btn-mini", onClick: () => editarComboModal(c, pres, rerender) }, "Editar"),
          h("button", { class: "btn btn-mini", onClick: async () => { await setComboActivo(c.id, !c.activo); rerender(); } }, c.activo ? "Desactivar" : "Activar"))),
    )) : [h("div", { class: "glass card tenue centrado", style: "padding:40px" }, "Aún no hay combos.")];

    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" }, h("div", {}, h("h2", {}, "Combos"),
        h("p", {}, "Paquete de productos distintos a precio fijo. Se arma un combo completo por cada juego exacto de ingredientes en el carrito; lo que sobre se cobra a precio normal."))),
      h("div", { class: "admin-grid" },
        h("div", { class: "grid", style: "gap:var(--sp-4)" }, ...cards),
        formCrearCombo(pres, rerender),
      ),
    );
  },
};

function editarComboModal(combo, pres, onSaved) {
  const idsPres = new Set(pres.map((p) => p.id));
  modal((caja, cerrar) => {
    const nombre = h("input", { class: "input", value: combo.nombre });
    const desc = h("input", { class: "input", value: combo.descripcion || "" });
    const precio = h("input", { class: "input mono", inputmode: "decimal", value: String(combo.precio_promocional) });

    // Preserva presentaciones inactivas ya ligadas (no aparecen en `pres` activas).
    const extra = (combo.combo_items || [])
      .filter((it) => !idsPres.has(it.presentacion_id))
      .map((it) => ({ id: it.presentacion_id, etiqueta: `${it.presentaciones?.productos?.nombre ?? "?"} · ${it.presentaciones?.nombre ?? ""} (inactiva)` }));
    const selector = selectorPresentaciones([...pres, ...extra], {
      conCantidad: true,
      iniciales: (combo.combo_items || []).map((it) => ({ presentacion_id: it.presentacion_id, cantidad_requerida: Number(it.cantidad_requerida) || 1 })),
    });

    const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Guardar cambios");
    async function guardar() {
      const n = nombre.value.trim();
      const pp = parseFloat(precio.value);
      const items = selector.seleccionadas();
      if (!n) { falla("Ponle nombre al combo."); return; }
      if (!Number.isFinite(pp) || pp < 0) { falla("Precio de combo inválido."); return; }
      if (items.length < 2) { falla("Un combo necesita al menos 2 presentaciones distintas."); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      try {
        await actualizarCombo(combo.id, { nombre: n, descripcion: desc.value.trim() || null, precio_promocional: pp });
        await setComboItems(combo.id, items);
        exito("Combo actualizado"); cerrar(); onSaved();
      } catch (e) { console.error(e); falla("No se pudo guardar: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Guardar cambios"; }
    }

    caja.append(
      h("h3", {}, "Editar combo"),
      h("div", { class: "campo", style: "margin:12px 0" }, h("label", {}, "Nombre"), nombre),
      h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Descripción"), desc),
      h("label", { style: "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-tenue)" }, "Productos del combo (marca y pon la cantidad de cada uno)"),
      selector.node,
      h("div", { class: "campo", style: "margin:12px 0" }, h("label", {}, "Precio del combo"), precio),
      h("div", { class: "fila entre" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
    );
  }, { ancho: 520 });
}

function formCrearCombo(pres, onSaved) {
  const nombre = h("input", { class: "input", placeholder: "Tequila + Squirt" });
  const desc = h("input", { class: "input", placeholder: "1 tequila 750ml + 1 squirt 1.5L" });
  const precio = h("input", { class: "input mono", inputmode: "decimal", placeholder: "395" });
  const selector = selectorPresentaciones(pres, { conCantidad: true });

  const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: guardar }, "Crear combo");
  async function guardar() {
    const n = nombre.value.trim();
    const pp = parseFloat(precio.value);
    const items = selector.seleccionadas();
    if (!n) { falla("Ponle nombre al combo."); return; }
    if (!Number.isFinite(pp) || pp < 0) { falla("Precio de combo inválido."); return; }
    if (items.length < 2) { falla("Un combo necesita al menos 2 presentaciones distintas."); return; }
    btn.disabled = true; btn.textContent = "Creando…";
    try { await crearCombo({ nombre: n, descripcion: desc.value.trim() || null, precio_promocional: pp, items }); exito("Combo creado"); onSaved(); }
    catch (e) { console.error(e); falla("No se pudo crear: " + (e.message || "error")); btn.disabled = false; btn.textContent = "Crear combo"; }
  }

  return h("aside", { class: "glass card admin-form" },
    h("h3", {}, "Crear combo"),
    h("div", { class: "campo", style: "margin:12px 0" }, h("label", {}, "Nombre"), nombre),
    h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Descripción"), desc),
    pres.length
      ? h("div", {},
          h("label", { style: "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--tinta-tenue)" }, "Productos del combo (marca y pon la cantidad de cada uno)"),
          selector.node)
      : h("p", { class: "tenue", style: "margin:8px 0;font-size:12px" }, "No hay productos activos todavía. Da de alta el catálogo en Inventario."),
    h("div", { class: "campo", style: "margin:12px 0" }, h("label", {}, "Precio del combo"), precio),
    btn,
  );
}
