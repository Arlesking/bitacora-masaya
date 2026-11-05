-- Historial de cada tarea y novedad: quien ve una tarea o una novedad también ve su historial
-- (cuándo se creó, a quién se asignó, cada cambio de estado, fecha o urgencia).
-- Solo se abre el historial de ESA tarea o novedad: el registro de actividad completo sigue
-- siendo de Líder (sus áreas), Gerente y Administrador.
-- Las dos consultas de adentro pasan por las reglas (RLS) de quien mira, así que solo
-- devuelven algo si esa persona ya puede ver la tarea o la novedad.

create index if not exists log_auditoria_registro_idx on log_auditoria (registro_id, en);

alter policy ver on log_auditoria using (
  es_admin()
  or (hotel_id is not null and mi_rol(hotel_id) >= 'gerente')
  or (hotel_id is not null and mi_rol(hotel_id) = 'lider' and log_de_mis_areas(hotel_id, tabla, registro_id, antes, despues))
  or (tabla = 'tareas' and exists (select 1 from tareas t where t.id = registro_id))
  or (tabla = 'novedades' and exists (select 1 from novedades n where n.id = registro_id)));

-- Para deshacer: volver a la regla de la migración 014
-- alter policy ver on log_auditoria using (
--   es_admin()
--   or (hotel_id is not null and mi_rol(hotel_id) >= 'gerente')
--   or (hotel_id is not null and mi_rol(hotel_id) = 'lider' and log_de_mis_areas(hotel_id, tabla, registro_id, antes, despues)));
