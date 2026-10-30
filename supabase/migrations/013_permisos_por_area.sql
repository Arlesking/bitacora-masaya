-- Roles por área:
--   Operador y Jefe de servicio: una sola área (area_id), como antes.
--   Líder: una o varias áreas (areas). Maneja avisos, turnos y checklists de ellas y ve lo de sus áreas.
--   Gerente: todo su hotel. Avisos a todo el hotel, agrega personas, ve el registro. No cambia ajustes.
--   Administrador: todo, en todos los hoteles. Es el único que cambia áreas y tipos de novedad.
-- Los avisos de "Tener en cuenta" pasan a tener áreas destino (vacío = todo el hotel).
-- Se usa ALTER POLICY (no DROP) para no borrar nada; algunas políticas conservan su nombre "lider".

-- ===== Áreas de cada persona en un hotel =====
alter table membresias add column if not exists areas uuid[] not null default '{}';

-- La base de datos mantiene las dos columnas de acuerdo:
-- líder: areas es la lista y area_id la primera; operador y jefe: areas = [area_id]; gerente y admin: sin área.
create or replace function fn_membresia_areas() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.rol = 'lider' then
    new.areas := array(select x from unnest(coalesce(new.areas, '{}') || array_remove(array[new.area_id], null)) with ordinality t(x, i)
                       group by x order by min(i));
    if cardinality(new.areas) = 0 then raise exception 'Un líder necesita al menos un área.'; end if;
    new.area_id := case when new.area_id = any(new.areas) then new.area_id else new.areas[1] end;
  elsif new.rol in ('gerente', 'admin') then
    new.areas := '{}';
    new.area_id := null;
  else
    new.areas := array_remove(array[new.area_id], null);
  end if;
  if exists (select 1 from unnest(new.areas) x where not exists (select 1 from areas a where a.id = x and a.hotel_id = new.hotel_id)) then
    raise exception 'Esa área no es de este hotel.';
  end if;
  return new;
end $$;
revoke execute on function fn_membresia_areas() from public, anon, authenticated;
create trigger trg_membresia_areas before insert or update on membresias
for each row execute function fn_membresia_areas();

-- Los líderes actuales conservan su área; si no tenían ninguna (líder de todo el hotel), quedan con todas.
update membresias m set areas = case when m.area_id is not null then array[m.area_id]
  else array(select a.id from areas a where a.hotel_id = m.hotel_id and a.activa order by a.nombre) end
where m.rol = 'lider';
update membresias set areas = array[area_id] where rol in ('operador', 'jefe_servicio') and area_id is not null;

