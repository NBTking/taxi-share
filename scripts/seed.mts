/**
 * 데모용 시드 데이터.
 *
 *   npx tsx scripts/seed.mts
 *
 * 왜 스크립트인가:
 *   profiles 가 auth.users 를 참조하므로 SQL 만으로는 더미 사용자를 만들 수 없다.
 *   익명 로그인으로 진짜 auth.users 를 만들면 트리거가 profiles 까지 채워준다.
 *   (Supabase 대시보드 > Authentication > Sign In / Providers > Anonymous Sign-Ins 필요)
 *
 * 거리/요금은 카카오 실제 응답값을 박아뒀다.
 * 데모 중 길찾기 호출을 줄이고, 발표장 네트워크가 흔들려도 목록은 뜨게 하기 위함이다.
 *
 * 재실행하면 방을 전부 지우고 다시 만든다. 프로필은 재사용하므로 계정이 쌓이지 않는다.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KU, WANGSIMNI, APGUJEONG, GANGNAM, SINCHON, type Place } from '../src/lib/places';

// 좌표는 src/lib/places.ts 한 곳에서만 관리한다.
// 학교를 바꾸려면 그 파일의 HUB 만 수정하면 시드와 화면이 같이 따라온다.

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Person = { nickname: string; id?: string };
const PEOPLE: Record<string, Person> = {
  민서: { nickname: '민서' },
  준호: { nickname: '준호' },
  하늘: { nickname: '하늘' },
  서연: { nickname: '서연' },
  다인: { nickname: '다인' },
  태윤: { nickname: '태윤' },
};

/** 분 단위 오프셋 → ISO. 시드를 언제 돌려도 "지금 기준"이 되도록. */
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

type SeedMember = {
  who: string;
  pickup: Place;
  dropoff: Place;
  soloFare: number;
  isHost?: boolean;
};

type SeedRoom = {
  label: string;
  note: string;
  host: string;
  origin: Place;
  destination: Place;
  departInMin: number;
  /** 카카오 실측값 */
  totalDistanceM: number;
  totalFare: number;
  members: SeedMember[];
};

const ROOMS: SeedRoom[] = [
  {
    label: 'R1 고려대 → 강남역',
    note: '민서 혼자. 합류하면 2명',
    host: '민서',
    origin: KU,
    destination: GANGNAM,
    departInMin: 30,
    totalDistanceM: 12007,
    totalFare: 17600,
    members: [{ who: '민서', pickup: KU, dropoff: GANGNAM, soloFare: 17600, isHost: true }],
  },
  {
    label: 'R2 고려대 → 강남역 (2명)',
    note: '왕십리에서 한 명 태우고 압구정에 내려주는 방. 합류하면 3명이라 더 싸다',
    host: '준호',
    origin: KU,
    destination: GANGNAM,
    departInMin: 28,
    totalDistanceM: 13671,
    totalFare: 19100,
    members: [
      { who: '준호', pickup: KU, dropoff: GANGNAM, soloFare: 17600, isHost: true },
      { who: '하늘', pickup: WANGSIMNI, dropoff: APGUJEONG, soloFare: 9700 },
    ],
  },
  {
    label: 'R3 고려대 → 신촌역',
    note: '필터 테스트. 서쪽이라 회랑에서 8km 벗어난다',
    host: '서연',
    origin: KU,
    destination: SINCHON,
    departInMin: 32,
    totalDistanceM: 10535,
    totalFare: 16500,
    members: [{ who: '서연', pickup: KU, dropoff: SINCHON, soloFare: 16500, isHost: true }],
  },
  {
    label: 'R4 강남역 → 고려대 (역방향)',
    note: '필터 테스트. 이동 방향이 반대라 제외되어야 한다',
    host: '다인',
    origin: GANGNAM,
    destination: KU,
    departInMin: 30,
    totalDistanceM: 11776,
    totalFare: 15500,
    members: [{ who: '다인', pickup: GANGNAM, dropoff: KU, soloFare: 15500, isHost: true }],
  },
  {
    label: 'R5 고려대 → 강남역 (2시간 뒤)',
    note: '필터 테스트. 시간창 밖이라 제외되어야 한다',
    host: '태윤',
    origin: KU,
    destination: GANGNAM,
    departInMin: 120,
    totalDistanceM: 12007,
    totalFare: 17600,
    members: [{ who: '태윤', pickup: KU, dropoff: GANGNAM, soloFare: 17600, isHost: true }],
  },
];

