import {
  label,
  link,
  secondaryLabel,
  secondarySystemGroupedBackground,
  separator,
  systemGroupedBackground,
  tertiarySystemFill,
} from '@bacons/apple-colors';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { TreatRow, TreatRowSeparator } from '@/components/TreatRow';
import { FlavourList, LocationList } from '@/model';

export default function LocationDetails() {
  const { id } = useLocalSearchParams();
  const router = useRouter();

  const location = LocationList.find((item) => item.id === Number(id));
  const [selectedStoreName, setSelectedStoreName] = useState<string | null>(null);
  const flavours = FlavourList.filter((flavour) => flavour.location === Number(id));

  const selectedStore = location?.stores.find((s) => s.name === selectedStoreName) ?? null;

  useEffect(() => {
    if (location) {
      setSelectedStoreName(location.stores[0]?.name ?? null);
    }
  }, [location]);

  if (!location) {
    return (
      <View style={styles.screen}>
        <Text style={styles.notFound}>Location not found</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: location.name,
          headerLargeTitle: true,
          headerBackButtonDisplayMode: 'minimal',
        }}
      />
      <ScrollView
        style={styles.screen}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}>
        <View style={styles.info}>
          {location.stores.length > 1 ? (
            <View style={styles.chips}>
              {location.stores.map((store) => {
                const selected = store.name === selectedStoreName;
                return (
                  <Pressable
                    key={store.name}
                    onPress={() => setSelectedStoreName(store.name)}
                    style={[styles.chip, selected && styles.chipSelected]}>
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {store.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {location.stores.length <= 1 && location.neighborhoods ? (
            <Text style={styles.neighborhoods}>{location.neighborhoods}</Text>
          ) : null}

          {selectedStore ? (
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() =>
                Linking.openURL(
                  `https://maps.apple.com/?ll=${selectedStore.point[0]},${selectedStore.point[1]}`
                )
              }>
              <Text style={styles.address}>{selectedStore.address}</Text>
            </Pressable>
          ) : null}

          {selectedStore ? <Text style={styles.hours}>{selectedStore.hours}</Text> : null}
        </View>

        <View style={[styles.card, styles.treatsCard]}>
          {flavours.map((flavour, index) => (
            <View key={flavour.id}>
              {index > 0 ? <TreatRowSeparator /> : null}
              <TreatRow
                flavour={flavour}
                first={index === 0}
                last={index === flavours.length - 1}
                onPress={() => router.push(`/flavours/${flavour.id}`)}
              />
            </View>
          ))}
        </View>

        {location.missions && location.missions.length > 0 ? (
          <>
            <Text style={styles.sectionHeader}>Prize Missions</Text>
            <View style={styles.card}>
              {location.missions.map((mission, index) => (
                <View key={mission.name}>
                  {index > 0 ? <View style={styles.missionSeparator} /> : null}
                  <View style={styles.mission}>
                    <Text style={styles.missionName}>{mission.name}</Text>
                    <Text style={styles.missionDesc}>{mission.description}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: systemGroupedBackground },
  content: { paddingBottom: 24 },
  notFound: { padding: 16, color: label },
  info: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16, gap: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 2 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: tertiarySystemFill,
  },
  chipSelected: { backgroundColor: link },
  chipText: { fontSize: 14, color: label },
  chipTextSelected: { color: '#fff', fontWeight: '600' },
  neighborhoods: { fontSize: 15, color: secondaryLabel },
  address: { fontSize: 16, color: link },
  hours: { fontSize: 16, color: label },
  sectionHeader: {
    fontSize: 22,
    fontWeight: '700',
    color: label,
    marginHorizontal: 16,
    marginTop: 24,
    marginBottom: 8,
  },
  mission: { paddingHorizontal: 16, paddingVertical: 11, gap: 2 },
  missionSeparator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: separator,
    marginLeft: 16,
  },
  missionName: { fontSize: 16, fontWeight: '600', color: label },
  missionDesc: { fontSize: 14, color: secondaryLabel },
  card: {
    marginHorizontal: 16,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: secondarySystemGroupedBackground,
  },
  treatsCard: { marginTop: 16 },
});
