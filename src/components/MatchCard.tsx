'use client';

import { useState } from 'react';
import { km, minutes, won } from '@/lib/format';
import type { MatchResult } from '@/lib/matching';

/**
 * 매칭된 택시 한 대를 보여주는 카드.
 *
 * 부담금과 절약액을 먼저 크게 보여주고, 근거(구간별 분할)는 접어둔다.
 * "왜 내가 이 금액인지"를 펼쳐서 확인할 수 있다는 점이 이 서비스의 설득 포인트다.
 *
 * 🅱️ 합류 기능이 여기에 붙는다:
 *   POST /api/rooms/[id]/join → { roomId, pickupOrder, myFare, settlement }
 *   성공하면 /rooms/[roomId] 로 이동.
 */

type Props = {
  match: MatchResult;
  myId: string;
};

export function MatchCard({ match, myId }: Props) {
  const [open, setOpen] = useState(false);
  const s = match.settlement;

  return (
    <article className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-center justify-between p-4">
        <div>
          <p className="text-2xl font-bold">{won(match.myFare)}</p>
          {match.savedFare !== undefined && match.savedFare > 0 && (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {won(match.savedFare)} 절약
              {match.savedRate !== undefined && ` (${Math.round(match.savedRate * 100)}%)`}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <p>+{minutes(match.extraDurationS)} 우회</p>
          <p>{match.pickupOrder}번째 승차</p>
          {s && <p>{s.shares.length}명 동승</p>}
        </div>
      </div>

      {s && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400"
          >
            {open ? '요금 계산 접기' : '이 금액이 나온 이유 보기'}
          </button>

          {open && (
            <div className="border-t border-slate-100 px-4 py-3 text-xs dark:border-slate-800">
              <table className="w-full">
                <tbody>
                  {/* 같은 지점에서 연속 승하차하면 거리 0 인 구간이 생긴다. 0원 행은 혼란만 준다. */}
                  {s.segments
                    .filter((seg) => seg.distanceM > 0)
                    .map((seg) => (
                      <tr key={seg.seq} className="text-slate-600 dark:text-slate-300">
                        <td className="py-1 pr-2">
                          {seg.fromLabel} → {seg.toLabel}
                        </td>
                        <td className="py-1 text-right tabular-nums">{km(seg.distanceM)}</td>
                        <td className="py-1 pl-2 text-right tabular-nums">
                          {won(seg.segmentFare)} ÷ {seg.riderCount}명
                        </td>
                      </tr>
                    ))}
                  <tr className="text-slate-600 dark:text-slate-300">
                    <td className="py-1 pr-2" colSpan={2}>
                      기본요금{s.tollFare > 0 ? ' + 통행료' : ''}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      {won(s.baseFare + s.tollFare)} ÷ {s.shares.length}명
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                {s.shares.map((share) => (
                  <div
                    key={share.riderId}
                    className={`flex justify-between ${
                      share.riderId === myId
                        ? 'font-semibold text-slate-900 dark:text-white'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <span>
                      {share.nickname}
                      {share.riderId === myId && ' (나)'}
                    </span>
                    <span className="tabular-nums">{won(share.finalFare)}</span>
                  </div>
                ))}
                <div className="flex justify-between pt-1 text-slate-400">
                  <span>택시 총요금</span>
                  <span className="tabular-nums">{won(s.totalFare)}</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}
