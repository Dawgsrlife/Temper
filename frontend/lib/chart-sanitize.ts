export interface IndexedChartPoint {
  index: number;
  time: number;
  value: number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Lightweight Charts requires strictly increasing time values.
 * This utility filters invalid points, sorts by time, and nudges
 * duplicate/non-increasing timestamps by +1s to preserve stability.
 */
export function sanitizeIndexedChartPoints(
  points: IndexedChartPoint[],
): IndexedChartPoint[] {
  const valid = points
    .filter(
      (point) =>
        isFiniteNumber(point.index) &&
        isFiniteNumber(point.time) &&
        isFiniteNumber(point.value),
    )
    .map((point) => ({
      index: Math.trunc(point.index),
      time: Math.trunc(point.time),
      value: point.value,
    }))
    .sort((a, b) => (a.time === b.time ? a.index - b.index : a.time - b.time));

  if (valid.length === 0) return [];

  const normalized: IndexedChartPoint[] = [];
  let lastTime = Number.NEGATIVE_INFINITY;
  for (const point of valid) {
    const nextTime = point.time <= lastTime ? lastTime + 1 : point.time;
    normalized.push({ ...point, time: nextTime });
    lastTime = nextTime;
  }
  return normalized;
}

