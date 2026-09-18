// ── Administración de Usuarios (solo admin) ─────────────────────────────────
// En la versión offline la gestión de usuarios es LOCAL (auth.js con PBKDF2 sobre
// IndexedDB), no una Edge Function. La tabla de integrantes se puede incrustar en
// Configuración › Usuarios (montarUsuarios) y también tiene su propia pantalla, que
// además ofrece el RESPALDO local (exportar/importar/borrar) — el equivalente
// offline del respaldo que en la nube da Supabase.
import { h, limpiar, exito, falla, confirmar, modal, fechaCorta, fechaHora } from "../lib/ui.js";
import { listarUsuarios } from "../lib/datos.js";
import { perfil, crearUsuario, setUsuarioActivo, resetPassword } from "../lib/auth.js";
import { exportarTodo, importarTodo, borrarTodo } from "../lib/almacen.js";

// Pinta la administración de integrantes dentro de `contenido` (un contenedor que
// provee la anfitriona: la pestaña Usuarios de Configuración o la pantalla Usuarios).
export async function montarUsuarios(contenido) {
  limpiar(contenido).append(h("div", { class: "cargando" }, "Cargando usuarios…"));
  let lista;
  try { lista = await listarUsuarios(); }
  catch (e) { console.error(e); limpiar(contenido).append(h("div", { class: "cargando" }, "No se pudieron cargar los usuarios.")); return; }
  const rerender = () => montarUsuarios(contenido);
  const yoId = perfil()?.id;

  async function accion(fn, okMsg) {
    try { const r = await fn(); if (!r.ok) { falla(r.error); return; } exito(okMsg); rerender(); }
    catch (e) { console.error(e); falla("Error: " + (e.message || "")); }
  }

  const filas = lista.map((u) => h("tr", { class: u.activo ? "" : "inactivo" },
    h("td", {}, h("strong", {}, u.nombre), u.id === yoId ? h("span", { class: "chip chip-tenue", style: "margin-left:8px" }, "tú") : null),
    h("td", {}, h("span", { class: "chip " + (u.rol === "admin" ? "chip-adv" : "chip-tenue") }, u.rol === "admin" ? "Administrador" : "Cajero")),
    h("td", {}, h("span", { class: "chip " + (u.activo ? "chip-ok" : "chip-tenue") }, u.activo ? "activo" : "inactivo")),
    h("td", { class: "tenue mono" }, u.created_at ? fechaCorta(u.created_at) : "—"),
    h("td", { class: "num" }, h("div", { class: "fila", style: "gap:6px;justify-content:flex-end" },
      h("button", { class: "btn btn-mini", onClick: () => resetModal(u, accion) }, "Contraseña"),
      u.id === yoId ? null : h("button", { class: "btn btn-mini", onClick: () =>
        accion(() => setUsuarioActivo(u.nombre, !u.activo), u.activo ? "Usuario desactivado" : "Usuario reactivado") },
        u.activo ? "Desactivar" : "Reactivar"),
    )),
  ));

  limpiar(contenido).append(
    h("div", { class: "fila entre", style: "align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px" },
      h("div", {},
        h("h3", { style: "margin:0 0 4px" }, "Integrantes"),
        h("p", { class: "tenue", style: "margin:0;font-size:13px" }, "Entran con nombre y contraseña (sin correo). Desactivar conserva el historial; no se borra.")),
      h("button", { class: "btn btn-primario", "data-glow": "1", onClick: () => altaModal(accion) }, "Agregar integrante"),
    ),
    h("div", { style: "overflow-x:auto" },
      h("table", { class: "tabla" },
        h("thead", {}, h("tr", {}, h("th", {}, "Nombre"), h("th", {}, "Rol"), h("th", {}, "Estado"), h("th", {}, "Alta"), h("th", {}, ""))),
        h("tbody", {}, ...filas),
      ),
    ),
  );
}

export const usuarios = {
  id: "usuarios", etiqueta: "Usuarios", titulo: "Usuarios", roles: ["admin"], enNav: true,
  render({ contenido }) {
    const tabla = h("div", { class: "glass card" });
    limpiar(contenido).append(
      h("div", { class: "titulo-seccion" },
        h("div", {}, h("h2", {}, "Usuarios"), h("p", {}, "Integrantes del sistema y respaldo de la información local."))),
      tabla,
      tarjetaRespaldo(),
    );
    montarUsuarios(tabla);
  },
};

