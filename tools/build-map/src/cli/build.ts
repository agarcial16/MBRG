import { validateMap } from '@mbrg/shared';

// T1 spike stub: proves tsx runs workspace TypeScript with extensionless imports.
const result = validateMap({});
console.log(`validateMap ran, ok=${String(result.ok)}`);
