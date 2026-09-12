import { buildRideEvents, settleFare } from './fare';
import { haversineM, pointToSegmentDistanceM } from './geo';
import type { DirectionsRequest, DirectionsResult } from './directions';
import type { LatLng, RideEvent, Rider, RiderId, Settlement } from './types';

/**
 * 동승 매칭.
 *
 * 3단 필터로 카카오 길찾기 호출 수를 억제하는 것이 설계의 전부다.
 *   1차 (공짜)  시간창 + 회랑 + 진행방향   → 후보를 maxCandidates 개로 압축
 *   2차 (유료)  후보마다 길찾기 1~2회      → 실제 우회율 판정
 *   3차 (공짜)  통과분만 가상 정산         → 내 부담금 / 절약액
 *
 * 1차를 건너뛰고 모든 방에 길찾기를 돌리면 무료 쿼터가 순식간에 증발한다.
 */

export const MATCH_DEFAULTS = {
  /** 출발 희망시각 허용 오차(분) */
  timeWindowMin: 10,
  /** 방의 출발→도착 직선에서 벗어나도 되는 최대 거리(m) */
  corridorM: 2000,
  /** 2차로 넘길 후보 최대 개수. 곧 길찾기 호출 상한이다. */
  maxCandidates: 5,
  /** 우회 허용 비율 */
  detourTolerance: 0.3,
} as const;

export type RoomCandidate = {
  id: string;
  hostId: RiderId;
  /** 택시 출발점 */
  origin: LatLng;
  /** 택시 최종 도착점 */
  destination: LatLng;
  /** ISO 문자열 */
  departAt: string;
  capacity: number;
  detourTolerance: number;
  baseFare: number;
  /** 이미 합류한 사람들 */
  members: Rider[];
  /**
   * 현재 확정 경로의 거리(m). rooms.total_distance_m 에 저장해 두면
   * 후보마다 기준 경로를 다시 조회하지 않아도 되어 길찾기 호출이 절반으로 준다.
   */
  currentDistanceM?: number;
  currentDurationS?: number;
};

export type MatchQuery = {
  /** 합류하려는 사람 */
  rider: Rider;
  departAt: string;
  timeWindowMin?: number;
  corridorM?: number;
  maxCandidates?: number;
};

export type RejectReason =
  | 'capacity'
  | 'time_window'
  | 'corridor'
  | 'wrong_direction'
  | 'detour'
  | 'directions_failed';

export const REJECT_MESSAGES: Record<RejectReason, string> = {
  capacity: '정원이 찼습니다',
  time_window: '출발 시간이 맞지 않습니다',
  corridor: '경로에서 너무 멀리 떨어져 있습니다',
  wrong_direction: '이동 방향이 반대입니다',
  detour: '우회가 너무 큽니다',
  directions_failed: '경로를 계산하지 못했습니다',
};

export type MatchResult = {
  roomId: string;
  accepted: boolean;
  reason?: RejectReason;
  /** 나를 태우느라 늘어난 거리(m) */
  detourM: number;
  /** detourM / 기존 경로 거리 */
  detourRatio: number;
  /** 늘어난 소요시간(초). 카드에 "+N분"으로 표시 */
  extraDurationS: number;
  /** 택시 전체 운행 시간(초) */
  totalDurationS: number;
  /**
   * 내가 실제로 타고 있는 시간(초).
   * 중간에 타거나 먼저 내리면 전체 운행 시간보다 짧다.
   * 합류 여부를 정할 때 금액 다음으로 중요한 정보다.
   */
  myRideDurationS: number;
  /** 합류했을 때 내 부담금(원) */
  myFare: number;
  soloFare?: number;
  savedFare?: number;
  savedRate?: number;
  /** 합류 후 전체 정산 미리보기. 방 상세 화면이 그대로 렌더링한다. */
  settlement?: Settlement;
  /** 확정 시 이 사람의 승차 순번 */
  pickupOrder?: number;
};

