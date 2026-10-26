-- Cuando se termina la última tarea abierta de una novedad, la novedad se cierra sola
-- y queda un comentario de seguimiento que lo explica. Funciona sin importar quién
-- complete la tarea (un operador no puede cerrar novedades ajenas por sí mismo).
create or replace function fn_cerrar_novedad_con_tareas() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.novedad_id is null or new.estado = old.estado or new.estado not in ('hecha', 'cancelada') then
    return new;
  end if;
  if exists (select 1 from tareas where novedad_id = new.novedad_id and estado in ('pendiente', 'en_curso')) then
    return new;
  end if;
  if not exists (select 1 from tareas where novedad_id = new.novedad_id and estado = 'hecha') then
    return new;  -- todas canceladas: la novedad sigue abierta para que alguien decida
  end if;
  update novedades set estado = 'cerrada'
  where id = new.novedad_id and estado in ('abierta', 'seguimiento');
  if found then
    insert into comentarios (novedad_id, autor_id, texto)
    values (new.novedad_id, coalesce(auth.uid(), new.asignada_a, new.creado_por),
            'Cerrada automáticamente: se completó la tarea «' || new.titulo || '».');
  end if;
  return new;
end $$;
revoke execute on function fn_cerrar_novedad_con_tareas() from public, anon, authenticated;
create trigger trg_cerrar_novedad_con_tareas after update of estado on tareas
for each row execute function fn_cerrar_novedad_con_tareas();
