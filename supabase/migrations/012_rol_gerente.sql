-- Nuevo rol Gerente: maneja todo su hotel, entre Líder y Administrador.
-- Va solo en esta migración porque Postgres no deja usar un valor nuevo de un enum
-- en la misma transacción en que se agrega; la 013 ya lo usa.
alter type rol_t add value if not exists 'gerente' before 'admin';
