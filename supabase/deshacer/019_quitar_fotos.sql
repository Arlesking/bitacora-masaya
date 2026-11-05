-- SOLO SI SE DECIDE QUITAR LAS FOTOS POR COMPLETO. No se aplica sola.
--
-- Para dejar de usar las fotos NO hace falta esto: basta con poner FOTOS_ACTIVAS = false
-- en js/config.js. Desaparecen los botones, nada se borra y se puede volver a encender.
--
-- Este archivo deshace la migración 019. Antes de correrlo:
--   1. Publicar la página sin fotos (revertir el PR de fotos), porque las listas piden fotos(count).
--   2. Borrar los archivos del bucket "fotos" desde el panel de Supabase (Storage) si se quiere el espacio.
--      Supabase no deja borrar archivos de Storage con SQL.
-- Lo que se pierde: el registro de qué foto era de qué novedad. Las novedades, tareas y comentarios quedan.

drop policy if exists fotos_subir on storage.objects;
drop policy if exists fotos_ver on storage.objects;
drop policy if exists fotos_borrar on storage.objects;
drop function if exists espacio_fotos();
drop table if exists fotos;            -- se lleva sus triggers y políticas
drop function if exists fn_foto();
drop function if exists fn_no_borrar_foto();
-- El bucket se borra desde el panel (Storage › fotos › Delete bucket) cuando ya esté vacío.
