import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, Modal, RefreshControl, Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { buildAccountingHtml, generateAndShare } from "@/src/utils/pdf";

type Head = {
  id: string;
  name: string;
  type: "credit" | "debit";
  is_cash?: boolean;
  allow_notes?: boolean;
  multiple_entries?: boolean;
  created_at: string;
};
type MultiItem = { id: string; label?: string; note?: string; amount: number };
type EntryValue = number | { amount: number; note?: string } | MultiItem[];
type AccData = {
  date: string;
  store_id: string;
  historical?: boolean;
  opening_balance: number | null;
  closing_balance: number | null;
  heads: Head[];
  entries: Record<string, EntryValue>;
  total_credit: number;
  total_debit: number;
  net: number;
  submitted: boolean;
  submitted_by?: string | null;
  submitted_at?: string | null;
};

const CURRENCY = "$";

// US denominations (cents for sub-dollar, dollars for ≥ $1)
const DENOMS = [
  { label: "5¢", value: 0.05 },
  { label: "10¢", value: 0.10 },
  { label: "25¢", value: 0.25 },
  { label: "$1", value: 1 },
  { label: "$2", value: 2 },
  { label: "$5", value: 5 },
  { label: "$10", value: 10 },
  { label: "$50", value: 50 },
  { label: "$100", value: 100 },
];

