# Bitácora Masaya

Bitácora web de turnos para hoteles: novedades, entrega de turno, tareas y registro de actividad. Funciona en el navegador del celular o del computador, sin instalar nada.

## Cómo está hecha

- **Página**: HTML, CSS y JavaScript sin compilación (`index.html`, `css/`, `js/`). Se publica gratis con GitHub Pages.
- **Datos y usuarios**: Supabase (plan gratis). La seguridad vive en la base de datos: cada consulta pasa por reglas por fila (RLS) según el hotel y el rol de la persona.
- **Creación de usuarios y cambio de PIN**: función `supabase/functions/gestionar-usuario`, porque necesita la clave de servicio, que nunca va en la página.

## Roles

| Rol | Puede |
| --- | --- |
| Administrador | Todo, en todos los hoteles. Crea hoteles, grupos y gerentes. Es el único que cambia áreas, tipos de novedad y módulos. |
| Gerente | Todo su hotel: ve todo, manda avisos a todo el hotel o a cualquier área, agrega y cambia personas (hasta líder) y ve el registro. No cambia ajustes. |
| Líder | Una o varias áreas: ve lo de ellas, les manda avisos, asigna sus tareas, arma sus turnos y checklists y ve el registro de lo que toca a sus áreas. |
| Jefe de servicio | Su área: asigna sus tareas, le manda avisos y cierra novedades. |
| Operador | Crear novedades y tareas, comentar, marcar checklists, tomar y completar tareas de su área. |

Las novedades no se borran: se anulan con un motivo. Todo cambio queda en `log_auditoria`, escrito por la base de datos.

## Módulos

Algunas secciones son módulos que el administrador enciende por hotel en **Ajustes → Módulos**, eligiendo qué áreas los usan. El gerente los ve siempre que estén encendidos; el resto del personal (líderes incluidos) solo en sus áreas elegidas. La base de datos aplica la misma regla (`puedo_usar_modulo`), así que ocultarlo en el menú no es la única barrera.

- **Checklist**: el líder arma listas por área y por turno (o para todos los turnos) en **Ajustes → Checklists**. El personal del área marca cada punto en su turno; queda guardado quién y cuándo, y cada día y turno queda en el historial. Los días anteriores no se pueden cambiar.

## Sin señal

En Tayrona la señal se cae seguido, así que la página sigue funcionando sin ella:

- **Abrir y ver**: `sw.js` guarda la página y lo último que se cargó. Siempre intenta primero la red; sin señal, o si no responde en unos segundos, muestra lo guardado.
- **Anotar**: las novedades, los comentarios y las marcas del checklist que no se pueden enviar quedan en el celular como "pendientes de enviar" (franja amarilla arriba) y salen solos, en orden, cuando vuelve la señal. Cada cosa lleva su id desde el celular, así que reintentar nunca la duplica. Lo demás (cambiar estados, asignar tareas, ajustes) necesita señal.
- **Entrar**: tras 10 minutos sin uso se pide el PIN otra vez, pero la sesión queda guardada para poder entrar sin señal. Sin señal solo entra quien entró por última vez en ese celular, con su PIN (se guarda una huella del PIN, no el PIN; tras 5 intentos fallidos hay que entrar con señal). **Cerrar sesión** borra todo del celular.

## Base de datos

Las migraciones están en `supabase/migrations/` y se aplican en orden.

## Hotel de pruebas

Existe un "Hotel de pruebas" separado para ensayar sin mezclar datos reales.
