import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { SessionProvider } from "@/src/ctx/SessionProvider";

SplashScreen.preventAutoHideAsync();

// Swallow the harmless `@expo/vector-icons` fallback rejection that fires
// when an <Icon> mounts before the family registers in Expo Go Android.
// The prewarm hook below handles registration; this just keeps the console
// clean if the vendor path is hit on a transient race / cache miss.
const isIconFontEmptyError = (reason: unknown): boolean => {
  const msg = String((reason as { message?: string })?.message ?? reason ?? "");
  return /Font file for .+ is empty/i.test(msg) ||
         /expoFontLoader\.loadAsync/i.test(msg);
};

if (typeof globalThis !== "undefined") {
  // React Native: HermesInternal/global unhandled rejection tracker
  // @ts-ignore
  const tracker = globalThis.HermesInternal?.enablePromiseRejectionTracker;
  if (typeof tracker === "function") {
    tracker({
      allRejections: true,
      onUnhandled: (_id: number, reason: unknown) => {
        if (!isIconFontEmptyError(reason)) {
          console.warn("Unhandled promise rejection:", reason);
        }
      },
    });
  }
  // Web fallback
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("unhandledrejection", (ev) => {
      if (isIconFontEmptyError((ev as PromiseRejectionEvent).reason)) {
        ev.preventDefault();
      }
    });
  }
}

export default function RootLayout() {
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <SessionProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </SessionProvider>
    </SafeAreaProvider>
  );
}
