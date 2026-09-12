import type { LatLng, FarePolicy } from './types';

/** 지구 반지름(m) */
const EARTH_RADIUS_M = 6_371_000;

/** 위도 1도 ≈ 111.32km (경도는 위도에 따라 줄어든다) */
const METERS_PER_DEG_LAT = 111_320;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * 두 좌표 사이의 직선(대권) 거리(m).
 *
 * 카카오 길찾기를 부르지 않고 공짜로 쓸 수 있다는 것이 존재 이유다.
 * 매칭 1차 필터에서 후보를 걸러내 길찾기 API 호출 수를 줄이는 데 쓴다.
 */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 직선거리 → 실제 도로거리 보정 계수. 도심 기준 경험값. */
export const ROAD_DETOUR_FACTOR = 1.3;

/**
 * 길찾기 API 없이 도로 거리를 어림잡는다.
 * 카카오 쿼터가 소진됐을 때의 폴백 경로에서만 쓸 것.
 */
export function estimateRoadDistanceM(a: LatLng, b: LatLng): number {
  return Math.round(haversineM(a, b) * ROAD_DETOUR_FACTOR);
}

/**
 * 거리로 택시요금을 추정한다(원).
 * 역시 폴백 전용 — 평소에는 카카오가 주는 summary.fare.taxi 를 쓴다.
 */
export function estimateFare(distanceM: number, policy: FarePolicy): number {
  const km = distanceM / 1000;
  const raw = policy.baseFare + km * policy.perKmFare;
  return Math.round(raw * (1 + policy.nightSurchargeRate));
}

export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

/**
 * 중심점에서 반경 radiusM 를 덮는 사각 범위.
 *
 * Supabase 쿼리에서 `lat >= minLat and lat <= maxLat ...` 형태로 쓴다.
 * 원이 아니라 사각형이라 약간 넓게 잡히는데, 어차피 뒤에서
 * haversine 으로 정확히 다시 거르므로 문제되지 않는다.
 */
export function boundingBox(center: LatLng, radiusM: number): BoundingBox {
  const latDelta = radiusM / METERS_PER_DEG_LAT;
  // 경도 간격은 위도가 높아질수록 좁아진다. cos 이 0 에 수렴하는 극지방 방어.
  const lngDelta =
    radiusM / (METERS_PER_DEG_LAT * Math.max(0.01, Math.cos(toRad(center.lat))));

  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLng: center.lng - lngDelta,
    maxLng: center.lng + lngDelta,
  };
}

/** a 가 b 로부터 radiusM 이내인가 */
export function isWithinRadius(a: LatLng, b: LatLng, radiusM: number): boolean {
  return haversineM(a, b) <= radiusM;
}

/**
 * 점 p 에서 선분 a-b 까지의 최단거리(m).
 *
 * 매칭 1차 필터의 핵심이다.
 * "출발지가 가까운 사람"만 찾으면 이 서비스의 절반(경로 중간 픽업)이 통째로 날아간다.
 * 방의 출발→도착 직선을 하나의 회랑(corridor)으로 보고, 그 회랑에서
 * 얼마나 벗어나 있는지를 재야 "가는 길에 태울 수 있는 사람"이 걸린다.
 *
 * 도시 규모에서는 등장방형(equirectangular) 근사로 충분하다.
 */
export function pointToSegmentDistanceM(p: LatLng, a: LatLng, b: LatLng): number {
  // a 를 원점으로 하는 로컬 평면(m)으로 투영
  const scaleLng = METERS_PER_DEG_LAT * Math.cos(toRad(a.lat));
  const toXY = (q: LatLng) => ({
    x: (q.lng - a.lng) * scaleLng,
    y: (q.lat - a.lat) * METERS_PER_DEG_LAT,
  });

  const P = toXY(p);
  const B = toXY(b);

  const lenSq = B.x * B.x + B.y * B.y;
  if (lenSq === 0) return Math.hypot(P.x, P.y); // 출발지 == 도착지

  // 선분 위로의 정사영 위치를 [0,1] 로 클램프 → 선분 밖이면 끝점까지의 거리
  const t = Math.max(0, Math.min(1, (P.x * B.x + P.y * B.y) / lenSq));
  return Math.hypot(P.x - B.x * t, P.y - B.y * t);
}

/**
 * 카카오 길찾기 API 좌표 포맷: "경도,위도" (x,y 순서)
 * lat/lng 순서를 뒤집는 실수가 잦아 변환을 한 곳으로 모아둔다.
 */
export function toKakaoCoord(p: LatLng): string {
  return `${p.lng},${p.lat}`;
}
