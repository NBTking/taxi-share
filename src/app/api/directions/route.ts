import { DirectionsError, getDirections } from '@/lib/directions';
import type { LatLng } from '@/lib/types';

/**
 * POST /api/directions
 *
 * 브라우저가 카카오 길찾기를 쓰는 유일한 통로.
 * KAKAO_REST_API_KEY 를 클라이언트에 노출하지 않기 위해 존재한다.
 *
 * body:
 *   {
 *     "origin":      { "lat": 37.4979, "lng": 127.0276 },
 *     "destination": { "lat": 37.3595, "lng": 127.1058 },
 *     "waypoints":   [ { "lat": ..., "lng": ... } ]      // 선택
 *   }
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON 본문을 파싱할 수 없습니다' }, { status: 400 });
  }

  const input = body as {
    origin?: unknown;
    destination?: unknown;
    waypoints?: unknown;
  };

  const origin = parseLatLng(input.origin, 'origin');
  const destination = parseLatLng(input.destination, 'destination');
  if (typeof origin === 'string') return Response.json({ error: origin }, { status: 400 });
  if (typeof destination === 'string') {
    return Response.json({ error: destination }, { status: 400 });
  }

  const waypoints: LatLng[] = [];
  if (input.waypoints !== undefined) {
    if (!Array.isArray(input.waypoints)) {
      return Response.json({ error: 'waypoints 는 배열이어야 합니다' }, { status: 400 });
    }
    for (let i = 0; i < input.waypoints.length; i++) {
      const p = parseLatLng(input.waypoints[i], `waypoints[${i}]`);
      if (typeof p === 'string') return Response.json({ error: p }, { status: 400 });
      waypoints.push(p);
    }
  }

  try {
    const result = await getDirections({ origin, destination, waypoints });
    return Response.json(result);
  } catch (error) {
    // 카카오가 "이 경로는 안 된다"고 답한 경우: 사용자에게 그대로 보여줄 수 있는 메시지다.
    if (error instanceof DirectionsError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 502 },
      );
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return Response.json({ error: '길찾기 응답이 지연되고 있습니다' }, { status: 504 });
    }
    console.error('[api/directions]', error);
    return Response.json({ error: '길찾기에 실패했습니다' }, { status: 500 });
  }
}

/** 성공하면 LatLng, 실패하면 에러 메시지 문자열을 돌려준다. */
function parseLatLng(value: unknown, field: string): LatLng | string {
  if (typeof value !== 'object' || value === null) {
    return `${field} 가 없거나 객체가 아닙니다`;
  }
  const { lat, lng } = value as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    return `${field}.lat 이 올바르지 않습니다`;
  }
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) {
    return `${field}.lng 이 올바르지 않습니다`;
  }
  return { lat, lng };
}
