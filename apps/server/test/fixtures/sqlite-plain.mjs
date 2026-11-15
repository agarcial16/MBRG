// Child-process fixture (NFR-53): loads node:sqlite with NO warning filter, so stderr shows Node's own behavior.
const { DatabaseSync } = await import('node:sqlite');
new DatabaseSync(':memory:').close();
process.emitWarning('planted', 'TestWarning');
