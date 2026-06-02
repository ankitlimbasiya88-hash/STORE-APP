import { Platform, Alert } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

/**
 * CSV helpers — generate properly-escaped CSV strings and save/share them.
 *
 * Web fallback: triggers a browser download via a Blob.
 * Native: writes to cache dir then opens the native share sheet.
 */

const escapeCell = (v: any): string => {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Normalize line breaks
  s = s.replace(/\r\n|\r/g, "\n");
  // If contains delimiter, quote, or newline → wrap in quotes and double-up quotes
  if (/[",\n]/.test(s)) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
};

/** Build a CSV string from `headers` (row 1) and `rows` (each row is an array of cells). */
export const buildCsv = (headers: string[], rows: any[][]): string => {
  const lines: string[] = [];
  lines.push(headers.map(escapeCell).join(","));
  for (const row of rows) {
    lines.push(row.map(escapeCell).join(","));
  }
  return lines.join("\n");
};

/** Build a multi-section CSV with named blocks separated by a blank line. */
export const buildMultiCsv = (sections: { title: string; headers: string[]; rows: any[][] }[]): string => {
  const out: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (i > 0) out.push("");                 // blank separator
    out.push(`# ${escapeCell(s.title)}`);
    out.push(s.headers.map(escapeCell).join(","));
    for (const row of s.rows) out.push(row.map(escapeCell).join(","));
  }
  return out.join("\n");
};

export async function shareCsv(csv: string, filename: string): Promise<void> {
  try {
    // Web: trigger a Blob-based download
    if (Platform.OS === "web") {
      // BOM so Excel opens UTF-8 correctly
      const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return;
    }

    // Native: write file + Sharing
    const path = `${FileSystem.cacheDirectory}${filename}`;
    await FileSystem.writeAsStringAsync(path, "\ufeff" + csv, { encoding: FileSystem.EncodingType.UTF8 });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: filename });
    } else {
      Alert.alert("Saved", `CSV saved to ${path}`);
    }
  } catch (e: any) {
    Alert.alert("CSV error", e?.message || String(e));
  }
}
