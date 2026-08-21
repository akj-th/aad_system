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
          이동 후 지도에서 필지를 클릭해 선택하세요. 다시 클릭하면 해제됩니다.
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
