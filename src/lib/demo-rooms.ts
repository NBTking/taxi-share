import { APGUJEONG, GANGNAM, KU, SINCHON, WANGSIMNI, type Place } from './places';

/**
 * 데모용 방 생성 규칙.
 *
 * 심사가 무인으로, 기간을 알 수 없게 진행되므로 방이 항상 "지금 근처"에 있어야 한다.
 * 시드 스크립트(수동)와 크론(자동)이 같은 규칙을 써야 데이터가 갈라지지 않으므로
 * 생성 규칙만 여기에 모아둔다. 이 파일은 DB 도 네트워크도 모른다.
 */

/**
 * 방을 까는 간격(분).
 *
 * 홈의 "N분 내" 는 [지금, 지금+N분] 구간이라 가장 좁은 창이 10분이다.
 * 간격이 창보다 넓으면 아무것도 안 걸리는 시간대가 생기므로 창보다 좁게 잡는다.
 */
export const STEP_MIN = 7;

/** 기본으로 유지할 커버리지(일). 크론이 이 길이를 계속 채운다. */
export const COVERAGE_DAYS = 30;

export const DEMO_HOSTS = ['민서', '준호', '서연', '태윤', '지우', '현우'] as const;
export const DEMO_RIDERS = ['하늘', '다인'] as const;
export const DEMO_NICKNAMES = [...DEMO_HOSTS, ...DEMO_RIDERS];

/** 카카오 실측값 (고려대 기준) */
const FARE = {
  solo: { distanceM: 12007, fare: 17600 },
  via: { distanceM: 13671, fare: 19100 },
  sinchon: { distanceM: 10535, fare: 16500 },
  reverse: { distanceM: 11776, fare: 15500 },
};

export type DemoMember = {
  who: string;
  pickup: Place;
  dropoff: Place;
  soloFare: number;
  isHost?: boolean;
};

export type DemoRoom = {
  host: string;
  origin: Place;
  destination: Place;
  departAt: Date;
  totalDistanceM: number;
  totalFare: number;
  members: DemoMember[];
};

/**
 * [from, to] 구간에 방을 깐다.
 *
 * 한 슬롯마다 1인 방과 2인 방을 함께 만들어, 매칭 결과에서
 * "사람이 많을수록 싸진다" 가 바로 비교되게 한다.
 * 2시간마다 필터 테스트용 방(역방향 / 회랑 이탈)도 하나씩 섞는다.
 */
export function buildDemoRooms(from: Date, to: Date): DemoRoom[] {
  const rooms: DemoRoom[] = [];
  const stepMs = STEP_MIN * 60_000;
  let n = 0;

  for (let t = from.getTime(); t <= to.getTime(); t += stepMs) {
    const host = DEMO_HOSTS[n % DEMO_HOSTS.length];
    const rider = DEMO_RIDERS[n % DEMO_RIDERS.length];
    n++;

    rooms.push({
      host,
      origin: KU,
      destination: GANGNAM,
      departAt: new Date(t),
      totalDistanceM: FARE.solo.distanceM,
      totalFare: FARE.solo.fare,
      members: [
        { who: host, pickup: KU, dropoff: GANGNAM, soloFare: FARE.solo.fare, isHost: true },
      ],
    });

    // 왕십리에서 태우고 압구정에 내려주는 2인 방. 합류하면 3명이라 더 싸다.
    const host2 = DEMO_HOSTS[n % DEMO_HOSTS.length];
    n++;
    rooms.push({
      host: host2,
      origin: KU,
      destination: GANGNAM,
      departAt: new Date(t + 3 * 60_000),
      totalDistanceM: FARE.via.distanceM,
      totalFare: FARE.via.fare,
      members: [
        { who: host2, pickup: KU, dropoff: GANGNAM, soloFare: FARE.solo.fare, isHost: true },
        { who: rider, pickup: WANGSIMNI, dropoff: APGUJEONG, soloFare: 9700 },
      ],
    });

    // 2시간마다 필터가 동작하는 것도 보이도록 걸러질 방을 섞는다
    const twoHourSlot = Math.floor(t / (120 * 60_000)) !== Math.floor((t - stepMs) / (120 * 60_000));
    if (twoHourSlot) {
      rooms.push({
        host: '다인',
        origin: GANGNAM,
        destination: KU,
        departAt: new Date(t),
        totalDistanceM: FARE.reverse.distanceM,
        totalFare: FARE.reverse.fare,
        members: [
          { who: '다인', pickup: GANGNAM, dropoff: KU, soloFare: FARE.reverse.fare, isHost: true },
        ],
      });
      rooms.push({
        host: '하늘',
        origin: KU,
        destination: SINCHON,
        departAt: new Date(t),
        totalDistanceM: FARE.sinchon.distanceM,
        totalFare: FARE.sinchon.fare,
        members: [
          { who: '하늘', pickup: KU, dropoff: SINCHON, soloFare: FARE.sinchon.fare, isHost: true },
        ],
      });
    }
  }

  return rooms;
}

/** DemoRoom → rooms 테이블 행 */
export function toRoomRow(room: DemoRoom, hostId: string) {
  return {
    host_id: hostId,
    origin_lat: room.origin.lat,
    origin_lng: room.origin.lng,
    origin_address: room.origin.address,
    dest_lat: room.destination.lat,
    dest_lng: room.destination.lng,
    dest_address: room.destination.address,
    depart_at: room.departAt.toISOString(),
    capacity: 4,
    status: 'open',
    total_distance_m: room.totalDistanceM,
    total_fare: room.totalFare,
  };
}

/** DemoRoom → room_members 테이블 행들 */
export function toMemberRows(room: DemoRoom, roomId: string, idOf: (nick: string) => string) {
  return room.members.map((m, order) => ({
    room_id: roomId,
    user_id: idOf(m.who),
    pickup_lat: m.pickup.lat,
    pickup_lng: m.pickup.lng,
    pickup_address: m.pickup.address,
    dropoff_lat: m.dropoff.lat,
    dropoff_lng: m.dropoff.lng,
    dropoff_address: m.dropoff.address,
    pickup_order: order + 1,
    dropoff_order: order + 1,
    solo_fare: m.soloFare,
    final_fare: m.soloFare,
    is_host: m.isHost ?? false,
  }));
}
