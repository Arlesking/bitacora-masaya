-- El líder agrega y maneja a la gente de sus áreas, en su hotel.
--   Solo como Operador o Jefe de servicio, y solo en un área que él lidera.
--   No toca a otros líderes, gerentes ni administradores, ni a gente de otras áreas.
-- El gerente y el administrador siguen igual. Se usa ALTER POLICY / CREATE OR REPLACE: no se borra nada.

-- ¿Esta persona tiene en algún hotel un rol de líder o más alto (o es administrador)?
-- A esa gente el líder no le cambia PIN ni correo, porque son los mismos en todos sus hoteles.
create or replace function tiene_rol_alto(p_perfil uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias where perfil_id = p_perfil and rol >= 'lider')
      or coalesce((select es_admin_global from perfiles where id = p_perfil), false)
$$;
revoke execute on function tiene_rol_alto(uuid) from public, anon;
grant execute on function tiene_rol_alto(uuid) to authenticated;

-- Accesos al hotel: gerente+ como antes; el líder, operadores y jefes de sus áreas (nunca a sí mismo)
alter policy lider on membresias
  using ((mi_rol(hotel_id) >= 'gerente' and (rol < 'gerente' or es_admin()))
         or (mi_rol(hotel_id) = 'lider' and rol < 'lider' and perfil_id <> auth.uid()
             and area_id is not null and area_id = any(mis_areas(hotel_id))))
  with check ((mi_rol(hotel_id) >= 'gerente' and (rol < 'gerente' or es_admin()))
              or (mi_rol(hotel_id) = 'lider' and rol < 'lider' and perfil_id <> auth.uid()
                  and area_id is not null and area_id = any(mis_areas(hotel_id))));

-- Buscar por correo al agregar: ahora también el líder
create or replace function persona_por_correo(p_hotel uuid, p_correo text)
returns table (nombre text, en_este_hotel boolean)
language sql stable security definer set search_path = public as $$
  select p.nombre,
         exists (select 1 from membresias m where m.perfil_id = p.id and m.hotel_id = p_hotel)
  from perfiles p
  where p.correo = lower(trim(p_correo))
    and mi_rol(p_hotel) >= 'lider'
$$;

-- Traer de otro hotel: el líder ve a la gente de los hoteles donde también es líder (o más),
-- pero solo a operadores y jefes (no a otros líderes ni gerentes)
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
  where mi_rol(p_hotel) >= 'lider'
    and mi_rol(m.hotel_id) >= 'lider'
    and (mi_rol(p_hotel) >= 'gerente' or not tiene_rol_alto(p.id))
    and m.hotel_id <> p_hotel and m.activa and m.rol <> 'admin'
    and p.activo and not p.es_admin_global and p.id <> auth.uid()
    and h.es_prueba = (select es_prueba from hoteles where id = p_hotel)
    and not exists (select 1 from membresias x where x.perfil_id = p.id and x.hotel_id = p_hotel)
  group by p.id, p.nombre, p.correo
  order by p.nombre
$$;

-- En qué otros hoteles trabaja cada persona: ahora también lo ve el líder
create or replace function otros_hoteles_de_personas(p_hotel uuid)
returns table (perfil_id uuid, hoteles text)
language sql stable security definer set search_path = public as $$
  select m.perfil_id, string_agg(h.nombre, ', ' order by h.nombre)
  from membresias m
  join hoteles h on h.id = m.hotel_id
  where mi_rol(p_hotel) >= 'lider'
    and m.hotel_id <> p_hotel and m.activa and h.activo
    and exists (select 1 from membresias x where x.perfil_id = m.perfil_id and x.hotel_id = p_hotel)
  group by m.perfil_id
$$;
