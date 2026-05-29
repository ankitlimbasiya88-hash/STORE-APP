import React, { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function StoresManageScreen() {
  const { api, stores, refreshStores } = useSession();
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => { await refreshStores(); setLoading(false); })();
  }, []);

  const addStore = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api("/api/stores", { method: "POST", body: JSON.stringify({ name: newName.trim() }) });
      setNewName("");
      setModalOpen(false);
      await refreshStores();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const remove = (id: string, name: string) => {
    Alert.alert(
      "Delete store?",
      `Removing "${name}" will delete all its checklists, accounting records, and chat messages. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => {
            try {
              await api(`/api/stores/${id}`, { method: "DELETE" });
              await refreshStores();
            } catch (e: any) { Alert.alert("Error", e.message); }
        }},
      ],
    );
  };

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Stores</Text>
        <TouchableOpacity testID="add-store-btn" onPress={() => setModalOpen(true)} style={styles.headerAction}>
          <Ionicons name="add" size={20} color="#fff" />
          <Text style={styles.btnLabel}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {stores.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={56} color={colors.textLight} />
            <Text style={styles.emptyText}>No stores yet. Tap + to add one.</Text>
          </View>
        ) : (
          stores.map((s) => (
            <View key={s.id} style={styles.row}>
              <View style={styles.storeIcon}>
                <Ionicons name="storefront" size={22} color={colors.primary} />
              </View>
              <Text style={styles.name}>{s.name}</Text>
              <TouchableOpacity testID={`remove-store-${s.id}`} onPress={() => remove(s.id, s.name)} hitSlop={10}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>New Store</Text>
            <TextInput
              testID="new-store-name"
              style={styles.input}
              placeholder="Store name (e.g. Downtown Branch)"
              placeholderTextColor={colors.textLight}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-store-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={addStore} disabled={busy}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving..." : "Add"}</Text>
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
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  headerAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.sm },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, textAlign: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  storeIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  name: { flex: 1, fontSize: 16, fontWeight: "600", color: colors.text },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, marginBottom: spacing.lg },
  modalActions: { flexDirection: "row", gap: spacing.sm },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.md, alignItems: "center" },
});
