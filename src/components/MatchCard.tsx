'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fromNow, km, minutes, toClock, won } from '@/lib/format';
import type { MatchResult } from '@/lib/matching';
import type { JoinResponse } from '@/lib/rooms';
import type { LatLng } from '@/lib/types';
import { useMe } from '@/lib/useMe';

/**
 * 매칭된 택시 한 대를 보여주는 카드.
 *
 * 부담금과 절약액을 먼저 크게 보여주고, 근거(구간별 분할)는 접어둔다.
 * "왜 내가 이 금액인지"를 펼쳐서 확인할 수 있다는 점이 이 서비스의 설득 포인트다.
 *
 * 🅱️ 합류 기능: POST /api/rooms/[id]/join → JoinResponse. 성공하면 /rooms/[roomId] 로 이동.
 */

type Props = {
  match: MatchResult;
  myId: string;
  /**
   * 합류 요청에 실어 보낼 내 승하차 좌표/주소.
   * TripForm 의 검색 조건이 지금은 page.tsx 안에만 있어 이 컴포넌트로 전달되지 않는다.
   * page.tsx 가 이 값을 내려주기 전까지는 합류 버튼이 안내 메시지만 띄운다.
   */
  myPickup?: LatLng;
  myPickupAddress?: string;
  myDropoff?: LatLng;
  myDropoffAddress?: string;
};

export function MatchCard({
  match,
  myId,
  myPickup,
  myPickupAddress,
  myDropoff,
  myDropoffAddress,
}: Props) {
  const router = useRouter();
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const s = match.settlement;

  async function handleJoin() {
    if (!me || !myPickup || !myDropoff) {
      alert('합류에 필요한 내 위치 정보가 없습니다');
      return;
    }
    setJoining(true);
    try {
      const res = await fetch(`/api/rooms/${match.roomId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          riderId: me.id,
          nickname: me.nickname,
          pickup: myPickup,
          pickupAddress: myPickupAddress,
          dropoff: myDropoff,
          dropoffAddress: myDropoffAddress,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        alert(json.error ?? '합류에 실패했습니다');
        return;
      }
      const data = json as JoinResponse;
      router.push(`/rooms/${data.roomId}`);
    } catch {
      alert('합류에 실패했습니다');
    } finally {
      setJoining(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-xl bg-white ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <div className="flex items-center justify-between p-4">
        <div>
          {/* 시계 시각만 있으면 얼마나 남았는지 암산해야 한다. 둘 다 적는다. */}
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            {toClock(match.departAt)} 출발 · {fromNow(match.departAt)}
          </p>
          <p className="text-2xl font-bold">{won(match.myFare)}</p>
          {match.savedFare !== undefined && match.savedFare > 0 && (
            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
              {won(match.savedFare)} 절약
              {match.savedRate !== undefined && ` (${Math.round(match.savedRate * 100)}%)`}
            </p>
          )}
        </div>
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          {/* 금액 다음으로 궁금한 건 "몇 분 걸리나" 다. 전체 운행이 아니라 내가 타는 시간을 보여준다. */}
          <p className="font-medium text-slate-700 dark:text-slate-200">
            내 탑승 {minutes(match.myRideDurationS)}
          </p>
          {/* 경로가 바뀌면서 예상 시간이 오히려 줄기도 한다. "+-2분" 이 찍히지 않게 한다. */}
          <p>{match.extraDurationS >= 60 ? `+${minutes(match.extraDurationS)} 우회` : '우회 없음'}</p>
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

      <div className="border-t border-slate-100 p-3 dark:border-slate-800">
        <button
          type="button"
          onClick={handleJoin}
          disabled={joining}
          className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
        >
          {joining ? '합류하는 중…' : '이 택시에 합류하기'}
        </button>
      </div>
    </article>
  );
}
