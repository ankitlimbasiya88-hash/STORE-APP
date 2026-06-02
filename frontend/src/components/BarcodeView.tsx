import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { encodeCode128B } from "@/src/utils/code128";

type Props = {
  value: string;
  height?: number;
  width?: number;
  showText?: boolean;
  background?: string;
  foreground?: string;
};

export const BarcodeView: React.FC<Props> = ({
  value,
  height = 80,
  width = 280,
  showText = true,
  background = "#fff",
  foreground = "#000",
}) => {
  const { widths, totalModules } = useMemo(() => {
    const v = (value || "").trim();
    if (!v) return { widths: [] as number[], totalModules: 1 };
    const ws = encodeCode128B(v);
    const sum = ws.reduce((s, x) => s + x, 0);
    return { widths: ws, totalModules: sum };
  }, [value]);

  if (!value || widths.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={styles.emptyText}>No barcode</Text>
      </View>
    );
  }

  const moduleWidth = width / totalModules;
  // Build bar rects (only the BAR modules, even-indexed entries are bars in our pattern
  // because Code128 patterns start with bar).
  const rects: React.ReactElement[] = [];
  let x = 0;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i] * moduleWidth;
    if (i % 2 === 0) {
      // bar
      rects.push(<Rect key={i} x={x} y={0} width={w} height={height} fill={foreground} />);
    }
    x += w;
  }

  return (
    <View style={[styles.wrap, { backgroundColor: background, width }]}>
      <Svg width={width} height={height}>{rects}</Svg>
      {showText && <Text style={styles.code}>{value}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { padding: 8, borderRadius: 6, alignItems: "center" },
  code: { marginTop: 4, fontSize: 11, color: "#0F172A", fontWeight: "600", letterSpacing: 1 },
  empty: { borderWidth: 1, borderColor: "#E2E8F0", borderStyle: "dashed", alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#F8FAFC" },
  emptyText: { color: "#94A3B8", fontSize: 12, fontStyle: "italic" },
});

export default BarcodeView;
