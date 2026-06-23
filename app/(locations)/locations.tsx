import { systemGroupedBackground } from '@bacons/apple-colors';
import * as Location from 'expo-location';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, useColorScheme } from 'react-native';

import { LocationRow, LocationRowSeparator } from '@/components/LocationRow';
import {
  TOOLBAR_FILTER_ACTIVE_ICON,
  TOOLBAR_FILTER_INACTIVE_ICON,
  TOOLBAR_SORT_ICON,
} from '@/components/icons';
import { distanceToLocationKm } from '@/lib/distance';
import { LocationList } from '@/model';

const DEFAULT_LOCATION = {
  latitude: 49.282729,
  longitude: -123.120735,
};

function parseTime(timeStr: string): { hours: number; minutes: number } | null {
  // Parse times like "8 a.m.", "8:30 p.m.", "6 p.m.", "noon", "midnight"
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
  const currentDay = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  const currentHours = now.getHours();
  const currentMinutes = now.getMinutes();

  const lower = hoursStr.toLowerCase();

  // Check if closed today
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

  // Check for explicit closure
  if (
    lower.includes(`closed ${currentDayName}`) ||
    lower.includes(`closed ${currentFullDayName}`) ||
    lower.includes(`closed on ${currentDayName}`)
  ) {
    return false;
  }

  // Try to find time range - look for patterns like "8 a.m. – 6 p.m." or "8am-6pm"
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

  // Default: assume open if we couldn't parse
  return true;
}

const SORT_OPTIONS = ['Name', 'Distance'] as const;

export default function Locations() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]>('Distance');
  const [searchText, setSearchText] = useState('');
  const [showOpenOnly, setShowOpenOnly] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number }>(
    DEFAULT_LOCATION
  );
  const [refreshing, setRefreshing] = useState(false);

  const updateLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }
      const location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });
    } catch (error) {
      console.warn('Failed to get current location, falling back to default:', error);
    }
  }, []);

  // Pull-to-refresh wrapper: drives the spinner around a re-fetch. Kept separate
  // from `updateLocation` so the mount effect below doesn't set state synchronously.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await updateLocation();
    } finally {
      setRefreshing(false);
    }
  }, [updateLocation]);

  useEffect(() => {
    updateLocation();
  }, [updateLocation]);

  const filteredAndSortedLocations = useMemo(() => {
    let result = [...LocationList];

    // Filter by search text
    if (searchText.trim()) {
      const query = searchText.toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(query) ||
          item.stores.some((store) => store.address.toLowerCase().includes(query))
      );
    }

    // Filter by open now
    if (showOpenOnly) {
      result = result.filter((item) => item.stores.some((store) => isOpenNow(store.hours)));
    }

    // Sort
    if (sortBy === 'Name') {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === 'Distance') {
      result.sort(
        (a, b) => distanceToLocationKm(userLocation, a) - distanceToLocationKm(userLocation, b)
      );
    }

    return result;
  }, [sortBy, searchText, showOpenOnly, userLocation]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Locations',
          headerLargeTitle: true,
          headerSearchBarOptions: {
            hideWhenScrolling: true,
            barTintColor: colorScheme === 'dark' ? '#333335' : '#d0d0d5',
            onChangeText: (e) => setSearchText(e.nativeEvent.text),
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={TOOLBAR_SORT_ICON} tintColor="#007AFF" separateBackground>
          {SORT_OPTIONS.map((option) => (
            <Stack.Toolbar.MenuAction
              key={option}
              isOn={sortBy === option}
              onPress={() => setSortBy(option)}>
              {option}
            </Stack.Toolbar.MenuAction>
          ))}
        </Stack.Toolbar.Menu>
        <Stack.Toolbar.Menu
          tintColor="#007AFF"
          separateBackground
          icon={showOpenOnly ? TOOLBAR_FILTER_ACTIVE_ICON : TOOLBAR_FILTER_INACTIVE_ICON}>
          <Stack.Toolbar.MenuAction
            isOn={showOpenOnly}
            onPress={() => setShowOpenOnly(!showOpenOnly)}>
            Show Open Now Only
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {/* React Native FlatList rather than @expo/ui List: the treat thumbnails
          need an exact size, and an RN view inside a SwiftUI List slot gets a
          SwiftUI-controlled frame that ignores its dimensions (same reason the
          Treats screen uses a FlatList). */}
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        data={filteredAndSortedLocations}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={LocationRowSeparator}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item, index }) => (
          <LocationRow
            location={item}
            distanceKm={distanceToLocationKm(userLocation, item)}
            first={index === 0}
            last={index === filteredAndSortedLocations.length - 1}
            onPress={() => router.push(`/locations/${item.id}`)}
          />
        )}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1, backgroundColor: systemGroupedBackground },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
});
