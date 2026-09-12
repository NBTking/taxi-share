'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Map, Polyline, CustomOverlayMap, useKakaoLoader } from 'react-kakao-maps-sdk';
import { haversineM } from '@/lib/geo';
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

/**
 * 이 픽셀 거리 안에 들어오면 한 마커로 합친다.
 * 마커(24px) + 라벨이 서로 닿기 시작하는 지점이 대략 이 정도다.
 */
const MARKER_MERGE_PX = 56;

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
  /** 축척이 바뀌면 화면상 간격이 달라지므로 묶음을 다시 계산해야 한다. */
  const [zoomLevel, setZoomLevel] = useState(level);
  const wrapperRef = useRef<HTMLDivElement>(null);

  /**
   * 화면에서 겹치는 핀을 하나로 묶는다.
   *
   * 거리 기준(예: 11m)으로 묶으면 지도를 축소했을 때 문제가 생긴다.
   * 실제로 1km 떨어진 두 지점도 축소하면 화면에서는 몇 픽셀 차이라 서로 가린다.
   * 그래서 지도 투영을 써서 **화면 픽셀 거리**로 묶는다.
   *
   * 투영을 아직 쓸 수 없으면(지도 로딩 전) 좌표가 같은 것만 묶는 방식으로 물러선다.
   *
   * (전역 Map 은 react-kakao-maps-sdk 의 Map 컴포넌트에 가려지므로 객체/배열을 쓴다)
   */
  const clusters = useMemo(() => {
    // 현재 축척에서 1픽셀이 몇 미터인지 구한다.
    // 지도 가로폭이 담고 있는 실제 거리 ÷ 화면 가로 픽셀.
    let metersPerPx = 0;
    const bounds = map?.getBounds();
    const widthPx = wrapperRef.current?.clientWidth ?? 0;
    if (bounds && widthPx > 0) {
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const acrossM = haversineM(
        { lat: sw.getLat(), lng: sw.getLng() },
        { lat: sw.getLat(), lng: ne.getLng() },
      );
      metersPerPx = acrossM / widthPx;
    }

    const groups: { key: string; position: LatLng; pins: MapPin[] }[] = [];
    for (const pin of pins) {
      const near = groups.find((g) => {
        const gapM = haversineM(g.position, pin.position);
        // 축척을 모르면(로딩 전) 좌표가 사실상 같은 것만 묶는다
        return metersPerPx > 0 ? gapM / metersPerPx < MARKER_MERGE_PX : gapM < 15;
      });
      if (near) near.pins.push(pin);
      else groups.push({ key: `${pin.kind}-${groups.length}`, position: pin.position, pins: [pin] });
    }
    return groups;
    // wrapperRef 는 반응형 값이 아니지만 축척이 바뀔 때마다 다시 계산되므로 충분하다
  }, [pins, map, zoomLevel]);

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
    // setBounds 는 축척을 바꾸지만 onZoomChanged 가 항상 오지는 않는다
    setZoomLevel(map.getLevel());
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
    <div ref={wrapperRef} className={`relative overflow-hidden rounded-xl ${className ?? ''}`}>
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
        onZoomChanged={(target) => setZoomLevel(target.getLevel())}
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

        {clusters.map((cluster) => (
          <CustomOverlayMap key={cluster.key} position={cluster.position} yAnchor={1}>
            <div className="flex -translate-y-1 flex-col items-center">
              {/* 겹친 핀은 라벨을 세로로 쌓아 누가 누군지 구분되게 한다 */}
              <span className="flex flex-col items-center whitespace-nowrap rounded-md bg-white/95 px-2 py-0.5 text-xs font-medium text-slate-800 shadow ring-1 ring-black/5">
                {cluster.pins.map((pin, i) => (
                  <span key={i}>{pin.label}</span>
                ))}
              </span>
              <span className="mt-0.5 flex gap-0.5">
                {cluster.pins.map((pin, i) => (
                  <span
                    key={i}
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white shadow ring-2 ring-white ${PIN_STYLE[pin.kind]}`}
                  >
                    {pin.order ?? ''}
                  </span>
                ))}
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
