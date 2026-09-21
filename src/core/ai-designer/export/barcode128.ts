/**
 * A small, self-contained CODE128 (subset B) encoder — pure, framework-
 * agnostic, no DOM/canvas dependency, so it can run inside
 * @react-pdf/renderer's server-side render (which has neither). Deliberately
 * NOT a deep-import of `jsbarcode`'s own internal, unversioned build path
 * (a fragile choice that could silently break on any future jsbarcode
 * version bump) — this is a small, well-known, static algorithm instead.
 *
 * The `BARS` table below is copied verbatim from jsbarcode's own verified
 * `src/barcodes/CODE128/constants.js` (already an installed dependency of
 * this project, used by the browser-only `Barcode.tsx` component) — the
 * industry-standard CODE128 symbol table, not derived from memory, so the
 * resulting barcode is genuinely scannable, not just visually barcode-shaped.
 * Each entry is an 11-bit (13-bit for the STOP symbol) binary string where
 * '1' = a black module and '0' = a white module, all 1 unit wide.
 */

const START_B = 104;
const STOP = 106;
const MODULO = 103;

const BARS: string[] = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "1100011101011",
];

/** Printable ASCII only (32-126, space through ~) — CODE128 Subset B's plain range, no FNC/control characters. This app's projectNumber values are always alphanumeric+hyphen, so this should never actually trigger. */
function isEncodableCode128B(value: string): boolean {
  return value.length > 0 && /^[\x20-\x7E]+$/.test(value);
}

export interface BarcodeBar {
  /** Left edge of this bar, in module units (each module is 1 unit wide). */
  x: number;
  /** Width of this bar, in module units. */
  width: number;
}

export interface EncodedBarcode {
  bars: BarcodeBar[];
  totalModules: number;
}

/**
 * Encodes `value` as CODE128 Subset B. Returns null for anything outside
 * printable ASCII 32-126 rather than throwing — a caller must render a
 * graceful "barcode unavailable" fallback in that case, never crash the
 * whole PDF export over one unencodable character.
 */
export function encodeCode128(value: string): EncodedBarcode | null {
  if (!isEncodableCode128B(value)) return null;

  const dataValues = value.split("").map((ch) => ch.charCodeAt(0) - 32);
  const checksum = (START_B + dataValues.reduce((sum, v, i) => sum + v * (i + 1), 0)) % MODULO;
  const symbolValues = [START_B, ...dataValues, checksum, STOP];

  const bits = symbolValues.map((v) => BARS[v]).join("");
  return { bars: buildBars(bits), totalModules: bits.length };
}

function buildBars(bits: string): BarcodeBar[] {
  const bars: BarcodeBar[] = [];
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "1") {
      const start = i;
      while (i < bits.length && bits[i] === "1") i++;
      bars.push({ x: start, width: i - start });
    } else {
      i++;
    }
  }
  return bars;
}
