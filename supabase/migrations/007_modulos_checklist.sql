-- Módulos que el administrador enciende por hotel y para ciertas áreas, y el primero de ellos:
-- checklists por área y turno, con historial de quién marcó cada punto y cuándo.

-- ===== Módulos por hotel =====
create table modulos_hotel (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  modulo text not null check (modulo in ('checklist')),
  activo boolean not null default false,
  areas uuid[] not null default '{}',   -- áreas que lo usan; líderes y administradores lo ven siempre que esté activo
  unique (hotel_id, modulo)
);

-- ¿Puedo usar este módulo en este hotel (y en esta área, si se indica)?
-- El administrador siempre puede, para configurarlo y probarlo antes de encenderlo.
create or replace function puedo_usar_modulo(p_hotel uuid, p_modulo text, p_area uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin() or coalesce((
    select case when mi_rol(p_hotel) >= 'lider' then true
                else mi_area(p_hotel) = any(m.areas) and (p_area is null or p_area = mi_area(p_hotel)) end
    from modulos_hotel m where m.hotel_id = p_hotel and m.modulo = p_modulo and m.activo), false)
$$;

-- ===== Checklist =====
-- Una plantilla es la lista de un área; turno_id null = sirve para todos los turnos del área.
create table checklist_plantillas (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  area_id uuid not null references areas(id),
  turno_id uuid references turnos(id),
  nombre text not null,
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

create table checklist_items (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references checklist_plantillas(id),
  hotel_id uuid references hoteles(id),   -- lo pone la base de datos
  texto text not null,
  orden int not null default 0,
  activo boolean not null default true
);

-- Un registro es la lista de un día y turno concretos; se crea con la primera marca.
create table checklist_registros (
  id uuid primary key default gen_random_uuid(),
  plantilla_id uuid not null references checklist_plantillas(id),
  hotel_id uuid references hoteles(id),   -- lo pone la base de datos
  area_id uuid references areas(id),      -- lo pone la base de datos
  turno_id uuid references turnos(id),
  fecha date not null,                    -- día en que empezó el turno
  abierto_por uuid not null references perfiles(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  unique nulls not distinct (plantilla_id, fecha, turno_id)
);

create table checklist_marcas (
  id uuid primary key default gen_random_uuid(),
  registro_id uuid not null references checklist_registros(id),
  item_id uuid not null references checklist_items(id),
  hotel_id uuid references hoteles(id),   -- lo pone la base de datos
  texto text,                             -- copia del punto, por si luego se cambia la plantilla
  hecho boolean not null default true,
  nota text,
  marcado_por uuid references perfiles(id),
  marcado_en timestamptz not null default now(),
  unique (registro_id, item_id)
);

-- La base de datos completa y valida los datos que no deben venir de la página
create or replace function fn_checklist_plantilla() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hotel_id := (select hotel_id from areas where id = new.area_id);
  if new.turno_id is not null and not exists (select 1 from turnos where id = new.turno_id and area_id = new.area_id) then
    raise exception 'El turno no pertenece a esa área.';
  end if;
  return new;
end $$;

create or replace function fn_checklist_item() returns trigger
language plpgsql set search_path = public as $$
begin
  new.hotel_id := (select hotel_id from checklist_plantillas where id = new.plantilla_id);
  return new;
end $$;

create or replace function fn_checklist_registro() returns trigger
language plpgsql set search_path = public as $$
declare p checklist_plantillas;
begin
  select * into p from checklist_plantillas where id = new.plantilla_id;
  new.hotel_id := p.hotel_id;
  new.area_id := p.area_id;
  if p.turno_id is not null then new.turno_id := p.turno_id; end if;
  if new.turno_id is not null and not exists (select 1 from turnos where id = new.turno_id and area_id = p.area_id) then
    raise exception 'El turno no pertenece a esa área.';
  end if;
  return new;
end $$;

create or replace function fn_checklist_marca() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.registro_id <> old.registro_id or new.item_id <> old.item_id) then
    raise exception 'No se puede mover una marca.';
  end if;
  select i.hotel_id, i.texto into new.hotel_id, new.texto
  from checklist_items i join checklist_registros r on r.plantilla_id = i.plantilla_id
  where i.id = new.item_id and r.id = new.registro_id;
  if new.hotel_id is null then raise exception 'Ese punto no pertenece a este checklist.'; end if;
  new.marcado_por := auth.uid();
  new.marcado_en := now();
  return new;
end $$;

create trigger trg_checklist_plantilla before insert or update on checklist_plantillas for each row execute function fn_checklist_plantilla();
create trigger trg_checklist_item before insert or update on checklist_items for each row execute function fn_checklist_item();
create trigger trg_checklist_registro before insert or update on checklist_registros for each row execute function fn_checklist_registro();
create trigger trg_checklist_marca before insert or update on checklist_marcas for each row execute function fn_checklist_marca();

do $$ declare t text; begin
  foreach t in array array['modulos_hotel','checklist_plantillas','checklist_items','checklist_registros','checklist_marcas'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on %1$s for each row execute function fn_auditar()', t);
  end loop;
end $$;

-- ===== Seguridad por filas =====
alter table modulos_hotel enable row level security;
alter table checklist_plantillas enable row level security;
alter table checklist_items enable row level security;
alter table checklist_registros enable row level security;
alter table checklist_marcas enable row level security;

-- Todos en el hotel leen qué módulos hay (para armar el menú); solo el administrador los cambia.
create policy ver on modulos_hotel for select using (es_admin() or mi_rol(hotel_id) is not null);
create policy admin on modulos_hotel for all using (es_admin()) with check (es_admin());

-- Plantillas: las ve quien usa el módulo en esa área; las arma el líder o el administrador.
create policy ver on checklist_plantillas for select using (puedo_usar_modulo(hotel_id, 'checklist', area_id));
create policy lider on checklist_plantillas for all
  using (mi_rol(hotel_id) >= 'lider' and puedo_usar_modulo(hotel_id, 'checklist'))
  with check (mi_rol(hotel_id) >= 'lider' and puedo_usar_modulo(hotel_id, 'checklist'));

create policy ver on checklist_items for select using (exists (select 1 from checklist_plantillas p where p.id = plantilla_id));
create policy lider on checklist_items for all
  using (mi_rol(hotel_id) >= 'lider' and puedo_usar_modulo(hotel_id, 'checklist'))
  with check (mi_rol(hotel_id) >= 'lider' and puedo_usar_modulo(hotel_id, 'checklist'));

-- Registros: se ven en el área; se abren solo para hoy o el turno de anoche. Nadie los borra.
create policy ver on checklist_registros for select using (puedo_usar_modulo(hotel_id, 'checklist', area_id));
create policy abrir on checklist_registros for insert with check (
  abierto_por = auth.uid() and fecha between current_date - 1 and current_date + 1
  and puedo_usar_modulo(hotel_id, 'checklist', area_id));

-- Marcas: se marcan y desmarcan mientras el turno está reciente; después quedan como historial.
create policy ver on checklist_marcas for select using (exists (select 1 from checklist_registros r where r.id = registro_id));
create policy marcar on checklist_marcas for insert with check (exists (
  select 1 from checklist_registros r where r.id = registro_id and r.fecha >= current_date - 1
  and puedo_usar_modulo(r.hotel_id, 'checklist', r.area_id)));
create policy cambiar on checklist_marcas for update
  using (exists (select 1 from checklist_registros r where r.id = registro_id and r.fecha >= current_date - 1
    and puedo_usar_modulo(r.hotel_id, 'checklist', r.area_id)))
  with check (exists (select 1 from checklist_registros r where r.id = registro_id and r.fecha >= current_date - 1
    and puedo_usar_modulo(r.hotel_id, 'checklist', r.area_id)));

create index on checklist_plantillas (hotel_id, area_id);
create index on checklist_items (plantilla_id, orden);
create index on checklist_registros (hotel_id, fecha desc);
create index on checklist_marcas (registro_id);

revoke execute on function fn_checklist_plantilla(), fn_checklist_item(), fn_checklist_registro(), fn_checklist_marca() from public, anon, authenticated;
revoke execute on function puedo_usar_modulo(uuid, text, uuid) from public, anon;
grant execute on function puedo_usar_modulo(uuid, text, uuid) to authenticated;

-- Todos los hoteles empiezan con el módulo apagado
insert into modulos_hotel (hotel_id, modulo) select id, 'checklist' from hoteles;