-- ===== Funciones de permiso =====
-- Mis áreas en este hotel (vacío para gerente y administrador, que ven todas)
create or replace function mis_areas(p_hotel uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce((select areas from membresias where perfil_id = auth.uid() and hotel_id = p_hotel and activa), '{}')
$$;

-- Mi rol frente a un área: gerente y administrador en todas las de su hotel; los demás solo en las suyas.
create or replace function mi_rol_en_area(p_area uuid) returns rol_t language sql stable security definer set search_path = public as $$
  select case when es_admin() then 'admin'::rol_t else (
    select case when m.rol >= 'gerente' then m.rol when p_area = any(m.areas) then m.rol end
    from areas a join membresias m on m.hotel_id = a.hotel_id
    where a.id = p_area and m.perfil_id = auth.uid() and m.activa) end
$$;

-- ¿Puedo crear o cambiar un aviso para estas áreas? Vacío = todo el hotel, solo gerente o administrador.
-- Con áreas: jefe de servicio o líder de cada una (o gerente/administrador). Las áreas deben ser del hotel.
create or replace function puedo_avisar(p_hotel uuid, p_areas uuid[]) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when coalesce(cardinality(p_areas), 0) = 0 then coalesce(mi_rol(p_hotel) >= 'gerente', false)
    when exists (select 1 from unnest(p_areas) x where not exists (select 1 from areas a where a.id = x and a.hotel_id = p_hotel)) then false
    else coalesce(mi_rol(p_hotel) >= 'gerente', false)
      or not exists (select 1 from unnest(p_areas) x where coalesce(mi_rol_en_area(x) >= 'jefe_servicio', false) = false)
  end
$$;

-- Módulos: gerente y administrador los ven siempre que estén activos; los demás, en sus áreas que lo usan.
create or replace function puedo_usar_modulo(p_hotel uuid, p_modulo text, p_area uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or coalesce((
    select case when mi_rol(p_hotel) >= 'gerente' then true
                when p_area is null then m.areas && mis_areas(p_hotel)
                else p_area = any(m.areas) and p_area = any(mis_areas(p_hotel)) end
    from modulos_hotel m where m.hotel_id = p_hotel and m.modulo = p_modulo and m.activo), false)
$$;

revoke execute on function mis_areas(uuid), mi_rol_en_area(uuid), puedo_avisar(uuid, uuid[]) from public, anon;
grant execute on function mis_areas(uuid), mi_rol_en_area(uuid), puedo_avisar(uuid, uuid[]) to authenticated;

-- ===== Ajustes =====
-- Áreas y tipos de novedad: solo el administrador
alter policy lider on areas using (mi_rol(hotel_id) = 'admin') with check (mi_rol(hotel_id) = 'admin');
alter policy lider on tipos_novedad using (mi_rol(hotel_id) = 'admin') with check (mi_rol(hotel_id) = 'admin');

-- Turnos: el líder de esa área o el administrador
alter policy lider on turnos
  using (mi_rol_en_area(area_id) in ('lider', 'admin'))
  with check (mi_rol_en_area(area_id) in ('lider', 'admin'));

-- Checklists: el líder de esa área (si el área usa el módulo) o el administrador.
-- Los puntos siguen a su lista: solo se ven si se ve la lista.
alter policy lider on checklist_plantillas
  using (mi_rol_en_area(area_id) in ('lider', 'admin') and puedo_usar_modulo(hotel_id, 'checklist', area_id))
  with check (mi_rol_en_area(area_id) in ('lider', 'admin') and puedo_usar_modulo(hotel_id, 'checklist', area_id));
alter policy lider on checklist_items
  using (exists (select 1 from checklist_plantillas p where p.id = plantilla_id and mi_rol_en_area(p.area_id) in ('lider', 'admin')))
  with check (exists (select 1 from checklist_plantillas p where p.id = plantilla_id and mi_rol_en_area(p.area_id) in ('lider', 'admin')));

-- Personas: el gerente agrega y cambia a quienes están por debajo de él; a un gerente solo lo toca el administrador
alter policy lider on membresias
  using (mi_rol(hotel_id) >= 'gerente' and (rol < 'gerente' or es_admin()))
  with check (mi_rol(hotel_id) >= 'gerente' and (rol < 'gerente' or es_admin()));

-- Registro de actividad: gerente y administrador
alter policy ver on log_auditoria using (es_admin() or (hotel_id is not null and mi_rol(hotel_id) >= 'gerente'));

-- ===== Lo que cada quien ve =====
-- Novedades: el gerente ve todo su hotel; los demás, lo general, lo suyo y lo de sus áreas
alter policy ver on novedades using (
  puedo_ver_hotel(hotel_id, compartida_grupo) and (
    mi_rol(hotel_id) >= 'gerente'
    or mi_rol(hotel_id) is null  -- visto vía grupo (solo compartidas)
    or (para_area_id is null and coalesce(cardinality(para_areas), 0) = 0 and para_perfil_id is null)
    or para_perfil_id = auth.uid()
    or autor_id = auth.uid()
    or para_area_id = any(mis_areas(hotel_id))
    or para_areas && mis_areas(hotel_id)));

alter policy ver on tareas using (
  puedo_ver_hotel(hotel_id, compartida_grupo) and (
    mi_rol(hotel_id) >= 'gerente'
    or mi_rol(hotel_id) is null
    or asignada_a = auth.uid() or creado_por = auth.uid()
    or area_id = any(mis_areas(hotel_id))
    or (area_id is null and asignada_a is null)));

-- Tareas: las asigna y cambia el jefe o líder de su área (o el gerente), además de quien la tiene o la creó
alter policy editar on tareas using (
  mi_rol(hotel_id) >= 'gerente'
  or coalesce(mi_rol_en_area(area_id) >= 'jefe_servicio', false)
  or asignada_a = auth.uid() or creado_por = auth.uid()
  or (asignada_a is null and area_id = any(mis_areas(hotel_id))))  -- operador se toma una tarea del área
  with check (mi_rol(hotel_id) is not null);

-- ===== Avisos de "Tener en cuenta" por área =====
alter table avisos add column if not exists areas uuid[];   -- null o vacío = todo el hotel
create index if not exists avisos_areas_idx on avisos using gin (areas);

alter policy ver on avisos using (
  mi_rol(hotel_id) >= 'gerente'
  or (mi_rol(hotel_id) is not null and (coalesce(cardinality(areas), 0) = 0 or areas && mis_areas(hotel_id) or autor_id = auth.uid())));
alter policy crear on avisos
  with check (puedo_avisar(hotel_id, areas) and autor_id = auth.uid() and quitado_en is null);
alter policy editar on avisos
  using (puedo_avisar(hotel_id, areas)) with check (puedo_avisar(hotel_id, areas));

-- ===== Funciones para agregar personas: ahora del gerente =====
create or replace function persona_por_correo(p_hotel uuid, p_correo text)
returns table (nombre text, en_este_hotel boolean)
language sql stable security definer set search_path = public as $$
  select p.nombre,
         exists (select 1 from membresias m where m.perfil_id = p.id and m.hotel_id = p_hotel)
  from perfiles p
  where p.correo = lower(trim(p_correo))
    and mi_rol(p_hotel) >= 'gerente'
$$;

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
  where mi_rol(p_hotel) >= 'gerente'
    and mi_rol(m.hotel_id) >= 'gerente'
    and m.hotel_id <> p_hotel and m.activa and m.rol <> 'admin'
    and p.activo and not p.es_admin_global and p.id <> auth.uid()
    and h.es_prueba = (select es_prueba from hoteles where id = p_hotel)
    and not exists (select 1 from membresias x where x.perfil_id = p.id and x.hotel_id = p_hotel)
  group by p.id, p.nombre, p.correo
  order by p.nombre
$$;

create or replace function otros_hoteles_de_personas(p_hotel uuid)
returns table (perfil_id uuid, hoteles text)
language sql stable security definer set search_path = public as $$
  select m.perfil_id, string_agg(h.nombre, ', ' order by h.nombre)
  from membresias m
  join hoteles h on h.id = m.hotel_id
  where mi_rol(p_hotel) >= 'gerente'
    and m.hotel_id <> p_hotel and m.activa and h.activo
    and exists (select 1 from membresias x where x.perfil_id = m.perfil_id and x.hotel_id = p_hotel)
  group by m.perfil_id
$$;
