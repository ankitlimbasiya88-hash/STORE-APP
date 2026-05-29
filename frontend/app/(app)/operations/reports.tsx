import React, { useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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

export default function ReportsScreen() {
  const { apiStore, session, storeName } = useSession();
  const isEmployee = session?.user.role !== "admin";
  const [date, setDate] = useState<Date>(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const dateStr = formatDateInput(date);

  const onChangeDate = (event: any, selected?: Date) => {
    setShowPicker(Platform.OS === "ios");
    if (selected) setDate(selected);
  };

  const generateChecklist = async (type: "opening" | "closing") => {
    setBusy(type);
    try {
      const d = await apiStore<any>(`/api/checklists/${type}/today?date=${dateStr}`);
      const html = buildChecklistHtml({
        title: type === "opening" ? "Opening Checklist" : "Closing Checklist",
        storeName: storeName || "Store",
        date: d.date,
        tasks: (d.tasks || []).map((t: any) => ({ id: t.id, title: t.title })),
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
      const d = await apiStore<any>(`/api/accounting/today?date=${dateStr}`);
      const html = buildAccountingHtml({
        storeName: storeName || "Store",
        date: d.date,
        heads: d.heads || [],
        entries: d.entries || {},
        openingBalance: d.opening_balance,
        closingBalance: d.closing_balance,
        totalCredit: d.total_credit,
        totalDebit: d.total_debit,
        net: d.net,
        submitted: d.submitted,
        submittedBy: d.submitted_by,
        submittedAt: d.submitted_at,
        showBalances: !isEmployee,
      });
      await generateAndShare(html, `Accounting - ${d.date}.pdf`);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(null); }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Reports</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Select date</Text>
        <TouchableOpacity testID="date-picker-btn" style={styles.dateBox} onPress={() => setShowPicker(true)}>
          <Ionicons name="calendar" size={22} color={colors.primary} />
          <Text style={styles.dateText}>{date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</Text>
          <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
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

        <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Generate PDF report</Text>

        <TouchableOpacity testID="report-opening" style={styles.reportCard} onPress={() => generateChecklist("opening")} disabled={busy !== null} activeOpacity={0.8}>
          <View style={[styles.iconWrap, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="sunny" size={24} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reportTitle}>Opening Checklist</Text>
            <Text style={styles.reportSub}>{busy === "opening" ? "Generating..." : "Tap to download PDF"}</Text>
          </View>
          {busy === "opening" ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="download-outline" size={22} color={colors.primary} />}
        </TouchableOpacity>

        <TouchableOpacity testID="report-closing" style={styles.reportCard} onPress={() => generateChecklist("closing")} disabled={busy !== null} activeOpacity={0.8}>
          <View style={[styles.iconWrap, { backgroundColor: "#EDE9FE" }]}>
            <Ionicons name="moon" size={24} color="#7C3AED" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reportTitle}>Closing Checklist</Text>
            <Text style={styles.reportSub}>{busy === "closing" ? "Generating..." : "Tap to download PDF"}</Text>
          </View>
          {busy === "closing" ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="download-outline" size={22} color={colors.primary} />}
        </TouchableOpacity>

        <TouchableOpacity testID="report-accounting" style={styles.reportCard} onPress={generateAccounting} disabled={busy !== null} activeOpacity={0.8}>
          <View style={[styles.iconWrap, { backgroundColor: "#DBEAFE" }]}>
            <Ionicons name="calculator" size={24} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.reportTitle}>Accounting</Text>
            <Text style={styles.reportSub}>{busy === "accounting" ? "Generating..." : "Tap to download PDF"}</Text>
          </View>
          {busy === "accounting" ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="download-outline" size={22} color={colors.primary} />}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, letterSpacing: 1, textTransform: "uppercase", marginBottom: spacing.sm },
  dateBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  dateText: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  reportCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  reportTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  reportSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
