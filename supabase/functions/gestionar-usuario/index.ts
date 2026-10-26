// Crea usuarios y cambia PINs. Solo líderes (en su hotel) y administradores.
// Se necesita la clave de servicio para crear cuentas, por eso esto no puede vivir en la página.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ORDEN = ["operador", "jefe_servicio", "lider", "admin"];

function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: u, error: eu } = await admin.auth.getUser(token);
    if (eu || !u?.user) return resp({ error: "Sesión no válida" }, 401);

    // Cliente con la sesión de quien llama: lo que escribe queda en el log a su nombre
    const yo = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const b = await req.json();
    const { data: miRol } = await yo.rpc("mi_rol", { p_hotel: b.hotel_id });
    if (!miRol || ORDEN.indexOf(miRol) < ORDEN.indexOf("lider")) return resp({ error: "Solo líderes o administradores" }, 403);
    const soyAdmin = miRol === "admin";
    if (b.pin !== undefined && !/^\d{6}$/.test(String(b.pin))) return resp({ error: "El PIN debe tener 6 dígitos" }, 400);

    if (b.accion === "crear") {
      const correo = String(b.correo ?? "").trim().toLowerCase();
      const nombre = String(b.nombre ?? "").trim();
      if (!correo || !nombre) return resp({ error: "Falta correo o nombre" }, 400);
      if (!ORDEN.includes(b.rol) || b.rol === "admin") return resp({ error: "Rol no válido" }, 400);
      if (ORDEN.indexOf(b.rol) >= ORDEN.indexOf("lider") && !soyAdmin) return resp({ error: "Solo un administrador puede crear líderes" }, 403);

      const { data: existente } = await admin.from("perfiles").select("id").eq("correo", correo).maybeSingle();
      let id = existente?.id;
      if (!id) {
        if (!b.pin) return resp({ error: "Falta el PIN inicial" }, 400);
        const { data: nuevo, error } = await admin.auth.admin.createUser({
          email: correo, password: String(b.pin), email_confirm: true, user_metadata: { nombre },
        });
        if (error) return resp({ error: error.message }, 400);
        id = nuevo.user.id;
      }
      const { error: em } = await yo.from("membresias").upsert(
        { perfil_id: id, hotel_id: b.hotel_id, rol: b.rol, area_id: b.area_id || null, activa: true },
        { onConflict: "perfil_id,hotel_id" },
      );
      if (em) return resp({ error: em.message }, 400);
      return resp({ ok: true, id, yaExistia: !!existente });
    }

    if (b.accion === "resetear_pin") {
      const { data: m } = await admin.from("membresias").select("rol")
        .eq("perfil_id", b.perfil_id).eq("hotel_id", b.hotel_id).maybeSingle();
      if (!m) return resp({ error: "Esa persona no está en este hotel" }, 404);
      if (ORDEN.indexOf(m.rol) >= ORDEN.indexOf("lider") && !soyAdmin) return resp({ error: "Solo un administrador puede cambiar el PIN de un líder" }, 403);
      const { error } = await admin.auth.admin.updateUserById(b.perfil_id, { password: String(b.pin) });
      if (error) return resp({ error: error.message }, 400);
      return resp({ ok: true });
    }

    return resp({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return resp({ error: String(e) }, 500);
  }
});
