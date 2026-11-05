-- Nueva forma de asignar tareas:
-- 1. Toda tarea pertenece a un área (del mismo hotel). Ya no puede quedar sin área.
-- 2. Cualquiera manda una tarea a la bandeja de cualquier área de su hotel ("pedir a otra área").
--    Elegir a la persona es del jefe de servicio, líder o gerente de esa área; cada uno puede
--    asignársela a sí mismo solo en sus áreas.
-- 3. Quien tiene la tarea puede pasarla a un compañero del área o devolverla a la bandeja,
--    hasta 2 veces. Después solo el jefe, el líder o el gerente la mueven.
--
-- Para deshacer:
--   drop trigger trg_mover_tarea on tareas; drop function fn_mover_tarea();
--   alter table tareas drop column pases; alter table tareas alter column area_id drop not null;
--   y volver a la regla "crear" de la migración 015.

alter table tareas alter column area_id set not null;
alter table tareas add column pases smallint not null default 0;

alter policy crear on tareas with check (
  creado_por = auth.uid()
  and mi_rol(hotel_id) is not null
  and exists (select 1 from areas a where a.id = area_id and a.hotel_id = tareas.hotel_id)
  and (
    asignada_a is null
    or coalesce(mi_rol_en_area(area_id) >= 'jefe_servicio', false)
    or (asignada_a = auth.uid() and mi_rol_en_area(area_id) is not null)));

-- Quién puede cambiar la persona o el área de una tarea ya creada.
create or replace function fn_mover_tarea() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or coalesce(mi_rol_en_area(old.area_id) >= 'jefe_servicio', false) then
    return new;  -- jefe, líder o gerente del área (o un proceso de la base de datos)
  end if;
  new.pases := old.pases;
  if new.area_id is distinct from old.area_id then
    raise exception 'Solo el jefe o el líder del área puede cambiar el área de la tarea.';
  end if;
  if new.asignada_a is not distinct from old.asignada_a then
    return new;
  end if;
  -- Tomar una tarea de la bandeja de mi área
  if old.asignada_a is null and new.asignada_a = auth.uid() then
    return new;
  end if;
  -- Pasar la que tengo yo a un compañero del área, o devolverla a la bandeja
  if old.asignada_a = auth.uid() then
    if old.pases >= 2 then
      raise exception 'Esta tarea ya se pasó 2 veces. Ahora solo el jefe o el líder la puede mover.';
    end if;
    if new.asignada_a is not null and not exists (
      select 1 from membresias m
      where m.perfil_id = new.asignada_a and m.hotel_id = old.hotel_id and m.activa and old.area_id = any(m.areas)) then
      raise exception 'Solo puedes pasarla a alguien del área de la tarea.';
    end if;
    new.pases := old.pases + 1;
    return new;
  end if;
  raise exception 'Solo el jefe o el líder del área puede asignar esta tarea.';
end $$;
revoke execute on function fn_mover_tarea() from public, anon, authenticated;
create trigger trg_mover_tarea before update on tareas
for each row execute function fn_mover_tarea();
