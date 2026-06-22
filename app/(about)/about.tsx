import { Button, FieldGroup, Host, Text } from '@expo/ui';
import * as Linking from 'expo-linking';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

export default function AboutPage() {
  const colorScheme = useColorScheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Vancouver Ice Cream Festival' }} />
      <Host style={{ flex: 1 }} colorScheme={colorScheme === 'dark' ? 'dark' : 'light'}>
        <FieldGroup>
          <FieldGroup.Section title="ABOUT">
            <Text>
              This demo app showcases Expo UI components using data from the Vancouver Ice Cream
              Festival, sourced from Noms Magazine. The creators of this app are not in any way
              affiliated with the festival or Noms Magazine.
            </Text>
          </FieldGroup.Section>

          <FieldGroup.Section title="LINKS">
            <Button
              variant="text"
              onPress={() =>
                Linking.openURL('https://nomsmagazine.com/vancouver-ice-cream-festival/')
              }>
              <Text textStyle={{ color: '#007AFF' }}>Vancouver Ice Cream Festival</Text>
            </Button>
          </FieldGroup.Section>
        </FieldGroup>
      </Host>
    </>
  );
}
