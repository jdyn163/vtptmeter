// lib/rooms.ts
// Manages room lists for vtpt (hardcoded now, editable later)

export type RoomsByHouse = Record<string, string[]>;

const STORAGE_KEY = "vtpt_rooms_v1";

/**
 * Helper to generate rooms like:
 * makeRooms("A1", 3) -> ["A1-01", "A1-02", "A1-03"]
 */
function makeRooms(house: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const num = String(i + 1).padStart(2, "0");
    return `${house}-${num}`;
  });
}

/**
 * Default room structure (your real layout)
 */
export const DEFAULT_ROOMS: RoomsByHouse = {
  A0: makeRooms("A0", 6),
  A1: makeRooms("A1", 12),
  A2: makeRooms("A2", 5),
  A3: makeRooms("A3", 13),
  A4: makeRooms("A4", 9),
  A5: makeRooms("A5", 14),
  A6: makeRooms("A6", 14),
};

/**
 * Get rooms:
 * - If user has edited rooms before → load from localStorage
 * - Otherwise → use DEFAULT_ROOMS
 */
export function getRoomsByHouse(): RoomsByHouse {
  if (typeof window === "undefined") {
    return DEFAULT_ROOMS;
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return DEFAULT_ROOMS;
  }

  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // ignore corrupted data
  }

  return DEFAULT_ROOMS;
}

/**
 * Save rooms to localStorage
 * (used later when you add "Manage Rooms" screen)
 */
export function saveRoomsByHouse(data: RoomsByHouse) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
