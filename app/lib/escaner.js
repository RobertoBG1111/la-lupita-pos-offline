// ── Detector de lector de código de barras (keyboard-wedge) — POS "La Lupita" ─
// Un lector USB actúa como teclado: "teclea" el código muy rápido y termina con
// Enter, en el campo que tenga el foco. Eso rompe el flujo en cuanto el foco se
// va del campo esperado (al tocar un botón, al re-dibujarse un formulario, etc.).
//
// Este detector escucha a nivel de toda la página y distingue la RÁFAGA del lector
// (teclas casi instantáneas) de la ESCRITURA HUMANA (lenta): solo cuando detecta
// una ráfaga que termina en Enter entrega el código completo, sin importar qué
// elemento tenga el foco. La escritura humana normal nunca se ve afectada, porque
// cualquier pausa entre teclas reinicia el acumulador.
//
// Uso:
//   const desmontar = montarEscaner({ onCodigo: (code) => {...}, vivo: () => sigueEnPantalla });
//   // ...al salir de la pantalla se autolimpia (por `vivo`) o llama a `desmontar()`.

export function montarEscaner({ onCodigo, vivo, minLargo = 4, gapMs = 60 }) {
  let buf = "";
  let ultimo = 0;

  function onKey(e) {
    if (vivo && !vivo()) { document.removeEventListener("keydown", onKey, true); return; }
    const ahora = Date.now();

    if (e.key === "Enter") {
      const code = buf.trim();
      buf = "";
      if (code.length >= minLargo) { e.preventDefault(); e.stopPropagation(); onCodigo(code); }
      return;
    }

    // Solo caracteres de código de barras (letras/números). Así NO interferimos con
    // atajos como + − = ni con teclas de función: esas pasan libres a la pantalla.
    if (e.key.length !== 1 || !/[a-zA-Z0-9]/.test(e.key)) return;
    const gap = ahora - ultimo;
    if (gap > gapMs) buf = "";       // pausa larga = escritura humana → no acumula
    buf += e.key;
    ultimo = ahora;
    // Dentro de una ráfaga: no dejes que las teclas caigan en el campo enfocado.
    if (buf.length >= 2 && gap <= gapMs) { e.preventDefault(); e.stopPropagation(); }
  }

  document.addEventListener("keydown", onKey, true);
  return () => document.removeEventListener("keydown", onKey, true);
}
