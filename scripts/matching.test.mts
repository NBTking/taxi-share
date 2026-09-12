import { prefilterRooms, findMatches, type RoomCandidate, type MatchQuery } from '../src/lib/matching';
import { haversineM, estimateFare, pointToSegmentDistanceM } from '../src/lib/geo';
import type { Rider, LatLng } from '../src/lib/types';
import type { DirectionsRequest, DirectionsResult } from '../src/lib/directions';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  actual=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

const GATE: LatLng = { lat: 37.4979, lng: 127.0276 };   // 학교 정문
const GANGNAM: LatLng = { lat: 37.3595, lng: 127.1058 }; // 강남역
const POLICY = { baseFare: 4800, perKmFare: 760, nightSurchargeRate: 0 };

// ---- 길찾기 대역: 직선거리 x1.3, 시속 28km ----
let calls = 0;
let failNext = new Set<string>();
const fakeDirections = async (req: DirectionsRequest): Promise<DirectionsResult> => {
  calls++;
  const pts = [req.origin, ...(req.waypoints ?? []), req.destination];
  if (failNext.has(`${pts.length}`)) throw new Error('kakao down');
  const legs = pts.slice(0, -1).map((p, i) => {
    const distanceM = Math.round(haversineM(p, pts[i + 1]) * 1.3);
    return { distanceM, durationS: Math.round(distanceM / 7.8) };
  });
  const distanceM = legs.reduce((s, l) => s + l.distanceM, 0);
  return {
    distanceM,
    durationS: legs.reduce((s, l) => s + l.durationS, 0),
    taxiFare: estimateFare(distanceM, POLICY),
    tollFare: 0,
    legs,
  };
};

const host: Rider = { id: 'host', nickname: '민서', pickup: GATE, dropoff: GANGNAM, soloFare: 22900 };
const DEPART = '2026-09-12T20:00:00+09:00';

function room(over: Partial<RoomCandidate> = {}): RoomCandidate {
  return {
    id: 'r1', hostId: 'host', origin: GATE, destination: GANGNAM,
    departAt: DEPART, capacity: 4, detourTolerance: 0.3, baseFare: 4800,
    members: [host], currentDistanceM: 20470, currentDurationS: 2166,
    ...over,
  };
}

// 경로 회랑 위에서 타고, 강남역 근처에서 내리는 사람
const joiner: Rider = {
  id: 'joiner', nickname: '지훈',
  pickup: { lat: 37.4450, lng: 127.0560 },
  dropoff: { lat: 37.3660, lng: 127.1010 },
  soloFare: 13500,
};
const query: MatchQuery = { rider: joiner, departAt: DEPART };

// ---------- geo: 회랑 거리 ----------
console.log(`\n[geo] 회랑 이탈거리: 승차 ${Math.round(pointToSegmentDistanceM(joiner.pickup, GATE, GANGNAM))}m / 하차 ${Math.round(pointToSegmentDistanceM(joiner.dropoff, GATE, GANGNAM))}m`);
check('직선 위의 점은 이탈거리 ~0', Math.round(pointToSegmentDistanceM(GATE, GATE, GANGNAM)), 0);

// ---------- 1차 필터 ----------
check('정상 후보 통과', prefilterRooms([room()], query).length, 1);
check('정원 초과 제외', prefilterRooms([room({ capacity: 1 })], query).length, 0);
check('이미 합류한 방 제외', prefilterRooms([room({ members: [host, joiner] })], query).length, 0);
check('시간창 밖(+30분) 제외', prefilterRooms([room({ departAt: '2026-09-12T20:30:00+09:00' })], query).length, 0);
check('시간창 안(+9분) 통과', prefilterRooms([room({ departAt: '2026-09-12T20:09:00+09:00' })], query).length, 1);
check('회랑 밖(서울 서쪽) 제외', prefilterRooms([room()], {
  ...query, rider: { ...joiner, pickup: { lat: 37.55, lng: 126.90 } },
}).length, 0);
check('역방향 제외', prefilterRooms([room()], {
  ...query, rider: { ...joiner, pickup: joiner.dropoff, dropoff: joiner.pickup },
}).length, 0);

const many = Array.from({ length: 12 }, (_, i) => room({ id: `r${i}` }));
check('후보 상한 5개', prefilterRooms(many, query).length, 5);

// ---------- 2·3차: 실제 매칭 ----------
calls = 0;
const [m] = await findMatches(query, [room()], { getDirections: fakeDirections });
console.log(`\n[매칭] 우회 +${m.detourM}m (${Math.round(m.detourRatio * 100)}%) / +${Math.round(m.extraDurationS / 60)}분`);
console.log(`[매칭] 지훈 부담 ${m.myFare}원 (혼자면 ${m.soloFare}원 → ${m.savedFare}원 절약)`);
for (const sh of m.settlement!.shares) console.log(`        ${sh.nickname}: ${sh.finalFare}원`);

check('매칭 성공', m.accepted, true);
check('currentDistanceM 있으면 길찾기 1회만', calls, 1);
check('승차 순번 2번', m.pickupOrder, 2);
check('★ 정산 합계 == 총요금', m.settlement!.shares.reduce((a, b) => a + b.finalFare, 0), m.settlement!.totalFare);
check('부담금이 혼자 탈 때보다 싸다', m.myFare < joiner.soloFare!, true);
check('구간 수 = 이벤트 수 - 1', m.settlement!.segments.length, 3);

// ---------- 우회 초과 거절 ----------
const [tight] = await findMatches(query, [room({ detourTolerance: 0.001 })], { getDirections: fakeDirections });
check('우회 초과 시 거절', [tight.accepted, tight.reason], [false, 'detour']);
check('거절돼도 우회율은 알려준다', tight.detourRatio > 0, true);

// ---------- currentDistanceM 없으면 2회 호출 ----------
calls = 0;
await findMatches(query, [room({ currentDistanceM: undefined, currentDurationS: undefined })], { getDirections: fakeDirections });
check('기준거리 없으면 길찾기 2회', calls, 2);

// ---------- 길찾기 실패가 다른 방을 죽이지 않는다 ----------
failNext = new Set(['4']); // 합류 후 경로(출발+경유2+도착=점 4개) 조회만 실패시킴
const results = await findMatches(query, [room({ id: 'a' }), room({ id: 'b' })], { getDirections: fakeDirections });
check('실패해도 결과는 돌아온다', results.length, 2);
check('실패 사유 표기', results.every((r) => r.reason === 'directions_failed'), true);
failNext = new Set();

// ---------- 정렬: 절약액 큰 방이 위로 ----------
const far = room({ id: 'far', destination: { lat: 37.30, lng: 127.15 } });
const sorted = await findMatches(query, [room({ id: 'near' }), far], { getDirections: fakeDirections });
check('통과한 방이 거절된 방보다 위', sorted[0].accepted, true);

console.log(`\n${failed === 0 ? '전부 통과' : `${failed}건 실패`}`);
process.exit(failed === 0 ? 0 : 1);
