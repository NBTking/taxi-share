/**
 * taxi-share 공통 타입
 *
 * 이 파일은 "타입만" 둔다. 런타임 코드가 들어가면
 * fare.ts 같은 순수 모듈이 런타임 의존성을 갖게 되어 검증이 번거로워진다.
 */

/** 좌표. 카카오 API 는 x=lng, y=lat 순서라 변환 시 주의할 것. */
export type LatLng = {
  lat: number;
  lng: number;
};

export type RiderId = string;

export type RoomStatus = 'open' | 'locked' | 'completed' | 'cancelled';

/** 요금 정책. rooms 테이블에 스냅샷으로 저장되는 값과 1:1 대응. */
export type FarePolicy = {
  /** 기본요금(원). 전원 균등 분배 대상 */
  baseFare: number;
  /** km 당 추가요금(원). 카카오 실요금을 못 받았을 때만 사용하는 폴백 */
  perKmFare: number;
  /** 심야 할증 (0.2 = +20%) */
  nightSurchargeRate: number;
};

export const DEFAULT_FARE_POLICY: FarePolicy = {
  baseFare: 4800,
  perKmFare: 760,
  nightSurchargeRate: 0,
};

/** 동승자 1명. pickup/dropoff 가 사람마다 다른 것이 이 서비스의 전제. */
export type Rider = {
  id: RiderId;
  nickname: string;
  pickup: LatLng;
  dropoff: LatLng;
  /** 혼자 탔다면 냈을 요금(원). 절약액 계산용이라 없으면 절약액도 생략된다. */
  soloFare?: number;
};

/** 경로상의 정차 이벤트. 이 순서가 곧 카카오 길찾기의 경유지 순서가 된다. */
export type RideEvent = {
  riderId: RiderId;
  type: 'pickup' | 'dropoff';
  point: LatLng;
  /** 화면/정산표에 찍히는 라벨. 예: '민서 승차' */
  label: string;
};

/**
 * 경로 한 구간.
 * 카카오 길찾기 응답의 routes[0].sections[i] 에서 뽑아온다.
 * sections 개수 = 경유지 수 + 1 = RideEvent 수 - 1 로 정확히 맞아떨어진다.
 */
export type RouteLeg = {
  distanceM: number;
  durationS: number;
};

/** 정산 결과 - 구간별 근거. fare_segments 테이블과 1:1 대응. */
export type FareSegment = {
  seq: number;
  fromLabel: string;
  toLabel: string;
  distanceM: number;
  /** 이 구간에서 발생한 요금(원) */
  segmentFare: number;
  riderIds: RiderId[];
  riderCount: number;
  /** segmentFare / riderCount (반올림 전) */
  perPersonFare: number;
};

/** 정산 결과 - 개인별 부담액. room_members 의 final_fare 와 대응. */
export type RiderShare = {
  riderId: RiderId;
  nickname: string;
  /** 최종 부담액(원). 반올림까지 끝난 값 */
  finalFare: number;
  soloFare?: number;
  /** soloFare - finalFare */
  savedFare?: number;
  /** savedFare / soloFare (0~1) */
  savedRate?: number;
};

export type Settlement = {
  /** 택시 총요금(원). 카카오가 준 실요금 */
  totalFare: number;
  totalDistanceM: number;
  baseFare: number;
  /** 통행료(원). 기본요금과 함께 전원 균등 분배된다. */
  tollFare: number;
  segments: FareSegment[];
  shares: RiderShare[];
  /**
   * 100원 단위 올림 때문에 생긴 차액(원).
   * 올림이므로 항상 0 이하이며, 호스트가 흡수한다(= 호스트가 그만큼 덜 냄).
   */
  roundingAdjustment: number;
};
