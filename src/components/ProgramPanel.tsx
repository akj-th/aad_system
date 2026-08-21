"use client";

// 규모·용도 프로그램 (M2 입력 + 주차 산정). 계산은 전부 결정론 — AI 없음.

import { useEffect, useMemo } from "react";
import { useProjectStore } from "@/store/project";
import { calcAreas } from "@/lib/regulation/calc";
import { officialSiteArea } from "@/lib/regulation/landinfo";
import { calcParking, PARKING_CATEGORIES } from "@/lib/regulation/parking";

function fmt(n: number, digits = 1): string {
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export default function ProgramPanel() {
  const site = useProjectStore((s) => s.site);
  const regulation = useProjectStore((s) => s.regulation);
  const program = useProjectStore((s) => s.program);
  const updateProgram = useProjectStore((s) => s.updateProgram);

  const { area: baseArea } = officialSiteArea(site.parcels);
  const maxGross =
    regulation.far.applied > 0
      ? calcAreas(baseArea, regulation.bcr.applied, regulation.far.applied, program.floorHeight ?? 3).maxGrossArea
      : 0;

  // 계획 연면적 기본값 = 법정 최대 연면적 (사용자가 바꾸지 않았을 때)
  useEffect(() => {
    if (program.grossArea === 0 && maxGross > 0) {
      updateProgram({ grossArea: Math.round(maxGross) });
    }
  }, [maxGross, program.grossArea, updateProgram]);

  const ratioSum = program.uses.reduce((s, u) => s + u.ratio, 0);
  const addr = site.parcels[0]?.addr ?? "";

  const parkingResult = useMemo(
    () =>
      calcParking(
        program.uses.map((u) => ({
          code: u.code,
          area: (program.grossArea * u.ratio) / 100,
        })),
        addr,
      ),
    [program.uses, program.grossArea, addr],
  );

  // 산정 결과를 ProjectState.program.parking에 기록
  useEffect(() => {
    const legal = parkingResult.legal;
    const basis = `${parkingResult.tableName} · 끝수 ${parkingResult.roundingBasis}`;
    if (program.parking.legal !== legal || program.parking.basis !== basis) {
      updateProgram({ parking: { legal, recommended: legal, basis } });
    }
  }, [parkingResult, program.parking, updateProgram]);

  function addUse() {
    const used = new Set(program.uses.map((u) => u.code));
    const next = PARKING_CATEGORIES.find((c) => !used.has(c.code));
    if (!next) return;
    updateProgram({
      uses: [
        ...program.uses,
        { code: next.code, name: next.name, ratio: Math.max(0, 100 - ratioSum) },
      ],
    });
  }

  function updateUse(i: number, patch: { code?: string; ratio?: number }) {
    updateProgram({
      uses: program.uses.map((u, j) => {
        if (j !== i) return u;
        const code = patch.code ?? u.code;
        return {
          ...u,
          code,
          name: PARKING_CATEGORIES.find((c) => c.code === code)?.name ?? code,
          ratio: patch.ratio ?? u.ratio,
        };
      }),
    });
  }

  function removeUse(i: number) {
    updateProgram({ uses: program.uses.filter((_, j) => j !== i) });
  }

  const exclusiveArea = program.grossArea * program.efficiency;

  return (
    <section className="space-y-3">
      <h1 className="text-base font-bold text-zinc-900">규모·용도 프로그램</h1>

      {!regulation.useZone ? (
        <p className="text-xs text-zinc-400">법규 조회가 끝나면 최대 연면적이 채워집니다</p>
      ) : (
        <>
          <label className="block text-xs">
            <span className="text-zinc-500">계획 연면적 (㎡)</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                step={10}
                value={program.grossArea}
                onChange={(e) => updateProgram({ grossArea: Number(e.target.value) || 0 })}
                className="w-32 rounded border border-zinc-300 px-2 py-1"
                data-testid="program-gross-area"
              />
              <button
                className="rounded bg-zinc-100 px-2 py-1 text-[11px] hover:bg-zinc-200"
                onClick={() => updateProgram({ grossArea: Math.round(maxGross) })}
              >
                법정 최대({fmt(maxGross, 0)})로
              </button>
            </div>
            {program.grossArea > maxGross + 0.5 && (
              <p className="mt-1 text-[10px] text-red-600">
                법정 최대 연면적 {fmt(maxGross, 0)}㎡ 초과
              </p>
            )}
          </label>

          <label className="flex items-center gap-2 text-xs">
            <span className="text-zinc-500">전용률</span>
            <input
              type="number"
              min={0.3}
              max={1}
              step={0.01}
              value={program.efficiency}
              onChange={(e) => updateProgram({ efficiency: Number(e.target.value) || 0 })}
              className="w-20 rounded border border-zinc-300 px-2 py-1"
            />
            <span className="text-[10px] text-zinc-400">
              → 전용면적 약 {fmt(exclusiveArea, 0)}㎡ (사용자 입력)
            </span>
          </label>

          {/* 용도 구성 */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-zinc-700">
                용도 구성{" "}
                <span className={`font-normal ${ratioSum === 100 ? "text-zinc-400" : "text-red-600"}`}>
                  합 {ratioSum}%
                </span>
              </span>
              <button
                className="rounded bg-zinc-100 px-2 py-0.5 text-[11px] hover:bg-zinc-200"
                onClick={addUse}
                data-testid="program-add-use"
              >
                + 용도
              </button>
            </div>
            {program.uses.length === 0 && (
              <p className="text-[11px] text-zinc-400">용도를 추가하면 주차 대수가 산정됩니다</p>
            )}
            {program.uses.map((u, i) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <select
                  className="min-w-0 flex-1 rounded border border-zinc-300 px-1 py-1"
                  value={u.code}
                  onChange={(e) => updateUse(i, { code: e.target.value })}
                  data-testid={`program-use-code-${i}`}
                >
                  {PARKING_CATEGORIES.map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={u.ratio}
                  onChange={(e) => updateUse(i, { ratio: Number(e.target.value) || 0 })}
                  className="w-14 rounded border border-zinc-300 px-1 py-1"
                  data-testid={`program-use-ratio-${i}`}
                />
                <span className="text-zinc-400">%</span>
                <button className="text-zinc-400 hover:text-red-600" onClick={() => removeUse(i)}>
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* 주차 산정 */}
          {parkingResult.lines.length > 0 && (
            <div className="space-y-1 rounded bg-blue-50 p-3 text-xs" data-testid="parking-result">
              <p>
                법정 주차대수{" "}
                <strong data-testid="parking-legal">{parkingResult.legal}대</strong>{" "}
                <span className="text-[10px] text-zinc-400">
                  (산정값 {fmt(parkingResult.rawTotal, 2)} · {parkingResult.tableName})
                </span>
              </p>
              {parkingResult.nationalLegal !== parkingResult.legal && (
                <p className="text-[10px] text-zinc-400">
                  참고: 주차장법 시행령 기준 {parkingResult.nationalLegal}대
                </p>
              )}
              <ul className="space-y-0.5 text-[10px] text-zinc-500">
                {parkingResult.lines.map((l) => (
                  <li key={l.code}>
                    {l.name} {fmt(l.area, 0)}㎡ ÷ {l.areaPerSpace} = {fmt(l.raw, 2)}대
                    <span className="text-zinc-400"> — {l.basis}</span>
                    {l.caveat && <span className="block text-amber-700">⚠ {l.caveat}</span>}
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-zinc-400">끝수 처리: {parkingResult.roundingBasis}</p>
            </div>
          )}
        </>
      )}

      <p className="border-t border-zinc-200 pt-2 text-[10px] font-medium text-amber-700">
        참고용 검토이며 최종 확인은 담당 건축사 책임
      </p>
    </section>
  );
}
