import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, ActivityIndicator,
  Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { Supplier } from "@/src/utils/inventory";

export default function SuppliersScreen() {
  const { apiStore, session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiStore<Supplier[]>("/api/inventory/suppliers");
      setItems(list);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setName(""); setContact(""); setNotes(""); setModalOpen(true); };
  const openEdit = (s: Supplier) => { setEditing(s); setName(s.name); setContact(s.contact || ""); setNotes(s.notes || ""); setModalOpen(true); };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name required"); return; }
    setBusy(true);
    try {
      if (editing) {
        await apiStore(`/api/inventory/suppliers/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim(), contact, notes }),
        });
      } else {
        await apiStore("/api/inventory/suppliers", {
          method: "POST",
          body: JSON.stringify({ name: name.trim(), contact, notes }),
        });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const remove = (s: Supplier) => {
    Alert.alert("Remove supplier", `Delete \"${s.name}\"? Products will lose this preferred supplier.`, [
      { text: "Cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await apiStore(`/api/inventory/suppliers/${s.id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <AppIcon name="back" size={20} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Suppliers</Text>
        {isAdmin ? (
          <TouchableOpacity testID="add-supplier-btn" onPress={openCreate} style={styles.iconBtn}>
            <AppIcon name="plus" size={18} color="#fff" />
            <Text style={styles.btnLabel}>Add</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      {loading ? (
        <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: spacing.md }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No suppliers yet</Text>
              <Text style={styles.emptyDesc}>{isAdmin ? "Tap “Add” to create your first supplier." : "Ask your admin to add suppliers."}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                {!!item.contact && <Text style={styles.rowMeta}>{item.contact}</Text>}
                {!!item.notes && <Text style={styles.rowNote}>{item.notes}</Text>}
              </View>
              {isAdmin && (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity onPress={() => openEdit(item)} style={styles.actionBtn}>
                    <Text style={{ color: colors.primary, fontWeight: "700" }}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => remove(item)} style={[styles.actionBtn, { backgroundColor: "#FEE2E2" }]}>
                    <AppIcon name="trash" size={14} color={colors.danger} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        />
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{editing ? "Edit Supplier" : "New Supplier"}</Text>
            <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textLight} value={name} onChangeText={setName} autoFocus />
            <TextInput style={styles.input} placeholder="Contact (phone / email)" placeholderTextColor={colors.textLight} value={contact} onChangeText={setContact} />
            <TextInput style={[styles.input, { minHeight: 70 }]} placeholder="Notes (optional)" placeholderTextColor={colors.textLight} value={notes} onChangeText={setNotes} multiline />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-supplier" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={save} disabled={busy}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving..." : "Save"}</Text>
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
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.text },
  rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  rowNote: { fontSize: 12, color: colors.textMuted, fontStyle: "italic", marginTop: 4 },
  actionBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, backgroundColor: colors.surface },
  empty: { padding: 40, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyDesc: { fontSize: 13, color: colors.textMuted, marginTop: 6, textAlign: "center" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.sm },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 8 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border },
  modalBtn: { flex: 1, padding: 12, borderRadius: radius.md, alignItems: "center" },
});
