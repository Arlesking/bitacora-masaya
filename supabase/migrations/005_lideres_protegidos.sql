-- Un líder no puede cambiar ni quitar el acceso de otro líder; solo un administrador.
alter policy lider on membresias
  using (mi_rol(hotel_id) >= 'lider' and (rol < 'lider' or es_admin()))
  with check (mi_rol(hotel_id) >= 'lider' and (rol < 'lider' or es_admin()));
