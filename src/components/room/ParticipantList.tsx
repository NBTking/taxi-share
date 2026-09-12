import { won } from '@/lib/format';
import { nicknameOf } from '@/lib/rooms';
import type { RoomDetail } from './types';

type Props = {
  room: RoomDetail;
  myId?: string;
};

export function ParticipantList({ room, myId }: Props) {
  const members = [...room.room_members].sort(
    (a, b) => (a.pickup_order ?? 0) - (b.pickup_order ?? 0),
  );

  return (
    <ul className="divide-y divide-slate-100 rounded-xl bg-white ring-1 ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-800">
      {members.map((m) => {
        const nickname = nicknameOf(m.profiles);
        const isMe = m.user_id === myId;
        return (
          <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <p
                className={`truncate font-medium ${
                  isMe ? 'text-slate-900 dark:text-white' : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {nickname}
                {isMe && ' (나)'}
                {m.is_host && (
                  <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    호스트
                  </span>
                )}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {m.pickup_order ?? '?'}번째 승차 · {m.pickup_address} → {m.dropoff_address}
              </p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">
              {m.final_fare !== null ? won(m.final_fare) : '정산 중'}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
