/**
 * Hand-curated Mumbai seed data for Phase 1.
 *
 * Coordinates and durations are entered by hand and are approximate — good
 * enough to develop and test the solver against, not a source of truth. Phase 2
 * replaces this file wholesale with OpenStreetMap ingestion plus Google Places
 * enrichment, at which point it survives only as fixture data for tests.
 *
 * The set deliberately spans far more than one day can hold, including a few
 * entries that should always be rejected for a short South Mumbai itinerary
 * (Elephanta Caves, Sanjay Gandhi National Park), so rejection handling has
 * something real to chew on.
 */
import { dailyWindow, dailyWindowExcept } from '@/lib/solver/hours';
import type { Candidate } from '@/lib/solver/types';

export const MUMBAI = {
  slug: 'mumbai',
  name: 'Mumbai',
  country: 'India',
  center: { lng: 72.8347, lat: 18.9220 },
  timezone: 'Asia/Kolkata',
  defaultRadiusM: 6000,
} as const;

/** Category slugs used across the app. Kept small on purpose. */
export const CATEGORIES = [
  { slug: 'history', name: 'History' },
  { slug: 'art', name: 'Art and museums' },
  { slug: 'food', name: 'Food' },
  { slug: 'parks', name: 'Parks' },
  { slug: 'views', name: 'Views' },
  { slug: 'markets', name: 'Markets' },
  { slug: 'religious', name: 'Temples and churches' },
  { slug: 'family', name: 'Family' },
] as const;

const MON = 1;
const WED = 3;
const FRI = 5;
const SUN = 0;

const hm = (h: number, m = 0) => h * 60 + m;

