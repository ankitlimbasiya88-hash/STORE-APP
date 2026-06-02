import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, RefreshControl, Modal, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { buildReportsSummaryHtml, generateAndShare } from "@/src/utils/pdf";
import { buildMultiCsv, shareCsv } from "@/src/utils/csv";

const fmt = (n: number): string => `$${(Math.round(n * 100) / 100).toFixed(2)}`;
const fmtDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type AccountingByHead = { head_id: string; head_name: string; type: "credit" | "debit"; total: number };
type AccountingByDay = { date: string; credit: number; debit: number; net: number };
type AccountingBlock = {
  hidden?: boolean;
  credit_total?: number;
  debit_total?: number;
  net?: number;
  by_head?: AccountingByHead[];
  by_day?: AccountingByDay[];
  days_with_entries?: number;
};
type ShoppingBySupplier = { supplier_id: string | null; supplier_name: string; spent: number; tax: number; items: number; quantity: number };
type ShoppingByMonth = { month: string; spent: number };
type ShoppingBlock = {
  total_spent: number;
  total_tax: number;
  batches: number;
  items: number;
  by_supplier: ShoppingBySupplier[];
  by_month: ShoppingByMonth[];
};
type Summary = {
  period: { from: string; to: string };
  store_id: string;
  accounting: AccountingBlock;
  shopping: ShoppingBlock;
};

type Preset = { key: string; label: string };
const PRESETS: Preset[] = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
];

function presetRange(key: string): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(now);
  let from = new Date(now);
  if (key === "this_month") from = new Date(now.getFullYear(), now.getMonth(), 1);
  else if (key === "last_month") {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from, to: lastDay };
  } else if (key === "last_30") from.setDate(from.getDate() - 29);
  else if (key === "last_90") from.setDate(from.getDate() - 89);
  else if (key === "ytd") from = new Date(now.getFullYear(), 0, 1);
  return { from, to };
}