export default function AccountingScreen() {
  const { apiStore, session, storeName } = useSession();
  const isAdmin = session?.user.role === "admin";
  const isEmployee = !isAdmin;
  const [data, setData] = useState<AccData | null>(null);
  const [loading, setLoading] = useState(true);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [multiItems, setMultiItems] = useState<Record<string, MultiItem[]>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"credit" | "debit">("credit");
  const [newAllowNotes, setNewAllowNotes] = useState(false);
  const [newMultiple, setNewMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  // Cash counter modal
  const [cashOpen, setCashOpen] = useState(false);
  const [cashHeadId, setCashHeadId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const d = await apiStore<AccData>("/api/accounting/today");
      setData(d);
      // For admin: prefill from saved entries. For employee: blank inputs.
      if (isAdmin) {
        const amountMap: Record<string, string> = {};
        const noteMap: Record<string, string> = {};
        const multiMap: Record<string, MultiItem[]> = {};
        d.heads.forEach((h) => {
          const val = d.entries?.[h.id];
          if (h.multiple_entries) {
            if (Array.isArray(val)) {
              multiMap[h.id] = val.map((it: any) => ({
                id: String(it.id),
                label: it.label || "",
                note: it.note || "",
                amount: Number(it.amount) || 0,
              }));
            } else {
              multiMap[h.id] = [];
            }
          } else if (h.allow_notes) {
            if (val && typeof val === "object" && !Array.isArray(val)) {
              amountMap[h.id] = String((val as any).amount ?? 0);
              noteMap[h.id] = String((val as any).note ?? "");
            } else if (typeof val === "number") {
              amountMap[h.id] = String(val);
            } else {
              amountMap[h.id] = "0";
            }
          } else {
            amountMap[h.id] = String(typeof val === "number" ? val : (val && typeof val === "object" && !Array.isArray(val) ? (val as any).amount ?? 0 : 0));
          }
        });
        setAmounts(amountMap);
        setNotes(noteMap);
        setMultiItems(multiMap);
      } else {
        setAmounts({});
        setNotes({});
        setMultiItems({});
      }
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore, isAdmin]);

  useEffect(() => { load(); }, [load]);

  const saveAmount = async (headId: string, value: string) => {
    const num = parseFloat(value) || 0;
    setAmounts(prev => ({ ...prev, [headId]: value }));
    try {
      await apiStore("/api/accounting/entry", {
        method: "POST", body: JSON.stringify({ head_id: headId, amount: num }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const saveSingleWithNote = async (headId: string) => {
    const amt = parseFloat(amounts[headId] || "0") || 0;
    const note = notes[headId] || "";
    try {
      await apiStore("/api/accounting/entry/set", {
        method: "POST",
        body: JSON.stringify({ head_id: headId, value: { amount: amt, note } }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const saveMulti = async (headId: string, items: MultiItem[]) => {
    try {
      await apiStore("/api/accounting/entry/set", {
        method: "POST",
        body: JSON.stringify({
          head_id: headId,
          value: items.map((it) => ({
            id: it.id,
            label: it.label || "",
            note: it.note || "",
            amount: Number(it.amount) || 0,
          })),
        }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const addMultiItem = (headId: string) => {
    setMultiItems((prev) => {
      const cur = prev[headId] || [];
      const next = [...cur, { id: `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, label: "", note: "", amount: 0 }];
      return { ...prev, [headId]: next };
    });
  };

  const updateMultiItem = (headId: string, idx: number, patch: Partial<MultiItem>) => {
    setMultiItems((prev) => {
      const cur = [...(prev[headId] || [])];
      cur[idx] = { ...cur[idx], ...patch } as MultiItem;
      return { ...prev, [headId]: cur };
    });
  };

  const removeMultiItem = (headId: string, idx: number) => {
    const cur = multiItems[headId] || [];
    const next = cur.filter((_, i) => i !== idx);
    setMultiItems((prev) => ({ ...prev, [headId]: next }));
    // Persist immediately on removal
    saveMulti(headId, next);
  };

  const addHead = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await apiStore("/api/accounting/heads", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(),
          type: newType,
          allow_notes: newAllowNotes,
          multiple_entries: newMultiple,
        }),
      });
      setNewName("");
      setNewAllowNotes(false);
      setNewMultiple(false);
      setModalOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const removeHead = (h: Head) => {
    if (h.is_cash) {
      Alert.alert("Cannot remove", "The Cash head is built-in and cannot be removed.");
      return;
    }
    Alert.alert("Remove head", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
          try {
            await apiStore(`/api/accounting/heads/${h.id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
      }},
    ]);
  };

  const submit = async () => {
    try {
      await apiStore("/api/accounting/submit", { method: "POST" });
      Alert.alert("Submitted", "Today's accounting submitted.");
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const openCashCounter = (headId: string) => {
    setCashHeadId(headId);
    setCounts({});
    setCashOpen(true);
  };

  const cashTotal = DENOMS.reduce((sum, d) => {
    const c = parseInt(counts[d.label] || "0", 10) || 0;
    return sum + c * d.value;
  }, 0);

  const saveCash = async () => {
    if (!cashHeadId) return;
    await saveAmount(cashHeadId, cashTotal.toFixed(2));
    setCashOpen(false);
  };

  const downloadPdf = async () => {
    if (!data) return;
    const html = buildAccountingHtml({
      storeName: storeName || "Store",
      date: data.date,
      heads: data.heads,
      entries: data.entries || {},
      openingBalance: data.opening_balance,
      closingBalance: data.closing_balance,
      totalCredit: data.total_credit,
      totalDebit: data.total_debit,
      net: data.net,
      submitted: data.submitted,
      submittedBy: data.submitted_by,
      submittedAt: data.submitted_at,
      showBalances: !isEmployee,
    });
    await generateAndShare(html, `Accounting - ${data.date}.pdf`);
  };

  if (loading || !data) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  const credits = data.heads.filter(h => h.type === "credit");
  const debits = data.heads.filter(h => h.type === "debit");

  const headTotal = (h: Head): number => {
    const val = data!.entries?.[h.id];
    if (h.multiple_entries) {
      if (Array.isArray(val)) return val.reduce((s: number, it: any) => s + (Number(it?.amount) || 0), 0);
      // For employee (no entries), use local state
      const local = multiItems[h.id] || [];
      return local.reduce((s, it) => s + (Number(it.amount) || 0), 0);
    }
    if (val && typeof val === "object" && !Array.isArray(val)) return Number((val as any).amount) || 0;
    if (typeof val === "number") return val;
    return 0;
  };

  const renderHead = (h: Head) => {
    const isCashHead = !!h.is_cash;
    const isMulti = !!h.multiple_entries && !isCashHead;
    const hasNotes = !!h.allow_notes && !isCashHead;
    const items = multiItems[h.id] || [];
    const subtotal = headTotal(h);

    return (
      <View key={h.id} style={styles.headBlock}>
        <View style={styles.headRow}>
          <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6 }}>
            {isCashHead && <Ionicons name="cash" size={16} color={colors.credit} />}
            <Text style={styles.headName}>{h.name}</Text>
            {isMulti && (
              <View style={styles.miniBadge}>
                <Text style={styles.miniBadgeText}>Multi</Text>
              </View>
            )}
            {hasNotes && !isMulti && (
              <View style={[styles.miniBadge, { backgroundColor: "#EEF2FF" }]}>
                <Text style={[styles.miniBadgeText, { color: colors.primary }]}>Notes</Text>
              </View>
            )}
          </View>

          {/* Right-side compact display */}
          {isCashHead ? (
            <TouchableOpacity
              testID={`cash-btn-${h.id}`}
              style={styles.cashBtn}
              onPress={() => openCashCounter(h.id)}
              disabled={data!.submitted}
            >
              <Ionicons name="calculator" size={16} color="#fff" />
              <Text style={styles.cashBtnText}>
                {isAdmin && subtotal ? `${CURRENCY}${subtotal.toFixed(2)}` : "Count Cash"}
              </Text>
            </TouchableOpacity>
          ) : isMulti ? (
            <Text style={styles.multiTotal}>
              {CURRENCY}{subtotal.toFixed(2)}
            </Text>
          ) : (
            <View style={styles.amountWrap}>
              <Text style={styles.currency}>{CURRENCY}</Text>
              <TextInput
                testID={`amount-${h.id}`}
                style={styles.amountInput}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={colors.textLight}
                value={amounts[h.id] ?? ""}
                onChangeText={(v) => setAmounts((prev) => ({ ...prev, [h.id]: v }))}
                onBlur={() => (hasNotes ? saveSingleWithNote(h.id) : saveAmount(h.id, amounts[h.id] ?? "0"))}
                editable={!data!.submitted}
              />
            </View>
          )}

          {isAdmin && !data!.submitted && !isCashHead && (
            <TouchableOpacity testID={`remove-head-${h.id}`} onPress={() => removeHead(h)} hitSlop={10}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </TouchableOpacity>
          )}
        </View>

        {/* Notes input for single+note heads */}
        {hasNotes && !isMulti && (
          <TextInput
            testID={`note-${h.id}`}
            style={styles.noteInput}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.textLight}
            value={notes[h.id] ?? ""}
            onChangeText={(v) => setNotes((p) => ({ ...p, [h.id]: v }))}
            onBlur={() => saveSingleWithNote(h.id)}
            editable={!data!.submitted}
            multiline
          />
        )}

        {/* Multi-entry rows */}
        {isMulti && (
          <View style={styles.multiBox}>
            {items.length === 0 ? (
              <Text style={styles.multiEmpty}>No entries yet</Text>
            ) : (
              items.map((it, idx) => (
                <View key={it.id} style={styles.multiRow}>
                  <View style={styles.multiCol}>
                    <TextInput
                      testID={`multi-label-${h.id}-${idx}`}
                      style={styles.multiLabel}
                      placeholder="Label (optional)"
                      placeholderTextColor={colors.textLight}
                      value={it.label || ""}
                      onChangeText={(v) => updateMultiItem(h.id, idx, { label: v })}
                      onBlur={() => saveMulti(h.id, multiItems[h.id] || [])}
                      editable={!data!.submitted}
                    />
                    <TextInput
                      testID={`multi-note-${h.id}-${idx}`}
                      style={styles.multiNote}
                      placeholder="Note (optional)"
                      placeholderTextColor={colors.textLight}
                      value={it.note || ""}
                      onChangeText={(v) => updateMultiItem(h.id, idx, { note: v })}
                      onBlur={() => saveMulti(h.id, multiItems[h.id] || [])}
                      editable={!data!.submitted}
                      multiline
                    />
                  </View>
                  <View style={styles.multiAmountWrap}>
                    <Text style={styles.currency}>{CURRENCY}</Text>
                    <TextInput
                      testID={`multi-amount-${h.id}-${idx}`}
                      style={styles.multiAmountInput}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                      value={it.amount ? String(it.amount) : ""}
                      onChangeText={(v) =>
                        updateMultiItem(h.id, idx, { amount: parseFloat(v.replace(/[^0-9.]/g, "")) || 0 })
                      }
                      onBlur={() => saveMulti(h.id, multiItems[h.id] || [])}
                      editable={!data!.submitted}
                    />
                  </View>
                  {!data!.submitted && (
                    <TouchableOpacity
                      testID={`multi-remove-${h.id}-${idx}`}
                      onPress={() => removeMultiItem(h.id, idx)}
                      hitSlop={10}
                      style={{ paddingHorizontal: 4 }}
                    >
                      <Ionicons name="close-circle" size={22} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </View>
              ))
            )}
            {!data!.submitted && (
              <TouchableOpacity
                testID={`multi-add-${h.id}`}
                style={styles.multiAddBtn}
                onPress={() => addMultiItem(h.id)}
              >
                <Ionicons name="add-circle" size={18} color={colors.primary} />
                <Text style={styles.multiAddText}>Add entry</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Accounting</Text>
        <View style={{ flexDirection: "row" }}>
          {isAdmin && (
            <TouchableOpacity testID="add-head-btn" onPress={() => setModalOpen(true)} style={styles.headerAction}>
              <Ionicons name="add" size={20} color="#fff" />
              <Text style={styles.btnLabel}>Add Head</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />} keyboardShouldPersistTaps="handled">
          <View style={styles.summaryCard}>
            {!isEmployee && data.opening_balance !== null && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Opening Balance</Text>
                <Text style={styles.summaryVal}>{CURRENCY}{data.opening_balance.toFixed(2)}</Text>
              </View>
            )}
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.credit }]}>+ Total Credit</Text>
              <Text style={[styles.summaryVal, { color: colors.credit }]}>{CURRENCY}{data.total_credit.toFixed(2)}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.debit }]}>− Total Debit</Text>
              <Text style={[styles.summaryVal, { color: colors.debit }]}>{CURRENCY}{data.total_debit.toFixed(2)}</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryRow}>
              <Text style={styles.closingLabel}>{isEmployee ? "Net (Credit − Debit)" : "Net"}</Text>
              <Text testID="net-amount" style={[styles.closingVal, { color: data.net >= 0 ? colors.success : colors.danger }]}>
                {CURRENCY}{data.net.toFixed(2)}
              </Text>
            </View>
            {!isEmployee && data.closing_balance !== null && (
              <View style={[styles.summaryRow, { marginTop: spacing.sm }]}>
                <Text style={styles.closingLabel}>Closing Balance</Text>
                <Text testID="closing-balance" style={styles.closingVal}>{CURRENCY}{data.closing_balance.toFixed(2)}</Text>
              </View>
            )}
          </View>

          <Text style={[styles.sectionTitle, { color: colors.credit }]}>Credits</Text>
          {credits.length === 0 ? <Text style={styles.empty}>No credit heads</Text> : credits.map(renderHead)}

          <Text style={[styles.sectionTitle, { color: colors.debit }]}>Debits</Text>
          {debits.length === 0 ? <Text style={styles.empty}>No debit heads</Text> : debits.map(renderHead)}

          {!data.submitted && data.heads.length > 0 && (
            <TouchableOpacity testID="submit-accounting-btn" style={styles.submitBtn} onPress={submit}>
              <Ionicons name="checkmark-done" size={20} color="#fff" />
              <Text style={styles.submitText}>Submit Today's Accounting</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity testID="pdf-btn" style={styles.pdfBtn} onPress={downloadPdf}>
            <Ionicons name="download-outline" size={20} color={colors.primary} />
            <Text style={styles.pdfText}>Download PDF Report</Text>
          </TouchableOpacity>
          {data.submitted && (
            <View style={styles.submittedBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.submittedText}>Today's accounting submitted</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add Head Modal */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>New Account Head</Text>
            <TextInput testID="new-head-name" style={styles.modalInput} placeholder="Head name (e.g. Card Sales)" placeholderTextColor={colors.textLight} value={newName} onChangeText={setNewName} autoFocus />
            <View style={styles.typeRow}>
              <TouchableOpacity testID="type-credit" style={[styles.typeBtn, newType === "credit" && { backgroundColor: colors.credit, borderColor: colors.credit }]} onPress={() => setNewType("credit")}>
                <Text style={[styles.typeText, newType === "credit" && { color: "#fff" }]}>Credit</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="type-debit" style={[styles.typeBtn, newType === "debit" && { backgroundColor: colors.debit, borderColor: colors.debit }]} onPress={() => setNewType("debit")}>
                <Text style={[styles.typeText, newType === "debit" && { color: "#fff" }]}>Debit</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.optionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Notes box</Text>
                <Text style={styles.optionSub}>Allow employees to add a note for this entry</Text>
              </View>
              <Switch
                testID="opt-allow-notes"
                value={newAllowNotes}
                onValueChange={(v) => {
                  setNewAllowNotes(v);
                  // Single+notes and multi-entry shouldn't both be on
                  if (v && newMultiple) setNewMultiple(false);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
            </View>
            <View style={styles.optionRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.optionTitle}>Multiple entries</Text>
                <Text style={styles.optionSub}>This head can have several line items per day (label, amount, note)</Text>
              </View>
              <Switch
                testID="opt-multi"
                value={newMultiple}
                onValueChange={(v) => {
                  setNewMultiple(v);
                  if (v && newAllowNotes) setNewAllowNotes(false);
                }}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor="#fff"
              />
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
        </KeyboardAvoidingView>
      </Modal>

      {/* Cash Counter Modal */}
      <Modal visible={cashOpen} transparent animationType="slide" onRequestClose={() => setCashOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={[styles.modalBox, { maxHeight: "85%" }]}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
              <Text style={styles.modalTitle}>Count Cash</Text>
              <TouchableOpacity onPress={() => setCashOpen(false)}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={{ color: colors.textMuted, marginBottom: spacing.md }}>
              Enter the number of each denomination you have.
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {DENOMS.map((d) => {
                const c = parseInt(counts[d.label] || "0", 10) || 0;
                const sub = c * d.value;
                return (
                  <View key={d.label} style={styles.denomRow}>
                    <Text style={styles.denomLabel}>{d.label}</Text>
                    <Text style={styles.times}>×</Text>
                    <TextInput
                      testID={`denom-${d.label}`}
                      style={styles.denomInput}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textLight}
                      value={counts[d.label] ?? ""}
                      onChangeText={(v) => setCounts((p) => ({ ...p, [d.label]: v.replace(/[^0-9]/g, "") }))}
                    />
                    <Text style={styles.denomSub}>= {CURRENCY}{sub.toFixed(2)}</Text>
                  </View>
                );
              })}
            </ScrollView>
            <View style={styles.cashTotalBox}>
              <Text style={styles.cashTotalLabel}>Total</Text>
              <Text testID="cash-total" style={styles.cashTotalVal}>{CURRENCY}{cashTotal.toFixed(2)}</Text>
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setCashOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-cash-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={saveCash}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  headerAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  pdfBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: colors.primary, padding: 14, borderRadius: radius.md, marginTop: spacing.md },
  pdfText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
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
  headName: { fontSize: 15, color: colors.text, fontWeight: "500" },
  amountWrap: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 8 },
  currency: { color: colors.textMuted, fontSize: 15, fontWeight: "600", marginRight: 2 },
  amountInput: { minWidth: 80, paddingVertical: 8, fontSize: 15, color: colors.text, textAlign: "right", fontWeight: "600" },
  cashBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.credit, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  cashBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
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
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.md, alignItems: "center" },
  denomRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  denomLabel: { width: 50, fontSize: 16, fontWeight: "700", color: colors.text },
  times: { color: colors.textMuted, fontSize: 14 },
  denomInput: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 12, fontSize: 16, color: colors.text, textAlign: "center", fontWeight: "600" },
  denomSub: { width: 90, textAlign: "right", color: colors.textMuted, fontSize: 13, fontWeight: "500" },
  cashTotalBox: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, backgroundColor: "#DCFCE7", borderRadius: radius.md, marginTop: spacing.md },
  cashTotalLabel: { fontSize: 16, fontWeight: "700", color: colors.text },
  cashTotalVal: { fontSize: 22, fontWeight: "700", color: colors.credit },
  // New styles for notes & multi-entry heads
  headBlock: { marginBottom: spacing.sm },
  miniBadge: { paddingHorizontal: 6, paddingVertical: 2, backgroundColor: "#F1F5F9", borderRadius: 4 },
  miniBadgeText: { fontSize: 10, fontWeight: "700", color: colors.textMuted, letterSpacing: 0.4 },
  multiTotal: { fontSize: 15, fontWeight: "700", color: colors.text, minWidth: 70, textAlign: "right" },
  noteInput: {
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: colors.text,
    marginTop: -4,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    minHeight: 38,
  },
  multiBox: {
    backgroundColor: colors.card,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderTopWidth: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    marginTop: -4,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  multiEmpty: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", paddingVertical: 4 },
  multiRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  multiCol: { flex: 1, minWidth: 0 },
  multiLabel: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    fontWeight: "600",
    marginBottom: 4,
    width: "100%",
  },
  multiNote: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: colors.textMuted,
    minHeight: 32,
    width: "100%",
  },
  multiAmountWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    minWidth: 90,
    maxWidth: 110,
  },
  multiAmountInput: {
    minWidth: 50,
    width: 70,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.text,
    textAlign: "right",
    fontWeight: "600",
  },
  multiAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  multiAddText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  optionTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
  optionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
});
