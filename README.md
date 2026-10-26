# Bitácora Masaya

Bitácora web de turnos para hoteles: novedades, entrega de turno, tareas y registro de actividad. Funciona en el navegador del celular o del computador, sin instalar nada.

## Cómo está hecha

- **Página**: HTML, CSS y JavaScript sin compilación (`index.html`, `css/`, `js/`). Se publica gratis con GitHub Pages.
- **Datos y usuarios**: Supabase (plan gratis). La seguridad vive en la base de datos: cada consulta pasa por reglas por fila (RLS) según el hotel y el rol de la persona.
- **Creación de usuarios y cambio de PIN**: función `supabase/functions/gestionar-usuario`, porque necesita la clave de servicio, que nunca va en la página.

## Roles

| Rol | Puede |
| --- | --- |
| Administrador | Todo, en todos los hoteles. Crea hoteles, grupos y líderes. |
| Líder | Su hotel: personas, áreas, turnos, tipos de novedad y registro. |
| Jefe de servicio | Asignar tareas, cerrar novedades, ver lo de su área. |
| Operador | Crear novedades y tareas, comentar, tomar y completar tareas de su área. |

Las novedades no se borran: se anulan con un motivo. Todo cambio queda en `log_auditoria`, escrito por la base de datos.

## Base de datos

Las migraciones están en `supabase/migrations/` y se aplican en orden.

## Hotel de pruebas

Existe un "Hotel de pruebas" separado para ensayar sin mezclar datos reales.
