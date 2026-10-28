-- Una novedad con tareas pendientes o en curso no se puede cerrar a mano.
-- El cierre automático de la 006 sigue funcionando porque ocurre cuando ya no quedan tareas abiertas.
-- Es security definer para ver todas las tareas de la novedad aunque quien cierra no las vea por RLS.
create or replace function fn_no_cerrar_con_tareas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cerrada' and old.estado <> 'cerrada' and exists (
    select 1 from tareas where novedad_id = new.id and estado in ('pendiente', 'en_curso')) then
    raise exception 'No se puede cerrar: la novedad tiene tareas sin terminar.';
  end if;
  return new;
end $$;
revoke execute on function fn_no_cerrar_con_tareas() from public, anon, authenticated;
create trigger trg_no_cerrar_con_tareas before update of estado on novedades
for each row execute function fn_no_cerrar_con_tareas();

-- Al agregar a alguien, saber si su correo ya tiene cuenta (en cualquier hotel) para no pedir otro PIN.
-- Solo responde a líderes o administradores del hotel indicado, y solo devuelve el nombre.
create or replace function persona_por_correo(p_hotel uuid, p_correo text)
returns table (nombre text, en_este_hotel boolean)
language sql stable security definer set search_path = public as $$
  select p.nombre,
         exists (select 1 from membresias m where m.perfil_id = p.id and m.hotel_id = p_hotel)
  from perfiles p
  where p.correo = lower(trim(p_correo))
    and mi_rol(p_hotel) in ('lider', 'admin')
$$;
revoke execute on function persona_por_correo(uuid, text) from public, anon;
grant execute on function persona_por_correo(uuid, text) to authenticated;
