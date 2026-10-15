// Startup stub (T1). The real startup is built in later tasks.
import { checkIdImage } from '@mbrg/shared';
import { Scene } from 'three';

// Referenced so the bundler and the type check resolve both imports; nothing is logged.
export const STUB_IMPORTS = { checkIdImage, Scene };
