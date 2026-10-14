import { round2 } from "./money";

/**
 * Standard 2-digit Indian GST State Codes (Census / GST State Code List).
 */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "25": "Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
};

/**
 * Regex for standard 15-character Indian GSTIN format:
 * 2 digits (State Code) + 5 letters (PAN) + 4 digits (PAN Seq) + 1 letter (PAN Check) +
 * 1 alphanumeric (Entity Code) + 'Z' (Default character) + 1 alphanumeric (Checksum).
 */
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

/**
 * Extracts and validates the 2-digit state code from an Indian GSTIN string.
 * Returns null if the GSTIN is missing, malformed, or has an unknown state code.
 */
export function extractStateCodeFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const clean = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(clean)) return null;
  const stateCode = clean.substring(0, 2);
  return GST_STATE_CODES[stateCode] ? stateCode : null;
}

export function isValidStateCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return Boolean(GST_STATE_CODES[code.trim()]);
}

export interface GstTaxBreakdown {
  placeOfSupplyStateCode: string | null;
  isInterState: boolean;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTaxAmount: number;
}

/**
 * Calculates header-level CGST, SGST, and IGST from total taxAmount.
 *
 * Deterministic Odd-Paisa Rule:
 * For intra-state transactions, CGST and SGST must sum exactly to taxAmount.
 * cgstAmount = round2(taxAmount / 2)
 * sgstAmount = round2(taxAmount - cgstAmount)
 * This guarantees: cgstAmount + sgstAmount === taxAmount, with zero paisa drift.
 */
export function calculateInvoiceGst(
  taxAmount: number,
  isInterState: boolean,
  isReverseCharge: boolean
): { cgstAmount: number; sgstAmount: number; igstAmount: number } {
  if (isReverseCharge || taxAmount <= 0) {
    return { cgstAmount: 0, sgstAmount: 0, igstAmount: 0 };
  }

  if (isInterState) {
    return {
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: round2(taxAmount),
    };
  }

  const cgstAmount = round2(taxAmount / 2);
  const sgstAmount = round2(taxAmount - cgstAmount);

  return {
    cgstAmount,
    sgstAmount,
    igstAmount: 0,
  };
}


export interface LineGstBreakdown {
  lineAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  lineTaxAmount: number;
  lineTotal: number;
}

/**
 * Deterministically splits a line item's tax amount into CGST/SGST or IGST.
 *
 * Deterministic Odd-Paisa Rule:
 * For intra-state transactions, CGST and SGST must sum exactly to lineTaxAmount.
 * lineCgst = round2(lineTaxAmount / 2)
 * lineSgst = round2(lineTaxAmount - lineCgst)
 * This guarantees that: lineCgst + lineSgst === lineTaxAmount, with zero paisa drift.
 */
export function calculateLineGst(
  lineAmount: number,
  gstPercentage: number,
  isInterState: boolean,
  isReverseCharge: boolean
): LineGstBreakdown {
  if (isReverseCharge || gstPercentage <= 0) {
    return {
      lineAmount,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
      lineTaxAmount: 0,
      lineTotal: lineAmount,
    };
  }

  const lineTaxAmount = round2(lineAmount * (gstPercentage / 100));

  if (isInterState) {
    return {
      lineAmount,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: lineTaxAmount,
      lineTaxAmount,
      lineTotal: round2(lineAmount + lineTaxAmount),
    };
  }

  // Intra-state: 50% CGST + 50% SGST with exact one-paisa reconciliation
  const cgstAmount = round2(lineTaxAmount / 2);
  const sgstAmount = round2(lineTaxAmount - cgstAmount);

  return {
    lineAmount,
    cgstAmount,
    sgstAmount,
    igstAmount: 0,
    lineTaxAmount,
    lineTotal: round2(lineAmount + lineTaxAmount),
  };
}
