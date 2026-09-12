'use client';

import { useEffect, useRef, useState } from 'react';
import { waitForServices } from '@/components/KakaoMap';
import type { Place } from '@/lib/places';

/**
 * 장소 검색 입력.
 *
 * 카카오 지도 SDK 의 services 라이브러리에 들어있는 키워드 검색을 쓴다.
 * 별도 API 키나 서버 경유가 필요 없다 — 지도와 같은 JS 키로 브라우저에서 바로 부른다.
 */

type Props = {
  label: string;
  tone: 'emerald' | 'rose';
  /** 지도 클릭·현재 위치·빠른 선택으로 바깥에서 정해진 값 */
  value: Place | null;
  onSelect: (place: Place) => void;
  placeholder?: string;
  /** 값 대신 잠깐 보여줄 문구 (예: '현재 위치 확인 중…') */
  pendingText?: string;
};

type Suggestion = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export function PlaceSearch({ label, tone, value, onSelect, placeholder, pendingText }: Props) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [empty, setEmpty] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 입력 중이 아닐 때는 바깥에서 정해진 주소를 보여준다.
  useEffect(() => {
    if (!editing) setQuery(value?.address ?? '');
  }, [value, editing]);

  // 타이핑이 멈추면 검색한다. 글자마다 부르면 결과가 덜컥거린다.
  useEffect(() => {
    if (!editing) return;
    const keyword = query.trim();
    if (keyword.length < 2) {
      setItems([]);
      setEmpty(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!(await waitForServices(4000)) || cancelled) return;
      setSearching(true);
      new window.kakao.maps.services.Places().keywordSearch(
        keyword,
        (data, status) => {
          if (cancelled) return;
          setSearching(false);
          if (status !== window.kakao.maps.services.Status.OK) {
            setItems([]);
            setEmpty(true);
            return;
          }
          setEmpty(false);
          setItems(
            data.slice(0, 7).map((d) => ({
              name: d.place_name,
              address: d.road_address_name || d.address_name,
              lat: Number(d.y),
              lng: Number(d.x),
            })),
          );
        },
        { size: 7 },
      );
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, editing]);

  function choose(item: Suggestion) {
    onSelect({ lat: item.lat, lng: item.lng, address: item.name });
    setEditing(false);
    setItems([]);
    setQuery(item.name);
  }

  const open = editing && (items.length > 0 || searching || empty);

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            tone === 'emerald' ? 'bg-emerald-500' : 'bg-rose-500'
          }`}
        />
        <span className="w-8 shrink-0 text-slate-400">{label}</span>
        <input
          value={editing ? query : (pendingText ?? query)}
          onChange={(e) => {
            setEditing(true);
            setQuery(e.target.value);
          }}
          onFocus={() => setEditing(true)}
          // 목록 클릭이 blur 보다 먼저 처리되도록 살짝 늦춘다
          onBlur={() => setTimeout(() => setEditing(false), 150)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && items.length > 0) {
              e.preventDefault();
              choose(items[0]);
            } else if (e.key === 'Escape') {
              setEditing(false);
            }
          }}
          placeholder={placeholder ?? '장소 검색 또는 지도 선택'}
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-slate-400"
        />
      </div>

      {open && (
        <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/10 dark:bg-slate-800 dark:ring-white/10">
          {searching && items.length === 0 && (
            <li className="px-3 py-2 text-xs text-slate-400">검색 중…</li>
          )}
          {empty && items.length === 0 && !searching && (
            <li className="px-3 py-2 text-xs text-slate-400">검색 결과가 없습니다</li>
          )}
          {items.map((item, i) => (
            <li key={`${item.name}-${i}`}>
              <button
                type="button"
                // onClick 은 blur 뒤에 오므로 mouseDown 으로 받는다
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <span className="block truncate text-sm text-slate-800 dark:text-slate-100">
                  {item.name}
                </span>
                <span className="block truncate text-xs text-slate-400">{item.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
