import { km, won } from '@/lib/format';
import type { RoomDetail } from './types';

/** 구간별 정산 근거. MatchCard 의 미리보기 테이블과 같은 형식을 방 상세에서 그대로 보여준다. */
type Props = {
  room: RoomDetail;
};

export function SettlementTable({ room }: Props) {
  const segments = [...(room.fare_segments ?? [])].sort((a, b) => a.seq - b.seq);
  const memberCount = room.room_members.length;

  return (
    <div className="rounded-xl bg-white p-3 text-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <table className="w-full">
        <tbody>
          {/* 같은 지점에서 연속 승하차하면 거리 0 인 구간이 생긴다. 0원 행은 혼란만 준다. */}
          {segments
            .filter((seg) => seg.distance_m > 0)
            .map((seg) => (
              <tr key={seg.seq} className="text-slate-600 dark:text-slate-300">
                <td className="py-1 pr-2">
                  {seg.from_label} → {seg.to_label}
                </td>
                <td className="py-1 text-right tabular-nums">{km(seg.distance_m)}</td>
                <td className="py-1 pl-2 text-right tabular-nums">
                  {won(seg.segment_fare)} ÷ {seg.rider_count}명
                </td>
              </tr>
            ))}
          {memberCount > 0 && (
            <tr className="text-slate-600 dark:text-slate-300">
              <td className="py-1 pr-2" colSpan={2}>
                기본요금
              </td>
              <td className="py-1 pl-2 text-right tabular-nums">
                {won(room.base_fare)} ÷ {memberCount}명
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {room.total_fare !== null && (
        <p className="mt-2 border-t border-slate-100 pt-2 text-right text-slate-400 dark:border-slate-800">
          택시 총요금 {won(room.total_fare)}
        </p>
      )}
    </div>
  );
}
