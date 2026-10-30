-- "Traer de otro hotel": la gente que ya trabaja en otros hoteles donde quien llama es líder o administrador,
-- y que aún no está en este hotel. Así se le da acceso tocando su nombre, sin escribir el correo.
-- La gente del Hotel de pruebas solo aparece al agregar a otro hotel de pruebas.
create or replace function personas_de_otros_hoteles(p_hotel uuid)
returns table (perfil_id uuid, nombre text, correo text, hoteles text, rol rol_t, area text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.correo,
         string_agg(h.nombre, ', ' order by h.nombre),
         (array_agg(m.rol order by m.rol desc))[1],
         (array_agg(a.nombre order by m.rol desc) filter (where a.nombre is not null))[1]
  from membresias m
  join perfiles p on p.id = m.perfil_id
  join hoteles h on h.id = m.hotel_id
  left join areas a on a.id = m.area_id
  where mi_rol(p_hotel) in ('lider', 'admin')
    and mi_rol(m.hotel_id) in ('lider', 'admin')
    and m.hotel_id <> p_hotel and m.activa and m.rol <> 'admin'
    and p.activo and not p.es_admin_global and p.id <> auth.uid()
    and h.es_prueba = (select es_prueba from hoteles where id = p_hotel)
    and not exists (select 1 from membresias x where x.perfil_id = p.id and x.hotel_id = p_hotel)
  group by p.id, p.nombre, p.correo
  order by p.nombre
$$;
revoke execute on function personas_de_otros_hoteles(uuid) from public, anon;
grant execute on function personas_de_otros_hoteles(uuid) to authenticated;

-- En qué otros hoteles trabaja cada persona de este hotel, para dejar claro que su correo y PIN sirven en todos.
create or replace function otros_hoteles_de_personas(p_hotel uuid)
returns table (perfil_id uuid, hoteles text)
language sql stable security definer set search_path = public as $$
  select m.perfil_id, string_agg(h.nombre, ', ' order by h.nombre)
  from membresias m
  join hoteles h on h.id = m.hotel_id
  where mi_rol(p_hotel) in ('lider', 'admin')
    and m.hotel_id <> p_hotel and m.activa and h.activo
    and exists (select 1 from membresias x where x.perfil_id = m.perfil_id and x.hotel_id = p_hotel)
  group by m.perfil_id
$$;
revoke execute on function otros_hoteles_de_personas(uuid) from public, anon;
grant execute on function otros_hoteles_de_personas(uuid) to authenticated;
