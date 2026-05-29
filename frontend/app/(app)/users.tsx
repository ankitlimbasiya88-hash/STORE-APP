import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "@/src/components/AppIcon";
import { router } from "expo-router";

import { useSession, User } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function UsersScreen() {
  const { api, session, stores, refreshStores } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState<User | null>(null);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "employee">("employee");
  const [newAllowed, setNewAllowed] = useState<Set<string>>(new Set());
  const [assignAllowed, setAssignAllowed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await api<User[]>("/api/users");
      setUsers(list);
      await refreshStores();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [api, refreshStores]);

  useEffect(() => { load(); }, [load]);

  const toggleSet = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const add = async () => {
    if (!newName.trim() || newPin.length !== 4) {
      Alert.alert("Invalid", "Name + 4-digit PIN required");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: newName.trim(), pin: newPin, role: newRole,
          allowed_stores: Array.from(newAllowed),
        }),
      });
      setNewName(""); setNewPin(""); setNewRole("employee"); setNewAllowed(new Set());
      setAddOpen(false);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const openAssign = (u: User) => {
    setAssignAllowed(new Set(u.allowed_stores || []));
    setAssignOpen(u);
  };

  const saveAssign = async () => {
    if (!assignOpen) return;
    setBusy(true);
    try {
      await api(`/api/users/${assignOpen.id}/stores`, {
        method: "PUT",
        body: JSON.stringify({ allowed_stores: Array.from(assignAllowed) }),
      });
      setAssignOpen(null);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const remove = (u: User) => {
    if (u.id === session?.user.id) return;
    Alert.alert("Remove user", `Remove ${u.name}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
          try {
            await api(`/api/users/${u.id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
      }},
    ]);
  };

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  const storeNamesFor = (u: User): string => {
    if (u.role === "admin") return "All stores";
    if (!u.allowed_stores || u.allowed_stores.length === 0) return "No stores assigned";
    const names = u.allowed_stores
      .map((id) => stores.find((s) => s.id === id)?.name)
      .filter(Boolean);
    return names.join(", ") || "—";
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={26} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Users</Text>
        <TouchableOpacity testID="add-user-btn" onPress={() => setAddOpen(true)} style={styles.headerAction}>
          <Ionicons name="person-add" size={18} color="#fff" />
          <Text style={styles.btnLabel}>Add</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {users.map((u) => (
          <View key={u.id} style={styles.row} testID={`user-${u.name}`}>
            <View style={[styles.avatar, u.role === "admin" && { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>{u.name[0]?.toUpperCase() || "?"}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{u.name}</Text>
              <Text style={[styles.role, u.role === "admin" && { color: colors.primary }]}>{u.role}</Text>
              <Text style={styles.stores} numberOfLines={2}>{storeNamesFor(u)}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              {u.role === "employee" && (
                <TouchableOpacity testID={`assign-${u.name}`} onPress={() => openAssign(u)} hitSlop={10}>
                  <Ionicons name="business-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
              )}
              {u.id !== session?.user.id && (
                <TouchableOpacity testID={`remove-user-${u.name}`} onPress={() => remove(u)} hitSlop={10}>
                  <AppIcon name="trash" size={20} color={colors.danger} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Add user modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={[styles.modalBox, { maxHeight: "90%" }]}>
            <Text style={styles.modalTitle}>Add User</Text>
            <ScrollView>
              <TextInput testID="new-user-name" style={styles.input} placeholder="Name" placeholderTextColor={colors.textLight} value={newName} onChangeText={setNewName} />
              <TextInput testID="new-user-pin" style={[styles.input, { letterSpacing: 8, textAlign: "center" }]} placeholder="4-digit PIN" placeholderTextColor={colors.textLight} keyboardType="number-pad" secureTextEntry maxLength={4} value={newPin} onChangeText={(t) => setNewPin(t.replace(/[^0-9]/g, ""))} />
              <View style={styles.typeRow}>
                <TouchableOpacity testID="role-employee" style={[styles.typeBtn, newRole === "employee" && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => setNewRole("employee")}>
                  <Text style={[styles.typeText, newRole === "employee" && { color: "#fff" }]}>Employee</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="role-admin" style={[styles.typeBtn, newRole === "admin" && { backgroundColor: colors.primary, borderColor: colors.primary }]} onPress={() => setNewRole("admin")}>
                  <Text style={[styles.typeText, newRole === "admin" && { color: "#fff" }]}>Admin</Text>
                </TouchableOpacity>
              </View>
              {newRole === "employee" && (
                <>
                  <Text style={styles.assignLabel}>Assign stores</Text>
                  {stores.length === 0 ? (
                    <Text style={{ color: colors.textMuted, fontStyle: "italic" }}>No stores yet</Text>
                  ) : stores.map((s) => {
                    const on = newAllowed.has(s.id);
                    return (
                      <TouchableOpacity key={s.id} testID={`pick-store-${s.id}`} style={[styles.storeRow, on && styles.storeRowOn]} onPress={() => setNewAllowed(toggleSet(newAllowed, s.id))}>
                        <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.textMuted} />
                        <Text style={styles.storeRowText}>{s.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setAddOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-user-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={add} disabled={busy}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving..." : "Add"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Assign stores modal */}
      <Modal visible={!!assignOpen} transparent animationType="slide" onRequestClose={() => setAssignOpen(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={[styles.modalBox, { maxHeight: "75%" }]}>
            <Text style={styles.modalTitle}>Assign Stores to {assignOpen?.name}</Text>
            <ScrollView>
              {stores.length === 0 ? <Text style={{ color: colors.textMuted }}>No stores yet</Text> : stores.map((s) => {
                const on = assignAllowed.has(s.id);
                return (
                  <TouchableOpacity key={s.id} testID={`assign-store-${s.id}`} style={[styles.storeRow, on && styles.storeRowOn]} onPress={() => setAssignAllowed(toggleSet(assignAllowed, s.id))}>
                    <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.textMuted} />
                    <Text style={styles.storeRowText}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setAssignOpen(null)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-assign-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={saveAssign} disabled={busy}>
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
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  headerAction: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.textLight, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  role: { fontSize: 12, color: colors.textMuted, textTransform: "capitalize", marginTop: 2 },
  stores: { fontSize: 11, color: colors.textMuted, marginTop: 4, fontStyle: "italic" },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  typeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md, marginTop: spacing.sm },
  typeBtn: { flex: 1, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: "center" },
  typeText: { fontWeight: "600", color: colors.text },
  assignLabel: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.sm, letterSpacing: 0.5, textTransform: "uppercase" },
  storeRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.md, marginBottom: 6, backgroundColor: colors.surface, borderWidth: 1, borderColor: "transparent" },
  storeRowOn: { backgroundColor: "#EFF6FF", borderColor: colors.primaryLight + "55" },
  storeRowText: { fontSize: 15, color: colors.text, fontWeight: "500" },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.md, alignItems: "center" },
});