export default function ReportsSummaryScreen() {
  const { apiStore, session, storeName } = useSession();
  const isAdmin = session?.user.role === "admin";
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const initial = presetRange("this_month");
  const [from, setFrom] = useState<Date>(initial.from);
  const [to, setTo] = useState<Date>(initial.to);
  const [activePreset, setActivePreset] = useState<string | null>("this_month");
  const [data, setData] = useState<Summary | null>(null);
  const [pickerOpen, setPickerOpen] = useState<null | "from" | "to">(null);
  const [tempDate, setTempDate] = useState<Date>(new Date());

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const qs = `date_from=${fmtDateInput(from)}&date_to=${fmtDateInput(to)}`;
      const res = await apiStore<Summary>(`/api/reports/summary?${qs}`);
      setData(res);
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiStore, from, to]);

  useEffect(() => { load(); }, [load]);

  const applyPreset = (key: string) => {
    const r = presetRange(key);
    setFrom(r.from);
    setTo(r.to);
    setActivePreset(key);
  };

  const openPicker = (which: "from" | "to") => {
    setTempDate(which === "from" ? from : to);
    setPickerOpen(which);
  };

  const onDateChange = (_: any, d?: Date) => {
    if (Platform.OS === "android") setPickerOpen(null);
    if (!d) return;
    setTempDate(d);
    if (Platform.OS === "android") {
      if (pickerOpen === "from") setFrom(d);
      else if (pickerOpen === "to") setTo(d);
      setActivePreset(null);
    }
  };

  const confirmIOSPicker = () => {
    if (pickerOpen === "from") setFrom(tempDate);
    else if (pickerOpen === "to") setTo(tempDate);
    setActivePreset(null);
    setPickerOpen(null);
  };

  const sharePdf = async () => {
    if (!data) return;
    try {
      const html = buildReportsSummaryHtml({
        storeName: storeName || "Store",
        period: data.period,
        accounting: data.accounting,
        shopping: data.shopping,
      });
      await generateAndShare(html, `ReportsSummary_${data.period.from}_to_${data.period.to}.pdf`);
    } catch (e: any) {
      Alert.alert("PDF error", e.message || "Failed to export");
    }
  };

  const shareCsvReport = async () => {
    if (!data) return;
    try {
      const sections: { title: string; headers: string[]; rows: any[][] }[] = [];
      sections.push({
        title: `Reports Summary — ${storeName || "Store"} — ${data.period.from} to ${data.period.to}`,
        headers: ["Section", "Metric", "Value"],
        rows: [["Period", "From", data.period.from], ["Period", "To", data.period.to]],
      });
      if (!data.accounting?.hidden) {
        sections.push({
          title: "Cash Accounting — totals",
          headers: ["Metric", "Amount"],
          rows: [
            ["Credit total", data.accounting.credit_total ?? 0],
            ["Debit total", data.accounting.debit_total ?? 0],
            ["Net", data.accounting.net ?? 0],
            ["Days with entries", data.accounting.days_with_entries ?? 0],
          ],
        });
        sections.push({
          title: "Cash Accounting — by head",
          headers: ["Head", "Type", "Total"],
          rows: (data.accounting.by_head || []).map((h) => [h.head_name, h.type, h.total]),
        });
        if ((data.accounting.by_day || []).length) {
          sections.push({
            title: "Cash Accounting — by day",
            headers: ["Date", "Credit", "Debit", "Net"],
            rows: (data.accounting.by_day || []).map((d) => [d.date, d.credit, d.debit, d.net]),
          });
        }
      }
      sections.push({
        title: "Shopping spend — totals",
        headers: ["Metric", "Value"],
        rows: [
          ["Total spent (incl tax)", data.shopping.total_spent],
          ["Total tax", data.shopping.total_tax],
          ["Items", data.shopping.items],
          ["Batches", data.shopping.batches],
        ],
      });
      sections.push({
        title: "Shopping spend — by supplier",
        headers: ["Supplier", "Units", "Items", "Tax", "Spent"],
        rows: data.shopping.by_supplier.map((s) => [s.supplier_name, s.quantity, s.items, s.tax, s.spent]),
      });
      sections.push({
        title: "Shopping spend — by month",
        headers: ["Month", "Spent"],
        rows: data.shopping.by_month.map((m) => [m.month, m.spent]),
      });
      const csv = buildMultiCsv(sections);
      await shareCsv(csv, `ReportsSummary_${data.period.from}_to_${data.period.to}.csv`);
    } catch (e: any) {
      Alert.alert("CSV error", e.message || "Failed to export");
    }
  };

  // For sparkline-ish progress bars
  const maxByHead = useMemo(() => {
    const heads = data?.accounting?.by_head || [];
    return Math.max(1, ...heads.map((h) => h.total));
  }, [data]);
  const maxBySupplier = useMemo(() => {
    const sup = data?.shopping?.by_supplier || [];
    return Math.max(1, ...sup.map((s) => s.spent));
  }, [data]);
  const maxByMonth = useMemo(() => {
    const m = data?.shopping?.by_month || [];
    return Math.max(1, ...m.map((s) => s.spent));
  }, [data]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={20} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Reports Dashboard</Text>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <TouchableOpacity onPress={sharePdf} style={styles.pdfBtn}>
            <AppIcon name="download" size={16} color="#fff" />
            <Text style={styles.pdfBtnText}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareCsvReport} style={[styles.pdfBtn, { backgroundColor: "#10B981" }]}>
            <Text style={styles.pdfBtnText}>CSV</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} />}
      >
        {/* Date range */}
        <View style={styles.section}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {PRESETS.map((p) => (
              <TouchableOpacity key={p.key} onPress={() => applyPreset(p.key)} style={[styles.presetChip, activePreset === p.key && styles.presetChipActive]}>
                <Text style={[styles.presetTxt, activePreset === p.key && styles.presetTxtActive]}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <View style={styles.dateRow}>
            <TouchableOpacity style={styles.dateBtn} onPress={() => openPicker("from")}>
              <Text style={styles.dateLabel}>FROM</Text>
              <Text style={styles.dateVal}>{fmtDateInput(from)}</Text>
            </TouchableOpacity>
            <View style={styles.dash}><AppIcon name="forward" size={14} color={colors.textMuted} /></View>
            <TouchableOpacity style={styles.dateBtn} onPress={() => openPicker("to")}>
              <Text style={styles.dateLabel}>TO</Text>
              <Text style={styles.dateVal}>{fmtDateInput(to)}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={{ alignItems: "center", paddingVertical: 60 }}><ActivityIndicator color={colors.primary} /></View>
        ) : !data ? null : (
          <>
            {/* Cash Accounting card */}
            {data.accounting?.hidden ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Cash Accounting</Text>
                <Text style={styles.muted}>Hidden — employees do not see cash totals.</Text>
              </View>
            ) : (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>💵 Cash Accounting</Text>
                <View style={styles.kpiRow}>
                  <View style={[styles.kpi, { backgroundColor: "#DCFCE7" }]}>
                    <Text style={styles.kpiLabel}>Credits</Text>
                    <Text style={[styles.kpiVal, { color: "#16A34A" }]}>{fmt(data.accounting.credit_total || 0)}</Text>
                  </View>
                  <View style={[styles.kpi, { backgroundColor: "#FEE2E2" }]}>
                    <Text style={styles.kpiLabel}>Debits</Text>
                    <Text style={[styles.kpiVal, { color: "#DC2626" }]}>{fmt(data.accounting.debit_total || 0)}</Text>
                  </View>
                  <View style={[styles.kpi, { backgroundColor: "#DBEAFE" }]}>
                    <Text style={styles.kpiLabel}>Net</Text>
                    <Text style={[styles.kpiVal, { color: colors.primary }]}>{fmt(data.accounting.net || 0)}</Text>
                  </View>
                </View>
                <Text style={styles.sectionSub}>By head ({data.accounting.days_with_entries} day{(data.accounting.days_with_entries || 0) === 1 ? "" : "s"} with entries)</Text>
                {(data.accounting.by_head || []).length === 0 ? (
                  <Text style={styles.muted}>No entries in this period.</Text>
                ) : (
                  (data.accounting.by_head || []).map((h) => {
                    const pct = Math.max(0, Math.min(1, h.total / maxByHead));
                    return (
                      <View key={h.head_id} style={styles.barRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.barName} numberOfLines={1}>{h.head_name}</Text>
                          <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: h.type === "credit" ? "#16A34A" : "#DC2626" }]} />
                          </View>
                        </View>
                        <Text style={[styles.barVal, { color: h.type === "credit" ? "#16A34A" : "#DC2626" }]}>{fmt(h.total)}</Text>
                      </View>
                    );
                  })
                )}
              </View>
            )}

            {/* Shopping card */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>🛒 Shopping Spend</Text>
              <View style={styles.kpiRow}>
                <View style={[styles.kpi, { backgroundColor: "#FFF7ED" }]}>
                  <Text style={styles.kpiLabel}>Total</Text>
                  <Text style={[styles.kpiVal, { color: "#EA580C" }]}>{fmt(data.shopping.total_spent)}</Text>
                </View>
                <View style={[styles.kpi, { backgroundColor: "#FAE8FF" }]}>
                  <Text style={styles.kpiLabel}>Tax</Text>
                  <Text style={[styles.kpiVal, { color: "#A855F7" }]}>{fmt(data.shopping.total_tax)}</Text>
                </View>
                <View style={[styles.kpi, { backgroundColor: "#E0F2FE" }]}>
                  <Text style={styles.kpiLabel}>Items / Batches</Text>
                  <Text style={[styles.kpiVal, { color: "#0EA5E9" }]}>{data.shopping.items} / {data.shopping.batches}</Text>
                </View>
              </View>
              <Text style={styles.sectionSub}>Top suppliers</Text>
              {data.shopping.by_supplier.length === 0 ? (
                <Text style={styles.muted}>No shopping in this period.</Text>
              ) : (
                data.shopping.by_supplier.map((s) => {
                  const pct = Math.max(0, Math.min(1, s.spent / maxBySupplier));
                  return (
                    <View key={s.supplier_id || s.supplier_name} style={styles.barRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.barName} numberOfLines={1}>{s.supplier_name}</Text>
                        <Text style={styles.barMeta}>{s.items} items · {s.quantity} units</Text>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: "#EA580C" }]} />
                        </View>
                      </View>
                      <Text style={[styles.barVal, { color: "#EA580C" }]}>{fmt(s.spent)}</Text>
                    </View>
                  );
                })
              )}
              {data.shopping.by_month.length > 1 && (
                <>
                  <Text style={styles.sectionSub}>By month</Text>
                  {data.shopping.by_month.map((m) => {
                    const pct = Math.max(0, Math.min(1, m.spent / maxByMonth));
                    return (
                      <View key={m.month} style={styles.barRow}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.barName}>{m.month}</Text>
                          <View style={styles.barTrack}>
                            <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: "#0EA5E9" }]} />
                          </View>
                        </View>
                        <Text style={[styles.barVal, { color: "#0EA5E9" }]}>{fmt(m.spent)}</Text>
                      </View>
                    );
                  })}
                </>
              )}
            </View>
            <View style={{ height: 30 }} />
          </>
        )}
      </ScrollView>

      {/* Date picker modal */}
      {pickerOpen && Platform.OS === "ios" && (
        <Modal visible transparent animationType="slide">
          <TouchableOpacity style={styles.pickerBack} activeOpacity={1} onPress={() => setPickerOpen(null)}>
            <TouchableOpacity style={styles.pickerBox} activeOpacity={1}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", padding: spacing.md }}>
                <TouchableOpacity onPress={() => setPickerOpen(null)}><Text style={{ color: colors.textMuted, fontWeight: "600" }}>Cancel</Text></TouchableOpacity>
                <Text style={{ fontWeight: "700", color: colors.text }}>{pickerOpen === "from" ? "From date" : "To date"}</Text>
                <TouchableOpacity onPress={confirmIOSPicker}><Text style={{ color: colors.primary, fontWeight: "700" }}>Done</Text></TouchableOpacity>
              </View>
              <DateTimePicker value={tempDate} mode="date" display="spinner" onChange={onDateChange} maximumDate={new Date()} />
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      )}
      {pickerOpen && Platform.OS === "android" && (
        <DateTimePicker value={tempDate} mode="date" onChange={onDateChange} maximumDate={new Date()} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  backBtn: { padding: 6 },
  title: { color: "#fff", fontWeight: "800", fontSize: 17 },
  pdfBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radius.sm },
  pdfBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  content: { padding: spacing.md, gap: spacing.md },
  section: { gap: spacing.sm },
  presetChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  presetChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetTxt: { color: colors.text, fontWeight: "600", fontSize: 13 },
  presetTxtActive: { color: "#fff" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateBtn: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.card, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  dateLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, letterSpacing: 0.5 },
  dateVal: { fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 2 },
  dash: { paddingHorizontal: 6 },

  card: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  cardTitle: { color: colors.text, fontWeight: "800", fontSize: 16 },
  sectionSub: { color: colors.textMuted, fontWeight: "700", fontSize: 12, textTransform: "uppercase", marginTop: spacing.sm },
  muted: { color: colors.textMuted, fontSize: 13 },

  kpiRow: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  kpi: { flex: 1, paddingVertical: 10, paddingHorizontal: 10, borderRadius: radius.sm, alignItems: "flex-start" },
  kpiLabel: { fontSize: 11, fontWeight: "700", color: colors.textMuted, textTransform: "uppercase" },
  kpiVal: { fontSize: 17, fontWeight: "800", marginTop: 2 },

  barRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 },
  barName: { color: colors.text, fontWeight: "600", fontSize: 13 },
  barMeta: { color: colors.textMuted, fontSize: 11 },
  barTrack: { height: 8, backgroundColor: colors.surface, borderRadius: 4, marginTop: 4, overflow: "hidden" },
  barFill: { height: "100%", borderRadius: 4 },
  barVal: { fontSize: 14, fontWeight: "800", minWidth: 80, textAlign: "right" },

  pickerBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  pickerBox: { backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: spacing.md },
});
