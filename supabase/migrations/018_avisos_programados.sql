-- "Tener en cuenta" programados: un aviso puede empezar a verse en una fecha futura ("desde")
-- y se quita solo al terminar el día "hasta". Los avisos de antes empiezan el día en que se crearon.
-- Antes de su fecha, el aviso solo lo ven quienes pueden cambiarlo (para revisarlo o quitarlo).

alter table avisos add column if not exists desde date;
update avisos set desde = least((creado_en at time zone 'America/Bogota')::date, hasta) where desde is null;
alter table avisos alter column desde set default ((now() at time zone 'America/Bogota')::date);
alter table avisos alter column desde set not null;
alter table avisos add constraint avisos_desde_antes_de_hasta check (desde <= hasta);

-- Programados: el resto del hotel no los recibe hasta que llegue su fecha
alter policy ver on avisos using (
  puedo_avisar(hotel_id, areas)
  or autor_id = auth.uid()
  or (desde <= (now() at time zone 'America/Bogota')::date and (
    mi_rol(hotel_id) >= 'gerente'
    or (mi_rol(hotel_id) is not null and (coalesce(cardinality(areas), 0) = 0 or areas && mis_areas(hotel_id))))));
