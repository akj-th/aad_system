"use client";

import { useState } from "react";
import { useProjectStore } from "@/store/project";
import CompareSlider from "./CompareSlider";
import SketchCanvas from "./SketchCanvas";

const TIME_OPTIONS = ["맑은 낮", "황금시간대(늦은 오후)", "일몰 직후", "야간"];
const SEASON_OPTIONS = ["봄", "여름", "가을", "겨울"];

const TIME_EN: Record<string, string> = {
  "맑은 낮": "clear midday",
  "황금시간대(늦은 오후)": "golden hour, late afternoon",
  "일몰 직후": "dusk, just after sunset",
  야간: "night",
};
const SEASON_EN: Record<string, string> = {
  봄: "spring",
  여름: "summer",
  가을: "autumn",
  겨울: "winter",
};

/** captureId를 주면 그 캡처 기준으로 생성·비교(노드 확장 뷰용), 없으면 최신 캡처 */
export default function RenderPanel({ captureId }: { captureId?: string }) {
  const captures = useProjectStore((s) => s.captures);
  const addRender = useProjectStore((s) => s.addRender);
  const latest = captureId
    ? captures.find((c) => c.id === captureId)
    : captures[0];

  const [material, setMaterial] = useState(
    "light gray granite base, white stone panels, clear glass windows with dark aluminum frames",
  );
  const [timeOfDay, setTimeOfDay] = useState(TIME_OPTIONS[0]);
  const [season, setSeason] = useState(SEASON_OPTIONS[1]);
  const [extra, setExtra] = useState("");
  const [useSilhouette, setUseSilhouette] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  /** 결과 위 손스케치 재생성 루프 */
  const [sketchMode, setSketchMode] = useState(false);
  const [sketchImage, setSketchImage] = useState<string | null>(null);

  async function generate(resketch = false) {
    if (!latest) return;
    if (resketch && !sketchImage) {
      setError("스케치를 그린 뒤 재생성하세요");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 재생성 루프에서는 주석이 합성된 렌더 이미지를 입력으로 보낸다
          beauty: resketch ? sketchImage : latest.beauty,
          silhouette: latest.silhouette,
          options: {
            material,
            timeOfDay: TIME_EN[timeOfDay] ?? timeOfDay,
            season: SEASON_EN[season] ?? season,
            extra,
            useSilhouette,
            mode: resketch ? "resketch" : "initial",
          },
        }),
      });
      const json = (await res.json()) as {
        image?: string;
        prompt?: string;
        error?: string;
        detail?: string | null;
      };
      if (!res.ok || !json.image) {
        throw new Error(
          [json.error ?? "생성 실패", json.detail].filter(Boolean).join(" — "),
        );
      }
      addRender(latest.id, {
        image: json.image,
        prompt: json.prompt ?? "",
        options: {
          material: resketch ? `${material} (스케치 재생성)` : material,
          timeOfDay,
          season,
          extra,
          useSilhouette,
        },
      });
      setCompareId(null); // 최신 결과를 기본 비교 대상으로
      setSketchMode(false);
      setSketchImage(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setGenerating(false);
    }
  }

  const renders = latest?.renders ?? [];
  const compared = renders.find((r) => r.id === compareId) ?? renders[0];

  return (
    <section className="space-y-3">
      <h1 className="text-base font-bold text-zinc-900">렌더</h1>

      {!latest ? (
        <p className="text-xs text-zinc-400">먼저 2패스 캡처를 만드세요</p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">외장 재료</span>
            <textarea
              className="h-16 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              data-testid="render-material"
            />
          </label>

          <div className="flex gap-2">
            <label className="block flex-1 space-y-1">
              <span className="text-xs text-zinc-500">시간대</span>
              <select
                className="w-full rounded border border-zinc-300 px-1 py-1 text-xs"
                value={timeOfDay}
                onChange={(e) => setTimeOfDay(e.target.value)}
              >
                {TIME_OPTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block flex-1 space-y-1">
              <span className="text-xs text-zinc-500">계절</span>
              <select
                className="w-full rounded border border-zinc-300 px-1 py-1 text-xs"
                value={season}
                onChange={(e) => setSeason(e.target.value)}
              >
                {SEASON_OPTIONS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs text-zinc-500">추가 지시 (선택)</span>
            <textarea
              className="h-12 w-full rounded border border-zinc-300 px-2 py-1 text-xs"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
              placeholder="예: 저층부는 목재 루버"
              data-testid="render-extra"
            />
          </label>

          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={useSilhouette}
              onChange={(e) => setUseSilhouette(e.target.checked)}
              data-testid="render-use-silhouette"
            />
            실루엣을 형태 참조로 함께 전송
          </label>

          <button
            className="w-full rounded bg-emerald-600 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            onClick={() => generate(false)}
            disabled={generating}
            data-testid="render-button"
          >
            {generating ? "생성 중… (수십 초 걸릴 수 있음)" : "AI 리터칭 생성"}
          </button>
          {error && (
            <p className="text-xs whitespace-pre-wrap text-red-600" data-testid="render-error">
              {error}
            </p>
          )}

          {compared && (
            <div className="space-y-2" data-testid="render-result">
              {sketchMode ? (
                <>
                  <div className="rounded bg-amber-50 p-2 text-[11px] text-amber-800">
                    결과 위에 <strong>고칠 부분을 그리고 글로 적으세요</strong>. 주석이 있는
                    영역만 수정되고 나머지는 그대로 유지됩니다.
                  </div>
                  <SketchCanvas src={compared.image} onCommit={setSketchImage} />
                  <div className="flex gap-1">
                    <button
                      className="flex-1 rounded bg-zinc-100 py-1.5 text-xs hover:bg-zinc-200"
                      onClick={() => {
                        setSketchMode(false);
                        setSketchImage(null);
                      }}
                    >
                      취소
                    </button>
                    <button
                      className="flex-[2] rounded bg-emerald-600 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      onClick={() => generate(true)}
                      disabled={generating || !sketchImage}
                      data-testid="resketch-button"
                    >
                      {generating ? "재생성 중…" : "스케치대로 재생성"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <CompareSlider before={latest.beauty} after={compared.image} />
                  <button
                    className="w-full rounded border border-emerald-600 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                    onClick={() => setSketchMode(true)}
                    data-testid="sketch-mode"
                  >
                    ✏ 결과 위에 스케치해서 수정
                  </button>
                </>
              )}
              <p className="text-[10px] text-zinc-400">
                AI 생성 — 실제 설계안과 재질·주변 환경이 다를 수 있음
              </p>
              <div className="flex items-center justify-between text-xs">
                <a
                  href={compared.image}
                  download={`render-${compared.createdAt.replace(/[:.]/g, "-")}.png`}
                  className="text-blue-600 hover:underline"
                >
                  결과 다운로드
                </a>
                <span className="text-zinc-400">
                  {new Date(compared.createdAt).toLocaleTimeString("ko-KR")}
                  {compared.options.useSilhouette && " · 실루엣 참조"}
                </span>
              </div>
              {renders.length > 1 && (
                <div className="flex gap-1 overflow-x-auto">
                  {renders.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setCompareId(r.id)}
                      className={`shrink-0 rounded border-2 ${
                        r.id === compared.id
                          ? "border-emerald-600"
                          : "border-transparent"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.image}
                        alt="변형"
                        className="h-12 w-16 rounded object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
