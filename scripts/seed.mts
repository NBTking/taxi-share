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
  태윤: { nickname: '태윤' },
  지우: { nickname: '지우' },
  다인: { nickname: '다인' },
  현우: { nickname: '현우' },
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

/**
 * 심사가 언제 이뤄질지 모르므로(무인 심사) 방을 앞으로 SPAN_HOURS 동안
 * STEP_MIN 간격으로 깔아둔다.
 *
 * 매칭 시간창이 ±10분이라 어떤 고정 시각도 20분을 못 버틴다.
 * 시드를 한 번 돌리고 방치하면 8~12분 뒤부터 "조건에 맞는 택시가 없어요" 가 된다.
 * 홈의 "N분 내" 는 [지금, 지금+N분] 구간이라 가장 좁은 창이 10분이다.
 * 간격이 창보다 넓으면 아무것도 안 걸리는 구간이 생기므로 7분 간격으로 깐다.
 * 심사 시점을 모르므로 3일치를 미리 깔아 여유를 둔다(방 650개, 시딩 7초).
 */
const SPAN_HOURS = 72;
const STEP_MIN = 7;

/** 카카오 실측값 (고려대 기준) */
const FARE = {
  soloRoute: { distanceM: 12007, fare: 17600 },
  viaRoute: { distanceM: 13671, fare: 19100 },
  sinchon: { distanceM: 10535, fare: 16500 },
  reverse: { distanceM: 11776, fare: 15500 },
};

const HOSTS = ['민서', '준호', '서연', '태윤', '지우', '현우'];
const RIDERS = ['하늘', '다인'];

function buildRooms(): SeedRoom[] {
  const rooms: SeedRoom[] = [];
  let n = 0;

  for (let t = 5; t <= SPAN_HOURS * 60; t += STEP_MIN) {
    const host = HOSTS[n % HOSTS.length];
    const rider = RIDERS[n % RIDERS.length];
    n++;

    // 1인 방 — 합류하면 2명
    rooms.push({
      label: `고려대 → 강남역 (+${t}분)`,
      note: '1명',
      host,
      origin: KU,
      destination: GANGNAM,
      departInMin: t,
      totalDistanceM: FARE.soloRoute.distanceM,
      totalFare: FARE.soloRoute.fare,
      members: [
        { who: host, pickup: KU, dropoff: GANGNAM, soloFare: FARE.soloRoute.fare, isHost: true },
      ],
    });

    // 2인 방 — 왕십리에서 태우고 압구정에 내려준다. 합류하면 3명이라 더 싸다
    const host2 = HOSTS[n % HOSTS.length];
    n++;
    rooms.push({
      label: `고려대 → 강남역 (+${t + 3}분, 2명)`,
      note: '2명',
      host: host2,
      origin: KU,
      destination: GANGNAM,
      departInMin: t + 3,
      totalDistanceM: FARE.viaRoute.distanceM,
      totalFare: FARE.viaRoute.fare,
      members: [
        { who: host2, pickup: KU, dropoff: GANGNAM, soloFare: FARE.soloRoute.fare, isHost: true },
        { who: rider, pickup: WANGSIMNI, dropoff: APGUJEONG, soloFare: 9700 },
      ],
    });

    // 2시간마다 필터 테스트용 방(역방향 / 회랑 이탈)도 하나씩
    if (t % 120 < STEP_MIN) {
      rooms.push({
        label: `강남역 → 고려대 (+${t}분, 역방향)`,
        note: '필터: 역방향',
        host: '다인',
        origin: GANGNAM,
        destination: KU,
        departInMin: t,
        totalDistanceM: FARE.reverse.distanceM,
        totalFare: FARE.reverse.fare,
        members: [
          { who: '다인', pickup: GANGNAM, dropoff: KU, soloFare: FARE.reverse.fare, isHost: true },
        ],
      });
      rooms.push({
        label: `고려대 → 신촌역 (+${t}분, 회랑 이탈)`,
        note: '필터: 회랑 이탈',
        host: '하늘',
        origin: KU,
        destination: SINCHON,
        departInMin: t,
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

const ROOMS: SeedRoom[] = buildRooms();

async function main() {
  console.log(`→ ${SUPABASE_URL}\n`);

  await ensurePeople();
  await deleteAllRooms();
  await insertRooms();

  console.log(`
완료. 앞으로 ${SPAN_HOURS}시간 동안 ${STEP_MIN}분 간격으로 방 ${ROOMS.length}개를 깔았습니다.`);
  console.log('  고려대에서 강남역으로 가려는 사람이 언제 열어도 후보가 뜹니다.');
  console.log('  역방향(강남→고려대) · 회랑 이탈(고려대→신촌) 방은 필터에 걸려 항상 제외됩니다.');
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
  // 방이 수백 개라 한 건씩 넣으면 몇 분이 걸린다.
  // PostgREST 는 배열을 받으면 한 번에 넣고 생성된 행을 순서대로 돌려준다.
  const CHUNK = 100;

  for (let i = 0; i < ROOMS.length; i += CHUNK) {
    const batch = ROOMS.slice(i, i + CHUNK);

    const created = await rest<Array<{ id: string }>>(
      'POST',
      '/rest/v1/rooms',
      batch.map((room) => ({
        host_id: idOf(room.host),
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
      })),
    );

    const members = batch.flatMap((room, idx) =>
      room.members.map((m, order) => ({
        room_id: created[idx].id,
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
      })),
    );
    await rest('POST', '/rest/v1/room_members', members);

    console.log(`  ${i + batch.length}/${ROOMS.length} 개 방 생성`);
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
