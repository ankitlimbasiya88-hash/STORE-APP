import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "@/src/components/AppIcon";
import { router } from "expo-router";
import DateTimePicker from "@react-native-community/datetimepicker";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import {
  buildChecklistHtml, buildAccountingHtml, generateAndShare,
} from "@/src/utils/pdf";

const CURRENCY = "$";

const formatDateInput = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

type MultiItem = { id: string; label?: string; note?: string; amount: number };
type EntryValue = number | { amount: number; note?: string } | MultiItem[];

type Head = {
  id: string;
  name: string;
  type: "credit" | "debit";
  is_cash?: boolean;
  allow_notes?: boolean;
  multiple_entries?: boolean;
};

type AccPreview = {
  date: string;
  heads: Head[];
  entries: Record<string, EntryValue>;
  opening_balance: number | null;
  closing_balance: number | null;
  total_credit: number;
  total_debit: number;
  net: number;
  submitted: boolean;
  submitted_by?: string | null;
  submitted_at?: string | null;
};

type ChecklistPreview = {
  date: string;
  tasks: { id: string; title: string }[];
  completed_ids: string[];
  submitted: boolean;
  submitted_by?: string | null;
  submitted_at?: string | null;
};

const entryAmount = (v: any): number => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  if (Array.isArray(v)) return v.reduce((s, it) => s + (Number(it?.amount) || 0), 0);
  if (typeof v === "object") return Number(v.amount) || 0;
  return 0;
};

