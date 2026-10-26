-- Nadie llama directamente a las funciones de trigger; las de permisos solo con sesión iniciada.
revoke execute on function fn_auditar(), fn_nuevo_usuario(), fn_no_borrar() from public, anon, authenticated;
revoke execute on function es_admin(), mi_rol(uuid), mi_area(uuid), puedo_ver_hotel(uuid, boolean) from public, anon;
grant execute on function es_admin(), mi_rol(uuid), mi_area(uuid), puedo_ver_hotel(uuid, boolean) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
