-- El operador puede cambiar el estado (en seguimiento, cerrar, reabrir) de las novedades
-- que le tocan: las de sus áreas, las dirigidas a él y las de todo el hotel.
-- Antes solo podía hacerlo con las que él mismo escribió.
-- Anular y cambiar cualquier otro dato sigue siendo solo del autor o de jefe de servicio hacia arriba.

alter policy editar on novedades
  using (
    autor_id = auth.uid()
    or mi_rol(hotel_id) >= 'jefe_servicio'
    or (mi_rol(hotel_id) is not null and (
      para_perfil_id = auth.uid()
      or para_area_id = any(mis_areas(hotel_id))
      or para_areas && mis_areas(hotel_id)
      or (para_area_id is null and coalesce(cardinality(para_areas), 0) = 0 and para_perfil_id is null))))
  with check (mi_rol(hotel_id) is not null);

-- Quien no es autor ni jefe+ solo puede mover el estado entre abierta, en seguimiento y cerrada.
create or replace function fn_operador_solo_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or old.autor_id = auth.uid() or mi_rol(old.hotel_id) >= 'jefe_servicio' then
    return new;
  end if;
  if new.estado not in ('abierta', 'seguimiento', 'cerrada') or old.estado = 'anulada' then
    raise exception 'Solo quien escribió la novedad o un jefe puede anularla.';
  end if;
  if (to_jsonb(new) - 'estado' - 'creado_en') <> (to_jsonb(old) - 'estado' - 'creado_en') then
    raise exception 'Solo puedes cambiar el estado de esta novedad.';
  end if;
  return new;
end $$;
revoke execute on function fn_operador_solo_estado() from public, anon, authenticated;
create trigger trg_operador_solo_estado before update on novedades
for each row execute function fn_operador_solo_estado();
