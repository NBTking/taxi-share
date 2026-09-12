import { getDirections } from '@/lib/directions';
import { buildRideEvents, settleFare } from '@/lib/fare';
import { eventsToDirectionsRequest, finalDestinationOf } from '@/lib/matching';
import { ROOM_SELECT, toRoomCandidate, type JoinResponse, type RoomRow } from '@/lib/rooms';
import { createClient } from '@/lib/supabase/server';
import type { LatLng, Rider } from '@/lib/types';

/**
 * POST /api/rooms/[id]/join — 방에 합류한다.
 *
 * body:
 *   {
 *     "riderId": "<profiles.id>",
 *     "nickname": "지훈",
 *     "pickup":  { "lat": .., "lng": .. },
 *     "dropoff": { "lat": .., "lng": .. }
 *   }
 *
 * 합류는 단순히 참가자 한 줄을 넣는 일이 아니다. 사람이 늘면 경로가 바뀌고,
 * 경로가 바뀌면 모든 사람의 부담금이 바뀐다. 그래서 여기서 전부 다시 계산해
 * 저장한다 — 승하차 순서, 방 전체 거리/요금, 구간별 정산 근거, 각자의 최종 부담금.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/rooms/[id]/join'>) {
  const { id: roomId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const parsed = parseRider(body);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const rider = parsed.rider;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_SELECT)
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    console.error('[join] supabase', error);
    return Response.json({ error: '방을 불러오지 못했습니다' }, { status: 500 });
  }
  if (!data) return Response.json({ error: '방을 찾을 수 없습니다' }, { status: 404 });

  const row = data as unknown as RoomRow;
  const room = toRoomCandidate(row);

  if (row.status !== 'open') {
    return Response.json({ error: '모집이 끝난 방입니다' }, { status: 409 });
  }
  if (room.members.some((m) => m.id === rider.id)) {
    return Response.json({ error: '이미 이 방에 참여 중입니다' }, { status: 409 });
  }
  if (room.members.length >= room.capacity) {
    return Response.json({ error: '정원이 찼습니다' }, { status: 409 });
  }

  // --- 합류 후 경로와 정산을 다시 계산 ---
  const riders: Rider[] = [...room.members, rider];
  const events = buildRideEvents(riders, finalDestinationOf(riders, room.origin));

  let route;
  try {
    route = await getDirections(eventsToDirectionsRequest(events));
  } catch (e) {
    console.error('[join] directions', e);
    return Response.json({ error: '경로를 계산하지 못했습니다' }, { status: 502 });
  }

  // 매칭 화면에서 통과했더라도 그 사이 다른 사람이 합류했을 수 있다. 여기서 다시 본다.
  const baseDistanceM = row.total_distance_m;
  if (baseDistanceM && baseDistanceM > 0) {
    const detourRatio = (route.distanceM - baseDistanceM) / baseDistanceM;
    if (detourRatio > room.detourTolerance) {
      return Response.json(
        { error: '그 사이 경로가 바뀌어 우회가 너무 커졌습니다', detourRatio },
        { status: 422 },
      );
    }
  }

  // 절약액 표시에 쓸 "혼자 갔을 때" 요금. 실패해도 합류 자체는 막지 않는다.
  let soloFare: number | null = null;
  try {
    const solo = await getDirections({ origin: rider.pickup, destination: rider.dropoff });
    soloFare = solo.taxiFare + solo.tollFare;
  } catch {
    // 무시
  }

  const settlement = settleFare({
    totalFare: route.taxiFare + route.tollFare,
    baseFare: room.baseFare,
    tollFare: route.tollFare,
    legs: route.legs,
    events,
    riders: riders.map((r) => (r.id === rider.id ? { ...r, soloFare: soloFare ?? undefined } : r)),
    hostId: room.hostId,
  });

  const pickupOrders = orderMap(events, 'pickup');
  const dropoffOrders = orderMap(events, 'dropoff');

  // --- 저장 ---
  // Supabase REST 에는 트랜잭션이 없어 순차로 쓴다.
  // 참가자 행을 먼저 넣어야 동시 합류로 정원을 넘기는 창이 가장 짧아진다.
  const { error: insertError } = await supabase.from('room_members').insert({
    room_id: roomId,
    user_id: rider.id,
    pickup_lat: rider.pickup.lat,
    pickup_lng: rider.pickup.lng,
    pickup_address: parsed.pickupAddress,
    dropoff_lat: rider.dropoff.lat,
    dropoff_lng: rider.dropoff.lng,
    dropoff_address: parsed.dropoffAddress,
    pickup_order: pickupOrders.get(rider.id) ?? null,
    dropoff_order: dropoffOrders.get(rider.id) ?? null,
    solo_fare: soloFare,
    is_host: false,
  });
  if (insertError) {
    console.error('[join] insert member', insertError);
    return Response.json({ error: '합류에 실패했습니다' }, { status: 500 });
  }

  await supabase
    .from('rooms')
    .update({
      total_distance_m: route.distanceM,
      total_fare: route.taxiFare + route.tollFare,
      // 정원이 찼으면 더 받지 않는다
      status: riders.length >= room.capacity ? 'locked' : 'open',
    })
    .eq('id', roomId);

  // 사람이 늘면 기존 참가자의 순서와 부담금도 전부 바뀐다
  for (const share of settlement.shares) {
    await supabase
      .from('room_members')
      .update({
        pickup_order: pickupOrders.get(share.riderId) ?? null,
        dropoff_order: dropoffOrders.get(share.riderId) ?? null,
        final_fare: share.finalFare,
      })
      .eq('room_id', roomId)
      .eq('user_id', share.riderId);
  }

  // 정산 근거는 통째로 갈아끼운다
  await supabase.from('fare_segments').delete().eq('room_id', roomId);
  await supabase.from('fare_segments').insert(
    settlement.segments.map((seg) => ({
      room_id: roomId,
      seq: seg.seq,
      from_label: seg.fromLabel,
      to_label: seg.toLabel,
      distance_m: seg.distanceM,
      segment_fare: seg.segmentFare,
      rider_count: seg.riderCount,
      per_person_fare: seg.perPersonFare,
      rider_ids: seg.riderIds,
    })),
  );

  const body_: JoinResponse = {
    roomId,
    pickupOrder: pickupOrders.get(rider.id) ?? riders.length,
    myFare: settlement.shares.find((s) => s.riderId === rider.id)?.finalFare ?? 0,
    settlement,
  };
  return Response.json(body_);
}

/** 이벤트 순서에서 승차(또는 하차) 순번을 뽑는다. 1부터 시작. */
function orderMap(
  events: { riderId: string; type: 'pickup' | 'dropoff' }[],
  type: 'pickup' | 'dropoff',
): Map<string, number> {
  const map = new Map<string, number>();
  events
    .filter((e) => e.type === type)
    .forEach((e, i) => map.set(e.riderId, i + 1));
  return map;
}

