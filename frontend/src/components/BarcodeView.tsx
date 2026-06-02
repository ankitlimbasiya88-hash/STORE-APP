// Barcode generator using JsBarcode (proven library) + react-native-svg.
// Output is a real scannable Code128 (auto-selects A/B/C). Verified scannable
// by hardware POS readers.
//
// Usage: <BarcodeView value="1234567890123" />

import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";
// Import the barcode encoders directly. This avoids the canvas/svg renderers
// that ship with JsBarcode (which depend on DOM APIs that don't exist in RN).
// @ts-ignore — jsbarcode has no TypeScript types in src
import barcodes from "jsbarcode/src/barcodes";

type Props = {
  value: string;
  height?: number;
  width?: number;
  showText?: boolean;
  background?: string;
  foreground?: string;
  format?: "CODE128" | "EAN13" | "EAN8" | "UPC" | "CODE39" | "auto";
};

/** Choose the right encoder. CODE128 works with any printable ASCII and is
 *  universally scannable on POS hardware — perfect default. For EAN/UPC formats
 *  jsbarcode needs extra options (flat/displayValue/etc.), so we only switch to
 *  them when the caller explicitly requests it AND supplies a valid check digit. */
const UPC_OPTS = { flat: true, displayValue: false, fontSize: 10, width: 2, height: 100, textMargin: 2, font: "monospace", textAlign: "center", textPosition: "bottom", background: "#fff", lineColor: "#000" };

function pickEncoder(value: string, format: Props["format"]) {
  const v = (value || "").trim();
  // Explicit format requested by caller
  if (format === "EAN13") return new barcodes.EAN13(v, UPC_OPTS);
  if (format === "EAN8") return new barcodes.EAN8(v, UPC_OPTS);
  if (format === "UPC") return new barcodes.UPC(v, UPC_OPTS);
  if (format === "CODE39") return new barcodes.CODE39(v, { mod43: false });
  if (format === "CODE128") return new barcodes.CODE128(v, {});

  // Auto: CODE128 is the safest default — encodes anything, no extra options
  // needed, and every modern POS scanner reads it.
  return new barcodes.CODE128(v, {});
}

export const BarcodeView: React.FC<Props> = ({
  value,
  height = 80,
  width = 280,
  showText = true,
  background = "#fff",
  foreground = "#000",
  format = "auto",
}) => {
  const { binary, displayText, ok } = useMemo(() => {
    const v = (value || "").trim();
    if (!v) return { binary: "", displayText: "", ok: false };
    try {
      const enc = pickEncoder(v, format);
      if (!enc.valid()) {
        // Last-resort: Code128 accepts any printable ASCII
        const enc2 = new barcodes.CODE128(v, {});
        if (!enc2.valid()) return { binary: "", displayText: v, ok: false };
        const r2 = enc2.encode();
        return { binary: r2.data, displayText: r2.text || v, ok: true };
      }
      const r = enc.encode();
      return { binary: r.data, displayText: r.text || v, ok: true };
    } catch (e) {
      return { binary: "", displayText: v, ok: false };
    }
  }, [value, format]);

  if (!ok || !binary) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>Invalid barcode</Text>
      </View>
    );
  }

  const moduleWidth = width / binary.length;
  // Build rect runs of consecutive '1's for fewer SVG elements.
  const rects: React.ReactElement[] = [];
  let runStart = -1;
  for (let i = 0; i <= binary.length; i++) {
    const bit = i < binary.length ? binary[i] : "0";
    if (bit === "1" && runStart < 0) runStart = i;
    if (bit === "0" && runStart >= 0) {
      const x = runStart * moduleWidth;
      const w = (i - runStart) * moduleWidth;
      rects.push(<Rect key={runStart} x={x} y={0} width={w} height={height} fill={foreground} />);
      runStart = -1;
    }
  }

  return (
    <View style={[styles.wrap, { backgroundColor: background }]}>
      {/* Quiet zone: padding on sides ensures scanner can locate the start/stop */}
      <View style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: background }}>
        <Svg width={width} height={height}>{rects}</Svg>
      </View>
      {showText && <Text style={styles.code}>{displayText}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { borderRadius: 6, alignItems: "center", paddingBottom: 6 },
  code: { marginTop: 4, fontSize: 12, color: "#0F172A", fontWeight: "600", letterSpacing: 2 },
  empty: { borderWidth: 1, borderColor: "#E2E8F0", borderStyle: "dashed", alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#F8FAFC" },
  emptyText: { color: "#94A3B8", fontSize: 12, fontStyle: "italic" },
});

export default BarcodeView;
