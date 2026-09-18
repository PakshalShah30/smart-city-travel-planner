/**
 * Where the planner gets its places from.
 *
 * Phase 1 answers from the hand-curated seed module, so the whole application
 * runs without a database — useful for anyone cloning the repo, and it keeps the
 * UI honest while ingestion is still to come. Phase 2 replaces the bodies of
 * `getCandidates` and `getCity` with PostGIS queries; the signatures do not
 * change, so nothing above this file has to.
 */
import { MUMBAI, MUMBAI_POIS } from '@/db/seed/mumbai';

import type { Coord } from './geo';
import type { Candidate } from './solver/types';

export type City = {
  slug: string;
  name: string;
  country: string;
  center: Coord;
  timezone: string;
  defaultRadiusM: number;
};

/** A place the user can say they are setting off from. Phase 4 adds geocoding. */
export type StartPoint = {
  id: string;
  label: string;
  location: Coord;
};

export const CITIES: readonly City[] = [MUMBAI];

const START_POINTS: Record<string, readonly StartPoint[]> = {
  mumbai: [
    { id: 'colaba', label: 'Colaba Causeway', location: { lng: 72.828, lat: 18.9155 } },
    { id: 'gateway', label: 'Gateway of India', location: { lng: 72.8347, lat: 18.922 } },
    { id: 'csmt', label: 'CSMT station', location: { lng: 72.8353, lat: 18.9401 } },
    { id: 'marine-drive', label: 'Marine Drive', location: { lng: 72.823, lat: 18.944 } },
    { id: 'bandra', label: 'Bandra station', location: { lng: 72.8406, lat: 19.0544 } },
  ],
};

export function getCity(slug: string): City | undefined {
  return CITIES.find((c) => c.slug === slug);
}

export function getStartPoints(citySlug: string): readonly StartPoint[] {
  return START_POINTS[citySlug] ?? [];
}

export function getStartPoint(citySlug: string, id: string): StartPoint | undefined {
  return getStartPoints(citySlug).find((p) => p.id === id);
}

export function getCandidates(citySlug: string): Candidate[] {
  return citySlug === 'mumbai' ? MUMBAI_POIS : [];
}
