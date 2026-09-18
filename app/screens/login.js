// ── Pantalla: Login (nombre + contraseña, sin correo) ───────────────────────
import { h, limpiar, falla, modal } from "../lib/ui.js";
import { CONFIG } from "../config.js";
import { entrar } from "../lib/auth.js";
import { abrirTurno, turnoActivoDe } from "../lib/datos.js";

// Pide el dinero inicial en caja (fondo) al abrir un turno nuevo. Devuelve el monto.
function pedirFondoInicial(nombre) {
  return new Promise((resolve) => {
    modal((caja, cerrar) => {
      const monto = h("input", { class: "input mono", type: "text", inputmode: "decimal", placeholder: "0.00", autofocus: true });
      function confirmar() {
        const v = parseFloat(String(monto.value).replace(",", "."));
        cerrar();
        resolve(Number.isFinite(v) && v >= 0 ? v : 0);
      }
      monto.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } });
      caja.append(
        h("h3", {}, "Dinero inicial en caja"),
        h("p", { class: "tenue", style: "margin:6px 0 16px;font-size:13px;line-height:1.5" },
          `Hola ${nombre}. ¿Con cuánto efectivo abre la caja este turno? El corte lo usará para calcular cuánto debería haber al cerrar.`),
        h("div", { class: "campo", style: "margin-bottom:18px" }, h("label", {}, "Fondo de caja"), monto),
        h("div", { class: "fila entre" },
          h("button", { class: "btn btn-fantasma", onClick: () => { cerrar(); resolve(0); } }, "Sin fondo ($0)"),
          h("button", { class: "btn btn-primario", "data-glow": "1", onClick: confirmar }, "Abrir turno"),
        ),
      );
      // El atributo autofocus no es fiable en un modal creado al vuelo: enfoca a mano.
      setTimeout(() => { monto.focus(); monto.select(); }, 30);
    });
  });
}

export const login = {
  id: "login",
  full: true,
  roles: "todos",
  render({ contenido, ir }) {
    const nombre = h("input", { class: "input", type: "text", autocomplete: "username", placeholder: "Tu nombre", autofocus: true });
    const pass = h("input", { class: "input", type: "password", autocomplete: "current-password", placeholder: "Contraseña" });
    const btn = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1", type: "submit" }, "Entrar");

    async function hacerLogin(e) {
      e?.preventDefault();
      const n = nombre.value.trim();
      if (!n || !pass.value) { falla("Escribe tu nombre y contraseña."); return; }
      btn.disabled = true; btn.textContent = "Entrando…";
      const r = await entrar(n, pass.value);
      if (!r.ok) { falla(r.error); btn.disabled = false; btn.textContent = "Entrar"; pass.value = ""; pass.focus(); return; }
      // Abre turno. Si NO hay uno activo, pide primero el fondo de caja inicial.
      try {
        const activo = await turnoActivoDe(r.perfil.id);
        if (!activo) {
          const fondo = await pedirFondoInicial(r.perfil.nombre);
          await abrirTurno(r.perfil.id, fondo);
        }
      } catch (err) { console.warn("No se pudo abrir turno:", err); }
      ir("venta");
    }

    const form = h("form", { onSubmit: hacerLogin },
      h("div", { class: "campo", style: "margin-bottom:16px" }, h("label", {}, "Nombre"), nombre),
      h("div", { class: "campo", style: "margin-bottom:24px" }, h("label", {}, "Contraseña"), pass),
      btn,
    );

    limpiar(contenido).append(
      h("div", { style: "height:100%;display:grid;place-items:center" },
        h("div", { class: "glass card", style: "width:min(420px,92vw);padding:44px 36px" },
          h("img", { src: CONFIG.NEGOCIO.logo, alt: "", style: "height:56px;margin-bottom:16px;border-radius:10px", onerror: (e) => e.target.remove() }),
          h("h2", { style: "font-size:28px;margin-bottom:4px" }, "Iniciar sesión"),
          h("p", { class: "tenue", style: "margin:0 0 26px" }, "Entra con tu nombre y contraseña."),
          form,
          h("button", { class: "btn btn-fantasma btn-bloque", style: "margin-top:14px", onClick: () => ir("bienvenida") }, "Volver"),
        ),
      ),
    );
    setTimeout(() => nombre.focus(), 30);
  },
};
