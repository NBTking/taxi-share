import { getDirections } from '@/lib/directions';
import { buildRideEvents, settleFare } from '@/lib/fare';
import { eventsToDirectionsRequest } from '@/lib/matching';
import type { CreateRoomResponse } from '@/lib/rooms';
import { createClient } from '@/lib/supabase/server';
import { DEFAULT_FARE_POLICY, type LatLng, type Rider } from '@/lib/types';
import { addressOr, parseLatLng, positiveNumber, requireText } from '@/lib/validate';

/**
 * POST /api/rooms — 방을 만든다.
 *
 * body:
 *   {
 *     "hostId": "<profiles.id>", "nickname": "민서",
 *     "origin":      { "lat": .., "lng": .. }, "originAddress": "정문",
 *     "destination": { "lat": .., "lng": .. }, "destinationAddress": "강남역",
 *     "departAt": "2026-09-12T20:00:00+09:00",
 *     "capacity": 4                                   // 선택
 *   }
 *
 * 만들 때 경로를 미리 계산해 total_distance_m / total_fare 에 넣어둔다.
 * 이 값이 있으면 나중에 다른 사람이 매칭할 때 기준 경로를 다시 조회하지 않아도 되어
 * 후보 한 건당 길찾기 호출이 2회에서 1회로 준다.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const parsed = parseInput(body);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  // --- 혼자 갔을 때의 경로. 방의 기준 경로이자 호스트의 solo_fare 가 된다 ---
  let route;
  try {
    route = await getDirections({ origin: parsed.origin, destination: parsed.destination });
  } catch (e) {
    console.error('[rooms] directions', e);
    return Response.json({ error: '경로를 계산하지 못했습니다' }, { status: 502 });
  }

  const totalFare = route.taxiFare + route.tollFare;

  // 혼자여도 정산을 돌려 fare_segments 를 남긴다.
  // 방 상세 화면이 "참가자가 1명일 때"를 따로 처리하지 않아도 되게 하기 위함이다.
  const host: Rider = {
    id: parsed.hostId,
    nickname: parsed.nickname,
    pickup: parsed.origin,
    dropoff: parsed.destination,
    soloFare: totalFare,
  };
  const events = buildRideEvents([host], parsed.destination);
  const settlement = settleFare({
    totalFare,
    baseFare: parsed.baseFare,
    tollFare: route.tollFare,
    legs: route.legs,
    events,
    riders: [host],
    hostId: host.id,
  });

  const supabase = await createClient();

  const { data: created, error: roomError } = await supabase
    .from('rooms')
    .insert({
      host_id: parsed.hostId,
      origin_lat: parsed.origin.lat,
      origin_lng: parsed.origin.lng,
      origin_address: parsed.originAddress,
      dest_lat: parsed.destination.lat,
      dest_lng: parsed.destination.lng,
      dest_address: parsed.destinationAddress,
      depart_at: parsed.departAt,
      capacity: parsed.capacity,
      status: 'open',
      base_fare: parsed.baseFare,
      total_distance_m: route.distanceM,
      total_fare: totalFare,
    })
    .select('id')
    .single();

  if (roomError || !created) {
    console.error('[rooms] insert room', roomError);
    // 존재하지 않는 hostId 면 외래키에서 걸린다
    const isFk = roomError?.code === '23503';
    return Response.json(
      { error: isFk ? '사용자 정보를 찾을 수 없습니다' : '방을 만들지 못했습니다' },
      { status: isFk ? 400 : 500 },
    );
  }

  const roomId = created.id as string;

  const { error: memberError } = await supabase.from('room_members').insert({
    room_id: roomId,
    user_id: parsed.hostId,
    pickup_lat: parsed.origin.lat,
    pickup_lng: parsed.origin.lng,
    pickup_address: parsed.originAddress,
    dropoff_lat: parsed.destination.lat,
    dropoff_lng: parsed.destination.lng,
    dropoff_address: parsed.destinationAddress,
    pickup_order: 1,
    dropoff_order: 1,
    solo_fare: totalFare,
    final_fare: settlement.shares[0]?.finalFare ?? totalFare,
    is_host: true,
  });

  if (memberError) {
    // 방만 남으면 참가자 0명인 유령 방이 되어 매칭 목록을 더럽힌다
    console.error('[rooms] insert member', memberError);
    await supabase.from('rooms').delete().eq('id', roomId);
    return Response.json({ error: '방을 만들지 못했습니다' }, { status: 500 });
  }

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

  const response: CreateRoomResponse = {
    roomId,
    totalDistanceM: route.distanceM,
    totalDurationS: route.durationS,
    totalFare,
    settlement,
  };
  return Response.json(response, { status: 201 });
}

type ParsedInput = {
  hostId: string;
  nickname: string;
  origin: LatLng;
  originAddress: string;
  destination: LatLng;
  destinationAddress: string;
  departAt: string;
  capacity: number;
  baseFare: number;
};

function parseInput(body: unknown): ParsedInput | { error: string } {
  const input = body as Record<string, unknown>;

  const hostId = requireText(input?.hostId, 'hostId');
  if (typeof hostId !== 'string') return hostId;
  const nickname = requireText(input.nickname, 'nickname');
  if (typeof nickname !== 'string') return nickname;

  const origin = parseLatLng(input.origin, 'origin');
  if (typeof origin === 'string') return { error: origin };
  const destination = parseLatLng(input.destination, 'destination');
  if (typeof destination === 'string') return { error: destination };

  if (typeof input.departAt !== 'string' || Number.isNaN(new Date(input.departAt).getTime())) {
    return { error: 'departAt 이 올바른 날짜 문자열이 아닙니다' };
  }

  const capacity = Math.round(positiveNumber(input.capacity, 4));
  if (capacity < 2 || capacity > 4) {
    return { error: '정원은 2~4명이어야 합니다' };
  }

  return {
    hostId,
    nickname,
    origin,
    originAddress: addressOr(input.originAddress, origin),
    destination,
    destinationAddress: addressOr(input.destinationAddress, destination),
    departAt: new Date(input.departAt).toISOString(),
    capacity,
    baseFare: positiveNumber(input.baseFare, DEFAULT_FARE_POLICY.baseFare),
  };
}
