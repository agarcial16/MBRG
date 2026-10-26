import type { MapFormatV1 } from '@mbrg/shared';

/**
 * Mapa artesanal del usuario (imagen de referencia: A, B, D, E).
 * Los puntos de las fronteras compartidas son EXACTAMENTE iguales en ambos
 * polígonos vecinos para que no queden costuras al renderizar.
 *
 * Adjacencias: A–B, A–E, B–E, B–D, E–D.
 */
export const handmadeMap: MapFormatV1 = {
  version: 1,
  name: 'Mapa artesanal',
  width: 497,
  height: 415,
  territories: [
    {
      id: 'A',
      name: 'Aurelia',
      neighbors: ['B', 'E'],
      center: [108, 135],
      polygons: [[
        [152, 64], [148, 115], [153, 160], [150, 198],
        [125, 192], [100, 186], [75, 182], [66, 170],
        [62, 140], [70, 105], [95, 75], [125, 66],
      ]],
    },
    {
      id: 'B',
      name: 'Borgoña',
      neighbors: ['A', 'D', 'E'],
      center: [225, 130],
      polygons: [[
        [152, 64], [185, 45], [230, 30], [270, 35], [300, 45],
        [305, 100], [298, 160], [290, 228],
        [270, 235], [230, 235], [185, 218], [150, 198],
        [153, 160], [148, 115],
      ]],
    },
    {
      id: 'E',
      name: 'Estalia',
      neighbors: ['A', 'B', 'D'],
      center: [155, 270],
      polygons: [[
        [66, 170], [75, 182], [100, 186], [125, 192], [150, 198],
        [185, 218], [230, 235], [270, 235], [290, 228],
        [283, 262], [272, 292], [258, 318],
        [232, 330], [190, 340], [140, 338], [90, 318], [52, 285],
        [44, 245], [52, 205],
      ]],
    },
    {
      id: 'D',
      name: 'Dracoria',
      neighbors: ['B', 'E'],
      center: [370, 185],
      polygons: [[
        [300, 45], [330, 33], [370, 28], [410, 45], [440, 85],
        [458, 140], [462, 200], [452, 255], [432, 300], [400, 335],
        [360, 358], [325, 372], [292, 380], [268, 368], [258, 340],
        [258, 318], [272, 292], [283, 262], [290, 228],
        [298, 160], [305, 100],
      ]],
    },
  ],
};
