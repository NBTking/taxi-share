'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ParticipantList } from '@/components/room/ParticipantList';
import { RoomMap } from '@/components/room/RoomMap';
import { LeaveButton } from '@/components/room/LeaveButton';
import { SettleButton } from '@/components/room/SettleButton';
import { SettlementTable } from '@/components/room/SettlementTable';
import { useRoomDetail } from '@/components/room/useRoomDetail';
import { won } from '@/lib/format';
import { useMe } from '@/lib/useMe';

/**
 * 방 상세 화면.
 *
 * API 를 기다리지 않고 Supabase 에서 직접 읽는다(useRoomDetail).
 * 누가 합류하면 realtime 이 자동으로 다시 읽어와 화면이 즉시 갱신된다.
 */
export default function RoomDetailPage() {
  const params = useParams<{ id: string }>();
  const roomId = params.id;
  const { me } = useMe();
  const { room, loading, error } = useRoomDetail(roomId);

  if (loading) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 items-center justify-center p-4 text-sm text-slate-500 dark:text-slate-400">
        불러오는 중…
      </main>
    );
  }

  if (error || !room) {
    return (
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-500 dark:text-slate-400">
        <p>{error ?? '방을 찾을 수 없습니다'}</p>
        <Link href="/" className="text-blue-600 dark:text-blue-400">
          홈으로
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold tracking-tight">
            {room.origin_address} → {room.dest_address}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {new Date(room.depart_at).toLocaleString('ko-KR')} · {room.room_members.length}/
            {room.capacity}명
          </p>
        </div>
        {room.total_fare !== null && (
          <p className="shrink-0 text-sm font-semibold tabular-nums">{won(room.total_fare)}</p>
        )}
      </header>

      <RoomMap room={room} />

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">참가자</h2>
        <ParticipantList room={room} myId={me?.id} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-500 dark:text-slate-400">
          정산 근거
        </h2>
        <SettlementTable room={room} />
      </section>

      {/* 확정하면 room_members 가 갱신되고, realtime 구독이 화면을 자동으로 다시 읽는다 */}
      <SettleButton room={room} myId={me?.id} />
      <LeaveButton room={room} myId={me?.id} />
    </main>
  );
}
