import { PNG } from 'pngjs';
import { checkPngFile } from '../core/png-check';
import type { PngCodec } from '../core/types';

/**
 * pngjs adapter (the only importer of pngjs). decode runs checkPngFile first, so a file
 * outside FR-105 never reaches pngjs. Every encode option is explicit (no gamma, no alpha).
 */
export const pngCodec: PngCodec = {
  encode(width, height, rgb) {
    const data = Buffer.alloc(rgb.length);
    data.set(rgb);
    const out = PNG.sync.write(
      { width, height, data } as unknown as PNG,
      { colorType: 2, inputColorType: 2, inputHasAlpha: false, bitDepth: 8, filterType: 0, deflateLevel: 9, deflateStrategy: 0 },
    );
    return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  },
  decode(bytes) {
    const checked = checkPngFile(bytes);
    if (!checked.ok) return checked;
    const image = PNG.sync.read(Buffer.from(bytes), { skipRescale: true });
    const rgb = new Uint8Array(3 * image.width * image.height);
    for (let i = 0; i < image.width * image.height; i++) {
      rgb[3 * i] = image.data[4 * i]!;
      rgb[3 * i + 1] = image.data[4 * i + 1]!;
      rgb[3 * i + 2] = image.data[4 * i + 2]!;
    }
    return { ok: true, value: { width: image.width, height: image.height, rgb } };
  },
};
