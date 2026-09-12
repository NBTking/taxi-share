import type { RoomCandidate } from './matching';
import type { Settlement } from './types';

/**
 * 방 조회/변환 공용 코드.
 *
 * /api/match 와 /api/rooms/[id]/join 이 같은 형태의 방 데이터를 필요로 하므로
 * 쿼리 문자열과 변환 로직을 한곳에 둔다. 여기가 갈라지면 매칭에서 본 금액과
 * 합류 후 금액이 달라지는 사고가 난다.
 */

/** rooms 를 읽을 때 쓰는 공통 select. 컬럼을 추가하면 두 API 에 같이 반영된다. */
export const ROOM_SELECT = `id, host_id, origin_lat, origin_lng, origin_address,
   dest_lat, dest_lng, dest_address, depart_at, status,
   capacity, detour_tolerance, base_fare, total_distance_m, total_fare,
   room_members ( id, user_id, pickup_lat, pickup_lng, pickup_address,
                  dropoff_lat, dropoff_lng, dropoff_address,
                  pickup_order, solo_fare, is_host, profiles ( nickname ) )`;

export type RoomMemberRow = {
  id: string;
  user_id: string;
  pickup_lat: number;
  pickup_lng: number;
  pickup_address: string;
  dropoff_lat: number;
  dropoff_lng: number;
  dropoff_address: string;
  pickup_order: number | null;
  solo_fare: number | null;
  is_host: boolean;
  /** PostgREST 임베드. 실제로는 객체지만 타입 추론상 배열로 잡힌다. */
  profiles: { nickname: string } | { nickname: string }[] | null;
};

export type RoomRow = {
  id: string;
  host_id: string;
  origin_lat: number;
  origin_lng: number;
  origin_address: string;
  dest_lat: number;
  dest_lng: number;
  dest_address: string;
  depart_at: string;
  status: string;
  capacity: number;
  detour_tolerance: number;
  base_fare: number;
  total_distance_m: number | null;
  total_fare: number | null;
  room_members: RoomMemberRow[];
};

export function nicknameOf(profiles: RoomMemberRow['profiles']): string {
  if (!profiles) return '익명';
  const p = Array.isArray(profiles) ? profiles[0] : profiles;
  return p?.nickname ?? '익명';
}

/** Supabase 행(스네이크 케이스) → matching/fare 가 쓰는 형태 */
export function toRoomCandidate(row: RoomRow): RoomCandidate {
  return {
    id: row.id,
    hostId: row.host_id,
    origin: { lat: row.origin_lat, lng: row.origin_lng },
    destination: { lat: row.dest_lat, lng: row.dest_lng },
    departAt: row.depart_at,
    capacity: row.capacity,
    detourTolerance: row.detour_tolerance,
    baseFare: row.base_fare,
    currentDistanceM: row.total_distance_m ?? undefined,
    members: (row.room_members ?? []).map((m) => ({
      id: m.user_id,
      nickname: nicknameOf(m.profiles),
      pickup: { lat: m.pickup_lat, lng: m.pickup_lng },
      dropoff: { lat: m.dropoff_lat, lng: m.dropoff_lng },
      soloFare: m.solo_fare ?? undefined,
    })),
  };
}

/** POST /api/rooms/[id]/join 의 응답 계약 */
export type JoinResponse = {
  roomId: string;
  /** 내 승차 순번 (1부터) */
  pickupOrder: number;
  /** 내 최종 부담금(원) */
  myFare: number;
  /** 합류 후 방 전체 정산. 방 상세 화면이 그대로 렌더링한다. */
  settlement: Settlement;
};
