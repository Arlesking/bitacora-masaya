-- Lo que se escribe sin señal se envía después. Se guarda la hora en que de verdad se escribió,
-- la que manda el celular, solo si es creíble: de las últimas 36 horas y no del futuro.
-- Si no, la del servidor. Así nadie puede poner fechas viejas a mano, y una vez creada la hora no cambia.
create or replace function fn_hora_del_celular() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.creado_en := old.creado_en;
  elsif new.creado_en is null or new.creado_en > now() + interval '5 minutes' or new.creado_en < now() - interval '36 hours' then
    new.creado_en := now();
  end if;
  return new;
end $$;
revoke execute on function fn_hora_del_celular() from public, anon, authenticated;
create trigger trg_hora_novedades before insert or update on novedades for each row execute function fn_hora_del_celular();
create trigger trg_hora_comentarios before insert or update on comentarios for each row execute function fn_hora_del_celular();

-- Marcas del checklist: igual, con la hora en que se tocó el punto. Antes siempre era la del servidor.
create or replace function fn_checklist_marca() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.registro_id <> old.registro_id or new.item_id <> old.item_id) then
    raise exception 'No se puede mover una marca.';
  end if;
  select i.hotel_id, i.texto into new.hotel_id, new.texto
  from checklist_items i join checklist_registros r on r.plantilla_id = i.plantilla_id
  where i.id = new.item_id and r.id = new.registro_id;
  if new.hotel_id is null then raise exception 'Ese punto no pertenece a este checklist.'; end if;
  new.marcado_por := auth.uid();
  -- Sin hora nueva del celular (se marcó con señal), cuenta la del servidor
  if new.marcado_en is null or (tg_op = 'UPDATE' and new.marcado_en = old.marcado_en)
     or new.marcado_en > now() + interval '5 minutes' or new.marcado_en < now() - interval '36 hours' then
    new.marcado_en := now();
  end if;
  return new;
end $$;
