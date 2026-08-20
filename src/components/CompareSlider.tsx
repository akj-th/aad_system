"use client";

import { useState } from "react";

/** 원본/결과 좌우 비교 슬라이더. 왼쪽=before, 오른쪽=after */
export default function CompareSlider({
  before,
  after,
}: {
  before: string;
  after: string;
}) {
  const [pos, setPos] = useState(50);

  return (
    <div className="space-y-1">
      <div className="relative w-full overflow-hidden rounded border border-zinc-200 select-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={after} alt="AI 결과" className="block w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={before}
          alt="원본 캡처"
          className="absolute inset-0 block h-full w-full object-cover"
          draggable={false}
          style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]"
          style={{ left: `${pos}%` }}
        />
        <span className="absolute left-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
          원본
        </span>
        <span className="absolute right-1 top-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
          AI
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        className="w-full"
        aria-label="비교 슬라이더"
        data-testid="compare-slider"
      />
    </div>
  );
}
