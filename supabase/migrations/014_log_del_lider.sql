-- El líder también ve el registro de actividad, pero solo lo que toca a sus áreas:
-- novedades y tareas que él puede ver (y sus comentarios), avisos que él ve,
-- turnos, checklists y personas de sus áreas. Gerente y administrador siguen viendo todo.
-- Es security invoker a propósito: las consultas de adentro pasan por las reglas (RLS) de quien mira.
create or replace function log_de_mis_areas(p_hotel uuid, p_tabla text, p_registro uuid, p_antes jsonb, p_despues jsonb)
returns boolean language sql stable set search_path = public as $$
  with d as (select coalesce(p_despues, p_antes) as j)
  select coalesce(case p_tabla
    when 'novedades' then exists (select 1 from novedades n where n.id = p_registro)
    when 'tareas' then exists (select 1 from tareas t where t.id = p_registro)
    when 'comentarios' then exists (select 1 from novedades n where n.id = ((select j from d)->>'novedad_id')::uuid)
                         or exists (select 1 from tareas t where t.id = ((select j from d)->>'tarea_id')::uuid)
    when 'avisos' then exists (select 1 from avisos a where a.id = p_registro)
    when 'turnos' then ((select j from d)->>'area_id')::uuid = any(mis_areas(p_hotel))
    when 'membresias' then ((select j from d)->>'area_id')::uuid = any(mis_areas(p_hotel))
                        or exists (select 1 from jsonb_array_elements_text(coalesce((select j from d)->'areas', '[]')) x
                                   where x::uuid = any(mis_areas(p_hotel)))
    when 'checklist_plantillas' then exists (select 1 from checklist_plantillas p where p.id = p_registro)
    when 'checklist_items' then exists (select 1 from checklist_plantillas p where p.id = ((select j from d)->>'plantilla_id')::uuid)
    when 'checklist_registros' then exists (select 1 from checklist_registros r where r.id = p_registro)
    when 'checklist_marcas' then exists (select 1 from checklist_registros r where r.id = ((select j from d)->>'registro_id')::uuid)
    else false end, false)
$$;
revoke execute on function log_de_mis_areas(uuid, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function log_de_mis_areas(uuid, text, uuid, jsonb, jsonb) to authenticated;

alter policy ver on log_auditoria using (
  es_admin()
  or (hotel_id is not null and mi_rol(hotel_id) >= 'gerente')
  or (hotel_id is not null and mi_rol(hotel_id) = 'lider' and log_de_mis_areas(hotel_id, tabla, registro_id, antes, despues)));
