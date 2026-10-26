-- Un líder no puede cambiar ni quitar el acceso de otro líder; solo un administrador.
drop policy lider on membresias;
create policy lider on membresias for all
  using (mi_rol(hotel_id) >= 'lider' and (rol < 'lider' or es_admin()))
  with check (mi_rol(hotel_id) >= 'lider' and (rol < 'lider' or es_admin()));
