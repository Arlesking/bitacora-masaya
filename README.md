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

## Módulos

Algunas secciones son módulos que el administrador enciende por hotel en **Ajustes → Módulos**, eligiendo qué áreas los usan. Los líderes los ven siempre que estén encendidos; el resto del personal solo si su área está elegida. La base de datos aplica la misma regla (`puedo_usar_modulo`), así que ocultarlo en el menú no es la única barrera.

- **Checklist**: el líder arma listas por área y por turno (o para todos los turnos) en **Ajustes → Checklists**. El personal del área marca cada punto en su turno; queda guardado quién y cuándo, y cada día y turno queda en el historial. Los días anteriores no se pueden cambiar.

## Base de datos

Las migraciones están en `supabase/migrations/` y se aplican en orden.

## Hotel de pruebas

Existe un "Hotel de pruebas" separado para ensayar sin mezclar datos reales.
