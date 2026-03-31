// constants.ts
// Shared frontend constants — avoids magic numbers scattered across components.

// React Query stale times (milliseconds)
export const STALE_TIME_DEFAULT = 5 * 60 * 1000;  // 5 min — used by most queries
export const STALE_TIME_STATIC  = 60 * 1000;       // 1 min — rarely-changing data (item names)

// UI feedback durations
export const FEEDBACK_TIMEOUT_MS = 2000;  // "Saved!" / "Copied!" flash duration

// Popover hover behaviour
export const POPOVER_OPEN_DELAY_MS  = 200;  // delay before opening on hover
export const POPOVER_CLOSE_DELAY_MS = 100;  // delay before closing (prevents flicker)
export const POPOVER_MIN_SPACE_PX   = 300;  // min space below trigger before flipping up
export const POPOVER_GAP_PX         = 4;    // gap between trigger and popover edge
