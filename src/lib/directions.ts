import { toKakaoCoord } from './geo';
import type { LatLng, RouteLeg } from './types';

/**
 * 카카오모빌리티 길찾기 API 래퍼. **서버 전용.**
 *
 * KAKAO_REST_API_KEY 는 NEXT_PUBLIC_ 이 아니므로 브라우저에서는 undefined 다.
 * 컴포넌트에서 직접 부르지 말고 /api/directions 를 경유할 것.
 *
 * 이 API 가 주는 것:
 *   - summary.fare.taxi   실제 택시요금(원)  ← 우리가 추정할 필요가 없다
 *   - summary.distance    전체 거리(m)
 *   - sections[]          구간별 거리 (경유지 수 + 1 개)
 * sections 가 fare.ts 의 legs 로 그대로 들어간다.
 */

const KAKAO_DIRECTIONS_URL = 'https://apis-navi.kakaomobility.com/v1/directions';

/** 응답이 늦으면 데모가 멈춘다. 기다리느니 폴백으로 넘기는 편이 낫다. */
const TIMEOUT_MS = 8_000;

/** 카카오 경유지 상한. 우리는 정원 4명이라 최대 4개 정도만 쓴다. */
const MAX_WAYPOINTS = 30;

export type DirectionsRequest = {
  origin: LatLng;
  destination: LatLng;
  /** 경유지. RideEvent 순서 그대로 넘기면 sections 가 구간과 1:1 대응한다. */
  waypoints?: LatLng[];
  priority?: 'RECOMMEND' | 'TIME' | 'DISTANCE';
};

export type DirectionsResult = {
  distanceM: number;
  durationS: number;
  /** 카카오가 계산한 실제 택시요금(원) */
  taxiFare: number;
  tollFare: number;
  /** 구간별 거리/시간. 개수 = waypoints.length + 1 */
  legs: RouteLeg[];
};

/** 카카오가 명시적으로 실패를 알려준 경우. 재시도해도 소용없다. */
export class DirectionsError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'DirectionsError';
  }
}

/** 자주 보는 result_code 를 사람이 읽을 수 있는 문구로 */
const RESULT_CODE_MESSAGES: Record<number, string> = {
  1: '경로를 찾을 수 없습니다',
  101: '경유지 주변에 도로가 없습니다',
  102: '출발지 주변에 도로가 없습니다',
  103: '도착지 주변에 도로가 없습니다',
  104: '출발지와 도착지가 너무 가깝습니다',
  105: '출발지가 도로 주변이 아닙니다',
  106: '도착지가 도로 주변이 아닙니다',
  107: '경유지가 도로 주변이 아닙니다',
};

/**
 * 같은 경로를 반복 조회하는 것을 막는다.
 *
 * 매칭은 후보 방마다 길찾기를 1번씩 부르기 때문에 같은 좌표 조합이 금방 반복된다.
 * 서버 메모리라 배포하면 날아가고 서버리스 인스턴스마다 따로 쌓이지만,
 * 무료 쿼터를 아끼는 데는 이 정도로 충분하다.
 */
const cache = new Map<string, { at: number; value: DirectionsResult }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

export async function getDirections(req: DirectionsRequest): Promise<DirectionsResult> {
  if (typeof window !== 'undefined') {
    throw new Error('getDirections 는 서버에서만 호출해야 합니다. /api/directions 를 쓰세요.');
  }

  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) {
    throw new Error('KAKAO_REST_API_KEY 가 없습니다. .env.local 을 확인하세요.');
  }

  const waypoints = req.waypoints ?? [];
  if (waypoints.length > MAX_WAYPOINTS) {
    throw new Error(`경유지는 최대 ${MAX_WAYPOINTS}개까지 가능합니다 (요청: ${waypoints.length})`);
  }

  const key = cacheKey(req);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.value;
  }

  const params = new URLSearchParams({
    origin: toKakaoCoord(req.origin),
    destination: toKakaoCoord(req.destination),
    priority: req.priority ?? 'RECOMMEND',
    // summary=true 여도 sections 는 그대로 내려온다. 도로 좌표 배열만 빠져서 응답이 가볍다.
    summary: 'true',
  });
  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(toKakaoCoord).join('|'));
  }

  const res = await fetch(`${KAKAO_DIRECTIONS_URL}?${params}`, {
    headers: { Authorization: `KakaoAK ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new DirectionsError(
      `카카오 길찾기 응답 오류 (HTTP ${res.status}). 쿼터 초과이거나 키가 잘못되었을 수 있습니다.`,
      res.status,
    );
  }

  const json = (await res.json()) as KakaoDirectionsResponse;
  const route = json.routes?.[0];
  if (!route) {
    throw new DirectionsError('카카오 응답에 경로가 없습니다', -1);
  }
  if (route.result_code !== 0) {
    const message =
      RESULT_CODE_MESSAGES[route.result_code] ?? route.result_msg ?? '길찾기 실패';
    throw new DirectionsError(message, route.result_code);
  }

  const legs: RouteLeg[] = (route.sections ?? []).map((s) => ({
    distanceM: s.distance,
    durationS: s.duration,
  }));

  // fare.ts 는 legs.length === events.length - 1 을 요구한다.
  // 여기서 어긋나면 정산이 통째로 틀어지므로 미리 막는다.
  const expectedLegs = waypoints.length + 1;
  if (legs.length !== expectedLegs) {
    throw new DirectionsError(
      `구간 수가 예상과 다릅니다 (기대 ${expectedLegs}, 실제 ${legs.length})`,
      -2,
    );
  }

  const value: DirectionsResult = {
    distanceM: route.summary.distance,
    durationS: route.summary.duration,
    taxiFare: route.summary.fare?.taxi ?? 0,
    tollFare: route.summary.fare?.toll ?? 0,
    legs,
  };

  putCache(key, value);
  return value;
}

function cacheKey(req: DirectionsRequest): string {
  const pts = [req.origin, ...(req.waypoints ?? []), req.destination];
  // 소수점 5자리 ≈ 1m. 이보다 정밀하게 구분해봐야 캐시만 새어나간다.
  return pts.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|') + `#${req.priority ?? 'RECOMMEND'}`;
}

function putCache(key: string, value: DirectionsResult): void {
  if (cache.size >= CACHE_MAX) {
    // 가장 오래된 것부터 버린다 (Map 은 삽입 순서를 유지한다)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

// ---- 카카오 응답에서 우리가 실제로 쓰는 필드만 ----
type KakaoDirectionsResponse = {
  routes?: Array<{
    result_code: number;
    result_msg?: string;
    summary: {
      distance: number;
      duration: number;
      fare?: { taxi?: number; toll?: number };
    };
    sections?: Array<{ distance: number; duration: number }>;
  }>;
};
