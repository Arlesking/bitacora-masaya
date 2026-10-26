-- Ajustes propios de Supabase: perfiles automáticos, permisos de roles de API, índices.

-- Al crear un usuario en Auth se crea su perfil
create or replace function fn_nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into perfiles (id, nombre, correo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger trg_nuevo_usuario after insert on auth.users
for each row execute function fn_nuevo_usuario();

-- Sin sesión no se puede leer ni escribir nada
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- La gente solo puede actualizar su propio nombre
create policy editar_mio on perfiles for update using (id = auth.uid())
  with check (id = auth.uid() and es_admin_global = (select p.es_admin_global from perfiles p where p.id = auth.uid())
              and activo = (select p.activo from perfiles p where p.id = auth.uid()));

create index on novedades (hotel_id, creado_en desc);
create index on tareas (hotel_id, estado);
create index on membresias (perfil_id);
create index on log_auditoria (hotel_id, en desc);
create index on comentarios (novedad_id);
create index on comentarios (tarea_id);
