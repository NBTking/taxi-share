import { getDirections } from '@/lib/directions';
import { buildRideEvents, settleFare } from '@/lib/fare';
import { eventsToDirectionsRequest, finalDestinationOf } from '@/lib/matching';
import {
  ROOM_WITH_SEGMENTS_SELECT,
  settlementFromRows,
  toRoomCandidate,
  type RoomRow,
  type SettleResponse,
} from '@/lib/rooms';
import { createClient } from '@/lib/supabase/server';
import { requireText } from '@/lib/validate';

/**
 * POST /api/rooms/[id]/settle — 운행을 끝내고 요금을 확정한다.
 *
 * body: { "requesterId": "<profiles.id>" }   // 방장만 확정할 수 있다
 *
 * 확정의 의미는 "금액을 얼린다"는 것이다.
 * 카카오가 주는 택시요금은 실시간 교통 상황에 따라 달라져서, 같은 경로라도
 * 10분 뒤에 다시 부르면 금액이 바뀐다. 확정 뒤에는 절대 다시 계산하지 않고
 * 저장된 값을 그대로 돌려준다 — 안 그러면 "아까 본 금액과 다른데요?" 가 된다.
 */
export async function POST(request: Request, ctx: RouteContext<'/api/rooms/[id]/settle'>) {
  const { id: roomId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const requesterId = requireText((body as Record<string, unknown>)?.requesterId, 'requesterId');
  if (typeof requesterId !== 'string') {
    return Response.json({ error: requesterId.error }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_WITH_SEGMENTS_SELECT)
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    console.error('[settle] supabase', error);
    return Response.json({ error: '방을 불러오지 못했습니다' }, { status: 500 });
  }
  if (!data) return Response.json({ error: '방을 찾을 수 없습니다' }, { status: 404 });

  const row = data as unknown as RoomRow;

  if (row.host_id !== requesterId) {
    return Response.json({ error: '방장만 정산을 확정할 수 있습니다' }, { status: 403 });
  }
  if (row.status === 'cancelled') {
    return Response.json({ error: '취소된 방입니다' }, { status: 409 });
  }

  // --- 이미 확정된 방: 저장된 값을 그대로 (재계산 금지) ---
  if (row.status === 'completed') {
    const stored = settlementFromRows(row);
    const already: SettleResponse = {
      roomId,
      status: 'completed',
      alreadySettled: true,
      totalDistanceM: row.total_distance_m ?? 0,
      totalFare: row.total_fare ?? 0,
      ...stored,
    };
    return Response.json(already);
  }

  // --- 최종 경로로 마지막 계산 ---
  const room = toRoomCandidate(row);
  if (room.members.length === 0) {
    return Response.json({ error: '참가자가 없는 방입니다' }, { status: 409 });
  }

  const events = buildRideEvents(room.members, finalDestinationOf(room.members, room.origin));

  let route;
  try {
    route = await getDirections(eventsToDirectionsRequest(events));
  } catch (e) {
    console.error('[settle] directions', e);
    return Response.json({ error: '최종 경로를 계산하지 못했습니다' }, { status: 502 });
  }

  const totalFare = route.taxiFare + route.tollFare;
  const settlement = settleFare({
    totalFare,
    baseFare: room.baseFare,
    tollFare: route.tollFare,
    legs: route.legs,
    events,
    riders: room.members,
    hostId: room.hostId,
  });

  // --- 저장 ---
  await supabase
    .from('rooms')
    .update({
      status: 'completed',
      total_distance_m: route.distanceM,
      total_fare: totalFare,
    })
    .eq('id', roomId);

  for (const share of settlement.shares) {
    await supabase
      .from('room_members')
      .update({ final_fare: share.finalFare })
      .eq('room_id', roomId)
      .eq('user_id', share.riderId);
  }

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

  const response: SettleResponse = {
    roomId,
    status: 'completed',
    alreadySettled: false,
    totalDistanceM: route.distanceM,
    totalFare,
    segments: settlement.segments,
    shares: settlement.shares,
  };
  return Response.json(response);
}
