-- Hoteles del mismo grupo (para mostrar lo compartido), visible solo para quien pertenece al hotel.
create or replace function hoteles_del_grupo(p_hotel uuid) returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select h2.id, h2.nombre from hoteles h join hoteles h2 on h2.grupo_id = h.grupo_id
  where h.id = p_hotel and h.grupo_id is not null and mi_rol(p_hotel) is not null
$$;
revoke execute on function hoteles_del_grupo(uuid) from public, anon;
grant execute on function hoteles_del_grupo(uuid) to authenticated;

-- Los comentarios guardan el hotel para que aparezcan en el registro del líder.
alter table comentarios add column hotel_id uuid references hoteles(id);
create or replace function fn_hotel_comentario() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hotel_id := coalesce(
    (select hotel_id from novedades where id = new.novedad_id),
    (select hotel_id from tareas where id = new.tarea_id));
  return new;
end $$;
revoke execute on function fn_hotel_comentario() from public, anon, authenticated;
create trigger trg_hotel_comentario before insert on comentarios
for each row execute function fn_hotel_comentario();