async function main() {
  console.log(`→ ${SUPABASE_URL}\n`);

  await ensurePeople();
  await deleteAllRooms();
  await insertRooms();

  console.log('\n완료. 데모 시나리오:');
  console.log(`  고려대(${KU.lat},${KU.lng}) 에서 타고 강남역에서 내리려는 사람`);
  console.log('  → R1, R2 가 후보로 뜬다. R3 는 회랑 이탈, R4 는 역방향, R5 는 시간창 밖으로 제외');
}

/** 없는 사람만 익명 가입으로 만든다. 재실행해도 계정이 쌓이지 않는다. */
async function ensurePeople() {
  const existing = await rest<Array<{ id: string; nickname: string }>>(
    'GET',
    '/rest/v1/profiles?select=id,nickname',
  );
  const byNickname = new Map(existing.map((p) => [p.nickname, p.id]));

  for (const key of Object.keys(PEOPLE)) {
    const person = PEOPLE[key];
    const found = byNickname.get(person.nickname);
    if (found) {
      person.id = found;
      console.log(`  재사용  ${person.nickname}`);
      continue;
    }

    const res = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { nickname: person.nickname } }),
    });
    const json = (await res.json()) as { user?: { id: string }; msg?: string; error_code?: string };
    if (!res.ok || !json.user) {
      if (json.error_code === 'anonymous_provider_disabled') {
        throw new Error(
          '익명 로그인이 꺼져 있습니다.\n' +
            '  Supabase 대시보드 > Authentication > Sign In / Providers > Anonymous Sign-Ins 를 켜주세요.',
        );
      }
      throw new Error(`가입 실패 (${person.nickname}): ${json.msg ?? res.status}`);
    }
    person.id = json.user.id;
    console.log(`  생성    ${person.nickname}`);
  }
}

async function deleteAllRooms() {
  // room_members / fare_segments 는 on delete cascade 로 같이 지워진다.
  await rest('DELETE', '/rest/v1/rooms?id=neq.00000000-0000-0000-0000-000000000000');
  console.log('\n  기존 방 삭제');
}

async function insertRooms() {
  for (const room of ROOMS) {
    const hostId = idOf(room.host);
    const [created] = await rest<Array<{ id: string }>>('POST', '/rest/v1/rooms', [
      {
        host_id: hostId,
        origin_lat: room.origin.lat,
        origin_lng: room.origin.lng,
        origin_address: room.origin.address,
        dest_lat: room.destination.lat,
        dest_lng: room.destination.lng,
        dest_address: room.destination.address,
        depart_at: inMinutes(room.departInMin),
        capacity: 4,
        status: 'open',
        total_distance_m: room.totalDistanceM,
        total_fare: room.totalFare,
      },
    ]);

    await rest(
      'POST',
      '/rest/v1/room_members',
      room.members.map((m, i) => ({
        room_id: created.id,
        user_id: idOf(m.who),
        pickup_lat: m.pickup.lat,
        pickup_lng: m.pickup.lng,
        pickup_address: m.pickup.address,
        dropoff_lat: m.dropoff.lat,
        dropoff_lng: m.dropoff.lng,
        dropoff_address: m.dropoff.address,
        pickup_order: i + 1,
        solo_fare: m.soloFare,
        is_host: m.isHost ?? false,
      })),
    );

    console.log(
      `  ${room.label.padEnd(26)} ${String(room.members.length)}명 / ${room.totalFare}원   ${room.note}`,
    );
  }
}

function idOf(nickname: string): string {
  const id = PEOPLE[nickname]?.id;
  if (!id) throw new Error(`${nickname} 의 profile id 가 없습니다`);
  return id;
}

async function rest<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** .env.local 을 직접 읽는다 (의존성 없이) */
function loadEnv(): Record<string, string> {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
    if (!out[k]) throw new Error(`.env.local 에 ${k} 가 없습니다`);
  }
  return out;
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  process.exit(1);
});
