-- Una novedad puede ir dirigida a varias áreas a la vez.
-- para_areas guarda todas; para_area_id se sigue llenando con la primera para no romper lo anterior.
alter table novedades add column if not exists para_areas uuid[];
update novedades set para_areas = array[para_area_id] where para_area_id is not null and para_areas is null;
create index if not exists novedades_para_areas_idx on novedades using gin (para_areas);

-- Ver: además de lo anterior, quien es de cualquiera de las áreas elegidas
alter policy ver on novedades using (
  puedo_ver_hotel(hotel_id, compartida_grupo) and (
    mi_rol(hotel_id) >= 'lider'
    or mi_rol(hotel_id) is null  -- visto vía grupo (solo compartidas)
    or (para_area_id is null and coalesce(cardinality(para_areas), 0) = 0 and para_perfil_id is null)
    or para_perfil_id = auth.uid()
    or autor_id = auth.uid()
    or para_area_id = mi_area(hotel_id)
    or mi_area(hotel_id) = any(para_areas)));
