import { haversineM } from './geo';
import type {
  FareSegment,
  LatLng,
  RideEvent,
  Rider,
  RiderId,
  RiderShare,
  RouteLeg,
  Settlement,
} from './types';

/**
 * 택시비 구간 분할 정산.
 *
 * 이 파일은 네트워크도 DB 도 건드리지 않는 순수 함수만 담는다.
 * 숫자를 넣으면 숫자가 나오므로 UI 없이 즉시 검증할 수 있고,
 * 이 서비스의 차별점 전부가 여기에 들어있다.
 *
 * 분배 규칙:
 *   1. variableFare = totalFare - baseFare
 *   2. 구간 요금 = variableFare × (구간거리 / 전체거리)
 *   3. 구간 탑승자 = 그 시점까지 탔고 아직 안 내린 사람
 *   4. 1인당 = 구간요금 ÷ 탑승인원
 *   5. 개인 합계 + baseFare ÷ 전체인원
 */

/** 1인당 금액 올림 단위(원) */
export const DEFAULT_ROUND_TO = 100;

export type SettleInput = {
  /** 승객이 내야 할 총액(원) = 카카오 fare.taxi + fare.toll */
  totalFare: number;
  /** 기본요금(원). 전원 균등 분배분 */
  baseFare: number;
  /**
   * 통행료(원). 카카오 fare.toll.
   * 특정 구간에서 발생하지만 구간 배분까지 하면 설명이 복잡해져서
   * 기본요금과 같이 전원 균등으로 처리한다.
   */
  tollFare?: number;
  /** 경로 구간들. 반드시 events.length - 1 개여야 한다. */
  legs: RouteLeg[];
  /** 승하차 이벤트를 경로 순서대로. 첫 이벤트는 pickup, 마지막은 dropoff. */
  events: RideEvent[];
  riders: Rider[];
  /** 반올림 차액을 흡수할 사람. 없으면 부담액이 가장 큰 사람이 흡수한다. */
  hostId?: RiderId;
  /** 올림 단위(원). 기본 100 */
  roundTo?: number;
};

/**
 * 승하차 순서를 정한다.
 *
 * 최적 순서 탐색(TSP)은 의도적으로 하지 않는다. 계산량 대비 얻는 것이 없고,
 * 규칙이 단순해야 사용자에게 설명할 수 있다.
 *
 *   - 픽업: 합류한 순서대로 (riders 배열 순서)
 *   - 하차: 최종 목적지에서 "먼" 사람부터 (이동 방향과 일치)
 */
export function buildRideEvents(riders: Rider[], destination: LatLng): RideEvent[] {
  if (riders.length === 0) {
    throw new Error('buildRideEvents: riders 가 비어 있습니다');
  }

  const pickups: RideEvent[] = riders.map((r) => ({
    riderId: r.id,
    type: 'pickup',
    point: r.pickup,
    label: `${r.nickname} 승차`,
  }));

  const dropoffs: RideEvent[] = [...riders]
    .sort((a, b) => haversineM(b.dropoff, destination) - haversineM(a.dropoff, destination))
    .map((r) => ({
      riderId: r.id,
      type: 'dropoff' as const,
      point: r.dropoff,
      label: `${r.nickname} 하차`,
    }));

  return [...pickups, ...dropoffs];
}

