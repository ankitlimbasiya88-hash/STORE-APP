import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput,
  ActivityIndicator, Alert, ScrollView, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { Taxonomy } from "@/src/utils/inventory";

type Kind = "category" | "purchase_type";
const KIND_LABEL: Record<Kind, { title: string; sub: string; api: string }> = {
  category: { title: "Categories / Departments", sub: "Used to classify products (e.g. Dairy, Snacks, Produce)", api: "categories" },
  purchase_type: { title: "Purchase Types", sub: "How items are sourced (e.g. In Person, Delivery, Pickup)", api: "purchase-types" },
};

export default function TaxonomyScreen() {
  const { apiStore, session } = useSession();
  const isAdmin = session?.user.role === "admin";
  const [kind, setKind] = useState<Kind>("category");
  const [items, setItems] = useState<Taxonomy[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Taxonomy | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await apiStore<Taxonomy[]>(`/api/inventory/${KIND_LABEL[kind].api}`);
      setItems(list);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore, kind]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setName(""); setModalOpen(true); };
  const openEdit = (t: Taxonomy) => { setEditing(t); setName(t.name); setModalOpen(true); };

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (editing) {
        await apiStore(`/api/inventory/${KIND_LABEL[kind].api}/${editing.id}`, { method: "PATCH", body: JSON.stringify({ name: name.trim() }) });
      } else {
        await apiStore(`/api/inventory/${KIND_LABEL[kind].api}`, { method: "POST", body: JSON.stringify({ name: name.trim() }) });
      }
      setModalOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const remove = (t: Taxonomy) => {
    Alert.alert("Remove", `Delete \"${t.name}\"?`, [
      { text: "Cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await apiStore(`/api/inventory/${KIND_LABEL[kind].api}/${t.id}`, { method: "DELETE" });
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
        <Text style={styles.headerTitle}>Lists</Text>
        {isAdmin ? (
          <TouchableOpacity onPress={openCreate} style={styles.iconBtn}>
            <AppIcon name="plus" size={18} color="#fff" />
            <Text style={styles.btnLabel}>Add</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      <View style={styles.kindRow}>
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.kindBtn, kind === k && styles.kindBtnActive]}
            onPress={() => setKind(k)}
          >
            <Text style={[styles.kindText, kind === k && { color: "#fff" }]}>{KIND_LABEL[k].title}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.subText}>{KIND_LABEL[kind].sub}</Text>

      {loading ? (
        <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ padding: spacing.md }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          ListEmptyComponent={() => (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyDesc}>{isAdmin ? "Tap “Add” to create one." : "Ask your admin to set them up."}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Text style={styles.rowTitle}>{item.name}</Text>
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
            <Text style={styles.modalTitle}>{editing ? "Edit" : `New ${kind === "category" ? "Category" : "Purchase Type"}`}</Text>
            <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textLight} value={name} onChangeText={setName} autoFocus />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={save} disabled={busy}>
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
  kindRow: { flexDirection: "row", gap: 8, padding: spacing.md },
  kindBtn: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: "center" },
  kindBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  kindText: { color: colors.text, fontWeight: "600", fontSize: 12, textAlign: "center" },
  subText: { fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.md, marginTop: -4 },
  row: { flexDirection: "row", alignItems: "center", padding: spacing.md, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, justifyContent: "space-between" },
  rowTitle: { fontSize: 15, fontWeight: "600", color: colors.text, flex: 1 },
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
