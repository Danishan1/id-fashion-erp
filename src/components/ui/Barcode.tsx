"use client";

import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

interface BarcodeProps {
  /** Usually a document number (e.g. ORD-2026-00001) — scan-to-lookup during production/dispatch. */
  value: string;
  height?: number;
}

/**
 * Shared Code128 barcode renderer — reusable anywhere a document number
 * needs to be scannable (Sales Orders today; Production Orders/Dispatch
 * later can reuse this instead of pulling in a second barcode library).
 */
export function Barcode({ value, height = 50 }: BarcodeProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    JsBarcode(svgRef.current, value, {
      format: "CODE128",
      height,
      displayValue: true,
      fontSize: 13,
      margin: 8,
    });
  }, [value, height]);

  return <svg ref={svgRef} role="img" aria-label={`Barcode for ${value}`} />;
}
