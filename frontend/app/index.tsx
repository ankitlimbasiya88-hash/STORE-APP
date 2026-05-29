import React, { useEffect, useState } from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Redirect } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function LoginScreen() {
  const { session, loading, signIn, storeId } = useSession();
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (session) {
    return <Redirect href={storeId ? "/(app)/home" : "/(app)/select-store"} />;
  }

  const onSubmit = async () => {
    setError(null);
    if (!name.trim() || pin.length !== 4) {
      setError("Enter your name and 4-digit PIN");
      return;
    }
    setSubmitting(true);
    try {
      await signIn(name.trim(), pin);
    } catch (e: any) {
      setError(e.message || "Login failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Ionicons name="storefront" size={40} color="#fff" />
          </View>
          <Text style={styles.title} testID="login-title">Grocery Ops</Text>
          <Text style={styles.subtitle}>Store Management Console</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            testID="login-name-input"
            style={styles.input}
            placeholder="Enter your name"
            placeholderTextColor={colors.textLight}
            autoCapitalize="words"
            autoCorrect={false}
            value={name}
            onChangeText={setName}
          />
          <Text style={styles.label}>4-digit PIN</Text>
          <TextInput
            testID="login-pin-input"
            style={[styles.input, styles.pinInput]}
            placeholder="••••"
            placeholderTextColor={colors.textLight}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
            value={pin}
            onChangeText={(t) => setPin(t.replace(/[^0-9]/g, ""))}
          />

          {error && <Text style={styles.error} testID="login-error">{error}</Text>}

          <TouchableOpacity testID="login-submit-btn" style={[styles.button, submitting && styles.buttonDisabled]} onPress={onSubmit} disabled={submitting}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign In</Text>}
          </TouchableOpacity>

          <Text style={styles.hint}>
            Default admin: <Text style={styles.hintBold}>Admin / 1234</Text>
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.primary },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { alignItems: "center", paddingVertical: spacing.xl, paddingTop: spacing.xl + 20 },
  logoCircle: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.primaryDark, alignItems: "center", justifyContent: "center", marginBottom: spacing.md, borderWidth: 2, borderColor: "rgba(255,255,255,0.2)" },
  title: { fontSize: 28, fontWeight: "700", color: "#fff", letterSpacing: 0.5 },
  subtitle: { fontSize: 14, color: "rgba(255,255,255,0.75)", marginTop: spacing.xs },
  card: { flex: 1, backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingTop: spacing.xl },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: spacing.sm, marginTop: spacing.md },
  input: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 16, color: colors.text },
  pinInput: { letterSpacing: 8, fontSize: 22, textAlign: "center" },
  error: { color: colors.danger, marginTop: spacing.md, fontSize: 14 },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 16, alignItems: "center", marginTop: spacing.xl },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "700", letterSpacing: 0.5 },
  hint: { textAlign: "center", color: colors.textMuted, marginTop: spacing.lg, fontSize: 13 },
  hintBold: { fontWeight: "700", color: colors.text },
});
