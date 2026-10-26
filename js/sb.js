import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

// "Recordarme" guarda la sesión en el dispositivo; si no, se borra al cerrar el navegador.
export function recordar() {
  try { return localStorage.getItem("recordar") !== "no"; } catch { return true; }
}
export function setRecordar(v) {
  try { localStorage.setItem("recordar", v ? "si" : "no"); } catch { /* sin almacenamiento */ }
}

// Se decide en cada lectura, así el cambio de "Recordarme" aplica sin recargar.
const memoria = new Map();
function almacen() {
  try { return recordar() ? localStorage : sessionStorage; } catch {
    return { getItem: (k) => memoria.get(k) ?? null, setItem: (k, v) => memoria.set(k, v), removeItem: (k) => memoria.delete(k) };
  }
}
const storage = {
  getItem: (k) => almacen().getItem(k),
  setItem: (k, v) => almacen().setItem(k, v),
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { memoria.delete(k); } },
};

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage, persistSession: true, autoRefreshToken: true },
});
