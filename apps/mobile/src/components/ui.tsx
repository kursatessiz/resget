import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';

/** A screen with safe-area padding and the kit's background. */
export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const style = [
    styles.screen,
    {
      backgroundColor: theme.colors.background,
      paddingTop: insets.top + theme.spacing[4],
      paddingBottom: insets.bottom + theme.spacing[6],
    },
  ];
  if (!scroll) return <View style={style}>{children}</View>;
  return <ScrollView contentContainerStyle={style}>{children}</ScrollView>;
}

export function Title({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: theme.colors.text,
        fontSize: theme.typography.size['2xl'],
        fontWeight: theme.typography.weight.bold,
        marginBottom: theme.spacing[2],
      }}
    >
      {children}
    </Text>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const theme = useTheme();
  return (
    <Text
      style={{
        color: muted ? theme.colors.muted : theme.colors.text,
        fontSize: theme.typography.size.md,
        lineHeight: 22,
      }}
    >
      {children}
    </Text>
  );
}

export function Caption({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <Text style={{ color: theme.colors.muted, fontSize: theme.typography.size.sm }}>{children}</Text>;
}

/** A flat card: surface, border, radius from the tokens; never nested in another card. */
export function Card({ children, title }: { children: ReactNode; title?: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: theme.colors.border,
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: theme.radii.md,
        padding: theme.spacing[4],
        gap: theme.spacing[3],
      }}
    >
      {title && (
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.size.lg,
            fontWeight: theme.typography.weight.semibold,
          }}
        >
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = 'theme',
  variant = 'solid',
  disabled = false,
  busy = false,
  big = false,
}: {
  label: string;
  onPress: () => void;
  tone?: 'theme' | 'success' | 'warn' | 'error' | 'muted';
  variant?: 'solid' | 'outline';
  disabled?: boolean;
  busy?: boolean;
  /** The courier's single action button: large and thumb friendly. */
  big?: boolean;
}) {
  const theme = useTheme();
  const color = tone === 'muted' ? theme.colors.muted : theme.colors[tone];
  const solid = variant === 'solid';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: solid ? color : 'transparent',
        borderColor: color,
        borderWidth: solid ? 0 : 1,
        borderRadius: theme.radii.sm,
        paddingVertical: big ? theme.spacing[5] : theme.spacing[3],
        paddingHorizontal: theme.spacing[4],
        alignItems: 'center',
        opacity: disabled || busy ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={solid ? theme.colors.onTheme : color} />
      ) : (
        <Text
          style={{
            color: solid ? theme.colors.onTheme : color,
            fontSize: big ? theme.typography.size.lg : theme.typography.size.md,
            fontWeight: theme.typography.weight.semibold,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...rest }: { label: string } & TextInputProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing[1] }}>
      <Text style={{ color: theme.colors.text, fontSize: theme.typography.size.sm }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.muted}
        {...rest}
        style={{
          color: theme.colors.text,
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderWidth: 1,
          borderRadius: theme.radii.sm,
          paddingVertical: theme.spacing[3],
          paddingHorizontal: theme.spacing[3],
          fontSize: theme.typography.size.md,
        }}
      />
    </View>
  );
}

export function Notice({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'error' | 'success' }) {
  const theme = useTheme();
  const color = tone === 'muted' ? theme.colors.muted : theme.colors[tone];
  return (
    <Text accessibilityRole="alert" style={{ color, fontSize: theme.typography.size.sm }}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, paddingHorizontal: 16, gap: 16 },
});
