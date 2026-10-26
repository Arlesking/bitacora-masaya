-- Bitácora Masaya: esquema inicial
-- Multi-hotel con grupos, roles por hotel, novedades, tareas, comentarios, lecturas y log de auditoría.

create extension if not exists pgcrypto;

-- ===== Catálogos =====
create type rol_t as enum ('operador','jefe_servicio','lider','admin');
create type urgencia_t as enum ('baja','media','alta','critica');
create type estado_novedad_t as enum ('abierta','seguimiento','cerrada','anulada');
create type estado_tarea_t as enum ('pendiente','en_curso','hecha','cancelada');

create table grupos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  creado_en timestamptz not null default now()
);

create table hoteles (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  grupo_id uuid references grupos(id),
  activo boolean not null default true,
  es_prueba boolean not null default false,
  creado_en timestamptz not null default now()
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  nombre text not null,
  activa boolean not null default true,
  unique (hotel_id, nombre)
);

-- Turnos configurables por área (hora_fin < hora_inicio = cruza medianoche)
create table turnos (
  id uuid primary key default gen_random_uuid(),
  area_id uuid not null references areas(id),
  nombre text not null,
  hora_inicio time not null,
  hora_fin time not null,
  activo boolean not null default true
);

create table tipos_novedad (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  nombre text not null,
  color text not null default '#6b7280',
  icono text,
  urgencia_defecto urgencia_t not null default 'media',
  activo boolean not null default true,
  unique (hotel_id, nombre)
);

