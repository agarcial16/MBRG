// Child-process fixture (NFR-53): the filter is installed BEFORE the dynamic import of node:sqlite.
import { installWarningFilter } from '../../src/warnings';

installWarningFilter();
const { DatabaseSync } = await import('node:sqlite');
new DatabaseSync(':memory:').close();
process.emitWarning('planted', 'TestWarning');
process.emitWarning('other experimental', 'ExperimentalWarning');
