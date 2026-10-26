// Child process of the lock test (spec 008 FR-291, M2b' T3'): tries to open the store file given as the first argument
// and prints `opened` or the StoreError code (`other` for any other error). Run with `node --import tsx`.
import { openStore } from '../../src/store/sqlite';
import { StoreError } from '../../src/store/store';

const file = process.argv[2];
if (file === undefined) {
  console.log('no file');
} else {
  try {
    openStore(file).close();
    console.log('opened');
  } catch (error) {
    console.log(error instanceof StoreError ? error.code : 'other');
  }
}
