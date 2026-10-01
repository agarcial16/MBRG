import { describe, expect, it } from 'vitest';

import type { MapFormatV1, Territory } from '@mbrg/shared';
import {
  applyNames,
  cleanName,
  MAX_NAME_LENGTH,
  namesByColor,
  parseNameFile,
} from '../src/naming.js';

function mapOf(...ids: string[]): MapFormatV1 {
  const territories: Territory[] = ids.map((id) => ({
    id,
    // What the importer writes: the id doubles as the placeholder name, so
    // "has a name" is just "name differs from id".
    name: id,
    polygon: [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    neighbors: ids.filter((other) => other !== id).sort(),
  }));
  return { version: 1, name: 'test', width: 100, height: 100, territories };
}

describe('cleanName', () => {
  it('trims and collapses whitespace, so pasted text does not break a label', () => {
    expect(cleanName('  Castilla \n la  Nueva ')).toBe('Castilla la Nueva');
    expect(cleanName('A\t\tB')).toBe('A B');
  });

  it('returns null for nothing, so the caller falls back to the id', () => {
    expect(cleanName('')).toBeNull();
    expect(cleanName('    ')).toBeNull();
    expect(cleanName('\n\t')).toBeNull();
  });

  it('caps the length: a name longer than its province is a wall of letters', () => {
    const long = 'Supercalifragilisticoespialidoso';
    expect(cleanName(long)).toHaveLength(MAX_NAME_LENGTH);
  });
});

describe('applyNames', () => {
  it('writes names into the territories and leaves the rest of the map alone', () => {
    const before = mapOf('a', 'b');
    const { map, kept } = applyNames(before, new Map([['a', 'Aurelia']]));
    expect(map.territories.map((t) => t.name)).toEqual(['Aurelia', 'b']);
    expect(map.width).toBe(before.width);
    expect(map.territories[0].polygon).toEqual(before.territories[0].polygon);
    expect(kept).toBe(1);
  });

  it('does not mutate the input: detection re-runs under the names', () => {
    const before = mapOf('a', 'b');
    applyNames(before, new Map([['a', 'Aurelia']]));
    expect(before.territories[0].name).toBe('a');
  });

  it('reports the names whose province disappeared after a parameter change', () => {
    const { map, kept, dropped } = applyNames(mapOf('a'), new Map([['a', 'A'], ['z', 'Z']]));
    expect(map.territories[0].name).toBe('A');
    expect(kept).toBe(1);
    expect(dropped).toEqual(['z']);
  });

  it('clears a name when the entry is removed', () => {
    const named = applyNames(mapOf('a'), new Map([['a', 'Aurelia']])).map;
    expect(named.territories[0].name).toBe('Aurelia');
    // The names map is the whole truth: an emptied field means "no name".
    expect(applyNames(named, new Map()).map.territories[0].name).toBe('a');
  });

  it('keeps holes and other territory fields while renaming', () => {
    const withHole: MapFormatV1 = {
      ...mapOf('a'),
      territories: [{ ...mapOf('a').territories[0], holes: [[[2, 2]]] }],
    };
    const { map } = applyNames(withHole, new Map([['a', 'Lago']]));
    expect(map.territories[0].holes).toEqual([[[2, 2]]]);
    expect(map.territories[0].name).toBe('Lago');
  });
});

describe('parseNameFile', () => {
  it('lee el mapa directo de color a nombre', () => {
    const { byColor, rejected } = parseNameFile('{"#c0392b": "Aurelia"}');
    expect(byColor.get('c0392b')).toBe('Aurelia');
    expect(rejected).toBe(0);
  });

  it('acepta las tres formas de escribir un color, porque se escriben a mano', () => {
    const { byColor } = parseNameFile('{"c0392b": "A", "#C0392B": "B", " #c0392b ": "C"}');
    // Last one wins: the keys are the same colour, and there is nothing sensible to
    // do about a duplicate except take one.
    expect(byColor.size).toBe(1);
    expect([...byColor.values()]).toEqual(['C']);
  });

  it('acepta el envoltorio colors, que es lo que podra crecer', () => {
    const { byColor } = parseNameFile('{"colors": {"#00ff00": "Borgoña"}}');
    expect(byColor.get('00ff00')).toBe('Borgoña');
  });

  it('descarta la linea mala y sigue con las demas', () => {
    // A name file is typed by hand; one typo must cost one province, not the
    // whole upload.
    const { byColor, rejected } = parseNameFile(
      '{"#c0392b": "Aurelia", "not-a-colour": "X", "#00ff00": ""}',
    );
    expect([...byColor.values()]).toEqual(['Aurelia']);
    expect(rejected).toBe(2);
  });

  it('falla claro cuando no es un objeto de pares', () => {
    expect(() => parseNameFile('[]')).toThrow(/object/);
    expect(() => parseNameFile('"hola"')).toThrow(/object/);
    expect(() => parseNameFile('{')).toThrow(/JSON/);
  });

  it('acepta colores de tres digitos', () => {
    const { byColor } = parseNameFile('{"#f00": "Rojo"}');
    expect(byColor.get('f00')).toBe('Rojo');
  });
});

describe('namesByColor', () => {
  const territories = [
    { id: 'p0', color: 0xc0392b },
    { id: 'p1', color: 0x27ae60 },
    { id: 'p2', color: 0xc0392b }, // the same colour twice
  ];

  it('nombra por el color representativo de cada provincia', () => {
    const file = new Map([
      ['c0392b', 'Aurelia'],
      ['27ae60', 'Borgoña'],
    ]);
    const { names, matched } = namesByColor(territories, file);
    expect(names.get('p0')).toBe('Aurelia');
    expect(names.get('p1')).toBe('Borgoña');
    expect(matched).toBe(3); // p2 shares the colour, and gets the same name
  });

  it('avisa de los colores que se repiten, porque suele ser que el mapa no es plano', () => {
    const file = new Map([['c0392b', 'Aurelia']]);
    expect(namesByColor(territories, file).shared).toEqual(['Aurelia']);
  });

  it('avisa de los colores del fichero que no salen en el mapa', () => {
    const file = new Map([
      ['c0392b', 'Aurelia'],
      ['ffffff', 'Blanco'],
    ]);
    const { unmatched } = namesByColor(territories, file);
    expect(unmatched).toEqual(['ffffff']);
  });

  it('ignora las provincias sin color, en vez de inventarles uno', () => {
    const { matched } = namesByColor(
      [
        { id: 'p0', color: 0xc0392b },
        { id: 'p1' },
      ],
      new Map([['c0392b', 'Aurelia']]),
    );
    expect(matched).toBe(1);
  });

  it('un mapa sin nombres queda intacto', () => {
    expect(namesByColor(territories, new Map()).names.size).toBe(0);
  });
});