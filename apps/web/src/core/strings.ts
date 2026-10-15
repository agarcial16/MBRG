// The UI strings module (NFR-28): the only place with user-visible text (Spanish for now).
// Templates use {name} placeholders filled by fillTemplate. Error kinds are English data and never live here.

export const STRINGS = {
  paramInvalid:
    'El parámetro «{param}» no es válido: «{text}». Debe ser un número entero formado solo por dígitos. Se muestra la ronda 0.',
  paramOutOfRange: 'El parámetro «{param}» está fuera de rango: «{text}». Se muestra la ronda 0.',
  paramRepeated: 'El parámetro «{param}» está repetido: «{text}». Se muestra la ronda 0.',
  cameraInvalid:
    'El parámetro de cámara «{param}» no es válido: «{text}». Debe ser un número decimal sin signo. Se muestra el mapa entero.',
  typedRoundInvalid: 'La ronda «{text}» no es válida. Escribe un número entero de 0 a {total}.',
  packageErrors: 'El paquete del mapa no es válido: {count} errores. Primer error: {kind}.',
  noWebgl2: 'Este navegador no ofrece WebGL 2, que hace falta para dibujar el mapa.',
  textureTooSmall:
    'El tamaño máximo de textura del navegador ({size}) es menor que el necesario ({required}) para dibujar el mapa.',
  simError: 'No se puede obtener el estado de la partida: {kind}.',
  debugTitle: 'Escena de depuración',
  outsideMap: 'fuera del mapa',
} as const;

/** Fills {name} placeholders; a placeholder without a value is left as written. */
export function fillTemplate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
