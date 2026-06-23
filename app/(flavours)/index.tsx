import { systemGroupedBackground } from '@bacons/apple-colors';
import * as Location from 'expo-location';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, useColorScheme } from 'react-native';

import { TreatRow, TreatRowSeparator } from '@/components/TreatRow';
import {
  TOOLBAR_DICE_ICON,
  TOOLBAR_FILTER_ACTIVE_ICON,
  TOOLBAR_FILTER_INACTIVE_ICON,
  TOOLBAR_SORT_ICON,
} from '@/components/icons';
import { useFavourites } from '@/context/FavouritesContext';
import { distanceToLocationKm } from '@/lib/distance';
import { FlavourList, LocationList } from '@/model';

const DEFAULT_LOCATION = {
  latitude: 49.282729,
  longitude: -123.120735,
};

const SORT_OPTIONS = ['Distance', 'Featured'] as const;

interface Filters {
  showFavouritesOnly: boolean;
  showCurrentOnly: boolean;
  showOpenNowOnly: boolean;
  showVeganOnly: boolean;
  showLactoseFreeOnly: boolean;
  showGlutenFreeOnly: boolean;
  showNutFreeOnly: boolean;
}

const defaultFilters: Filters = {
  showFavouritesOnly: false,
  showCurrentOnly: false,
  showOpenNowOnly: false,
  showVeganOnly: false,
  showLactoseFreeOnly: false,
  showGlutenFreeOnly: false,
  showNutFreeOnly: false,
};

function isCurrentlyAvailable(startDate: string, endDate: string): boolean {
  const now = new Date();
  const start = new Date(startDate);
  const end = new Date(endDate);
  return now >= start && now <= end;
}

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

export default function Index() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const { favourites } = useFavourites();
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [sortBy, setSortBy] = useState<(typeof SORT_OPTIONS)[number]>('Distance');
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number }>(
    DEFAULT_LOCATION
  );

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

  useEffect(() => {
    updateLocation();
  }, [updateLocation]);

  const toggleFilter = (key: keyof Filters) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const filteredFlavours = useMemo(() => {
    let result = [...FlavourList];

    // Filter by search text
    if (searchText.trim()) {
      const query = searchText.toLowerCase();
      result = result.filter((item) => {
        const location = LocationList.find((l) => l.id === item.location);
        return (
          item.name.toLowerCase().includes(query) || location?.name.toLowerCase().includes(query)
        );
      });
    }

    // Apply filters
    if (filters.showFavouritesOnly) {
      result = result.filter((item) => favourites.has(item.id));
    }
    if (filters.showCurrentOnly) {
      result = result.filter((item) => isCurrentlyAvailable(item.startDate, item.endDate));
    }
    if (filters.showOpenNowOnly) {
      result = result.filter((item) => {
        const location = LocationList.find((l) => l.id === item.location);
        return location?.stores.some((store) => isOpenNow(store.hours)) ?? false;
      });
    }
    if (filters.showVeganOnly) {
      result = result.filter((item) => item.tags.includes('Vegan-Friendly'));
    }
    if (filters.showLactoseFreeOnly) {
      result = result.filter((item) => item.tags.includes('Lactose Free'));
    }
    if (filters.showGlutenFreeOnly) {
      result = result.filter((item) => item.tags.includes('Gluten-Free'));
    }
    if (filters.showNutFreeOnly) {
      result = result.filter((item) => item.tags.includes('Nut Free'));
    }

    // Sort by distance to the treat's vendor (nearest store) — same metric as
    // the Locations screen so the two screens agree.
    if (sortBy === 'Distance') {
      const distanceFor = (flavourLocationId: number): number => {
        const location = LocationList.find((l) => l.id === flavourLocationId);
        return location ? distanceToLocationKm(userLocation, location) : Number.POSITIVE_INFINITY;
      };
      result.sort((a, b) => distanceFor(a.location) - distanceFor(b.location));
    }

    return result;
  }, [searchText, filters, favourites, sortBy, userLocation]);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Treats',
          headerLargeTitle: true,
          headerSearchBarOptions: {
            hideWhenScrolling: true,
            barTintColor: colorScheme === 'dark' ? '#333335' : '#d0d0d5',
            onChangeText: (e) => setSearchText(e.nativeEvent.text),
          },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={TOOLBAR_DICE_ICON}
          tintColor="#007AFF"
          onPress={() => {
            if (filteredFlavours.length === 0) return;
            const pick = filteredFlavours[Math.floor(Math.random() * filteredFlavours.length)];
            router.push(`/flavours/${pick.id}`);
          }}
        />
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
          icon={activeFilterCount > 0 ? TOOLBAR_FILTER_ACTIVE_ICON : TOOLBAR_FILTER_INACTIVE_ICON}>
          <Stack.Toolbar.MenuAction
            isOn={filters.showFavouritesOnly}
            onPress={() => toggleFilter('showFavouritesOnly')}>
            Show Favourites Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showCurrentOnly}
            onPress={() => toggleFilter('showCurrentOnly')}>
            Show Current Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showOpenNowOnly}
            onPress={() => toggleFilter('showOpenNowOnly')}>
            Show Open Now Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showVeganOnly}
            onPress={() => toggleFilter('showVeganOnly')}>
            Show Vegan-Friendly Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showLactoseFreeOnly}
            onPress={() => toggleFilter('showLactoseFreeOnly')}>
            Show Lactose Free Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showGlutenFreeOnly}
            onPress={() => toggleFilter('showGlutenFreeOnly')}>
            Show Gluten Free Only
          </Stack.Toolbar.MenuAction>
          <Stack.Toolbar.MenuAction
            isOn={filters.showNutFreeOnly}
            onPress={() => toggleFilter('showNutFreeOnly')}>
            Show Nut Free Only
          </Stack.Toolbar.MenuAction>
          {activeFilterCount > 0 && (
            <Stack.Toolbar.MenuAction destructive onPress={() => setFilters(defaultFilters)}>
              Clear All Filters
            </Stack.Toolbar.MenuAction>
          )}
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {/* React Native FlatList rather than @expo/ui List: the thumbnail must be
          sized exactly with a tight gap, and an RN view inside a SwiftUI List
          slot gets a SwiftUI-controlled frame that ignores its width. */}
      <FlatList
        style={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.listContent}
        data={filteredFlavours}
        keyExtractor={(item) => String(item.id)}
        ItemSeparatorComponent={TreatRowSeparator}
        renderItem={({ item, index }) => (
          <TreatRow
            flavour={item}
            showVendor
            first={index === 0}
            last={index === filteredFlavours.length - 1}
            onPress={() => router.push(`/flavours/${item.id}`)}
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
