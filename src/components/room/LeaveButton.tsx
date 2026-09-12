'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RoomDetail } from '@/components/room/types';
import type { LeaveResponse } from '@/lib/rooms';

/**
 * 방 나가기.
 *
 * 나가면 남은 사람들의 경로와 부담금이 전부 다시 계산된다.
 * 되돌릴 수 없으므로 한 번 확인을 받는다 — 특히 마지막 한 명이 나가면 방이 사라진다.
 */
type Props = {
  room: RoomDetail;
  myId?: string;
};

export function LeaveButton({ room, myId }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 정산이 끝났거나 참가자가 아니면 나갈 일이 없다
  if (room.status === 'completed' || room.status === 'cancelled') return null;
  if (!myId || !room.room_members.some((m) => m.user_id === myId)) return null;

  const isHost = room.host_id === myId;
  const isLast = room.room_members.length === 1;

  const warning = isLast
    ? '나가면 이 방은 사라집니다.'
    : isHost
      ? '나가면 다음 참가자에게 방장이 넘어가고, 남은 사람들의 요금이 다시 계산됩니다.'
      : '나가면 남은 사람들의 요금이 다시 계산됩니다.';

  async function handleLeave() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${room.id}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ riderId: myId }),
      });
      const json = (await res.json()) as LeaveResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? '나가기에 실패했습니다');
        setBusy(false);
        return;
      }
      router.push('/');
    } catch {
      setError('나가기에 실패했습니다');
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="w-full rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
      >
        방 나가기
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-slate-50 p-3 text-center dark:bg-slate-900">
      <p className="text-xs text-slate-600 dark:text-slate-300">{warning}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700"
        >
          취소
        </button>
        <button
          type="button"
          onClick={handleLeave}
          disabled={busy}
          className="flex-1 rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {busy ? '나가는 중…' : isLast ? '방 없애기' : '나가기'}
        </button>
      </div>
      {error && (
        <p className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
