import {
  APGUJEONG,
  CHEONGNYANGNI,
  GANGNAM,
  GYODAE,
  HANNAM,
  HOEGI,
  HONGDAE,
  JAMSIL,
  KONKUK,
  KU,
  MIA,
  SADANG,
  SINCHON,
  SINDANG,
  SINNONHYEON,
  SINSA,
  SUNGSHIN,
  WANGSIMNI,
  YANGJAE,
  type Place,
} from './places';

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

/**
 * 경로 한 종류. 거리·요금은 카카오 길찾기 실측값이다.
 *
 * via 가 있으면 2인 방을 만들 수 있다 — 중간에서 한 명을 태우고 내려주는 방이라
 * 구간마다 탑승 인원이 달라지는 정산을 보여줄 수 있다.
 */
type RouteSpec = {
  origin: Place;
  destination: Place;
  distanceM: number;
  fare: number;
  via?: {
    pickup: Place;
    dropoff: Place;
    /** 중간 승객까지 태웠을 때의 전체 경로 */
    distanceM: number;
    fare: number;
    /** 중간 승객이 혼자 갔다면 냈을 요금 */
    riderSoloFare: number;
  };
};

/**
 * 고려대에서 강남 방향으로 가려는 사람에게 매칭되는 경로들.
 *
 * 회랑(출발→도착 직선에서 2km) 안에 고려대와 강남역이 모두 들어오는 조합만 골랐다.
 * 슬롯마다 다른 경로를 쓰므로 검색 결과에 같은 노선만 줄줄이 뜨지 않는다.
 */
const MATCHING_ROUTES: RouteSpec[] = [
  {
    origin: KU,
    destination: GANGNAM,
    distanceM: 12278,
    fare: 14600,
    via: { pickup: WANGSIMNI, dropoff: APGUJEONG, distanceM: 12878, fare: 16100, riderSoloFare: 9000 },
  },
  {
    origin: KU,
    destination: YANGJAE,
    distanceM: 14787,
    fare: 16300,
    via: { pickup: WANGSIMNI, dropoff: SINSA, distanceM: 14052, fare: 17300, riderSoloFare: 9000 },
  },
  {
    origin: KU,
    destination: SINNONHYEON,
    distanceM: 10469,
    fare: 13400,
    via: { pickup: SINDANG, dropoff: APGUJEONG, distanceM: 11076, fare: 14100, riderSoloFare: 8000 },
  },
  // 경유 노선을 넣으면 우회가 48% 라 현실성이 없어 1인 방으로만 쓴다
  { origin: KU, destination: GYODAE, distanceM: 13621, fare: 15600 },
  {
    origin: MIA,
    destination: GANGNAM,
    distanceM: 17420,
    fare: 17800,
    via: { pickup: KU, dropoff: APGUJEONG, distanceM: 15816, fare: 18600, riderSoloFare: 11100 },
  },
  {
    origin: SUNGSHIN,
    destination: GANGNAM,
    distanceM: 12765,
    fare: 15200,
    via: { pickup: KU, dropoff: SINSA, distanceM: 14061, fare: 16800, riderSoloFare: 12500 },
  },
  {
    origin: CHEONGNYANGNI,
    destination: GANGNAM,
    distanceM: 11554,
    fare: 14000,
    via: { pickup: WANGSIMNI, dropoff: APGUJEONG, distanceM: 13093, fare: 16100, riderSoloFare: 9000 },
  },
];

/**
 * 매칭에는 걸리지 않는 경로들.
 *
 * 목록이 고려대→강남 일색이면 "이 앱은 한 노선만 되나?" 로 보인다.
 * 다른 방향 방도 깔아두면 "근처 N개 방 중 M개는 경로·시간이 맞지 않아 제외"
 * 라는 문구가 실제 데이터에서 나온다.
 */
const OTHER_ROUTES: RouteSpec[] = [
  { origin: KU, destination: JAMSIL, distanceM: 15034, fare: 16400 },
  { origin: KU, destination: SADANG, distanceM: 17863, fare: 19000 },
  { origin: KU, destination: KONKUK, distanceM: 8218, fare: 11300 },
  { origin: KU, destination: SINCHON, distanceM: 11298, fare: 15400 },
  { origin: GANGNAM, destination: KU, distanceM: 12811, fare: 16400 },
  { origin: WANGSIMNI, destination: SADANG, distanceM: 14552, fare: 16800 },
  { origin: CHEONGNYANGNI, destination: JAMSIL, distanceM: 14067, fare: 15400 },
  { origin: HOEGI, destination: HONGDAE, distanceM: 19142, fare: 19900 },
  { origin: HOEGI, destination: GANGNAM, distanceM: 12801, fare: 15300 },
];

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

function soloRoom(route: RouteSpec, host: string, departAt: Date): DemoRoom {
  return {
    host,
    origin: route.origin,
    destination: route.destination,
    departAt,
    totalDistanceM: route.distanceM,
    totalFare: route.fare,
    members: [
      {
        who: host,
        pickup: route.origin,
        dropoff: route.destination,
        soloFare: route.fare,
        isHost: true,
      },
    ],
  };
}

function duoRoom(route: RouteSpec, host: string, rider: string, departAt: Date): DemoRoom {
  const via = route.via!;
  return {
    host,
    origin: route.origin,
    destination: route.destination,
    departAt,
    totalDistanceM: via.distanceM,
    totalFare: via.fare,
    members: [
      {
        who: host,
        pickup: route.origin,
        dropoff: route.destination,
        soloFare: route.fare,
        isHost: true,
      },
      { who: rider, pickup: via.pickup, dropoff: via.dropoff, soloFare: via.riderSoloFare },
    ],
  };
}

/** via 가 있는 경로만. 2인 방을 만들 때 쓴다. */
const DUO_ROUTES = MATCHING_ROUTES.filter((r) => r.via);

/**
 * [from, to] 구간에 방을 깐다.
 *
 * 슬롯마다 서로 다른 경로로 1인 방 + 2인 방을 하나씩 만든다.
 * 같은 노선이 연달아 나오지 않도록 두 목록을 서로 다른 주기로 돌린다.
 * 매칭되는 경로는 모든 슬롯에 들어가므로, 고려대→강남 검색은 언제나 결과가 있다.
 */
export function buildDemoRooms(from: Date, to: Date): DemoRoom[] {
  const rooms: DemoRoom[] = [];
  const stepMs = STEP_MIN * 60_000;
  let i = 0;

  for (let t = from.getTime(); t <= to.getTime(); t += stepMs, i++) {
    const host1 = DEMO_HOSTS[i % DEMO_HOSTS.length];
    const host2 = DEMO_HOSTS[(i + 2) % DEMO_HOSTS.length];
    const rider = DEMO_RIDERS[i % DEMO_RIDERS.length];

    rooms.push(soloRoom(MATCHING_ROUTES[i % MATCHING_ROUTES.length], host1, new Date(t)));
    rooms.push(
      duoRoom(DUO_ROUTES[(i + 3) % DUO_ROUTES.length], host2, rider, new Date(t + 3 * 60_000)),
    );

    // 세 슬롯에 한 번씩 다른 방향 방도 섞는다 (필터가 실제로 걸러내는 걸 보여준다)
    if (i % 3 === 0) {
      const other = OTHER_ROUTES[(i / 3) % OTHER_ROUTES.length];
      rooms.push(soloRoom(other, DEMO_RIDERS[(i + 1) % DEMO_RIDERS.length], new Date(t + 60_000)));
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
