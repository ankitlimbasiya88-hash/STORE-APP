import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  ActivityIndicator, Alert, Modal, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

type User = { id: string; name: string; role: "admin" | "employee" };

export default function UsersScreen() {
  const { api, session } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "employee">("employee");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setUsers(await api<User[]>("/api/users"));
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!newName.trim() || newPin.length !== 4) {
      Alert.alert("Invalid", "Name + 4-digit PIN required");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/register", {
        method: "POST", body: JSON.stringify({ name: newName.trim(), pin: newPin, role: newRole }),
      });
      setNewName(""); setNewPin(""); setNewRole("employee");
      setModalOpen(false);
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manage Users</Text>
        <TouchableOpacity testID="add-user-btn" onPress={() => setModalOpen(true)} style={styles.backBtn}>
          <Ionicons name="person-add" size={22} color="#fff" />
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
            </View>
            {u.id !== session?.user.id && (
              <TouchableOpacity testID={`remove-user-${u.name}`} onPress={() => remove(u)} hitSlop={10}>
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </ScrollView>

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Add User</Text>
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
            <View style={styles.modalActions}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="save-user-btn" style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={add} disabled={busy}>
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
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.textLight, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontWeight: "700", fontSize: 18 },
  name: { fontSize: 16, fontWeight: "600", color: colors.text },
  role: { fontSize: 12, color: colors.textMuted, textTransform: "capitalize", marginTop: 2 },
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, fontSize: 15, color: colors.text, marginBottom: spacing.sm },
  typeRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg, marginTop: spacing.sm },
  typeBtn: { flex: 1, padding: 14, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, alignItems: "center" },
  typeText: { fontWeight: "600", color: colors.text },
  modalActions: { flexDirection: "row", gap: spacing.sm },
  modalBtn: { flex: 1, padding: 14, borderRadius: radius.md, alignItems: "center" },
});
