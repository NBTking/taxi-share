import { getDirections } from '@/lib/directions';
import { buildRideEvents, settleFare } from '@/lib/fare';
import { eventsToDirectionsRequest, finalDestinationOf } from '@/lib/matching';
import {
  ROOM_SELECT,
  toRoomCandidate,
  type LeaveResponse,
  type RoomRow,
} from '@/lib/rooms';
import { createClient } from '@/lib/supabase/server';
import { requireText } from '@/lib/validate';

/**
 * POST /api/rooms/[id]/leave — 방에서 나간다.
 *
 * body: { "riderId": "<profiles.id>" }
 *
 * 합류의 역연산이다. 사람이 줄면 경로가 짧아지고, 남은 사람들의 부담금이
 * 전부 달라진다. 나가는 사람만 지우고 끝내면 다른 사람들에게 예전 금액이
 * 그대로 남아 "왜 아직 3명 기준이죠?" 가 된다.
 *
 * 두 가지 특수한 경우를 처리한다.
 *   - 방장이 나가면: 먼저 합류한 사람에게 방장을 넘긴다
 *   - 마지막 한 명이 나가면: 방을 cancelled 로 닫는다
 */
export async function POST(request: Request, ctx: RouteContext<'/api/rooms/[id]/leave'>) {
  const { id: roomId } = await ctx.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const riderId = requireText((body as Record<string, unknown>)?.riderId, 'riderId');
  if (typeof riderId !== 'string') {
    return Response.json({ error: riderId.error }, { status: 400 });
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_SELECT)
    .eq('id', roomId)
    .maybeSingle();

  if (error) {
    console.error('[leave] supabase', error);
    return Response.json({ error: '방을 불러오지 못했습니다' }, { status: 500 });
  }
  if (!data) {
    // 방이 이미 사라진 경우(데모 데이터 재생성, 지난 방 정리 등).
    // 사용자가 할 수 있는 게 없는데 에러를 띄우면 화면에 갇힌다.
    // 남아있을 수 있는 참가 기록만 정리하고 "나간 것" 으로 처리한다.
    await supabase.from('room_members').delete().eq('room_id', roomId).eq('user_id', riderId);
    const gone: LeaveResponse = { roomId, remaining: 0, status: 'cancelled' };
    return Response.json(gone);
  }

  const row = data as unknown as RoomRow;

  if (row.status === 'completed') {
    return Response.json({ error: '정산이 끝난 방은 나갈 수 없습니다' }, { status: 409 });
  }
  if (row.status === 'cancelled') {
    return Response.json({ error: '이미 취소된 방입니다' }, { status: 409 });
  }

  const leavingRow = row.room_members.find((m) => m.user_id === riderId);
  if (!leavingRow) {
    return Response.json({ error: '이 방의 참가자가 아닙니다' }, { status: 409 });
  }

  // --- 참가자 제거 ---
  const { error: deleteError } = await supabase
    .from('room_members')
    .delete()
    .eq('room_id', roomId)
    .eq('user_id', riderId);

  if (deleteError) {
    console.error('[leave] delete member', deleteError);
    return Response.json({ error: '나가기에 실패했습니다' }, { status: 500 });
  }

  const room = toRoomCandidate(row);
  const remaining = room.members.filter((m) => m.id !== riderId);

  // --- 아무도 안 남으면 방을 닫는다 ---
  if (remaining.length === 0) {
    await supabase.from('fare_segments').delete().eq('room_id', roomId);
    await supabase.from('rooms').update({ status: 'cancelled' }).eq('id', roomId);
    const empty: LeaveResponse = { roomId, remaining: 0, status: 'cancelled' };
    return Response.json(empty);
  }

  // --- 방장이 나갔으면 먼저 합류한 사람에게 넘긴다 ---
  let newHostId: string | undefined;
  if (row.host_id === riderId) {
    const heir = [...row.room_members]
      .filter((m) => m.user_id !== riderId)
      .sort((a, b) => a.joined_at.localeCompare(b.joined_at))[0];
    newHostId = heir.user_id;
    await supabase.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
    await supabase
      .from('room_members')
      .update({ is_host: true })
      .eq('room_id', roomId)
      .eq('user_id', newHostId);
  }

  // --- 남은 사람들로 경로와 정산을 다시 계산 ---
  const hostId = newHostId ?? room.hostId;
  const events = buildRideEvents(remaining, finalDestinationOf(remaining, remaining[0].pickup));

  let route;
  try {
    route = await getDirections(eventsToDirectionsRequest(events));
  } catch (e) {
    // 경로 재계산에 실패해도 나간 것 자체는 유지한다.
    // 금액이 잠깐 옛날 값으로 남는 편이, 나가지도 못하는 것보다 낫다.
    console.error('[leave] directions', e);
    const partial: LeaveResponse = {
      roomId,
      remaining: remaining.length,
      status: 'open',
      newHostId,
    };
    return Response.json(partial);
  }

  const settlement = settleFare({
    totalFare: route.taxiFare + route.tollFare,
    baseFare: room.baseFare,
    tollFare: route.tollFare,
    legs: route.legs,
    events,
    riders: remaining,
    hostId,
  });

  const pickupOrders = orderMap(events, 'pickup');
  const dropoffOrders = orderMap(events, 'dropoff');

  await supabase
    .from('rooms')
    .update({
      total_distance_m: route.distanceM,
      total_fare: route.taxiFare + route.tollFare,
      // 자리가 생겼으니 다시 모집 상태로
      status: 'open',
    })
    .eq('id', roomId);

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

  const response: LeaveResponse = {
    roomId,
    remaining: remaining.length,
    status: 'open',
    newHostId,
  };
  return Response.json(response);
}

/** 이벤트 순서에서 승차(또는 하차) 순번을 뽑는다. 1부터 시작. */
function orderMap(
  events: { riderId: string; type: 'pickup' | 'dropoff' }[],
  type: 'pickup' | 'dropoff',
): Map<string, number> {
  const map = new Map<string, number>();
  events.filter((e) => e.type === type).forEach((e, i) => map.set(e.riderId, i + 1));
  return map;
}
