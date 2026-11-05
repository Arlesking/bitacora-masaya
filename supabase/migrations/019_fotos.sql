-- Fotos en novedades, tareas, seguimiento y cierre de tareas.
-- El archivo va en Supabase Storage (bucket privado "fotos", ruta <hotel>/<id>.jpg) y aquí queda su registro.
-- Ve la foto quien ve la novedad o la tarea. Máximo 3 fotos por cosa (la novedad, cada comentario, el cierre).
-- Las fotos no se borran solas: el Administrador libera espacio a mano y la fila queda con "borrada_en".

create table fotos (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  autor_id uuid not null references perfiles(id) default auth.uid(),
  creado_en timestamptz not null default now(),
  novedad_id uuid references novedades(id),
  tarea_id uuid references tareas(id),
  comentario_id uuid references comentarios(id),
  de_cierre boolean not null default false,       -- "foto de cómo quedó" al marcar una tarea hecha
  ruta text not null unique,
  bytes integer not null check (bytes between 1 and 2000000),
  borrada_en timestamptz,                          -- el archivo se borró para liberar espacio
  check ((novedad_id is null) <> (tarea_id is null)),
  check (not de_cierre or tarea_id is not null)
);
create index fotos_novedad_idx on fotos (novedad_id) where novedad_id is not null;
create index fotos_tarea_idx on fotos (tarea_id) where tarea_id is not null;
create index fotos_creado_idx on fotos (creado_en) where borrada_en is null;

create or replace function fn_foto() returns trigger
language plpgsql set search_path = public as $$
declare v_cuantas int;
begin
  if tg_op = 'UPDATE' then
    -- Lo único que cambia es que se borró el archivo
    if (to_jsonb(new) - 'borrada_en') <> (to_jsonb(old) - 'borrada_en') or old.borrada_en is not null or new.borrada_en is null then
      raise exception 'Una foto no se puede cambiar.';
    end if;
    return new;
  end if;
  new.autor_id := auth.uid();
  new.borrada_en := null;
  new.hotel_id := coalesce((select hotel_id from novedades where id = new.novedad_id),
                           (select hotel_id from tareas where id = new.tarea_id));
  if new.comentario_id is not null and not exists (select 1 from comentarios c where c.id = new.comentario_id
      and c.novedad_id is not distinct from new.novedad_id and c.tarea_id is not distinct from new.tarea_id) then
    raise exception 'Ese comentario no es de esta novedad o tarea.';
  end if;
  if new.ruta <> new.hotel_id || '/' || new.id || '.jpg' then
    raise exception 'Ruta de foto no válida.';
  end if;
  select count(*) into v_cuantas from fotos f
  where f.novedad_id is not distinct from new.novedad_id and f.tarea_id is not distinct from new.tarea_id
    and f.comentario_id is not distinct from new.comentario_id and f.de_cierre = new.de_cierre;
  if v_cuantas >= 3 then raise exception 'Máximo 3 fotos.'; end if;
  return new;
end $$;
revoke execute on function fn_foto() from public, anon, authenticated;
create trigger trg_foto before insert or update on fotos for each row execute function fn_foto();
create trigger trg_hora_fotos before insert on fotos for each row execute function fn_hora_del_celular();
create trigger trg_audit_fotos after insert or update or delete on fotos for each row execute function fn_auditar();

create or replace function fn_no_borrar_foto() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'El registro de una foto no se borra; el Administrador libera el espacio desde Ajustes.'; end $$;
revoke execute on function fn_no_borrar_foto() from public, anon, authenticated;
create trigger trg_no_borrar_fotos before delete on fotos for each row execute function fn_no_borrar_foto();

alter table fotos enable row level security;
create policy ver on fotos for select using (
  (novedad_id is not null and exists (select 1 from novedades n where n.id = novedad_id))
  or (tarea_id is not null and exists (select 1 from tareas t where t.id = tarea_id)));
create policy crear on fotos for insert with check (autor_id = auth.uid() and (
  (novedad_id is not null and exists (select 1 from novedades n where n.id = novedad_id))
  or (tarea_id is not null and exists (select 1 from tareas t where t.id = tarea_id))));
create policy liberar on fotos for update using (es_admin()) with check (es_admin());

-- Espacio usado (para Ajustes › Fotos). Solo el Administrador.
create or replace function espacio_fotos() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin() then raise exception 'Solo el Administrador.'; end if;
  return (select json_build_object(
    'bytes', coalesce(sum(bytes), 0),
    'fotos', count(*),
    'viejas', count(*) filter (where creado_en < now() - interval '6 months'),
    'viejas_bytes', coalesce(sum(bytes) filter (where creado_en < now() - interval '6 months'), 0))
  from fotos where borrada_en is null);
end $$;
revoke execute on function espacio_fotos() from public, anon;
grant execute on function espacio_fotos() to authenticated;

-- ===== Storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 2000000, array['image/jpeg'])
on conflict (id) do nothing;

-- Sube quien trabaja en ese hotel o en uno de su grupo (comentarios en novedades compartidas)
create policy fotos_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'fotos' and puedo_ver_hotel(((storage.foldername(name))[1])::uuid, true));
-- Ve el archivo quien ve su registro (o quien lo subió, mientras se termina de guardar)
create policy fotos_ver on storage.objects for select to authenticated using (
  bucket_id = 'fotos' and (owner_id = (select auth.uid()::text)
    or exists (select 1 from public.fotos f where f.ruta = name)));
-- Borra archivos solo el Administrador, para liberar espacio
create policy fotos_borrar on storage.objects for delete to authenticated using (
  bucket_id = 'fotos' and es_admin());