type ParsedRider = { rider: Rider; pickupAddress: string; dropoffAddress: string };

function parseRider(body: unknown): ParsedRider | { error: string } {
  const input = body as Record<string, unknown>;

  if (typeof input?.riderId !== 'string' || input.riderId.length === 0) {
    return { error: 'riderId 가 없습니다' };
  }
  if (typeof input.nickname !== 'string' || input.nickname.length === 0) {
    return { error: 'nickname 이 없습니다' };
  }

  const pickup = parseLatLng(input.pickup, 'pickup');
  if (typeof pickup === 'string') return { error: pickup };
  const dropoff = parseLatLng(input.dropoff, 'dropoff');
  if (typeof dropoff === 'string') return { error: dropoff };

  const asText = (v: unknown, fallback: LatLng) =>
    typeof v === 'string' && v.length > 0
      ? v
      : `${fallback.lat.toFixed(4)}, ${fallback.lng.toFixed(4)}`;

  return {
    rider: { id: input.riderId, nickname: input.nickname, pickup, dropoff },
    pickupAddress: asText(input.pickupAddress, pickup),
    dropoffAddress: asText(input.dropoffAddress, dropoff),
  };
}

function parseLatLng(value: unknown, field: string): LatLng | string {
  if (typeof value !== 'object' || value === null) return `${field} 가 없거나 객체가 아닙니다`;
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return `${field}.lat 이 올바르지 않습니다`;
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return `${field}.lng 이 올바르지 않습니다`;
  }
  return { lat, lng };
}
