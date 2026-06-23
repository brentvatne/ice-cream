import { data as flavourData } from './assets/FlavourList.json';
import { data as locationData } from './assets/LocationList.json';

export const FlavourList: Flavour[] = flavourData;
// JSON infers `point` as number[]; assert the [lat, lng] tuple shape.
export const LocationList = locationData as unknown as Location[];

export interface Flavour {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  description: string;
  price?: string;
  /** Number of passport stamps this item earns (e.g. 3). */
  stamps?: number;
  /** Filename (relative to assets/treat-images) of the downloaded item photo, if any. */
  image?: string;
  location: number;
  tags: string[];
}

export interface Mission {
  name: string;
  description: string;
}

export interface Location {
  id: number;
  name: string;
  description: string;
  instagram?: string;
  website?: string;
  logoUrl?: string;
  /** Vendor-level neighborhood summary, e.g. "Kitsilano · Downtown". */
  neighborhoods?: string;
  /** Festival prize "missions" highlighted for this vendor. */
  missions?: Mission[];
  stores: Store[];
}

export interface Store {
  address: string;
  hours: string;
  point: [number, number];
  name: string;
}
