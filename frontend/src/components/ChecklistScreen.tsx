import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { buildChecklistHtml, generateAndShare } from "@/src/utils/pdf";

type Task = { id: string; title: string; type: string; created_at: string };
type Today = {
  date: string;
  historical?: boolean;
  tasks: Task[];
  completed_ids: string[];
  submitted: boolean;
  submitted_by?: string | null;
  submitted_at?: string | null;
};

export default function ChecklistScreen({ type, title, accentColor }: {
  type: "opening" | "closing"; title: string; accentColor: string;
}) {
  const { apiStore, session, storeName } = useSession();
  const isAdmin = session?.user.role === "admin";
  const [data, setData] = useState<Today | null>(null);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const today = await apiStore<Today>(`/api/checklists/${type}/today`);
      setData(today);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
    }
  }, [apiStore, type]);

  useEffect(() => { load(); }, [load]);

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setBusy(true);
    try {
      await apiStore(`/api/checklists/${type}/tasks`, {
        method: "POST", body: JSON.stringify({ title: newTitle.trim() }),
      });
      setNewTitle("");
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const removeTask = async (id: string) => {
    Alert.alert("Remove task", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
          try {
            await apiStore(`/api/checklists/${type}/tasks/${id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
      }},
    ]);
  };

  const toggle = async (taskId: string, completed: boolean) => {
    if (data?.submitted) return;
    try {
      await apiStore(`/api/checklists/${type}/toggle`, {
        method: "POST", body: JSON.stringify({ task_id: taskId, completed }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      await apiStore(`/api/checklists/${type}/submit`, { method: "POST" });
      Alert.alert("Submitted", "Checklist submitted for today.");
      await load();
    } catch (e: any) { Alert.alert("Cannot submit", e.message); }
    finally { setBusy(false); }
  };

  const downloadPdf = async () => {
    if (!data) return;
    const html = buildChecklistHtml({
      title,
      storeName: storeName || "Store",
      date: data.date,
      tasks: data.tasks.map((t) => ({ id: t.id, title: t.title })),
      completedIds: data.completed_ids,
      submitted: data.submitted,
      submittedBy: data.submitted_by,
      submittedAt: data.submitted_at,
    });
    await generateAndShare(html, `${title} - ${data.date}.pdf`);
  };

  if (loading || !data) {
    return <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  const completedSet = new Set(data.completed_ids);
  const total = data.tasks.length;
  const done = data.tasks.filter(t => completedSet.has(t.id)).length;
  const pending = total - done;
  const canSubmit = total > 0 && pending === 0 && !data.submitted;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={[styles.header, { backgroundColor: accentColor }]}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{done}/{total}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: pending > 0 ? colors.warning : colors.success }]}>{pending}</Text>
              <Text style={styles.statLabel}>Pending</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: data.submitted ? colors.success : colors.textMuted }]}>
                {data.submitted ? "✓" : "—"}
              </Text>
              <Text style={styles.statLabel}>Submitted</Text>
            </View>
          </View>

          {data.submitted && (
            <View style={styles.submittedBanner}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.submittedText}>
                Submitted by {data.submitted_by} • {data.submitted_at ? new Date(data.submitted_at).toLocaleTimeString() : ""}
              </Text>
            </View>
          )}

          {isAdmin && !data.submitted && (
            <View style={styles.addBox}>
              <TextInput
                testID="task-input"
                style={styles.addInput}
                placeholder="New task title..."
                placeholderTextColor={colors.textLight}
                value={newTitle}
                onChangeText={setNewTitle}
              />
              <TouchableOpacity testID="add-task-btn" style={styles.addBtn} onPress={addTask} disabled={busy}>
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          )}

          {data.tasks.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="document-outline" size={48} color={colors.textLight} />
              <Text style={styles.emptyText}>
                {isAdmin ? "Add tasks above to begin." : "No tasks configured yet. Ask admin to add them."}
              </Text>
            </View>
          ) : (
            data.tasks.map((t) => {
              const isDone = completedSet.has(t.id);
              return (
                <TouchableOpacity key={t.id} testID={`task-${t.id}`} style={[styles.taskRow, isDone && styles.taskRowDone]} onPress={() => toggle(t.id, !isDone)} disabled={data.submitted} activeOpacity={0.7}>
                  <View style={[styles.checkbox, isDone && { backgroundColor: colors.success, borderColor: colors.success }]}>
                    {isDone && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </View>
                  <Text style={[styles.taskTitle, isDone && styles.taskTitleDone]}>{t.title}</Text>
                  {isAdmin && !data.submitted && (
                    <TouchableOpacity testID={`remove-task-${t.id}`} onPress={() => removeTask(t.id)} hitSlop={10}>
                      <Ionicons name="trash-outline" size={20} color={colors.danger} />
                    </TouchableOpacity>
                  )}
                </TouchableOpacity>
              );
            })
          )}

          <TouchableOpacity testID="pdf-btn" style={styles.pdfBtn} onPress={downloadPdf}>
            <Ionicons name="download-outline" size={20} color={colors.primary} />
            <Text style={styles.pdfText}>Download PDF Report</Text>
          </TouchableOpacity>
        </ScrollView>

        {!data.submitted && total > 0 && (
          <View style={styles.footer}>
            <TouchableOpacity testID="submit-checklist-btn" style={[styles.submitBtn, !canSubmit && styles.submitBtnDisabled]} onPress={submit} disabled={!canSubmit || busy}>
              <Ionicons name="checkmark-done" size={20} color="#fff" />
              <Text style={styles.submitText}>
                {canSubmit ? "Submit Checklist" : `${pending} task(s) pending`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  pdfBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: "#EFF6FF", borderWidth: 1.5, borderColor: colors.primary, padding: 14, borderRadius: radius.md, marginTop: spacing.md, marginBottom: spacing.md },
  pdfText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, paddingBottom: 100 },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 22, fontWeight: "700", color: colors.text },
  statLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2, letterSpacing: 0.5, textTransform: "uppercase" },
  submittedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#DCFCE7", padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  submittedText: { color: colors.success, fontSize: 13, fontWeight: "600", flex: 1 },
  addBox: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  addInput: { flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, color: colors.text, fontSize: 15 },
  addBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  taskRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  taskRowDone: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0" },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  taskTitle: { flex: 1, fontSize: 15, color: colors.text },
  taskTitleDone: { textDecorationLine: "line-through", color: colors.textMuted },
  footer: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing.md, backgroundColor: colors.bg, borderTopWidth: 1, borderTopColor: colors.border },
  submitBtn: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8, backgroundColor: colors.primary, padding: 16, borderRadius: radius.md },
  submitBtnDisabled: { backgroundColor: colors.textLight },
  submitText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
