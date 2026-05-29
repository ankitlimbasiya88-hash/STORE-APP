import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Image,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "@/src/components/AppIcon";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { useSession, getWsUrl } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

type Msg = {
  id: string;
  store_id: string;
  sender_id: string;
  sender_name: string;
  text?: string | null;
  attachment_base64?: string | null;
  attachment_type?: string | null;
  attachment_content_type?: string | null;
  attachment_filename?: string | null;
  created_at: string;
};

export default function ChatScreen() {
  const { session, apiStore, storeId, storeName } = useSession();
  const me = session!.user;
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState<{
    base64: string; content_type: string; filename: string; type: "image" | "file";
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const wsRef = useRef<WebSocket | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);

  useEffect(() => {
    (async () => {
      try {
        const hist = await apiStore<Msg[]>("/api/chat/messages");
        setMessages(hist);
      } catch (e: any) { console.warn(e); }
      finally { setLoading(false); }
    })();
  }, [storeId]);

  useEffect(() => {
    if (!session || !storeId) return;
    const url = getWsUrl(session.token, storeId);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = (e) => console.warn("ws error", e);
    ws.onmessage = (ev) => {
      try {
        const m: Msg = JSON.parse(ev.data);
        setMessages((prev) => prev.find((p) => p.id === m.id) ? prev : [...prev, m]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
      } catch {}
    };
    return () => { ws.close(); };
  }, [session?.token, storeId]);

  const send = () => {
    if (!text.trim() && !pending) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      Alert.alert("Not connected", "Reconnecting…");
      return;
    }
    const payload: any = { text: text.trim() || null };
    if (pending) {
      payload.attachment_base64 = pending.base64;
      payload.attachment_type = pending.type;
      payload.attachment_content_type = pending.content_type;
      payload.attachment_filename = pending.filename;
    }
    wsRef.current.send(JSON.stringify(payload));
    setText("");
    setPending(null);
  };

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert("Permission required", "Grant photo library access to attach images."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images, base64: true, quality: 0.6,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset.base64) return;
    setPending({
      base64: asset.base64,
      content_type: asset.mimeType || "image/jpeg",
      filename: asset.fileName || "image.jpg",
      type: "image",
    });
  };

  const pickDoc = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    try {
      const res = await fetch(asset.uri);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        setPending({
          base64,
          content_type: asset.mimeType || "application/octet-stream",
          filename: asset.name,
          type: "file",
        });
      };
      reader.readAsDataURL(blob);
    } catch (e: any) { Alert.alert("Error", "Could not read file"); }
  };

  const renderItem = ({ item }: { item: Msg }) => {
    const mine = item.sender_id === me.id;
    return (
      <View style={[styles.msgRow, mine ? styles.msgMine : styles.msgTheirs]}>
        {!mine && <Text style={styles.sender}>{item.sender_name}</Text>}
        {item.attachment_base64 && item.attachment_type === "image" && (
          <Image source={{ uri: `data:${item.attachment_content_type};base64,${item.attachment_base64}` }} style={styles.attachImg} />
        )}
        {item.attachment_base64 && item.attachment_type === "file" && (
          <View style={styles.fileBox}>
            <Ionicons name="document-text" size={24} color={mine ? "#fff" : colors.primary} />
            <Text style={[styles.fileName, mine && { color: "#fff" }]} numberOfLines={1}>{item.attachment_filename || "Document"}</Text>
          </View>
        )}
        {item.text ? <Text style={[styles.msgText, mine && { color: "#fff" }]}>{item.text}</Text> : null}
        <Text style={[styles.msgTime, mine && { color: "rgba(255,255,255,0.7)" }]}>
          {new Date(item.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={26} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>{storeName ? `${storeName} Chat` : "Team Chat"}</Text>
          <Text style={styles.headerSub}>
            <View style={[styles.dot, { backgroundColor: connected ? "#22c55e" : "#f87171" }]} />
            {"  "}{connected ? "Connected" : "Connecting..."}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}>
        {loading ? (
          <View style={styles.loader}><ActivityIndicator color={colors.primary} /></View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {pending && (
          <View style={styles.pendingBox}>
            <Ionicons name={pending.type === "image" ? "image" : "document"} size={20} color={colors.primary} />
            <Text style={styles.pendingName} numberOfLines={1}>{pending.filename}</Text>
            <TouchableOpacity testID="clear-attachment-btn" onPress={() => setPending(null)}>
              <AppIcon name="close" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputBar}>
          <TouchableOpacity testID="attach-image-btn" onPress={pickImage} style={styles.iconBtn}>
            <Ionicons name="image" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TouchableOpacity testID="attach-doc-btn" onPress={pickDoc} style={styles.iconBtn}>
            <Ionicons name="attach" size={22} color={colors.primary} />
          </TouchableOpacity>
          <TextInput testID="chat-input" style={styles.input} placeholder="Message..." placeholderTextColor={colors.textLight} value={text} onChangeText={setText} multiline />
          <TouchableOpacity testID="send-btn" onPress={send} style={styles.sendBtn}>
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md, gap: 4 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  headerSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  loader: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: spacing.md, gap: spacing.sm },
  msgRow: { padding: spacing.sm + 2, borderRadius: radius.md, maxWidth: "80%", marginBottom: spacing.sm },
  msgMine: { backgroundColor: colors.primary, alignSelf: "flex-end", borderBottomRightRadius: 4 },
  msgTheirs: { backgroundColor: colors.card, alignSelf: "flex-start", borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  sender: { fontSize: 11, fontWeight: "700", color: colors.primary, marginBottom: 2 },
  msgText: { fontSize: 15, color: colors.text },
  msgTime: { fontSize: 10, color: colors.textMuted, marginTop: 4, alignSelf: "flex-end" },
  attachImg: { width: 200, height: 200, borderRadius: 8, marginBottom: 6 },
  fileBox: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 8, marginBottom: 6 },
  fileName: { color: colors.text, fontSize: 13, flex: 1 },
  pendingBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 10, backgroundColor: "#EFF6FF", marginHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#DBEAFE" },
  pendingName: { flex: 1, color: colors.text, fontSize: 13 },
  inputBar: { flexDirection: "row", alignItems: "flex-end", padding: spacing.sm, gap: 6, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 100, backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: colors.text },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
});