/**
 * POST /api/match 의 응답 형태.
 *
 * 화면 담당자가 API 완성을 기다리지 않고 작업할 수 있도록 계약을 타입으로 고정해 둔다.
 */
export type MatchResponse = {
  /** 혼자 탔을 때 요금(원). 계산에 실패하면 null */
  soloFare: number | null;
  /** 1차 필터 전, DB 에서 읽어온 방 개수 */
  scanned: number;
  matches: MatchResult[];
};

type PrefilterHit = {
  room: RoomCandidate;
  /** 방 경로에서 내 승차지점이 벗어난 거리(m) */
  pickupOffsetM: number;
  dropoffOffsetM: number;
};

/**
 * 1차 필터. **길찾기 API 를 호출하지 않는다.**
 *
 * 주의할 점은 "출발지가 가까운 방"만 고르면 안 된다는 것이다.
 * 이 서비스의 절반은 '가는 길에 픽업'이므로, 출발지 반경이 아니라
 * 방의 출발→도착 직선(회랑)까지의 거리로 걸러야 한다.
 */
export function prefilterRooms(rooms: RoomCandidate[], query: MatchQuery): PrefilterHit[] {
  const timeWindowMs = (query.timeWindowMin ?? MATCH_DEFAULTS.timeWindowMin) * 60_000;
  const corridorM = query.corridorM ?? MATCH_DEFAULTS.corridorM;
  const maxCandidates = query.maxCandidates ?? MATCH_DEFAULTS.maxCandidates;
  const wantAt = new Date(query.departAt).getTime();
  const { pickup, dropoff } = query.rider;

  const hits: PrefilterHit[] = [];

  for (const room of rooms) {
    if (room.members.length >= room.capacity) continue;
    // 이미 들어가 있는 방은 후보에서 뺀다
    if (room.members.some((m) => m.id === query.rider.id)) continue;

    const roomAt = new Date(room.departAt).getTime();
    if (!Number.isFinite(roomAt) || Math.abs(roomAt - wantAt) > timeWindowMs) continue;

    const pickupOffsetM = pointToSegmentDistanceM(pickup, room.origin, room.destination);
    if (pickupOffsetM > corridorM) continue;

    const dropoffOffsetM = pointToSegmentDistanceM(dropoff, room.origin, room.destination);
    if (dropoffOffsetM > corridorM) continue;

    // 내 하차지점이 내 승차지점보다 방의 목적지에 가까워야 한다.
    // 아니면 택시가 왔던 길을 되돌아가야 한다는 뜻이다.
    if (haversineM(dropoff, room.destination) >= haversineM(pickup, room.destination)) continue;

    hits.push({ room, pickupOffsetM, dropoffOffsetM });
  }

  // 회랑에서 덜 벗어난 방이 우회도 적을 가능성이 높다 → 그쪽부터 길찾기를 쓴다
  hits.sort((a, b) => a.pickupOffsetM + a.dropoffOffsetM - (b.pickupOffsetM + b.dropoffOffsetM));
  return hits.slice(0, maxCandidates);
}

export type MatchDeps = {
  getDirections: (req: DirectionsRequest) => Promise<DirectionsResult>;
};

/**
 * 2차 + 3차. 후보마다 실제 경로를 조회해 우회율을 재고, 통과분은 가상 정산까지 한다.
 *
 * 한 방의 길찾기가 실패해도 나머지 후보는 살려야 하므로 방별로 예외를 가둔다.
 */
export async function findMatches(
  query: MatchQuery,
  rooms: RoomCandidate[],
  deps: MatchDeps,
): Promise<MatchResult[]> {
  const hits = prefilterRooms(rooms, query);

  const results = await Promise.all(
    hits.map(({ room }) => evaluateRoom(query, room, deps)),
  );

  // 절약액이 큰 방을 위로. 절약액을 모르면 부담금이 적은 쪽을 위로.
  return results.sort((a, b) => {
    if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
    if (a.savedFare !== undefined && b.savedFare !== undefined) {
      return b.savedFare - a.savedFare;
    }
    return a.myFare - b.myFare;
  });
}

