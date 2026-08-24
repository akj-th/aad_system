"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import {
  flyTo,
  getContourState,
  getLabelsVisible,
  setContour,
  setLabelsVisible,
} from "@/lib/map/controller";
import { setView2D } from "@/lib/map/map2d";
import { eumLandUrl } from "@/lib/regulation/landinfo";
import type { SearchResultItem } from "@/app/api/vworld/search/route";

const CONTOUR_SPACINGS = [1, 5, 10] as const;

function formatArea(sqm: number): string {
  return `${sqm.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}㎡ (${(
    sqm / 3.3058
  ).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}평)`;
}

export default function SitePanel() {
  const site = useProjectStore((s) => s.site);
  const removeParcel = useProjectStore((s) => s.removeParcel);
  const clearSite = useProjectStore((s) => s.clearSite);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 초기값은 지도의 실제 상태에서 읽는다 (패널이 닫혔다 열려도 어긋나지 않게)
  const [contourOn, setContourOn] = useState(() => getContourState().enabled);
  const [contourSpacing, setContourSpacing] = useState<number>(
    () => getContourState().spacing,
  );
  const [labelsOn, setLabelsOn] = useState(() => getLabelsVisible());

  // 대표 필지 = 면적 최대 (토지특성 표시 기준)
  const rep = site.parcels.reduce<(typeof site.parcels)[number] | undefined>(
    (best, p) =>
      !best || (p.officialArea ?? p.area) > (best.officialArea ?? best.area) ? p : best,
    undefined,
  );

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/vworld/search?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as {
        items?: SearchResultItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "검색 실패");
      setResults(json.items ?? []);
      if ((json.items ?? []).length === 0) setSearchError("검색 결과가 없습니다");
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  }

  function toggleContour(on: boolean, spacing: number) {
    setContourOn(on);
    setContourSpacing(spacing);
    setContour(on, spacing);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-base font-bold text-zinc-900">대지</h1>

      {/* 주소 검색 */}
      <section className="space-y-2">
        <h2 className="font-semibold text-zinc-700">주소 검색</h2>
        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 outline-none focus:border-blue-500"
            placeholder="예: 압구정로29길 17"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            data-testid="search-input"
          />
          <button
            className="rounded bg-blue-600 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            onClick={runSearch}
            disabled={searching}
            data-testid="search-button"
          >
            {searching ? "…" : "검색"}
          </button>
        </div>
        {searchError && <p className="text-xs text-red-600">{searchError}</p>}
        {results.length > 0 && (
          <ul className="divide-y divide-zinc-100 rounded border border-zinc-200">
            {results.map((r, i) => (
              <li key={i}>
                <button
                  className="w-full px-2 py-1.5 text-left hover:bg-blue-50"
                  onClick={() => {
                    setView2D(r.lon, r.lat, 18);
                    flyTo(r.lon, r.lat);
                    setResults([]);
                  }}
                  data-testid={`search-result-${i}`}
                >
                  <span className="block truncate">{r.title}</span>
                  {r.parcelAddr && r.parcelAddr !== r.title && (
                    <span className="block truncate text-xs text-zinc-500">
                      {r.parcelAddr}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-400">
          이동 후 2D 지도에서 필지를 클릭해 선택하세요. 다시 클릭하면 해제됩니다. (z16 이상에서 필지 표시)
        </p>
      </section>

      {/* 선택 필지 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-zinc-700">
            선택 필지{" "}
            <span className="font-normal text-zinc-400">
              {site.parcels.length}
            </span>
          </h2>
          {site.parcels.length > 0 && (
            <button
              className="text-xs text-zinc-500 hover:text-red-600"
              onClick={clearSite}
            >
              전체 해제
            </button>
          )}
        </div>
        {site.parcels.length === 0 ? (
          <p className="text-xs text-zinc-400">선택된 필지가 없습니다</p>
        ) : (
          <ul
            className="divide-y divide-zinc-100 rounded border border-zinc-200"
            data-testid="parcel-list"
          >
            {site.parcels.map((p) => (
              <li
                key={p.pnu}
                className="flex items-center justify-between gap-2 px-2 py-1.5"
              >
                <div className="min-w-0">
                  <span className="block truncate">{p.addr || p.jibun}</span>
                  <span className="block text-xs text-zinc-500">
                    {formatArea(p.area)}
                    {p.jimok && ` · 지목 ${p.jimok}`}
                  </span>
                </div>
                <button
                  className="shrink-0 text-xs text-zinc-400 hover:text-red-600"
                  onClick={() => removeParcel(p.pnu)}
                >
                  해제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 대지 요약 */}
      {site.parcels.length > 0 && (
        <section className="space-y-1 rounded bg-zinc-50 p-3">
          <h2 className="font-semibold text-zinc-700">대지 요약</h2>
          <p data-testid="site-area">
            대지면적 <strong>{formatArea(site.area)}</strong>
          </p>
          <p className="text-xs text-zinc-500">
            {site.operation === "merge"
              ? `합필 ${site.parcels.length}필지 (geometry union)`
              : "단필"}
            {" · 도형 기준 면적으로 지적공부와 다를 수 있음"}
          </p>
        </section>
      )}

      {/* 토지특성 — 토지특성 API에서 함께 오는 대지 조건 */}
      {rep && (rep.roadSide || rep.terrain || rep.shape) && (
        <section className="space-y-1" data-testid="land-characteristics">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-zinc-700">토지특성</h2>
            <a
              href={eumLandUrl(rep.pnu)}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-blue-600 hover:underline"
              data-testid="eum-link"
            >
              토지이음에서 확인 ↗
            </a>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {(
              [
                ["도로접면", rep.roadSide],
                ["지형고저", rep.terrain],
                ["토지형상", rep.shape],
                ["이용상황", rep.useSituation],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-zinc-500">{k}</dt>
                  <dd className="truncate font-medium text-zinc-700">{v}</dd>
                </div>
              ))}
          </dl>
          <p className="text-[10px] text-zinc-400">
            토지특성 API (개별공시지가 조사자료) — 접도 폭·경사는 별도 실측 필요
          </p>
        </section>
      )}

      {/* 기존 건축물 (건축물대장) */}
      {site.existingBuildings && site.existingBuildings.length > 0 && (
        <section className="space-y-1" data-testid="existing-buildings">
          <h2 className="font-semibold text-zinc-700">
            기존 건축물{" "}
            <span className="font-normal text-zinc-400">
              {site.existingBuildings.length}동
            </span>
          </h2>
          <ul className="space-y-1">
            {site.existingBuildings.map((b, i) => (
              <li key={i} className="rounded bg-zinc-50 p-2 text-xs">
                <p className="font-medium text-zinc-700">
                  {b.name || b.mainUse || "건축물"}
                  {b.detailUse && b.detailUse !== b.mainUse && (
                    <span className="font-normal text-zinc-500"> · {b.detailUse}</span>
                  )}
                </p>
                <p className="text-[11px] text-zinc-500">
                  {[
                    b.structure,
                    b.groundFloors != null && `지상 ${b.groundFloors}층`,
                    b.basementFloors ? `지하 ${b.basementFloors}층` : null,
                    b.height != null && `H ${b.height}m`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="text-[11px] text-zinc-500">
                  연면적 {b.totalArea?.toLocaleString("ko-KR") ?? "—"}㎡ · 건축면적{" "}
                  {b.buildingArea?.toLocaleString("ko-KR") ?? "—"}㎡
                  {b.bcr != null && ` · 건폐율 ${b.bcr}%`}
                  {b.far != null && ` · 용적률 ${b.far}%`}
                </p>
                <p className="text-[10px] text-zinc-400">
                  {b.approvedAt ? `사용승인 ${b.approvedAt}` : "사용승인일 미상"} ·{" "}
                  {b.registerType || "건축물대장"}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-zinc-400">
            신축 검토 시 철거 대상 — 대장 기재값이며 현황과 다를 수 있음
          </p>
        </section>
      )}

      {/* 지도 명칭 */}
      <section className="space-y-1">
        <h2 className="font-semibold text-zinc-700">지도 명칭</h2>
        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={labelsOn}
            onChange={(e) => {
              setLabelsOn(e.target.checked);
              setLabelsVisible(e.target.checked);
            }}
            data-testid="labels-toggle"
          />
          지명·건물명·POI 표시
        </label>
      </section>

      {/* 등고선 */}
      <section className="space-y-2">
        <h2 className="font-semibold text-zinc-700">등고선</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={contourOn}
              onChange={(e) => toggleContour(e.target.checked, contourSpacing)}
              data-testid="contour-toggle"
            />
            표시
          </label>
          <div className="flex gap-1">
            {CONTOUR_SPACINGS.map((s) => (
              <button
                key={s}
                className={`rounded px-2 py-0.5 text-xs ${
                  contourSpacing === s
                    ? "bg-blue-600 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
                }`}
                onClick={() => toggleContour(contourOn, s)}
              >
                {s}m
              </button>
            ))}
          </div>
        </div>
      </section>
    </section>
  );
}
