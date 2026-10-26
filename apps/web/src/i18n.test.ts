import { describe, expect, it } from 'vitest';

import { LANGS, resolveLang } from './i18n.js';

describe('resolveLang', () => {
  it('una ?lang= explícita manda sobre todo lo demás', () => {
    expect(resolveLang('en', 'es', 'es-ES')).toBe('en');
    expect(resolveLang('es', 'en', 'en-GB')).toBe('es');
  });

  it('acepta mayúsculas, espacios y prefijos de región', () => {
    expect(resolveLang(' EN ', null, null)).toBe('en');
    expect(resolveLang('es-MX', null, null)).toBe('es');
  });

  it('ignora valores que no son un idioma soportado', () => {
    expect(resolveLang('fr', 'de', 'fr-FR')).toBe('en'); // fallback
    expect(resolveLang(null, 'xx', 'es-ES')).toBe('es'); // saved is junk → browser
  });

  it('usa la preferencia guardada cuando no hay ?lang=', () => {
    expect(resolveLang(null, 'es', 'en-GB')).toBe('es');
    expect(resolveLang(null, null, 'es-ES')).toBe('es');
  });

  it('cae en inglés cuando no hay ninguna señal', () => {
    expect(resolveLang(null, null, null)).toBe('en');
    expect(resolveLang('', '', 'fr-FR')).toBe('en');
  });
});

describe('LANGS', () => {
  it('son exactamente español e inglés', () => {
    expect([...LANGS]).toEqual(['es', 'en']);
  });
});