export const MUMBAI_POIS: Candidate[] = [
  // --- Colaba and the Fort district ---
  { id: 1, name: 'Gateway of India', location: { lng: 72.8347, lat: 18.9220 }, visitDurationMin: 45, popularity: 9.2, categories: ['history', 'views'], hours: { kind: 'always' } },
  { id: 2, name: 'Taj Mahal Palace (exterior)', location: { lng: 72.8332, lat: 18.9217 }, visitDurationMin: 20, popularity: 8.2, categories: ['history'], hours: { kind: 'always' } },
  { id: 3, name: 'Chhatrapati Shivaji Maharaj Vastu Sangrahalaya', location: { lng: 72.8324, lat: 18.9269 }, visitDurationMin: 90, popularity: 8.8, categories: ['art', 'history'], hours: dailyWindow(hm(10, 15), hm(18)) },
  { id: 4, name: 'Jehangir Art Gallery', location: { lng: 72.8318, lat: 18.9277 }, visitDurationMin: 40, popularity: 7.6, categories: ['art'], hours: dailyWindow(hm(11), hm(19)) },
  { id: 5, name: 'Kala Ghoda art precinct', location: { lng: 72.8320, lat: 18.9280 }, visitDurationMin: 40, popularity: 8.0, categories: ['art', 'history'], hours: { kind: 'always' } },
  { id: 6, name: 'Bombay High Court', location: { lng: 72.8296, lat: 18.9297 }, visitDurationMin: 25, popularity: 7.0, categories: ['history'], hours: dailyWindowExcept(hm(10, 30), hm(17), [SUN, 6]) },
  { id: 7, name: 'Rajabai Clock Tower', location: { lng: 72.8307, lat: 18.9298 }, visitDurationMin: 20, popularity: 7.4, categories: ['history'], hours: { kind: 'always' } },
  { id: 8, name: 'Flora Fountain', location: { lng: 72.8311, lat: 18.9322 }, visitDurationMin: 20, popularity: 7.2, categories: ['history'], hours: { kind: 'always' } },
  { id: 9, name: 'Asiatic Society Town Hall', location: { lng: 72.8365, lat: 18.9320 }, visitDurationMin: 30, popularity: 7.1, categories: ['history'], hours: dailyWindowExcept(hm(10), hm(18), [SUN]) },
  { id: 10, name: 'Chhatrapati Shivaji Maharaj Terminus', location: { lng: 72.8353, lat: 18.9401 }, visitDurationMin: 30, popularity: 9.0, categories: ['history'], hours: { kind: 'always' } },
  { id: 11, name: 'Colaba Causeway', location: { lng: 72.8280, lat: 18.9155 }, visitDurationMin: 45, popularity: 7.8, categories: ['markets'], hours: dailyWindow(hm(10), hm(21)) },
  { id: 12, name: 'Sassoon Docks', location: { lng: 72.8317, lat: 18.9106 }, visitDurationMin: 40, popularity: 6.6, categories: ['markets'], hours: dailyWindow(hm(5), hm(11)) },
  { id: 13, name: 'Afghan Church', location: { lng: 72.8137, lat: 18.9008 }, visitDurationMin: 25, popularity: 6.4, categories: ['religious', 'history'], hours: dailyWindow(hm(8), hm(18)) },

  // --- Marine Drive, Malabar Hill and Girgaum ---
  { id: 14, name: 'Marine Drive promenade', location: { lng: 72.8230, lat: 18.9440 }, visitDurationMin: 40, popularity: 9.4, categories: ['views'], hours: { kind: 'always' } },
  { id: 15, name: 'Girgaum Chowpatty', location: { lng: 72.8156, lat: 18.9547 }, visitDurationMin: 50, popularity: 8.4, categories: ['food', 'views'], hours: { kind: 'always' } },
  { id: 16, name: 'Mani Bhavan Gandhi Museum', location: { lng: 72.8093, lat: 18.9583 }, visitDurationMin: 40, popularity: 7.9, categories: ['history'], hours: dailyWindow(hm(9, 30), hm(18)) },
  { id: 17, name: 'Hanging Gardens', location: { lng: 72.8053, lat: 18.9567 }, visitDurationMin: 35, popularity: 7.3, categories: ['parks', 'views'], hours: dailyWindow(hm(5), hm(21)) },
  { id: 18, name: 'Kamala Nehru Park', location: { lng: 72.8048, lat: 18.9558 }, visitDurationMin: 25, popularity: 6.5, categories: ['parks', 'family'], hours: dailyWindow(hm(5), hm(21)) },
  { id: 19, name: 'Banganga Tank', location: { lng: 72.7936, lat: 18.9459 }, visitDurationMin: 35, popularity: 7.0, categories: ['religious', 'history'], hours: { kind: 'always' } },

  // --- Central: Byculla, Mahalaxmi, the mill district ---
  { id: 20, name: 'Crawford Market', location: { lng: 72.8347, lat: 18.9470 }, visitDurationMin: 45, popularity: 7.7, categories: ['markets', 'food'], hours: dailyWindowExcept(hm(11), hm(20), [SUN]) },
  { id: 21, name: 'Mohammed Ali Road food street', location: { lng: 72.8320, lat: 18.9590 }, visitDurationMin: 45, popularity: 8.1, categories: ['food'], hours: dailyWindow(hm(17), hm(23, 30)) },
  { id: 22, name: 'Chor Bazaar', location: { lng: 72.8290, lat: 18.9620 }, visitDurationMin: 40, popularity: 6.9, categories: ['markets'], hours: dailyWindowExcept(hm(11), hm(19), [FRI]) },
  { id: 23, name: 'Dhobi Ghat', location: { lng: 72.8250, lat: 18.9700 }, visitDurationMin: 25, popularity: 7.2, categories: ['views'], hours: { kind: 'always' } },
  { id: 24, name: 'Dr Bhau Daji Lad Museum', location: { lng: 72.8340, lat: 18.9790 }, visitDurationMin: 60, popularity: 7.5, categories: ['art', 'history'], hours: dailyWindowExcept(hm(10), hm(18), [WED]) },
  { id: 25, name: 'Veermata Jijabai Bhosale Udyan', location: { lng: 72.8335, lat: 18.9785 }, visitDurationMin: 60, popularity: 6.8, categories: ['parks', 'family'], hours: dailyWindowExcept(hm(9, 30), hm(18), [WED]) },
  { id: 26, name: 'Shree Mahalakshmi Temple', location: { lng: 72.8090, lat: 18.9740 }, visitDurationMin: 30, popularity: 8.0, categories: ['religious'], hours: dailyWindow(hm(6), hm(22)) },
  { id: 27, name: 'Haji Ali Dargah', location: { lng: 72.8090, lat: 18.9827 }, visitDurationMin: 45, popularity: 8.5, categories: ['religious', 'views'], hours: dailyWindow(hm(5, 30), hm(22)) },
  { id: 28, name: 'Nehru Science Centre', location: { lng: 72.8230, lat: 18.9880 }, visitDurationMin: 75, popularity: 6.7, categories: ['family', 'art'], hours: dailyWindow(hm(9, 30), hm(18)) },

  // --- Worli, Bandra and north ---
  { id: 29, name: 'Worli Fort', location: { lng: 72.8130, lat: 19.0170 }, visitDurationMin: 30, popularity: 6.2, categories: ['history', 'views'], hours: { kind: 'always' } },
  { id: 30, name: 'Bandra-Worli Sea Link viewpoint', location: { lng: 72.8170, lat: 19.0330 }, visitDurationMin: 25, popularity: 7.6, categories: ['views'], hours: { kind: 'always' } },
  { id: 31, name: 'Siddhivinayak Temple', location: { lng: 72.8302, lat: 19.0169 }, visitDurationMin: 40, popularity: 8.7, categories: ['religious'], hours: dailyWindow(hm(5, 30), hm(21, 50)) },
  { id: 32, name: 'Bandra Fort', location: { lng: 72.8190, lat: 19.0430 }, visitDurationMin: 30, popularity: 7.1, categories: ['history', 'views'], hours: { kind: 'always' } },
  { id: 33, name: 'Mount Mary Church', location: { lng: 72.8230, lat: 19.0450 }, visitDurationMin: 25, popularity: 7.3, categories: ['religious'], hours: dailyWindow(hm(6), hm(19)) },
  { id: 34, name: 'Juhu Beach', location: { lng: 72.8265, lat: 19.0990 }, visitDurationMin: 50, popularity: 7.9, categories: ['views', 'food'], hours: { kind: 'always' } },

  // --- Deliberately out of reach for a short central day ---
  // Elephanta is on an island: the real journey is an hour each way by ferry plus
  // waiting. Phase 1's straight-line estimate happily "drives" across the harbour
  // and puts it 36 minutes away, which is nonsense. Routed times in Phase 2 fix it.
  { id: 35, name: 'Elephanta Caves', location: { lng: 72.9315, lat: 18.9633 }, visitDurationMin: 240, popularity: 8.6, categories: ['history'], hours: dailyWindowExcept(hm(9), hm(17), [MON]) },
  { id: 36, name: 'Sanjay Gandhi National Park', location: { lng: 72.9106, lat: 19.2147 }, visitDurationMin: 180, popularity: 7.8, categories: ['parks', 'family'], hours: dailyWindowExcept(hm(7, 30), hm(18), [MON]) },
  { id: 37, name: 'Global Vipassana Pagoda', location: { lng: 72.8100, lat: 19.2330 }, visitDurationMin: 90, popularity: 7.4, categories: ['religious'], hours: dailyWindow(hm(9), hm(18)) },
];