-- ===== Personas y acceso =====
create table perfiles (
  id uuid primary key references auth.users(id),
  nombre text not null,
  correo text not null,
  es_admin_global boolean not null default false,
  activo boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Una persona puede estar en varios hoteles con distinto rol
create table membresias (
  id uuid primary key default gen_random_uuid(),
  perfil_id uuid not null references perfiles(id),
  hotel_id uuid not null references hoteles(id),
  area_id uuid references areas(id),       -- null para líder/admin de todo el hotel
  rol rol_t not null,
  activa boolean not null default true,
  unique (perfil_id, hotel_id)
);

-- ===== Novedades =====
create table novedades (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  autor_id uuid not null references perfiles(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  turno_id uuid references turnos(id),
  tipo_id uuid not null references tipos_novedad(id),
  urgencia urgencia_t not null,
  para_area_id uuid references areas(id),      -- null + para_perfil null = todo el hotel
  para_perfil_id uuid references perfiles(id),
  lugar text,
  descripcion text not null,
  foto_path text,
  compartida_grupo boolean not null default false,
  estado estado_novedad_t not null default 'abierta',
  motivo_anulacion text,
  check (estado <> 'anulada' or motivo_anulacion is not null)
);

create table novedad_lecturas (
  novedad_id uuid not null references novedades(id),
  perfil_id uuid not null references perfiles(id) default auth.uid(),
  leido_en timestamptz not null default now(),
  primary key (novedad_id, perfil_id)
);

-- ===== Tareas =====
create table tareas (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  creado_por uuid not null references perfiles(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  titulo text not null,
  descripcion text,
  area_id uuid references areas(id),            -- bandeja del área
  asignada_a uuid references perfiles(id),      -- persona (la pone jefe/líder o el operador se la toma)
  asignada_por uuid references perfiles(id),
  siguiente_turno boolean not null default false,
  fecha_limite timestamptz,
  urgencia urgencia_t not null default 'media',
  estado estado_tarea_t not null default 'pendiente',
  novedad_id uuid references novedades(id),     -- si salió de una novedad
  compartida_grupo boolean not null default false,
  completada_en timestamptz,
  nota_cierre text
);

-- Comentarios de seguimiento para novedades y tareas
create table comentarios (
  id uuid primary key default gen_random_uuid(),
  autor_id uuid not null references perfiles(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  novedad_id uuid references novedades(id),
  tarea_id uuid references tareas(id),
  texto text not null,
  check ((novedad_id is null) <> (tarea_id is null))
);

-- ===== Log de auditoría (lo llena la base de datos, no la página) =====
create table log_auditoria (
  id bigserial primary key,
  en timestamptz not null default now(),
  perfil_id uuid default auth.uid(),
  hotel_id uuid,
  tabla text not null,
  accion text not null,
  registro_id uuid,
  antes jsonb,
  despues jsonb
);

create or replace function fn_auditar() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_hotel uuid; v_new jsonb; v_old jsonb;
begin
  v_new := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_hotel := coalesce((v_new->>'hotel_id')::uuid, (v_old->>'hotel_id')::uuid);
  insert into log_auditoria(hotel_id, tabla, accion, registro_id, antes, despues)
  values (v_hotel, tg_table_name, tg_op,
          coalesce((v_new->>'id')::uuid, (v_old->>'id')::uuid), v_old, v_new);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['hoteles','areas','turnos','tipos_novedad','membresias','novedades','tareas','comentarios'] loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on %1$s for each row execute function fn_auditar()', t);
  end loop;
end $$;

-- Las novedades no se borran: solo se anulan
create or replace function fn_no_borrar() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'Las novedades no se pueden borrar; usa anular.'; end $$;
create trigger trg_no_borrar_novedades before delete on novedades for each row execute function fn_no_borrar();

-- ===== Funciones de permiso =====
create or replace function es_admin() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select es_admin_global from perfiles where id = auth.uid()), false)
$$;

create or replace function mi_rol(p_hotel uuid) returns rol_t language sql stable security definer set search_path = public as $$
  select case when es_admin() then 'admin'::rol_t
    else (select rol from membresias where perfil_id = auth.uid() and hotel_id = p_hotel and activa) end
$$;

create or replace function mi_area(p_hotel uuid) returns uuid language sql stable security definer set search_path = public as $$
  select area_id from membresias where perfil_id = auth.uid() and hotel_id = p_hotel and activa
$$;

-- ¿Puedo ver un registro de este hotel? (mi hotel, o compartido dentro de mi grupo)
create or replace function puedo_ver_hotel(p_hotel uuid, p_compartida boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select es_admin()
    or mi_rol(p_hotel) is not null
    or (p_compartida and exists (
          select 1 from membresias m join hoteles h on h.id = m.hotel_id
          join hoteles h2 on h2.id = p_hotel
          where m.perfil_id = auth.uid() and m.activa and h.grupo_id is not null and h.grupo_id = h2.grupo_id))
$$;

-- ===== Seguridad por filas (RLS) =====
alter table grupos enable row level security;
alter table hoteles enable row level security;
alter table areas enable row level security;
alter table turnos enable row level security;
alter table tipos_novedad enable row level security;
alter table perfiles enable row level security;
alter table membresias enable row level security;
alter table novedades enable row level security;
alter table novedad_lecturas enable row level security;
alter table tareas enable row level security;
alter table comentarios enable row level security;
alter table log_auditoria enable row level security;

create policy ver on grupos for select using (auth.uid() is not null);
create policy admin on grupos for all using (es_admin()) with check (es_admin());

create policy ver on hoteles for select using (es_admin() or mi_rol(id) is not null);
create policy admin on hoteles for all using (es_admin()) with check (es_admin());

create policy ver on areas for select using (mi_rol(hotel_id) is not null);
create policy lider on areas for all using (mi_rol(hotel_id) >= 'lider') with check (mi_rol(hotel_id) >= 'lider');

create policy ver on turnos for select using (exists (select 1 from areas a where a.id = area_id and mi_rol(a.hotel_id) is not null));
create policy lider on turnos for all
  using (exists (select 1 from areas a where a.id = area_id and mi_rol(a.hotel_id) >= 'lider'))
  with check (exists (select 1 from areas a where a.id = area_id and mi_rol(a.hotel_id) >= 'lider'));

create policy ver on tipos_novedad for select using (puedo_ver_hotel(hotel_id, true));
create policy lider on tipos_novedad for all using (mi_rol(hotel_id) >= 'lider') with check (mi_rol(hotel_id) >= 'lider');

-- Perfiles: me veo a mí y a compañeros de mis hoteles
create policy ver on perfiles for select using (
  id = auth.uid() or es_admin() or exists (
    select 1 from membresias m1 join membresias m2 on m1.hotel_id = m2.hotel_id
    where m1.perfil_id = auth.uid() and m2.perfil_id = perfiles.id));
create policy admin on perfiles for all using (es_admin()) with check (es_admin());

create policy ver on membresias for select using (perfil_id = auth.uid() or mi_rol(hotel_id) is not null);
create policy lider on membresias for all
  using (mi_rol(hotel_id) >= 'lider')
  with check (mi_rol(hotel_id) >= 'lider' and (rol < 'lider' or es_admin()));

-- Novedades: todo el personal del hotel ve las generales y las de su área/persona;
-- jefes ven su área; líder/admin todo. Las compartidas se ven en el grupo.
create policy ver on novedades for select using (
  puedo_ver_hotel(hotel_id, compartida_grupo) and (
    mi_rol(hotel_id) >= 'lider'
    or mi_rol(hotel_id) is null  -- visto vía grupo (solo compartidas)
    or (para_area_id is null and para_perfil_id is null)
    or para_perfil_id = auth.uid()
    or autor_id = auth.uid()
    or para_area_id = mi_area(hotel_id)));
create policy crear on novedades for insert with check (mi_rol(hotel_id) is not null and autor_id = auth.uid());
-- Cambiar estado: autor, jefes y líderes (la anulación exige motivo por el check)
create policy editar on novedades for update using (
  autor_id = auth.uid() or mi_rol(hotel_id) >= 'jefe_servicio')
  with check (mi_rol(hotel_id) is not null);

create policy ver on novedad_lecturas for select using (
  perfil_id = auth.uid() or exists (select 1 from novedades n where n.id = novedad_id and mi_rol(n.hotel_id) >= 'jefe_servicio'));
create policy marcar on novedad_lecturas for insert with check (perfil_id = auth.uid());

create policy ver on tareas for select using (
  puedo_ver_hotel(hotel_id, compartida_grupo) and (
    mi_rol(hotel_id) >= 'lider'
    or mi_rol(hotel_id) is null
    or asignada_a = auth.uid() or creado_por = auth.uid()
    or area_id = mi_area(hotel_id)
    or (area_id is null and asignada_a is null)));
create policy crear on tareas for insert with check (
  creado_por = auth.uid() and (
    mi_rol(hotel_id) >= 'jefe_servicio'
    or (mi_rol(hotel_id) = 'operador' and (area_id = mi_area(hotel_id) or asignada_a = auth.uid()))));
create policy editar on tareas for update using (
  mi_rol(hotel_id) >= 'jefe_servicio' or asignada_a = auth.uid() or creado_por = auth.uid()
  or (asignada_a is null and area_id = mi_area(hotel_id)))  -- operador se toma una tarea del área
  with check (mi_rol(hotel_id) is not null);

create policy ver on comentarios for select using (
  (novedad_id is not null and exists (select 1 from novedades n where n.id = novedad_id))
  or (tarea_id is not null and exists (select 1 from tareas t where t.id = tarea_id)));
create policy crear on comentarios for insert with check (autor_id = auth.uid() and (
  (novedad_id is not null and exists (select 1 from novedades n where n.id = novedad_id))
  or (tarea_id is not null and exists (select 1 from tareas t where t.id = tarea_id))));

create policy ver on log_auditoria for select using (es_admin() or (hotel_id is not null and mi_rol(hotel_id) >= 'lider'));
-- Sin políticas de insert/update/delete: solo los triggers escriben el log y nadie lo altera.

-- ===== Datos iniciales =====
insert into grupos (nombre) values ('Masaya Tayrona');
insert into hoteles (nombre, grupo_id) select 'Masaya Tayrona & Beach Club', id from grupos where nombre = 'Masaya Tayrona';
insert into hoteles (nombre, grupo_id) select 'Cayena by Masaya', id from grupos where nombre = 'Masaya Tayrona';
insert into hoteles (nombre, es_prueba) values ('Hotel de pruebas', true);

insert into areas (hotel_id, nombre)
select h.id, a from hoteles h, unnest(array['Recepción','Housekeeping','Mantenimiento','A&B']) a;

insert into tipos_novedad (hotel_id, nombre, color, urgencia_defecto)
select h.id, t.nombre, t.color, t.urg::urgencia_t from hoteles h, (values
  ('Queja o solicitud de huésped','#dc2626','alta'),
  ('Daño o mantenimiento','#ea580c','media'),
  ('Objeto perdido o encontrado','#7c3aed','baja'),
  ('Pendiente para el siguiente turno','#2563eb','media'),
  ('Llegada especial','#db2777','media'),
  ('Incidente de seguridad','#b91c1c','alta'),
  ('Accidente o salud','#991b1b','critica'),
  ('Faltante de insumos o inventario','#ca8a04','media'),
  ('Información general','#6b7280','baja')) t(nombre, color, urg);
