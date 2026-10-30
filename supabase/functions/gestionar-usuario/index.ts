// Crea, corrige y elimina usuarios, y cambia PINs. Solo gerentes (en su hotel) y administradores.
// Se necesita la clave de servicio para crear cuentas, por eso esto no puede vivir en la página.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ORDEN = ["operador", "jefe_servicio", "lider", "gerente", "admin"];

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
    if (!miRol || ORDEN.indexOf(miRol) < ORDEN.indexOf("gerente")) return resp({ error: "Solo gerentes o administradores" }, 403);
    const soyAdmin = miRol === "admin";
    if (b.pin !== undefined && !/^\d{6}$/.test(String(b.pin))) return resp({ error: "El PIN debe tener 6 dígitos" }, 400);

    if (b.accion === "crear") {
      const correo = String(b.correo ?? "").trim().toLowerCase();
      const nombre = String(b.nombre ?? "").trim();
      if (!correo || !nombre) return resp({ error: "Falta correo o nombre" }, 400);
      if (!ORDEN.includes(b.rol) || b.rol === "admin") return resp({ error: "Rol no válido" }, 400);
      if (ORDEN.indexOf(b.rol) >= ORDEN.indexOf("gerente") && !soyAdmin) return resp({ error: "Solo un administrador puede crear gerentes" }, 403);
      const areas = Array.isArray(b.areas) ? b.areas.filter((a: unknown) => typeof a === "string") : [];
      if (b.rol === "lider" && !areas.length && !b.area_id) return resp({ error: "Elige al menos un área para el líder" }, 400);

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
        { perfil_id: id, hotel_id: b.hotel_id, rol: b.rol, area_id: b.area_id || null, areas, activa: true },
        { onConflict: "perfil_id,hotel_id" },
      );
      if (em) return resp({ error: em.message }, 400);
      return resp({ ok: true, id, yaExistia: !!existente });
    }

    // Las demás acciones son sobre una persona de este hotel; a un gerente solo lo toca un administrador
    const { data: m } = await admin.from("membresias").select("id, rol")
      .eq("perfil_id", b.perfil_id).eq("hotel_id", b.hotel_id).maybeSingle();
    if (!m) return resp({ error: "Esa persona no está en este hotel" }, 404);
    if (b.perfil_id === u.user.id) return resp({ error: "Tus propios datos se cambian desde Mi cuenta" }, 400);
    if (ORDEN.indexOf(m.rol) >= ORDEN.indexOf("gerente") && !soyAdmin) return resp({ error: "Solo un administrador puede cambiar a un gerente" }, 403);
    const registrar = (accion: string, antes: unknown, despues: unknown) =>
      admin.from("log_auditoria").insert({ perfil_id: u.user.id, hotel_id: b.hotel_id, tabla: "perfiles", accion, registro_id: b.perfil_id, antes, despues });

    if (b.accion === "resetear_pin") {
      const { error } = await admin.auth.admin.updateUserById(b.perfil_id, { password: String(b.pin) });
      if (error) return resp({ error: error.message }, 400);
      await registrar("UPDATE", { pin: "anterior" }, { pin: "nuevo" });
      return resp({ ok: true });
    }

    if (b.accion === "editar") {
      const correo = String(b.correo ?? "").trim().toLowerCase();
      const nombre = String(b.nombre ?? "").trim();
      if (!correo || !nombre) return resp({ error: "Falta correo o nombre" }, 400);
      const { data: antes } = await admin.from("perfiles").select("nombre, correo").eq("id", b.perfil_id).single();
      if (correo !== antes.correo) {
        const { data: otro } = await admin.from("perfiles").select("id").eq("correo", correo).maybeSingle();
        if (otro) return resp({ error: "Ese correo ya lo usa otra persona" }, 409);
        const { error } = await admin.auth.admin.updateUserById(b.perfil_id, { email: correo, email_confirm: true });
        if (error) return resp({ error: error.message }, 400);
      }
      const { error: ep } = await admin.from("perfiles").update({ nombre, correo }).eq("id", b.perfil_id);
      if (ep) return resp({ error: ep.message }, 400);
      await registrar("UPDATE", antes, { nombre, correo });
      return resp({ ok: true });
    }

    if (b.accion === "eliminar") {
      // Solo se borra a quien no ha dejado nada en la bitácora; si tiene historial, se le quita el acceso
      const id = b.perfil_id;
      const conteos = await Promise.all([
        admin.from("novedades").select("id", { count: "exact", head: true }).or(`autor_id.eq.${id},para_perfil_id.eq.${id}`),
        admin.from("tareas").select("id", { count: "exact", head: true }).or(`creado_por.eq.${id},asignada_a.eq.${id},asignada_por.eq.${id}`),
        admin.from("comentarios").select("id", { count: "exact", head: true }).eq("autor_id", id),
        admin.from("novedad_lecturas").select("novedad_id", { count: "exact", head: true }).eq("perfil_id", id),
      ]);
      if (conteos.some((c) => c.error)) return resp({ error: "No se pudo revisar su historial" }, 500);
      if (conteos.some((c) => (c.count ?? 0) > 0)) {
        return resp({ error: "Esta persona ya tiene registros en la bitácora. Para no perder el historial, quítale el acceso en vez de eliminarla." }, 409);
      }
      const { data: antes } = await admin.from("perfiles").select("nombre, correo").eq("id", id).single();
      // El acceso a este hotel se borra con la sesión de quien llama, para que el registro diga quién fue
      const { error: em } = await yo.from("membresias").delete().eq("id", m.id);
      if (em) return resp({ error: em.message }, 400);
      const { count: otros } = await admin.from("membresias").select("id", { count: "exact", head: true }).eq("perfil_id", id);
      if ((otros ?? 0) > 0) {
        await registrar("DELETE", antes, null);
        return resp({ ok: true, soloEsteHotel: true });
      }
      const { error: ep } = await admin.from("perfiles").delete().eq("id", id);
      if (ep) return resp({ error: ep.message }, 400);
      const { error: eu2 } = await admin.auth.admin.deleteUser(id);
      if (eu2) return resp({ error: eu2.message }, 400);
      await registrar("DELETE", antes, null);
      return resp({ ok: true });
    }

    return resp({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return resp({ error: String(e) }, 500);
  }
});
