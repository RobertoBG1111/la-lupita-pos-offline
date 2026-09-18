// ── Pantalla: Bienvenida (reposo) ───────────────────────────────────────────
// En la PRIMERA corrida (sin usuarios) muestra el alta del primer administrador,
// para poder entrar. Después, es la pantalla en reposo con el botón de entrar.
import { h, limpiar, fechaHora, exito, falla } from "../lib/ui.js";
import { CONFIG } from "../config.js";
import { bootstrapNecesario, crearPrimerAdmin } from "../lib/auth.js";

export const bienvenida = {
  id: "bienvenida",
  full: true,
  roles: "todos",
  async render({ contenido, ir }) {
    const reloj = h("div", { class: "mono", style: "font-size:20px;color:var(--tinta-tenue)" }, fechaHora());
    const t = setInterval(() => { if (!document.body.contains(reloj)) return clearInterval(t); reloj.textContent = fechaHora(); }, 1000);

    const primeraVez = await bootstrapNecesario().catch(() => false);

    const marca = h("div", { style: "text-align:center" },
      h("img", { src: CONFIG.NEGOCIO.logo, alt: "Logo", style: "height:96px;margin-bottom:20px;border-radius:14px", onerror: (e) => e.target.remove() }),
      h("h1", { style: "font-size:40px;line-height:1.1" }, `${CONFIG.NEGOCIO.nombre}`),
      h("div", { style: "font-family:var(--font-display);font-size:24px;color:var(--verde-dato);margin-top:2px" }, CONFIG.NEGOCIO.sucursal),
      h("p", { class: "tenue", style: "margin:6px 0 28px" }, CONFIG.NEGOCIO.lugar),
    );

    const tarjeta = primeraVez ? bootstrapCard(ir) : h("div", {},
      reloj,
      h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1", style: "margin-top:32px", onClick: () => ir("login") }, "Iniciar sesión"),
      h("p", { class: "tenue", style: "margin-top:26px;font-size:12px" }, CONFIG.NEGOCIO.pieTicket),
    );

    limpiar(contenido).append(
      h("div", { style: "height:100%;display:grid;place-items:center" },
        h("div", { class: "glass card", style: "width:min(520px,92vw);text-align:center;padding:56px 40px" }, marca, tarjeta),
      ),
    );
  },
};

// Alta del primer administrador (solo en la primera corrida, base vacía).
function bootstrapCard(ir) {
  const nombre = h("input", { class: "input", type: "text", autocomplete: "off", placeholder: "Tu nombre", autofocus: true });
  const pass = h("input", { class: "input", type: "password", autocomplete: "new-password", placeholder: "Contraseña (mín. 6)" });
  const btn = h("button", { class: "btn btn-primario btn-lg btn-bloque", "data-glow": "1", type: "submit" }, "Crear administrador");

  async function crear(e) {
    e?.preventDefault();
    const n = nombre.value.trim();
    if (!n) { falla("Escribe tu nombre."); return; }
    if (pass.value.length < 6) { falla("La contraseña debe tener al menos 6 caracteres."); return; }
    btn.disabled = true; btn.textContent = "Creando…";
    const r = await crearPrimerAdmin(n, pass.value);
    if (!r.ok) { falla(r.error); btn.disabled = false; btn.textContent = "Crear administrador"; return; }
    exito("Administrador creado. Inicia sesión.");
    ir("login");
  }

  return h("form", { onSubmit: crear, style: "text-align:left;margin-top:6px" },
    h("h2", { style: "font-size:22px;margin-bottom:4px;text-align:center" }, "Primera configuración"),
    h("p", { class: "tenue", style: "margin:0 0 22px;text-align:center;font-size:13px" },
      "Crea la cuenta de administrador para empezar. Es solo esta computadora, sin internet ni correo."),
    h("div", { class: "campo", style: "margin-bottom:16px" }, h("label", {}, "Nombre"), nombre),
    h("div", { class: "campo", style: "margin-bottom:24px" }, h("label", {}, "Contraseña"), pass),
    btn,
  );
}
