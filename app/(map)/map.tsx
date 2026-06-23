import { BottomSheet, Button, Column, Host, Icon, Row, Spacer, Text } from '@expo/ui';
import { systemGroupedBackground } from '@bacons/apple-colors';
import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { SECONDARY_ICON_COLOR } from '@/components/icons';
import StoreMap from '@/components/StoreMap';
import { useFavourites } from '@/context/FavouritesContext';
import { type Flavour, FlavourList, LocationList, type Store } from '@/model';

// iOS-only swift-ui escape hatches; tree-shaken on other platforms.
const BOTTOM_SHEET_MODIFIERS =
  process.env.EXPO_OS === 'ios'
    ? [require('@expo/ui/swift-ui/modifiers').presentationBackgroundInteraction('enabled')]
    : [];

// Fill the sheet height and pin content to the top (vs. SwiftUI centering it).
const TOP_ALIGN_MODIFIERS =
  process.env.EXPO_OS === 'ios'
    ? [require('@expo/ui/swift-ui/modifiers').frame({ maxHeight: Infinity, alignment: 'top' })]
    : [];

const XMARK_CIRCLE_FILLED = Icon.select({
  ios: 'xmark.circle.fill',
  android: require('@expo/material-symbols/cancel.xml'),
});

function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  const lower = timeStr.toLowerCase().trim();
  if (lower === 'noon') return { hours: 12, minutes: 0 };
  if (lower === 'midnight') return { hours: 0, minutes: 0 };

  const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)/);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const isPM = match[3].startsWith('p');

  if (isPM && hours !== 12) hours += 12;
  if (!isPM && hours === 12) hours = 0;

  return { hours, minutes };
}

function isOpenNow(hoursStr: string): boolean {
  const now = new Date();
  const currentDay = now.getDay();
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();

  const lower = hoursStr.toLowerCase();
  const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const fullDayNames = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ];
  const currentDayName = dayNames[currentDay];
  const currentFullDayName = fullDayNames[currentDay];

  if (
    lower.includes(`closed ${currentDayName}`) ||
    lower.includes(`closed ${currentFullDayName}`) ||
    lower.includes(`closed on ${currentDayName}`)
  ) {
    return false;
  }

  const timeRangeMatch = hoursStr.match(
    /(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(?:–|-|to)\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))/i
  );

  if (timeRangeMatch) {
    const openTime = parseTime(timeRangeMatch[1]);
    const closeTime = parseTime(timeRangeMatch[2]);

    if (openTime && closeTime) {
      const currentTotalMinutes = currentHours * 60 + currentMinutes;
      const openTotalMinutes = openTime.hours * 60 + openTime.minutes;
      const closeTotalMinutes = closeTime.hours * 60 + closeTime.minutes;

      return currentTotalMinutes >= openTotalMinutes && currentTotalMinutes < closeTotalMinutes;
    }
  }

  return true;
}

// Add backtraced location data to the store.
// When clicking on a store, we can display the location metadata directly.
interface ExtendedStore extends Store {
  locationName: string;
  locationId: number;
  locationDescription: string;
  locationInstagram: string;
  locationWebsite: string;
  locationFlavours: Flavour[];
}

const STORES: ExtendedStore[] = LocationList.flatMap((location) =>
  location.stores.map((store) => ({
    ...store,
    point: [store.point[0], store.point[1]],
    locationName: location.name,
    locationId: location.id,
    locationDescription: location.description,
    locationInstagram: location.instagram ?? '',
    locationWebsite: location.website ?? '',
    locationFlavours: FlavourList.filter((flavour) => flavour.location === location.id),
  }))
);

export default function Tab() {
  const router = useRouter();
  const [selectedStore, setSelectedStore] = useState<ExtendedStore | null | undefined>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { favourites } = useFavourites();

  // Derive markers from stores and favourites
  // React Compiler will automatically memoize this
  const markers = STORES.map((store) => {
    const hasFavouriteFlavour = store.locationFlavours.some((f) => favourites.has(f.id));
    const isClosed = !isOpenNow(store.hours);

    // Determine icon: star for favourites, cup for regular
    const systemImage = hasFavouriteFlavour ? 'star.fill' : 'cup.and.saucer.fill';

    // Determine color: gray if closed, yellow if favourite, default (red) otherwise
    // Using #AARRGGBB format for alpha support
    const tintColor = isClosed
      ? '#808E8E93' // iOS systemGray at 50% opacity
      : hasFavouriteFlavour
        ? '#FFD60A' // iOS systemYellow
        : undefined;

    return {
      id: `${store.locationId}-${store.name}`,
      coordinates: {
        latitude: store.point[0],
        longitude: store.point[1],
      },
      systemImage,
      tintColor,
      title: `${store.locationName} - ${store.name}`,
    };
  });

  const openLocation = () => {
    if (!selectedStore) return;
    const locationId = selectedStore.locationId;
    setSelectedStore(null);
    router.navigate(`/locations/${locationId}`);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Location Map',
          headerLargeTitle: false,
          headerStyle: { backgroundColor: systemGroupedBackground },
        }}
      />
      <StoreMap
        markers={markers}
        onMarkerClick={(id) => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          setIsLoading(true);
          setSelectedStore(STORES.find((store) => `${store.locationId}-${store.name}` === id));
          setTimeout(() => setIsLoading(false), 500);
        }}
      />
      {isLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#007AFF" />
        </View>
      )}
      <Host>
        <BottomSheet
          isPresented={!!selectedStore}
          onDismiss={() => setSelectedStore(null)}
          snapPoints={[{ fraction: 0.32 }]}
          modifiers={BOTTOM_SHEET_MODIFIERS}>
          {/* All @expo/ui (native SwiftUI) so taps work in the sheet. Keep it
              minimal: name + address, then a native button out to the full
              location detail page rather than duplicating its content here.
              TOP_ALIGN_MODIFIERS pins the content to the top of the sheet. */}
          <Column
            alignment="start"
            spacing={10}
            style={{ padding: 20 }}
            modifiers={TOP_ALIGN_MODIFIERS}>
            <Row alignment="center">
              <Text textStyle={{ fontSize: 22, fontWeight: '700' }}>
                {selectedStore?.locationName ?? ''}
              </Text>
              <Spacer />
              <Icon
                name={XMARK_CIRCLE_FILLED}
                size={26}
                color={SECONDARY_ICON_COLOR}
                onPress={() => setSelectedStore(null)}
              />
            </Row>
            {selectedStore?.address ? (
              <Text textStyle={{ fontSize: 15, color: 'gray' }}>{selectedStore.address}</Text>
            ) : null}
            {selectedStore?.hours ? (
              <Text textStyle={{ fontSize: 15, color: 'gray' }}>{selectedStore.hours}</Text>
            ) : null}
            <Button variant="filled" onPress={openLocation} label="View Details" />
          </Column>
        </BottomSheet>
      </Host>
    </>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
});
