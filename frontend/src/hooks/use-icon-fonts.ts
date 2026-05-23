// Icon font loader for Expo apps. Ionicons (used app-wide) is bundled
// locally to avoid the "Font file for ionicons is empty" error caused by
// @expo/vector-icons' componentDidMount fallback hitting a broken vendor
// path in Expo Go. Other families fall back to a CDN under StoreClient
// only — native dev/prod builds and web get them via autolinking / web stubs.
// ICON_VECTOR_VERSION must match @expo/vector-icons in package.json.
// Usage: const [loaded, error] = useIconFonts();

import Constants, { ExecutionEnvironment } from "expo-constants";
import { useFonts } from "expo-font";

const ICON_VECTOR_VERSION = "15.0.3";

// Locally bundled — guarantees Ionicons works across Expo Go, web, dev builds.
const LOCAL_IONICONS = require("../../assets/fonts/Ionicons.ttf");

const ICON_FAMILIES = [
  "AntDesign",
  "Entypo",
  "EvilIcons",
  "Feather",
  "FontAwesome",
  "FontAwesome5_Brands",
  "FontAwesome5_Regular",
  "FontAwesome5_Solid",
  "FontAwesome6_Brands",
  "FontAwesome6_Regular",
  "FontAwesome6_Solid",
  "Fontisto",
  "Foundation",
  "MaterialCommunityIcons",
  "MaterialIcons",
  "Octicons",
  "SimpleLineIcons",
  "Zocial",
] as const;

type IconFamily = (typeof ICON_FAMILIES)[number];

const cdnFontMap = (): Record<IconFamily, string> =>
  Object.fromEntries(
    ICON_FAMILIES.map((f) => [
      f,
      `https://cdn.jsdelivr.net/npm/@expo/vector-icons@${ICON_VECTOR_VERSION}/build/vendor/react-native-vector-icons/Fonts/${f}.ttf`,
    ]),
  ) as Record<IconFamily, string>;

export const useIconFonts = (): readonly [boolean, Error | null] => {
  const isExpoGo =
    Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  return useFonts({
    // Always-bundled — the icon family the app actually uses.
    Ionicons: LOCAL_IONICONS,
    // Other families: only prewarmed via CDN under Expo Go.
    ...(isExpoGo ? cdnFontMap() : {}),
  });
};
