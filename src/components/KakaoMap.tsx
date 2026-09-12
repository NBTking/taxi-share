'use client';

import { useEffect, useState } from 'react';
import { Map, Polyline, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk';
import type { LatLng } from '@/lib/types';

/**
 * 카카오 지도 래퍼.
 *
 * SDK 로딩은 useKakaoLoader 가 전역에서 한 번만 처리하므로
 * 이 컴포넌트를 여러 화면에서 써도 스크립트가 중복 로드되지 않는다.
 */

export type PinKind = 'origin' | 'destination' | 'pickup' | 'dropoff';

export type MapPin = {
  position: LatLng;
  label: string;
  kind: PinKind;
  /** 경유 순번. 주면 핀에 숫자가 찍힌다. */
  order?: number;
};

const PIN_STYLE: Record<PinKind, string> = {
  origin: 'bg-emerald-500',
  destination: 'bg-rose-500',
  pickup: 'bg-sky-500',
  dropoff: 'bg-slate-500',
};

type Props = {
  center: LatLng;
  level?: number;
  pins?: MapPin[];
  /** 경로 폴리라인 */
  path?: LatLng[];
  /** 지도를 클릭했을 때. 주면 커서가 십자로 바뀐다. */
  onPick?: (point: LatLng) => void;
  /** 핀이 2개 이상이면 전부 보이도록 자동으로 축척을 맞춘다. */
  fitPins?: boolean;
  className?: string;
};

export function KakaoMap({
  center,
  level = 6,
  pins = [],
  path,
  onPick,
  fitPins = true,
  className,
}: Props) {
  const [map, setMap] = useState<kakao.maps.Map | null>(null);

  // center/level 만으로는 출발지와 도착지를 한 화면에 담을 수 없다.
  // (도착지를 중심에 두면 출발지가 화면 밖으로 나간다)
  useEffect(() => {
    if (!map || !fitPins || pins.length < 2 || !window.kakao?.maps) return;
    const bounds = new window.kakao.maps.LatLngBounds();
    for (const pin of pins) {
      bounds.extend(new window.kakao.maps.LatLng(pin.position.lat, pin.position.lng));
    }
    // 핀이 가장자리에 붙지 않도록 여백을 준다
    map.setBounds(bounds, 48, 24, 24, 24);
  }, [map, pins, fitPins]);

  const [loading, error] = useKakaoLoader({
    appkey: process.env.NEXT_PUBLIC_KAKAO_MAP_KEY!,
    // 좌표 → 주소 변환에 필요하다
    libraries: ['services'],
    // SDK 기본값이 프로토콜 상대경로("//dapi.kakao.com/...")라
    // http 인 localhost 에서는 http 로 요청되어 브라우저가 ERR_BLOCKED_BY_ORB 로 막는다.
    // 배포본(https)은 우연히 동작하지만 로컬 개발이 전부 깨지므로 https 를 못박는다.
    url: 'https://dapi.kakao.com/v2/maps/sdk.js',
  });

  if (error) {
    // 실무에서 이 화면을 보는 이유는 십중팔구 도메인 미등록이다.
    return (
      <div className={`flex items-center justify-center rounded-xl bg-rose-50 p-6 text-center text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 ${className ?? ''}`}>
        <div>
          <p className="font-semibold">지도를 불러오지 못했습니다</p>
          <p className="mt-1 opacity-80">
            Kakao Developers &gt; 앱 &gt; 일반 &gt; 플랫폼에 현재 도메인이 등록되어 있는지 확인하세요.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-xl ${className ?? ''}`}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-100 text-sm text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          지도 불러오는 중…
        </div>
      )}

      <Map
        center={center}
        level={level}
        isPanto
        onCreate={setMap}
        style={{ width: '100%', height: '100%' }}
        onClick={
          onPick
            ? (_map, mouseEvent) =>
                onPick({
                  lat: mouseEvent.latLng.getLat(),
                  lng: mouseEvent.latLng.getLng(),
                })
            : undefined
        }
      >
        {path && path.length > 1 && (
          <Polyline
            path={path}
            strokeWeight={5}
            strokeColor="#2563eb"
            strokeOpacity={0.8}
            strokeStyle="solid"
          />
        )}

        {pins.map((pin, i) => (
          <CustomOverlayMap key={`${pin.kind}-${i}`} position={pin.position} yAnchor={1}>
            <div className="flex -translate-y-1 flex-col items-center">
              <span className="whitespace-nowrap rounded-md bg-white/95 px-2 py-0.5 text-xs font-medium text-slate-800 shadow ring-1 ring-black/5">
                {pin.label}
              </span>
              <span
                className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white ${PIN_STYLE[pin.kind]}`}
              >
                {pin.order ?? ''}
              </span>
            </div>
          </CustomOverlayMap>
        ))}
      </Map>
    </div>
  );
}

/**
 * 좌표 → 도로명/지번 주소.
 *
 * 우리 스키마는 주소를 필수로 요구하는데(origin_address 등),
 * 지도를 클릭하면 좌표만 나오므로 변환이 필요하다.
 * services 라이브러리가 로드된 뒤에만 동작하므로 실패하면 좌표 문자열로 대체한다.
 */
export async function coordToAddress(point: LatLng): Promise<string> {
  const fallback = `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`;

  // 현재 위치는 SDK 로딩보다 먼저 도착할 수 있다.
  // 그때 바로 포기하면 주소 대신 좌표가 찍히므로 잠깐 기다린다.
  const ready = await waitForServices(4000);
  if (!ready) return fallback;

  return new Promise((resolve) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.coord2Address(point.lng, point.lat, (result, status) => {
      if (status !== window.kakao.maps.services.Status.OK || result.length === 0) {
        resolve(fallback);
        return;
      }
      const first = result[0];
      resolve(first.road_address?.address_name ?? first.address?.address_name ?? fallback);
    });
  });
}

/** services 라이브러리가 준비될 때까지 짧게 기다린다. */
export function waitForServices(timeoutMs: number): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.kakao?.maps?.services) return Promise.resolve(true);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.kakao?.maps?.services) {
        clearInterval(timer);
        resolve(true);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
}