/** 구간 분할 정산을 수행한다. */
export function settleFare(input: SettleInput): Settlement {
  const { totalFare, legs, events, riders, hostId } = input;
  const roundTo = input.roundTo ?? DEFAULT_ROUND_TO;

  validate(input);

  const tollFare = Math.max(0, Math.min(input.tollFare ?? 0, totalFare));
  // 기본요금이 총요금을 넘는 경우(초단거리) 남은 금액 전부를 기본요금으로 본다.
  const baseFare = Math.min(input.baseFare, totalFare - tollFare);
  const variableFare = totalFare - baseFare - tollFare;
  const totalDistanceM = legs.reduce((sum, leg) => sum + leg.distanceM, 0);

  const riderById = new Map(riders.map((r) => [r.id, r]));
  /** 반올림 전 개인별 누적액 */
  const raw = new Map<RiderId, number>(riders.map((r) => [r.id, 0]));

  const onboard = new Set<RiderId>();
  const segments: FareSegment[] = [];

  for (let i = 0; i < legs.length; i++) {
    applyEvent(onboard, events[i]);

    const riderIds = [...onboard];
    if (riderIds.length === 0) {
      throw new Error(
        `settleFare: ${i + 1}번 구간에 탑승자가 없습니다. ` +
          `승하차 순서(events)가 잘못되었을 가능성이 높습니다.`,
      );
    }

    // 거리 0 인 구간(같은 지점에서 연속 승하차)은 요금도 0 이 된다.
    const segmentFare =
      totalDistanceM > 0 ? (variableFare * legs[i].distanceM) / totalDistanceM : 0;
    const perPersonFare = segmentFare / riderIds.length;

    for (const id of riderIds) {
      raw.set(id, (raw.get(id) ?? 0) + perPersonFare);
    }

    segments.push({
      seq: i + 1,
      fromLabel: events[i].label,
      toLabel: events[i + 1].label,
      distanceM: legs[i].distanceM,
      segmentFare: Math.round(segmentFare),
      riderIds,
      riderCount: riderIds.length,
      perPersonFare: Math.round(perPersonFare),
    });
  }

  // 기본요금 + 통행료는 전원 균등
  const evenPerPerson = (baseFare + tollFare) / riders.length;
  for (const r of riders) {
    raw.set(r.id, (raw.get(r.id) ?? 0) + evenPerPerson);
  }

  // 100원 단위 올림 → 합계가 총요금을 초과하므로 차액은 음수가 된다.
  const shares: RiderShare[] = riders.map((r) => ({
    riderId: r.id,
    nickname: r.nickname,
    finalFare: roundUpTo(raw.get(r.id) ?? 0, roundTo),
  }));

  const roundedSum = shares.reduce((sum, s) => sum + s.finalFare, 0);
  const roundingAdjustment = totalFare - roundedSum;

  // 차액 흡수: 호스트 우선, 없으면 가장 많이 내는 사람
  const absorber =
    shares.find((s) => s.riderId === hostId) ??
    shares.reduce((max, s) => (s.finalFare > max.finalFare ? s : max), shares[0]);
  absorber.finalFare = Math.max(0, absorber.finalFare + roundingAdjustment);

  // 절약액은 soloFare 를 아는 사람만 계산한다.
  for (const share of shares) {
    const solo = riderById.get(share.riderId)?.soloFare;
    if (solo === undefined || solo <= 0) continue;
    share.soloFare = solo;
    share.savedFare = solo - share.finalFare;
    share.savedRate = share.savedFare / solo;
  }

  return {
    totalFare,
    totalDistanceM,
    baseFare,
    tollFare,
    segments,
    shares,
    roundingAdjustment,
  };
}

function applyEvent(onboard: Set<RiderId>, event: RideEvent): void {
  if (event.type === 'pickup') {
    onboard.add(event.riderId);
  } else {
    onboard.delete(event.riderId);
  }
}

function roundUpTo(value: number, unit: number): number {
  if (unit <= 1) return Math.round(value);
  return Math.ceil(value / unit) * unit;
}

/**
 * 입력을 미리 검증한다.
 *
 * 조용히 틀린 금액을 내놓는 것보다 즉시 터지는 쪽이 낫다.
 * 정산 오류는 화면에서 눈치채기 어렵고, 심사 중에 발견되면 치명적이다.
 */
function validate(input: SettleInput): void {
  const { legs, events, riders, totalFare } = input;

  if (riders.length === 0) {
    throw new Error('settleFare: riders 가 비어 있습니다');
  }
  if (events.length < 2) {
    throw new Error('settleFare: events 가 2개 미만입니다');
  }
  if (legs.length !== events.length - 1) {
    throw new Error(
      `settleFare: legs(${legs.length}) 는 events(${events.length}) - 1 개여야 합니다. ` +
        `같은 지점에서 연속 승하차가 있다면 거리 0 인 leg 를 끼워 넣으세요.`,
    );
  }
  if (totalFare < 0) {
    throw new Error('settleFare: totalFare 가 음수입니다');
  }
  if (events[0].type !== 'pickup') {
    throw new Error('settleFare: 첫 이벤트는 pickup 이어야 합니다');
  }
  if (events[events.length - 1].type !== 'dropoff') {
    throw new Error('settleFare: 마지막 이벤트는 dropoff 여야 합니다');
  }

  const riderIds = new Set(riders.map((r) => r.id));
  for (const e of events) {
    if (!riderIds.has(e.riderId)) {
      throw new Error(`settleFare: events 에 riders 에 없는 riderId 가 있습니다 (${e.riderId})`);
    }
  }
}
