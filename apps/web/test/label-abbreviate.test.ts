import { describe, expect, it } from 'vitest';
import { abbreviateName } from '../src/core/label-abbreviate';

describe('spec 032 FR-622 deterministic name abbreviation', () => {
  it('FR-622 keeps short names (1-4 code points) unchanged and never lengthens them', () => {
    for (const name of ['A', 'Jaén', 'Lugo', 'León', 'Soria'.slice(0, 4)]) {
      expect(abbreviateName(name), name).toStrictEqual([name]);
    }
  });

  it('FR-622 shortens single-word names with prefix + dot, preserving diacritics and casing', () => {
    expect(abbreviateName('Valencia')).toStrictEqual(['Valencia', 'Valen.', 'Val.']);
    expect(abbreviateName('Valderrebollo')).toStrictEqual(['Valderrebollo', 'Valde.', 'Val.']);
    expect(abbreviateName('Álava')).toStrictEqual(['Álava', 'Ála.']);
    expect(abbreviateName('Cádiz')).toStrictEqual(['Cádiz', 'Cád.']);
    expect(abbreviateName('Castellón')).toStrictEqual(['Castellón', 'Caste.', 'Cas.']);
  });

  it('FR-622 puts prefix-with-dot forms before plain uppercase acronyms for multi-word names', () => {
    const sct = abbreviateName('Santa Cruz de Tenerife');
    expect(sct[0]).toBe('Santa Cruz de Tenerife');
    expect(sct).toContain('S. C. Tenerife');
    expect(sct).toContain('SCT');
    expect(sct.indexOf('S. C. Tenerife')).toBeLessThan(sct.indexOf('SCT'));
    expect(sct.at(-1)).toBe('SCT');

    const mt = abbreviateName('Masegoso de Tajuña');
    expect(mt[0]).toBe('Masegoso de Tajuña');
    expect(mt).toContain('M. Tajuña');
    expect(mt).toContain('MT');
    expect(mt.indexOf('M. Tajuña')).toBeLessThan(mt.indexOf('MT'));

    const csg = abbreviateName('Casas de San Galindo');
    expect(csg[0]).toBe('Casas de San Galindo');
    expect(csg).toContain('C. S. Galindo');
    expect(csg).toContain('CSG');
    expect(csg.indexOf('C. S. Galindo')).toBeLessThan(csg.indexOf('CSG'));
  });

  it('FR-622 handles leading articles, connectors, and hyphenated names cleanly', () => {
    const lr = abbreviateName('La Rioja');
    expect(lr[0]).toBe('La Rioja');
    // 'La' is a connector, so only 1 significant word -> prefix + dot, no bogus 1-letter acronym
    expect(lr).toContain('L. Rio.');
    expect(lr).toContain('Rio.');
    expect(lr).not.toContain('R');

    const clm = abbreviateName('Castilla-La Mancha');
    expect(clm[0]).toBe('Castilla-La Mancha');
    expect(clm).toContain('C. Mancha');
    expect(clm).toContain('CM');
    expect(clm.indexOf('C. Mancha')).toBeLessThan(clm.indexOf('CM'));

    const cr = abbreviateName('Ciudad Real');
    expect(cr[0]).toBe('Ciudad Real');
    expect(cr).toContain('C. Real');
    expect(cr).toContain('CR');
    expect(cr.indexOf('C. Real')).toBeLessThan(cr.indexOf('CR'));
  });

  it('FR-622 returns strictly shorter unique candidates after the full name and is deterministic', () => {
    const samples = [
      'Santa Cruz de Tenerife',
      'Valderrebollo',
      'Masegoso de Tajuña',
      'Guipúzcoa',
      'A Coruña',
      'Islas Baleares',
      'Madrid',
      'Jaén',
      'Las Palmas',
      'Friuli-Venecia Julia',
      'United States of America',
    ];
    for (const name of samples) {
      const a = abbreviateName(name);
      const b = abbreviateName(name);
      expect(a, name).toStrictEqual(b);
      expect(a[0], name).toBe(name);
      expect(new Set(a).size, name).toBe(a.length);
      const fullLen = Array.from(name).length;
      for (let i = 1; i < a.length; i++) {
        expect(Array.from(a[i]!).length, `${name} -> ${a[i]}`).toBeLessThan(fullLen);
      }
    }
  });
});