export default function ReportsScreen() {
  const { apiStore, session, storeName } = useSession();
  const isEmployee = session?.user.role !== "admin";
  const [date, setDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState<ChecklistPreview | null>(null);
  const [closing, setClosing] = useState<ChecklistPreview | null>(null);
  const [accounting, setAccounting] = useState<AccPreview | null>(null);

  const dateStr = formatDateInput(date);

  const loadPreviews = useCallback(async () => {
    setLoading(true);
    try {
      const [op, cl, ac] = await Promise.all([
        apiStore<ChecklistPreview>(`/api/checklists/opening/today?date=${dateStr}`),
        apiStore<ChecklistPreview>(`/api/checklists/closing/today?date=${dateStr}`),
        apiStore<AccPreview>(`/api/accounting/today?date=${dateStr}`),
      ]);
      setOpening(op);
      setClosing(cl);
      setAccounting(ac);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [apiStore, dateStr]);

  useEffect(() => { loadPreviews(); }, [loadPreviews]);

  const onChangeDate = (event: any, selected?: Date) => {
    setShowPicker(Platform.OS === "ios");
    if (selected) setDate(selected);
  };

  const generateChecklist = async (type: "opening" | "closing") => {
    setBusy(type);
    try {
      const d = type === "opening" ? opening : closing;
      if (!d) return;
      const html = buildChecklistHtml({
        title: type === "opening" ? "Opening Checklist" : "Closing Checklist",
        storeName: storeName || "Store",
        date: d.date,
        tasks: (d.tasks || []).map((t) => ({ id: t.id, title: t.title })),
        completedIds: d.completed_ids || [],
        submitted: d.submitted,
        submittedBy: d.submitted_by,
        submittedAt: d.submitted_at,
      });
      await generateAndShare(html, `${type === "opening" ? "Opening" : "Closing"} Checklist - ${d.date}.pdf`);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };

  const generateAccounting = async () => {
    setBusy("accounting");
    try {
      if (!accounting) return;
      const html = buildAccountingHtml({
        storeName: storeName || "Store",
        date: accounting.date,
        heads: accounting.heads || [],
        entries: accounting.entries || {},
        openingBalance: accounting.opening_balance,
        closingBalance: accounting.closing_balance,
        totalCredit: accounting.total_credit,
        totalDebit: accounting.total_debit,
        net: accounting.net,
        submitted: accounting.submitted,
        submittedBy: accounting.submitted_by,
        submittedAt: accounting.submitted_at,
        showBalances: !isEmployee,
      });
      await generateAndShare(html, `Accounting - ${accounting.date}.pdf`);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };

  const renderChecklistPreview = (d: ChecklistPreview | null, label: string, color: string) => {
    if (!d) return null;
    const completed = d.completed_ids.length;
    const total = d.tasks.length;
    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHead}>
          <Text style={[styles.previewTitle, { color }]}>{label}</Text>
          <View style={[styles.statusBadge, { backgroundColor: d.submitted ? "#DCFCE7" : "#FEF3C7" }]}>
            <Text style={[styles.statusBadgeText, { color: d.submitted ? colors.success : "#B45309" }]}>
              {d.submitted ? "SUBMITTED" : "OPEN"}
            </Text>
          </View>
        </View>
        <Text style={styles.previewMeta}>
          {completed}/{total} tasks completed
          {d.submitted && d.submitted_by ? ` • by ${d.submitted_by}` : ""}
        </Text>
        {total === 0 && <Text style={styles.empty}>No tasks configured</Text>}
      </View>
    );
  };

  const renderAccountingPreview = () => {
    if (!accounting) return null;
    const credits = accounting.heads.filter((h) => h.type === "credit");
    const debits = accounting.heads.filter((h) => h.type === "debit");

    const renderHeadLine = (h: Head) => {
      const val = accounting.entries?.[h.id];
      const total = entryAmount(val);
      const isMulti = h.multiple_entries && Array.isArray(val) && (val as MultiItem[]).length > 0;
      const hasNote = h.allow_notes && val && typeof val === "object" && !Array.isArray(val) && (val as any).note;

      return (
        <View key={h.id} style={styles.headLine}>
          <View style={styles.headLineRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headLineName}>{h.name}</Text>
              {h.multiple_entries && (
                <Text style={styles.headLineMeta}>
                  {Array.isArray(val) ? `${(val as MultiItem[]).length} ${(val as MultiItem[]).length === 1 ? "entry" : "entries"}` : "0 entries"}
                </Text>
              )}
              {hasNote ? (
                <Text style={styles.headLineNote}>{(val as any).note}</Text>
              ) : null}
            </View>
            <Text style={[styles.headLineAmt, { color: h.type === "credit" ? colors.credit : colors.debit }]}>
              {CURRENCY}{total.toFixed(2)}
            </Text>
          </View>
          {isMulti && (
            <View style={styles.miniItems}>
              {(val as MultiItem[]).map((it) => (
                <View key={it.id} style={styles.miniItem}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.miniItemLabel}>• {it.label || "—"}</Text>
                    {it.note ? <Text style={styles.miniItemNote}>{it.note}</Text> : null}
                  </View>
                  <Text style={styles.miniItemAmt}>{CURRENCY}{(Number(it.amount) || 0).toFixed(2)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      );
    };

    return (
      <View style={styles.previewCard}>
        <View style={styles.previewHead}>
          <Text style={[styles.previewTitle, { color: colors.primary }]}>Accounting Summary</Text>
          <View style={[styles.statusBadge, { backgroundColor: accounting.submitted ? "#DCFCE7" : "#FEF3C7" }]}>
            <Text style={[styles.statusBadgeText, { color: accounting.submitted ? colors.success : "#B45309" }]}>
              {accounting.submitted ? "SUBMITTED" : "OPEN"}
            </Text>
          </View>
        </View>

        {!isEmployee && accounting.opening_balance !== null && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Opening Balance</Text>
            <Text style={styles.summaryVal}>{CURRENCY}{accounting.opening_balance.toFixed(2)}</Text>
          </View>
        )}
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.credit }]}>+ Total Credit</Text>
          <Text style={[styles.summaryVal, { color: colors.credit }]}>{CURRENCY}{accounting.total_credit.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, { color: colors.debit }]}>− Total Debit</Text>
          <Text style={[styles.summaryVal, { color: colors.debit }]}>{CURRENCY}{accounting.total_debit.toFixed(2)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryRow}>
          <Text style={styles.netLabel}>Net</Text>
          <Text style={[styles.netVal, { color: accounting.net >= 0 ? colors.success : colors.danger }]}>
            {CURRENCY}{accounting.net.toFixed(2)}
          </Text>
        </View>
        {!isEmployee && accounting.closing_balance !== null && (
          <View style={styles.summaryRow}>
            <Text style={styles.netLabel}>Closing Balance</Text>
            <Text style={styles.netVal}>{CURRENCY}{accounting.closing_balance.toFixed(2)}</Text>
          </View>
        )}

        {/* For admins, show per-head details for the historical date */}
        {!isEmployee && (credits.length + debits.length) > 0 && (
          <>
            <Text style={[styles.subSectionLabel, { color: colors.credit, marginTop: spacing.md }]}>Credits</Text>
            {credits.length === 0 ? <Text style={styles.empty}>No credit heads</Text> : credits.map(renderHeadLine)}

            <Text style={[styles.subSectionLabel, { color: colors.debit, marginTop: spacing.md }]}>Debits</Text>
            {debits.length === 0 ? <Text style={styles.empty}>No debit heads</Text> : debits.map(renderHeadLine)}
          </>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={22} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadPreviews} tintColor={colors.primary} />}
      >
        <Text style={styles.sectionLabel}>Select date</Text>
        <TouchableOpacity testID="date-picker-btn" style={styles.dateBox} onPress={() => setShowPicker(true)}>
          <AppIcon name="calendar" size={20} color={colors.primary} />
          <Text style={styles.dateText}>{date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</Text>
          <AppIcon name="down" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        {showPicker && (
          <DateTimePicker
            testID="date-picker"
            value={date}
            mode="date"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={onChangeDate}
            maximumDate={new Date()}
          />
        )}

        {loading ? (
          <View style={{ paddingVertical: 40, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Opening</Text>
            {renderChecklistPreview(opening, "Opening Checklist", "#F59E0B")}
            <TouchableOpacity
              testID="report-opening"
              style={styles.pdfBtn}
              onPress={() => generateChecklist("opening")}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === "opening" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <AppIcon name="download" size={18} color={colors.primary} />
              )}
              <Text style={styles.pdfBtnText}>{busy === "opening" ? "Generating..." : "Download Opening Checklist PDF"}</Text>
            </TouchableOpacity>

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Closing</Text>
            {renderChecklistPreview(closing, "Closing Checklist", "#7C3AED")}
            <TouchableOpacity
              testID="report-closing"
              style={styles.pdfBtn}
              onPress={() => generateChecklist("closing")}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === "closing" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <AppIcon name="download" size={18} color={colors.primary} />
              )}
              <Text style={styles.pdfBtnText}>{busy === "closing" ? "Generating..." : "Download Closing Checklist PDF"}</Text>
            </TouchableOpacity>

            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Accounting</Text>
            {renderAccountingPreview()}
            <TouchableOpacity
              testID="report-accounting"
              style={styles.pdfBtn}
              onPress={generateAccounting}
              disabled={busy !== null}
              activeOpacity={0.85}
            >
              {busy === "accounting" ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <AppIcon name="download" size={18} color={colors.primary} />
              )}
              <Text style={styles.pdfBtnText}>{busy === "accounting" ? "Generating..." : "Download Accounting PDF"}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: 60, gap: spacing.sm },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  dateBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dateText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.text },

  previewCard: {
    backgroundColor: colors.card,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.xs,
  },
  previewHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  previewTitle: { fontSize: 15, fontWeight: "700" },
  previewMeta: { fontSize: 12, color: colors.textMuted },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },

  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 5,
  },
  summaryLabel: { fontSize: 13, color: colors.textMuted, fontWeight: "500" },
  summaryVal: { fontSize: 14, fontWeight: "600", color: colors.text },
  summaryDivider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  netLabel: { fontSize: 15, fontWeight: "700", color: colors.text },
  netVal: { fontSize: 18, fontWeight: "700", color: colors.primary },

  subSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  headLine: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headLineRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  headLineName: { fontSize: 14, fontWeight: "600", color: colors.text },
  headLineMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  headLineNote: { fontSize: 11, color: colors.textMuted, fontStyle: "italic", marginTop: 2 },
  headLineAmt: { fontSize: 14, fontWeight: "700", textAlign: "right", minWidth: 80 },
  miniItems: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
    gap: 4,
  },
  miniItem: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  miniItemLabel: { fontSize: 13, color: colors.text, fontWeight: "500" },
  miniItemNote: { fontSize: 11, color: colors.textMuted, fontStyle: "italic", marginTop: 1 },
  miniItemAmt: { fontSize: 13, fontWeight: "600", color: colors.text, minWidth: 70, textAlign: "right" },

  pdfBtn: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    borderWidth: 1.5,
    borderColor: colors.primary,
    padding: 12,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  pdfBtnText: { color: colors.primary, fontWeight: "700", fontSize: 14 },

  empty: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", paddingVertical: 4 },
});
