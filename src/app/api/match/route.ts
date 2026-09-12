import { getDirections } from '@/lib/directions';
import { findMatches, MATCH_DEFAULTS, type MatchResponse } from '@/lib/matching';
import { ROOM_SELECT, toRoomCandidate, type RoomRow } from '@/lib/rooms';
import { createClient } from '@/lib/supabase/server';
import { parseLatLng, positiveNumber } from '@/lib/validate';
import type { LatLng, Rider } from '@/lib/types';

/**
 * POST /api/match
 *
 * 합류하려는 사람의 조건을 받아 동승 가능한 방을 찾는다.
 *
 * body:
 *   {
 *     "rider": {
 *       "id": "...", "nickname": "지훈",
 *       "pickup":  { "lat": .., "lng": .. },
 *       "dropoff": { "lat": .., "lng": .. },
 *       "soloFare": 13500            // 선택. 없으면 서버가 계산한다
 *     },
 *     "departAt": "2026-09-12T20:00:00+09:00"
 *   }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const parsed = parseQuery(body);
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { rider, departAt, timeWindowMin } = parsed;

  const supabase = await createClient();

  // 시간창은 SQL 에서 자른다 (rooms_status_depart_idx 를 탄다).
  // 회랑·방향 필터는 좌표 계산이라 prefilterRooms 가 메모리에서 처리한다.
  const windowMs = timeWindowMin * 60_000;
  const at = new Date(departAt).getTime();
  const { data, error } = await supabase
    .from('rooms')
    .select(ROOM_SELECT)
    .eq('status', 'open')
    .gte('depart_at', new Date(at - windowMs).toISOString())
    .lte('depart_at', new Date(at + windowMs).toISOString())
    .limit(50);

  if (error) {
    console.error('[api/match] supabase', error);
    return Response.json({ error: '방 목록을 불러오지 못했습니다' }, { status: 500 });
  }

  // DB 타입을 생성하지 않아서 supabase-js 가 임베드를 배열로 추론한다.
  // 실제로는 many-to-one 이라 객체가 오므로 toRoomCandidate 에서 양쪽을 모두 받는다.
  const rooms = ((data ?? []) as unknown as RoomRow[]).map(toRoomCandidate);

  // 절약액을 보여주려면 "혼자 갔을 때" 요금이 필요하다.
  // 클라이언트가 안 보냈으면 여기서 한 번 계산한다(길찾기 1회).
  let riderWithSolo = rider;
  if (rider.soloFare === undefined) {
    try {
      const solo = await getDirections({ origin: rider.pickup, destination: rider.dropoff });
      riderWithSolo = { ...rider, soloFare: solo.taxiFare + solo.tollFare };
    } catch {
      // 실패해도 매칭 자체는 가능하다. 절약액만 빠진다.
    }
  }

  try {
    const matches = await findMatches(
      { ...parsed, rider: riderWithSolo },
      rooms,
      { getDirections },
    );
    const body: MatchResponse = {
      soloFare: riderWithSolo.soloFare ?? null,
      scanned: rooms.length,
      matches,
    };
    return Response.json(body);
  } catch (e) {
    console.error('[api/match]', e);
    return Response.json({ error: '매칭 계산에 실패했습니다' }, { status: 500 });
  }
}

type ParsedQuery = {
  rider: Rider;
  departAt: string;
  timeWindowMin: number;
  corridorM: number;
  maxCandidates: number;
};

function parseQuery(body: unknown): ParsedQuery | { error: string } {
  const input = body as Record<string, unknown>;
  const r = input?.rider as Record<string, unknown> | undefined;

  if (!r || typeof r !== 'object') return { error: 'rider 가 없습니다' };
  if (typeof r.id !== 'string' || r.id.length === 0) return { error: 'rider.id 가 없습니다' };
  if (typeof r.nickname !== 'string' || r.nickname.length === 0) {
    return { error: 'rider.nickname 이 없습니다' };
  }

  const pickup = parseLatLng(r.pickup, 'rider.pickup');
  if (typeof pickup === 'string') return { error: pickup };
  const dropoff = parseLatLng(r.dropoff, 'rider.dropoff');
  if (typeof dropoff === 'string') return { error: dropoff };

  const departAt = input.departAt;
  if (typeof departAt !== 'string' || Number.isNaN(new Date(departAt).getTime())) {
    return { error: 'departAt 이 올바른 날짜 문자열이 아닙니다' };
  }

  const soloFare =
    typeof r.soloFare === 'number' && Number.isFinite(r.soloFare) && r.soloFare > 0
      ? r.soloFare
      : undefined;

  return {
    rider: { id: r.id, nickname: r.nickname, pickup, dropoff, soloFare },
    departAt,
    timeWindowMin: positiveNumber(input.timeWindowMin, MATCH_DEFAULTS.timeWindowMin),
    corridorM: positiveNumber(input.corridorM, MATCH_DEFAULTS.corridorM),
    maxCandidates: positiveNumber(input.maxCandidates, MATCH_DEFAULTS.maxCandidates),
  };
}


