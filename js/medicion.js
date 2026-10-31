import { CLARITY_ID } from "./config.js";

// Microsoft Clarity: ve pantallas, toques y tiempos, nunca el texto.
// Todo el <body> lleva data-clarity-mask="true", así que lo que escribe el personal
// (y los datos de huéspedes) se graba tapado. Solo se mandan etiquetas sin datos personales.
const activa = /^[a-z0-9]{6,20}$/.test(CLARITY_ID) && location.hostname.endsWith("github.io");

if (activa) {
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://www.clarity.ms/tag/" + CLARITY_ID;
  document.head.appendChild(s);
}

function etiqueta(clave, valor) { if (activa && valor) window.clarity("set", clave, String(valor)); }

// Pantalla abierta (entrar, inicio, novedades, novedad, tareas...)
export function medirPantalla(nombre) { etiqueta("pantalla", nombre); }

// Hotel y rol de quien usa la página, para filtrar en Clarity (sin nombre ni correo)
export function medirContexto(hotel, rol) {
  etiqueta("hotel", hotel ? hotel.nombre + (hotel.es_prueba ? " (pruebas)" : "") : null);
  etiqueta("rol", rol);
}