// ── Respaldo local (exportar / importar toda la base) ────────────────────────
// Toda la información vive en ESTA computadora (IndexedDB). Si se daña o se
// formatea, se pierde todo: por eso hay que respaldar a un archivo .json y
// guardarlo en un USB o en la nube seguido.
function tarjetaRespaldo() {
  async function exportar() {
    try {
      const dump = await exportarTodo();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: `respaldo-la-lupita-${new Date().toISOString().slice(0, 10)}.json` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      exito("Respaldo descargado");
    } catch (e) { console.error(e); falla("No se pudo exportar el respaldo."); }
  }

  const fileInput = h("input", { type: "file", accept: "application/json,.json", style: "display:none",
    onChange: async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const ok = await confirmar(
        "Importar un respaldo REEMPLAZA toda la información actual (productos, ventas, usuarios, inventario) por la del archivo. Esto no se puede deshacer.",
        { titulo: "Importar respaldo", okTexto: "Reemplazar todo", peligro: true });
      if (!ok) return;
      try {
        const json = JSON.parse(await file.text());
        await importarTodo(json);
        exito("Respaldo importado. Recargando…");
        setTimeout(() => location.reload(), 900);
      } catch (err) { console.error(err); falla("No se pudo importar: archivo inválido o dañado."); }
    } });

  return h("div", { class: "glass card", style: "margin-top:var(--sp-4)" },
    h("h3", {}, "Respaldo de la información"),
    h("p", { class: "tenue", style: "margin:6px 0 14px;line-height:1.5;font-size:13px" },
      "Toda la información del negocio se guarda en esta computadora. No hay copia en la nube: si el equipo se daña o se formatea, se pierde todo. ",
      h("strong", {}, "Exporta un respaldo seguido"),
      " y guárdalo en una USB o en la nube."),
    h("div", { class: "fila", style: "gap:10px;flex-wrap:wrap" },
      h("button", { class: "btn btn-primario", "data-glow": "1", onClick: exportar }, "⬇️  Exportar respaldo (.json)"),
      h("button", { class: "btn", onClick: () => fileInput.click() }, "⬆️  Importar respaldo"),
      fileInput,
    ),
    h("p", { class: "tenue", style: "margin:12px 0 0;font-size:12px" }, `Ahora: ${fechaHora()}`),
    h("hr", { style: "border:none;border-top:1px solid rgba(14,21,36,.12);margin:18px 0" }),
    h("h4", { style: "margin:0 0 4px" }, "Empezar de cero"),
    h("p", { class: "tenue", style: "margin:0 0 12px;font-size:12px;line-height:1.5" },
      "Borra TODO en esta computadora (productos, ventas, inventario, usuarios). Úsalo solo para dejar el sistema limpio antes de arrancar de verdad. No se puede deshacer — exporta un respaldo antes si quieres conservar algo."),
    h("button", { class: "btn btn-peligro", onClick: borrarTodoAccion }, "🗑️  Borrar todo y empezar de cero"),
  );
}

async function borrarTodoAccion() {
  const ok = await confirmar(
    "Vas a BORRAR toda la información de esta computadora: productos, ventas, inventario, turnos y usuarios. Esto no se puede deshacer.",
    { titulo: "Borrar todo", okTexto: "Sí, borrar todo", peligro: true });
  if (!ok) return;
  const ok2 = await confirmar(
    "Última confirmación. Después de esto el sistema arrancará desde cero y tendrás que crear de nuevo el primer administrador.",
    { titulo: "¿Seguro?", okTexto: "Borrar definitivamente", peligro: true });
  if (!ok2) return;
  try {
    await borrarTodo();
    exito("Todo borrado. Reiniciando…");
    setTimeout(() => location.reload(), 900);
  } catch (e) { console.error(e); falla("No se pudo borrar la información."); }
}

function altaModal(accion) {
  modal((caja, cerrar) => {
    const nombre = h("input", { class: "input", placeholder: "María López" });
    const rol = h("select", { class: "select" }, h("option", { value: "cajero" }, "Cajero"), h("option", { value: "admin" }, "Administrador"));
    const pass = h("input", { class: "input", type: "password", placeholder: "Mínimo 6 caracteres" });
    const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: async () => {
      const n = nombre.value.trim();
      if (!n) { falla("Escribe el nombre del integrante."); return; }
      if (pass.value.length < 6) { falla("La contraseña debe tener al menos 6 caracteres."); return; }
      btn.disabled = true; btn.textContent = "Creando…";
      await accion(() => crearUsuario({ nombre: n, rol: rol.value, password: pass.value }), `${n} agregado`);
      cerrar();
    } }, "Crear integrante");
    caja.append(
      h("h3", {}, "Agregar integrante"),
      h("p", { class: "tenue", style: "margin:6px 0 16px;font-size:13px" }, "Entrará con su nombre y contraseña; no usa correo."),
      h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Nombre"), nombre),
      h("div", { class: "campo", style: "margin-bottom:12px" }, h("label", {}, "Rol"), rol),
      h("div", { class: "campo", style: "margin-bottom:18px" }, h("label", {}, "Contraseña"), pass),
      h("div", { class: "fila entre" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
    );
  });
}

function resetModal(u, accion) {
  modal((caja, cerrar) => {
    const pass = h("input", { class: "input", type: "password", placeholder: "Nueva contraseña (mín. 6)" });
    const btn = h("button", { class: "btn btn-primario btn-bloque", onClick: async () => {
      if (pass.value.length < 6) { falla("La contraseña debe tener al menos 6 caracteres."); return; }
      btn.disabled = true; btn.textContent = "Guardando…";
      await accion(() => resetPassword(u.nombre, pass.value), "Contraseña restablecida");
      cerrar();
    } }, "Guardar contraseña");
    caja.append(
      h("h3", {}, "Restablecer contraseña"),
      h("p", { class: "tenue", style: "margin:6px 0 16px;font-size:13px" }, `Nueva contraseña para ${u.nombre}.`),
      h("div", { class: "campo", style: "margin-bottom:18px" }, h("label", {}, "Contraseña"), pass),
      h("div", { class: "fila entre" }, h("button", { class: "btn btn-fantasma", onClick: cerrar }, "Cancelar"), btn),
    );
  });
}
