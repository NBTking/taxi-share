import {
  COVERAGE_DAYS,
  DEMO_NICKNAMES,
  STEP_MIN,
  buildDemoRooms,
  toMemberRows,
  toRoomRow,
} from '@/lib/demo-rooms';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/cron/seed — 데모 방을 자동으로 이어서 깐다.
 *
 * 심사가 무인으로 오래 진행되므로, 사람이 매번 시드를 돌릴 수 없다.
 * 하루 한 번 실행되어 항상 앞으로 COVERAGE_DAYS 만큼의 방이 있도록 유지한다.
 *
 * 매번 전부 지우고 다시 까는 대신 **모자란 뒷부분만 이어 붙인다.**
 *   - 실행당 하루치(수백 개)만 넣으므로 함수 시간 제한에 걸리지 않는다
 *   - 크론이 며칠 멈춰도 남은 커버리지가 그대로 버틴다
 *
 * 지나간 방은 같이 정리한다. 매칭에 걸리지도 않으면서 행만 쌓이기 때문이다.
 *
 * 심사위원이 직접 만든 방은 건드리지 않는다 — 데모 계정이 만든 방만 대상이다.
 */
export const maxDuration = 60;

const CHUNK = 300;

export async function GET(request: Request) {
  // Vercel Cron 은 CRON_SECRET 이 설정돼 있으면 Authorization 헤더를 붙여 보낸다.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: '인증되지 않은 요청입니다' }, { status: 401 });
  }

  const supabase = await createClient();

  // --- 데모 계정 찾기 ---
  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select('id, nickname')
    .in('nickname', DEMO_NICKNAMES);

  if (profileError || !profiles || profiles.length === 0) {
    console.error('[cron/seed] profiles', profileError);
    return Response.json(
      { error: '데모 계정이 없습니다. scripts/seed.mts 를 한 번 실행해 주세요.' },
      { status: 500 },
    );
  }

  const idByNickname = new Map(profiles.map((p) => [p.nickname as string, p.id as string]));
  const demoIds = [...idByNickname.values()];
  const idOf = (nickname: string) => {
    const id = idByNickname.get(nickname);
    if (!id) throw new Error(`데모 계정 없음: ${nickname}`);
    return id;
  };

  const now = new Date();

  // --- 지나간 방 정리 ---
  const { count: removed } = await supabase
    .from('rooms')
    .delete({ count: 'exact' })
    .in('host_id', demoIds)
    .lt('depart_at', new Date(now.getTime() - 60 * 60_000).toISOString());

  // --- 어디까지 깔려 있는지 ---
  const { data: last } = await supabase
    .from('rooms')
    .select('depart_at')
    .in('host_id', demoIds)
    .order('depart_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const coverUntil = new Date(now.getTime() + COVERAGE_DAYS * 24 * 60 * 60_000);
  const lastAt = last?.depart_at ? new Date(last.depart_at as string) : null;
  // 이미 깔린 마지막 방 다음 슬롯부터. 비어 있으면 지금부터.
  const from = lastAt && lastAt > now ? new Date(lastAt.getTime() + STEP_MIN * 60_000) : now;

  if (from >= coverUntil) {
    return Response.json({
      ok: true,
      removed: removed ?? 0,
      added: 0,
      coveredUntil: lastAt?.toISOString() ?? null,
      message: '커버리지가 이미 충분합니다',
    });
  }

  // --- 모자란 만큼 이어 붙이기 ---
  const rooms = buildDemoRooms(from, coverUntil);
  let added = 0;

  for (let i = 0; i < rooms.length; i += CHUNK) {
    const batch = rooms.slice(i, i + CHUNK);

    const { data: created, error: roomError } = await supabase
      .from('rooms')
      .insert(batch.map((room) => toRoomRow(room, idOf(room.host))))
      .select('id');

    if (roomError || !created) {
      console.error('[cron/seed] insert rooms', roomError);
      return Response.json({ error: '방 생성에 실패했습니다', added }, { status: 500 });
    }

    const members = batch.flatMap((room, idx) =>
      toMemberRows(room, created[idx].id as string, idOf),
    );
    const { error: memberError } = await supabase.from('room_members').insert(members);
    if (memberError) {
      console.error('[cron/seed] insert members', memberError);
      return Response.json({ error: '참가자 생성에 실패했습니다', added }, { status: 500 });
    }

    added += batch.length;
  }

  return Response.json({
    ok: true,
    removed: removed ?? 0,
    added,
    coveredUntil: coverUntil.toISOString(),
  });
}
