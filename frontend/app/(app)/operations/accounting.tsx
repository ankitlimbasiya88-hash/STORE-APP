import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, Modal, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

type Head = { id: string; name: string; type: "credit" | "debit"; created_at: string };
type AccData = {
  date: string;
  opening_balance: number;
  heads: Head[];
  entries: Record<string, number>;
  total_credit: number;
  total_debit: number;
  closing_balance: number;
  submitted: boolean;
};

const CURRENCY = "$";

export default function AccountingScreen() {
  const { api, session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const [data, setData] = useState<AccData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"credit" | "debit">("credit");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<AccData>("/api/accounting/today");
      setData(d);
      const map: Record<string, string> = {};
      d.heads.forEach(h => { map[h.id] = String(d.entries[h.id] ?? 0); });
      setAmounts(map);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const saveAmount = async (headId: string, value: string) => {
    const num = parseFloat(value) || 0;
    setAmounts(prev => ({ ...prev, [headId]: value }));
    try {
      await api("/api/accounting/entry", {
        method: "POST", body: JSON.stringify({ head_id: headId, amount: num }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const addHead = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api("/api/accounting/heads", {
        method: "POST", body: JSON.stringify({ name: newName.trim(), type: newType }),
      });
      setNewName("");
      setModalOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const removeHead = (id: string) => {
    Alert.alert("Remove head", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
          try {
            await api(`/api/accounting/heads/${id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
      }},
    ]);
  };

  const submit = async () => {
    try {
      await api("/api/accounting/submit", { method: "POST" });
      Alert.alert("Submitted", "Today's accounting submitted.");
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  if (loading || !data) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const credits = data.heads.filter(h => h.type === "credit");
  const debits = data.heads.filter(h => h.type === "debit");

  const renderHead = (h: Head) => (
    <View key={h.id} style={styles.headRow}>
      <Text style={styles.headName}>{h.name}</Text>
      <View style={styles.amountWrap}>
        <Text style={styles.currency}>{CURRENCY}</Text>
        <TextInput
          testID={`amount-${h.id}`}
          style={styles.amountInput}
          keyboardType="decimal-pad"
          value={amounts[h.id] ?? "0"}
          onChangeText={(v) => setAmounts(prev => ({ ...prev, [h.id]: v }))}
          onBlur={() => saveAmount(h.id, amounts[h.id] ?? "0")}
          editable={!data.submitted}
        />
      </View>
      {isAdmin && (
        <TouchableOpacity testID={`remove-head-${h.id}`} onPress={() => removeHead(h.id)} hitSlop={10}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accounting</Text>
        {isAdmin ? (
          <TouchableOpacity testID="add-head-btn" onPress={() => setModalOpen(true)} style={styles.backBtn}>
            <Ionicons name="add" size={26} color="#fff" />
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Opening Balance</Text>
              <Text style={styles.summaryVal}>{CURRENCY}{data.opening_balance.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.credit }]}>+ Credits</Text>
              <Text style={[styles.summaryVal, { color: colors.credit }]}>{CURRENCY}{data.total_credit.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.debit }]}>− Debits</Text>
              <Text style={[styles.summaryVal, { color: colors.debit }]}>{CURRENCY}{data.total_debit.toFixed(2)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.closingLabel}>Closing Balance</Text>
              <Text testID="closing-balance" style={styles.closingVal}>{CURRENCY}{data.closing_balance.toFixed(2)}</Text>
            </View>
          </View>

          <Text style={[styles.sectionTitle, { color: colors.credit }]}>Credits</Text>
          {credits.length === 0 ? <Text style={styles.empty}>No credit heads</Text> :
            credits.map(renderHead)}

          <Text style={[styles.sectionTitle, { color: colors.debit }]}>Debits</Text>
          {debits.length === 0 ? <Text style={styles.empty}>No debit heads</Text> :
            debits.map(renderHead)}

          {!data.submitted && data.heads.length > 0 && (
            <TouchableOpacity testID="submit-accounting-btn" style={styles.submitBtn} onPress={submit}>
              <Ionicons name="checkmark-done" size={20} color="#fff" />
              <Text style={styles.submitText}>Submit Today's Accounting</Text>
            </TouchableOpacity>
          )}
          {data.submitted && (
            <View style={styles.submittedBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.submittedText}>Today's accounting submitted</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>New Account Head</Text>
            <TextInput
              testID="new-head-name"
              style={styles.modalInput}
              placeholder="Head name (e.g. Cash Sales)"
              placeholderTextColor={colors.textLight}
              value={newName}
              onChangeText={setNewName}
            />
            <View style={styles.typeRow}>
              <TouchableOpacity
                testID="type-credit"
                style={[styles.typeBtn, newType === "credit" && { backgroundColor: colors.credit, borderColor: colors.credit }]}
                onPress={() => setNewType("credit")}
              >
                <Text style={[styles.typeText, newType === "credit" && { color: "#fff" }]}>Credit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="type-debit"
                style={[styles.typeBtn, newType === "debit" && { backgroundColor: colors.debit, borderColor: colors.debit }]}
                onPress={() => setNewType("debit")}
              >
                <Text style={[styles.typeText, newType === "debit" && { color: "#fff" }]}>Debit</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-head-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={addHead} disabled={busy}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving..." : "Add"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: 40 },
  summaryCard: { backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  summaryLabel: { fontSize: 14, color: colors.textMuted, fontWeight: "500" },
  summaryVal: { fontSize: 15, fontWeight: "600", color: colors.text },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  closingLabel: { fontSize: 16, fontWeight: "700", color: colors.text },
  closingVal: { fontSize: 20, fontWeight: "700", color: colors.primary },
  sectionTitle: { fontSize: 14, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: 13, fontStyle: "italic", paddingVertical: 4 },
  headRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  headName: { flex: 1, fontSize: 15, color: colors.text, fontWeight: "500" },
  amountWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 8 },
  currency: { color: colors.textMuted, fontSize: 15, fontWeight: "600", marginRight: 2 },
  amountInput: { minWidth: 80, paddingVertical: 8, fontSize: 15, color: colors.text, textAlign: "right", fontWeight: "600" },
  submitBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: colors.primary, padding: 16, borderRadius: radius.md, marginTop: spacing.lg },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  submittedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#DCFCE7", padding: spacing.md, borderRadius: radius.md, marginTop: spacing.lg },
  submittedText: { color: colors.success, fontWeight: "600" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  modalInput: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, marginBottom: spacing.md },
  typeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  typeBtn: { flex: 1, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: "center" },
  typeText: { fontWeight: "600", color: colors.text },
  modalActions: { flexDirection: "row", gap: spacing.sm },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.md, alignItems: "center" },
});
