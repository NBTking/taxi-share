import { settleFare, buildRideEvents } from '../src/lib/fare';
import { haversineM, boundingBox, estimateFare } from '../src/lib/geo';
import type { Rider, RideEvent, RouteLeg } from '../src/lib/types';

let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  actual=${JSON.stringify(actual)}${ok ? '' : ` expected=${JSON.stringify(expected)}`}`);
}

// ---------- geo ----------
const gate = { lat: 37.4979, lng: 127.0276 };   // 학교 정문
const gangnam = { lat: 37.3595, lng: 127.1058 }; // 강남역
const d = Math.round(haversineM(gate, gangnam));
console.log(`\n[geo] 정문→강남역 직선거리 = ${d}m (카카오 실도로 20160m)`);
check('haversine 이 실도로보다 짧다', d < 20160 && d > 12000, true);

const bb = boundingBox(gate, 1000);
check('boundingBox 위도폭 ~0.009도', Math.abs((bb.maxLat - bb.minLat) - 0.01796) < 0.001, true);
check('boundingBox 가 중심을 포함', bb.minLat < gate.lat && gate.lat < bb.maxLat, true);
console.log(`[geo] 폴백 요금 추정(20160m) = ${estimateFare(20160, { baseFare: 4800, perKmFare: 760, nightSurchargeRate: 0 })}원 (카카오 실요금 22900원)`);

// ---------- fare: 핵심 시나리오 ----------
// A 혼자 2km → A+B 5km → B 혼자 3km, 총 10km / 총요금 12,000원 / 기본요금 4,800원
const riders: Rider[] = [
  { id: 'A', nickname: '민서', pickup: gate, dropoff: { lat: 37.40, lng: 127.08 }, soloFare: 11800 },
  { id: 'B', nickname: '지훈', pickup: { lat: 37.47, lng: 127.04 }, dropoff: gangnam, soloFare: 12800 },
];
const events: RideEvent[] = [
  { riderId: 'A', type: 'pickup', point: riders[0].pickup, label: '민서 승차' },
  { riderId: 'B', type: 'pickup', point: riders[1].pickup, label: '지훈 승차' },
  { riderId: 'A', type: 'dropoff', point: riders[0].dropoff, label: '민서 하차' },
  { riderId: 'B', type: 'dropoff', point: riders[1].dropoff, label: '지훈 하차' },
];
const legs: RouteLeg[] = [
  { distanceM: 2000, durationS: 300 },
  { distanceM: 5000, durationS: 700 },
  { distanceM: 3000, durationS: 400 },
];

const s = settleFare({ totalFare: 12000, baseFare: 4800, legs, events, riders, hostId: 'A' });

console.log('\n[정산표]');
for (const seg of s.segments) {
  console.log(`  ${seg.seq}. ${seg.fromLabel} → ${seg.toLabel}  ${seg.distanceM}m  ${seg.segmentFare}원  ÷${seg.riderCount}명 = ${seg.perPersonFare}원`);
}
console.log(`  기본요금 ${s.baseFare}원 ÷ ${riders.length}명`);
for (const sh of s.shares) {
  console.log(`  → ${sh.nickname}: ${sh.finalFare}원 (혼자면 ${sh.soloFare}원, ${sh.savedFare}원 절약 / ${Math.round((sh.savedRate ?? 0) * 100)}%)`);
}
console.log(`  반올림 차액: ${s.roundingAdjustment}원 (호스트 흡수)`);

check('구간 3개', s.segments.length, 3);
check('구간1 = A 혼자 1440원', [s.segments[0].segmentFare, s.segments[0].riderCount], [1440, 2 - 1]);
check('구간2 = 2명 3600원, 1인 1800원', [s.segments[1].segmentFare, s.segments[1].riderCount, s.segments[1].perPersonFare], [3600, 2, 1800]);
check('구간3 = B 혼자 2160원', [s.segments[2].segmentFare, s.segments[2].riderCount], [2160, 1]);
check('민서 최종 5600원', s.shares[0].finalFare, 5600);
check('지훈 최종 6400원', s.shares[1].finalFare, 6400);
check('★ 개인합계 == 총요금', s.shares.reduce((a, b) => a + b.finalFare, 0), 12000);
check('민서 절약 6200원', s.shares[0].savedFare, 6200);
check('전체거리 10000m', s.totalDistanceM, 10000);

// ---------- 하차 순서 ----------
const ev = buildRideEvents(riders, gangnam);
check('이벤트 4개', ev.length, 4);
check('픽업 먼저, 합류순', [ev[0].riderId, ev[1].riderId], ['A', 'B']);
check('목적지에서 먼 민서가 먼저 하차', [ev[2].riderId, ev[3].riderId], ['A', 'B']);

// ---------- 방어 로직 ----------
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}
check('legs 개수 불일치 시 에러', throws(() => settleFare({ totalFare: 12000, baseFare: 4800, legs: legs.slice(0, 2), events, riders })), true);
check('첫 이벤트가 하차면 에러', throws(() => settleFare({ totalFare: 12000, baseFare: 4800, legs, events: [events[2], ...events.slice(1)], riders })), true);
check('riders 비면 에러', throws(() => settleFare({ totalFare: 12000, baseFare: 4800, legs, events, riders: [] })), true);

// ---------- 엣지: 혼자 탄 경우 ----------
const solo = settleFare({
  totalFare: 11800, baseFare: 4800,
  legs: [{ distanceM: 10000, durationS: 1400 }],
  events: [events[0], events[2]],
  riders: [riders[0]],
});
check('혼자면 총요금 전액 부담', solo.shares[0].finalFare, 11800);

// ---------- 엣지: 초단거리(기본요금 > 총요금) ----------
const shortRide = settleFare({
  totalFare: 4800, baseFare: 4800,
  legs: [{ distanceM: 500, durationS: 120 }, { distanceM: 500, durationS: 120 }, { distanceM: 0, durationS: 0 }],
  events, riders, hostId: 'A',
});
check('초단거리도 합계 일치', shortRide.shares.reduce((a, b) => a + b.finalFare, 0), 4800);

console.log(`\n${failed === 0 ? '전부 통과' : `${failed}건 실패`}`);
process.exit(failed === 0 ? 0 : 1);
