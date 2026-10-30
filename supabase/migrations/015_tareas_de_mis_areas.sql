-- Crear tareas según el área: gerente y administrador para cualquier área del hotel;
-- jefe de servicio, líder y operador solo para sus áreas (o una tarea para sí mismos).
alter policy crear on tareas with check (
  creado_por = auth.uid() and (
    mi_rol(hotel_id) >= 'gerente'
    or (mi_rol(hotel_id) is not null and (area_id = any(mis_areas(hotel_id)) or asignada_a = auth.uid()))));
