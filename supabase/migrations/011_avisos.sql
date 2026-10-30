-- "Tener en cuenta": avisos cortos del hotel que duran hasta una fecha (grupo VIP, piscina en arreglo...).
-- Todos los del hotel los ven; solo Jefe de servicio, Líder y Administrador los crean, cambian o quitan.
-- Un aviso vence solo al terminar el día "hasta" (hora de Colombia). No se borran: "Quitar ya" marca quitado_en.

create table avisos (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hoteles(id),
  texto text not null check (length(trim(texto)) between 1 and 300),
  hasta date not null,
  autor_id uuid not null default auth.uid() references perfiles(id),
  creado_en timestamptz not null default now(),
  quitado_en timestamptz,
  quitado_por uuid references perfiles(id)
);
create index avisos_hotel_hasta on avisos (hotel_id, hasta) where quitado_en is null;

create trigger trg_audit_avisos after insert or update or delete on avisos for each row execute function fn_auditar();
create trigger trg_no_borrar_avisos before delete on avisos for each row execute function fn_no_borrar();

alter table avisos enable row level security;
create policy ver on avisos for select using (mi_rol(hotel_id) is not null);
create policy crear on avisos for insert
  with check (mi_rol(hotel_id) >= 'jefe_servicio' and autor_id = auth.uid() and quitado_en is null);
create policy editar on avisos for update
  using (mi_rol(hotel_id) >= 'jefe_servicio') with check (mi_rol(hotel_id) >= 'jefe_servicio');