async function evaluateRoom(
  query: MatchQuery,
  room: RoomCandidate,
  deps: MatchDeps,
): Promise<MatchResult> {
  const base: MatchResult = {
    roomId: room.id,
    accepted: false,
    detourM: 0,
    detourRatio: 0,
    extraDurationS: 0,
    totalDurationS: 0,
    myRideDurationS: 0,
    myFare: 0,
  };

  try {
    // --- 기준 경로: 내가 합류하기 전 ---
    let baseDistanceM = room.currentDistanceM;
    let baseDurationS = room.currentDurationS;
    if (baseDistanceM === undefined || baseDurationS === undefined) {
      const before = await deps.getDirections(toDirectionsRequest(room.members, room.origin));
      baseDistanceM = before.distanceM;
      baseDurationS = before.durationS;
    }

    // --- 합류 후 경로 ---
    const riders = [...room.members, query.rider];
    const events = buildRideEvents(riders, finalDestinationOf(riders, room.origin));
    const after = await deps.getDirections(toDirectionsRequest(riders, room.origin, events));

    const detourM = after.distanceM - baseDistanceM;
    const detourRatio = baseDistanceM > 0 ? detourM / baseDistanceM : 0;
    const extraDurationS = after.durationS - baseDurationS;

    if (detourRatio > room.detourTolerance) {
      return { ...base, reason: 'detour', detourM, detourRatio, extraDurationS };
    }

    // --- 3차: 가상 정산 ---
    const settlement = settleFare({
      totalFare: after.taxiFare + after.tollFare,
      baseFare: room.baseFare,
      tollFare: after.tollFare,
      legs: after.legs,
      events,
      riders,
      hostId: room.hostId,
    });

    const mine = settlement.shares.find((s) => s.riderId === query.rider.id);
    const pickupOrder =
      events.filter((e) => e.type === 'pickup').findIndex((e) => e.riderId === query.rider.id) + 1;

    return {
      roomId: room.id,
      accepted: true,
      detourM,
      detourRatio,
      extraDurationS,
      totalDurationS: after.durationS,
      myRideDurationS: mine?.rideDurationS ?? after.durationS,
      myFare: mine?.finalFare ?? 0,
      soloFare: mine?.soloFare,
      savedFare: mine?.savedFare,
      savedRate: mine?.savedRate,
      settlement,
      pickupOrder,
    };
  } catch {
    return { ...base, reason: 'directions_failed' };
  }
}

/**
 * 최종 목적지를 고른다.
 *
 * "방의 도착지"를 그대로 쓰면 안 된다. 새로 합류한 사람의 목적지가
 * 기존 도착지보다 더 멀 수 있고, 그 경우 그 사람이 마지막에 내려야 한다.
 */
export function finalDestinationOf(riders: Rider[], origin: LatLng): LatLng {
  return riders.reduce(
    (farthest, r) =>
      haversineM(r.dropoff, origin) > haversineM(farthest.dropoff, origin) ? r : farthest,
    riders[0],
  ).dropoff;
}

/** 승하차 이벤트 순서 → 카카오 길찾기 요청(출발 / 경유지 / 도착). */
export function eventsToDirectionsRequest(events: RideEvent[]): DirectionsRequest {
  return {
    origin: events[0].point,
    destination: events[events.length - 1].point,
    waypoints: events.slice(1, -1).map((e) => e.point),
  };
}

/** riders 로부터 이벤트를 만들어 길찾기 요청으로 변환한다. */
function toDirectionsRequest(
  riders: Rider[],
  origin: LatLng,
  prebuiltEvents?: RideEvent[],
): DirectionsRequest {
  const events = prebuiltEvents ?? buildRideEvents(riders, finalDestinationOf(riders, origin));
  return eventsToDirectionsRequest(events);
}
