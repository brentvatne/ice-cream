import { label, systemGroupedBackground } from '@bacons/apple-colors';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Stack } from 'expo-router';

type StackScreenOptions = React.ComponentProps<typeof Stack>['screenOptions'];

const hasLiquidGlass = isLiquidGlassAvailable();

/**
 * A preset for the Stack screen options that uses the system's appearance settings.
 */
export const SystemScreenStackPreset: StackScreenOptions = {
  headerTransparent: hasLiquidGlass,
  headerBlurEffect: hasLiquidGlass ? undefined : 'systemMaterial',
  headerLargeTitleShadowVisible: false,
  // Black header buttons (back chevron/label) in light mode; the adaptive
  // `label` color flips to white in dark mode so they stay legible.
  headerTintColor: label,
  contentStyle: { backgroundColor: systemGroupedBackground },
};
