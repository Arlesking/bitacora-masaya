import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// Con señal débil una petición puede quedarse colgada: a los 20 segundos se corta y cuenta como "sin señal".
// Cada respuesta dice si hubo señal: si vino de la red, o si vino de la copia guardada en el celular (sw.js).
const LIMITE_MS = 20000;
const avisarSenal = (hay) => window.dispatchEvent(new CustomEvent("senal", { detail: hay }));
async function fetchConLimite(url, opciones = {}) {
  const corte = new AbortController();
  const t = setTimeout(() => corte.abort(), LIMITE_MS);
  opciones.signal?.addEventListener("abort", () => corte.abort());
  try {
    const res = await fetch(url, { ...opciones, signal: corte.signal });
    avisarSenal(!res.headers.get("x-bitacora-guardado") && res.status < 500);
    return res;
  } catch (err) {
    avisarSenal(false);
    throw err;
  } finally { clearTimeout(t); }
}

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchConLimite },
});
