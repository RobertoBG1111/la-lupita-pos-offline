// ── Pantalla: Envases retornables ───────────────────────────────────────────
// Solo aparece cuando el carrito trae productos marcados como envase retornable.
// Muestra cuántos envases se compraron (por tipo) y pregunta cuántos VACÍOS trae
// el cliente; cobra depósito solo por los que falten. El cargo se suma al total.
// Los tipos de envase (y su depósito) son CONFIGURABLES: salen de getConfig().ENVASES.
import { h, limpiar, dinero } from "../lib/ui.js";
import { getConfig } from "../lib/config-runtime.js";
import { ventaEnCurso } from "../lib/estado.js";

export const envases = {
  id: "envases", etiqueta: "Envases", titulo: "Envases", roles: ["admin", "cajero"], enNav: false, full: true,
  render({ contenido, ir, params }) {
    const calc = params?.calc;
    if (!calc || ventaEnCurso.vacio) { ir("venta"); return; }
    const req = params?.requeridos || {}; // { clave: cantidad comprada }
    // Tipos configurados que aparecen en este carrito.
    const TIPOS = (getConfig().ENVASES || [])
      .map((t) => ({ clave: t.clave, label: t.nombre, precio: Number(t.deposito) || 0 }))
      .filter((t) => (req[t.clave] || 0) > 0);

    // Si no hay retornables (no debería pasar), va directo al cobro.
    if (!TIPOS.length) { ir("pago", { calc }); return; }

    const trae = {}; TIPOS.forEach((t) => { trae[t.clave] = req[t.clave]; }); // por defecto: trae todos → $0
    const faltan = (clave) => Math.max(0, (req[clave] || 0) - (trae[clave] || 0));
    const cargo = () => TIPOS.reduce((s, t) => s + faltan(t.clave) * t.precio, 0);

    const cargoEl = h("strong", { class: "mono" }, dinero(0));
    const totalEl = h("strong", { class: "mono" }, dinero(calc.total));
    const cobrarEls = {};
    function repintar() {
      for (const t of TIPOS) cobrarEls[t.clave].textContent = dinero(faltan(t.clave) * t.precio);
      cargoEl.textContent = dinero(cargo());
      totalEl.textContent = dinero(calc.total + cargo());
    }

    function filaTipo(t) {
      const inp = h("input", { class: "input mono", inputmode: "numeric", value: String(req[t.clave]), style: "width:70px;text-align:center" });
      const set = (n) => { let v = parseInt(n, 10); if (!Number.isFinite(v) || v < 0) v = 0; if (v > req[t.clave]) v = req[t.clave]; trae[t.clave] = v; inp.value = String(v); repintar(); };
      inp.addEventListener("input", () => set(inp.value));
      const menos = h("button", { class: "paso", onClick: () => set(trae[t.clave] - 1) }, "−");
      const mas = h("button", { class: "paso", onClick: () => set(trae[t.clave] + 1) }, "+");
      cobrarEls[t.clave] = h("strong", { class: "mono" }, dinero(0));
      return h("div", { class: "glass", style: "padding:12px 14px;border-radius:12px" },
        h("div", { class: "fila entre", style: "margin-bottom:8px" },
          h("span", {}, `${t.label} · $${t.precio} c/u`),
          h("span", { class: "tenue" }, `llevó ${req[t.clave]}`)),
        h("div", { class: "fila entre" },
          h("div", { class: "fila", style: "gap:8px;align-items:center" }, h("span", { class: "tenue" }, "vacíos que trae"), h("div", { class: "stepper" }, menos, inp, mas)),
          h("div", {}, h("span", { class: "tenue" }, "a cobrar "), cobrarEls[t.clave])),
      );
    }

    const filas = TIPOS.map(filaTipo);
    const continuar = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1",
      onClick: () => {
        const envases = {};
        for (const t of TIPOS) { const f = faltan(t.clave); if (f > 0) envases[t.clave] = f; }
        ir("pago", { calc, envases });
      } }, "Continuar al cobro");

    limpiar(contenido).append(
      h("div", { style: "height:100%;display:grid;place-items:center" },
        h("div", { class: "glass card", style: "width:min(500px,92vw);padding:36px 32px" },
          h("h2", { style: "font-size:26px;margin-bottom:4px" }, "Envases retornables"),
          h("p", { class: "tenue", style: "margin:0 0 22px" }, "El cliente lleva envases retornables. ¿Cuántos vacíos trae de vuelta? Se cobra depósito solo por los que falten."),
          h("div", { class: "col", style: "gap:12px" }, ...filas),
          h("hr", { style: "border:none;border-top:1px solid rgba(14,21,36,.12);margin:20px 0" }),
          h("div", { class: "fila entre", style: "margin-bottom:6px" }, h("span", { class: "tenue" }, "Depósito por envases faltantes"), cargoEl),
          h("div", { class: "fila entre", style: "margin-bottom:20px" }, h("span", {}, "Total a cobrar"), totalEl),
          continuar,
          h("button", { class: "btn btn-fantasma btn-bloque", style: "margin-top:10px", onClick: () => ir("venta") }, "Volver a la venta"),
        ),
      ),
    );
    repintar();
    setTimeout(() => continuar.focus(), 40);
  },
};
