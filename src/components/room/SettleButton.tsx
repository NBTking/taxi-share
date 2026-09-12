'use client';

import { useState } from 'react';
import type { RoomDetail } from '@/components/room/types';
import type { SettleResponse } from '@/lib/rooms';

/**
 * 운행을 끝내고 요금을 확정하는 버튼.
 *
 * 확정은 방장만 할 수 있고, 한 번 확정되면 금액이 얼어붙는다.
 * (카카오 택시요금은 실시간 교통 상황에 따라 달라져서, 확정 후 재계산하면
 *  "아까 본 금액과 다른데요?" 가 된다 — 서버가 저장된 값을 그대로 돌려준다)
 */
type Props = {
  room: RoomDetail;
  myId?: string;
  onSettled?: () => void;
};

export function SettleButton({ room, myId, onSettled }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (room.status === 'completed') {
    return (
      <p className="rounded-xl bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        정산이 확정되었습니다
      </p>
    );
  }

  // 참가자에게는 방장이 확정하기를 기다린다는 것만 알려준다
  if (!myId || myId !== room.host_id) {
    return (
      <p className="text-center text-xs text-slate-400">
        도착 후 방장이 정산을 확정하면 금액이 확정됩니다.
      </p>
    );
  }

  async function handleSettle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/rooms/${room.id}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requesterId: myId }),
      });
      const json = (await res.json()) as SettleResponse & { error?: string };
      if (!res.ok) {
        setError(json.error ?? '정산에 실패했습니다');
        return;
      }
      onSettled?.();
    } catch {
      setError('정산에 실패했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleSettle}
        disabled={busy}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:bg-slate-300 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 dark:disabled:bg-slate-700"
      >
        {busy ? '정산하는 중…' : '운행 완료 · 요금 확정'}
      </button>
      <p className="text-center text-xs text-slate-400">
        확정하면 금액이 고정되고 더 이상 합류할 수 없습니다.
      </p>
      {error && (
        <p className="rounded-lg bg-rose-50 p-2 text-center text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
