/**
 * 데모용 시드 데이터.
 *
 *   npx tsx scripts/seed.mts
 *
 * 방 생성 규칙은 src/lib/demo-rooms.ts 에 있다 (크론과 공유).
 * 이 스크립트는 계정을 만들고 방을 처음 깔아두는 역할만 한다.
 * 이후 유지는 /api/cron/seed 가 하루 한 번 자동으로 한다.
 *
 * profiles 가 auth.users 를 참조하므로 SQL 만으로는 더미 사용자를 만들 수 없다.
 * 익명 로그인으로 진짜 auth.users 를 만들면 트리거가 profiles 까지 채워준다.
 * (Supabase 대시보드 > Authentication > Sign In / Providers > Anonymous Sign-Ins 필요)
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COVERAGE_DAYS,
  DEMO_NICKNAMES,
  buildDemoRooms,
  toMemberRows,
  toRoomRow,
} from '../src/lib/demo-rooms';

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

type Person = { nickname: string; id?: string };
const PEOPLE: Record<string, Person> = Object.fromEntries(
  DEMO_NICKNAMES.map((n) => [n, { nickname: n }]),
);

async function main() {
  console.log(`→ ${SUPABASE_URL}
`);

  await ensurePeople();
  await deleteDemoRooms();
  await insertRooms();

  console.log(`
완료. 앞으로 ${COVERAGE_DAYS}일치 방을 깔았습니다.`);
  console.log('  이후에는 /api/cron/seed 가 하루 한 번 자동으로 이어서 채웁니다.');
  console.log('  고려대에서 강남역으로 가려는 사람이 언제 열어도 후보가 뜹니다.');
}

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

async function deleteDemoRooms() {
  // 데모 계정이 만든 방만 지운다.
  // 전부 지우면 심사위원이 만들어 둔 방까지 사라지고, 그 방에 있던 사람은
  // 나가기를 눌렀을 때 "방을 찾을 수 없습니다" 를 보게 된다.
  // room_members / fare_segments 는 on delete cascade 로 같이 지워진다.
  const ids = Object.values(PEOPLE)
    .map((person) => person.id)
    .filter((id): id is string => Boolean(id));
  await rest('DELETE', `/rest/v1/rooms?host_id=in.(${ids.join(',')})`);
  console.log('\n  기존 데모 방 삭제 (심사위원이 만든 방은 유지)');
}

async function insertRooms() {
  const now = new Date();
  const rooms = buildDemoRooms(now, new Date(now.getTime() + COVERAGE_DAYS * 24 * 60 * 60_000));
  const CHUNK = 200;

  for (let i = 0; i < rooms.length; i += CHUNK) {
    const batch = rooms.slice(i, i + CHUNK);
    const created = await rest<Array<{ id: string }>>(
      'POST',
      '/rest/v1/rooms',
      batch.map((room) => toRoomRow(room, idOf(room.host))),
    );
    await rest(
      'POST',
      '/rest/v1/room_members',
      batch.flatMap((room, idx) => toMemberRows(room, created[idx].id, idOf)),
    );
    console.log(`  ${i + batch.length}/${rooms.length} 개 방 생성`);
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
