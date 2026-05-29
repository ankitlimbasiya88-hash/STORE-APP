import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "@/src/ctx/SessionProvider";
import { colors } from "@/src/theme/colors";

export default function AppLayout() {
  const { session, loading, storeId, stores } = useSession();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/" />;

  // If no store is selected, ensure user goes through the picker first.
  // (Don't redirect when already on the picker / store management screens.)
  // We rely on each screen to call setStoreId — guard handled per-screen.
  return <Stack screenOptions={{ headerShown: false }} />;
}
