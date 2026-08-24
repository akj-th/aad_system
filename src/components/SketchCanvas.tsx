"use client";

// 이미지 위 손스케치 주석 (M7 재생성 루프).
// 배경 이미지 + 사용자가 그린 선을 하나로 합성해 dataURL로 돌려준다.
// 설계자가 "여기를 유리로", "저층부에 클럽하우스" 식으로 그림과 글로 지시하는 통로.

import { useEffect, useRef, useState } from "react";

const COLORS = ["#111827", "#dc2626", "#2563eb", "#ffffff"] as const;
const WIDTHS = [2, 4, 8] as const;

export default function SketchCanvas({
  src,
  onCommit,
}: {
  src: string;
  /** 배경+주석 합성 dataURL. 주석이 없으면 null */
  onCommit: (dataUrl: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [color, setColor] = useState<string>(COLORS[1]);
  const [width, setWidth] = useState<number>(WIDTHS[1]);
  const [ready, setReady] = useState(false);

  // 배경 이미지 로드 후 캔버스 크기를 원본에 맞춘다 (합성 해상도 유지)
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.width;
      canvas.height = img.height;
      redraw();
      setReady(true);
    };
    img.src = src;
    dirty.current = false;
  }, [src]);

  function redraw() {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  }

  /** 화면 좌표 → 캔버스 픽셀 좌표 */
  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / r.width) * canvas.width,
      ((e.clientY - r.top) / r.height) * canvas.height,
    ];
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const ctx = canvas.getContext("2d")!;
    const [x, y] = toCanvas(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = color;
    // 캔버스 원본 해상도 기준이라 표시 배율만큼 굵기를 키운다
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    ctx.lineWidth = width * scale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawing.current = true;
  }

  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const [x, y] = toCanvas(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  }

  function end() {
    if (!drawing.current) return;
    drawing.current = false;
    commit();
  }

  function commit() {
    onCommit(dirty.current ? canvasRef.current!.toDataURL("image/png") : null);
  }

  function clear() {
    redraw();
    dirty.current = false;
    onCommit(null);
  }

  return (
    <div className="space-y-1" data-testid="sketch-canvas">
      <canvas
        ref={canvasRef}
        className="w-full cursor-crosshair touch-none rounded border border-zinc-200"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
      />
      <div className="flex items-center gap-2 text-[11px]">
        <span className="text-zinc-500">펜</span>
        {COLORS.map((c) => (
          <button
            key={c}
            className={`h-4 w-4 rounded-full border ${color === c ? "ring-2 ring-blue-500" : "border-zinc-300"}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`색상 ${c}`}
          />
        ))}
        {WIDTHS.map((w) => (
          <button
            key={w}
            className={`rounded px-1.5 py-0.5 ${width === w ? "bg-blue-600 text-white" : "bg-zinc-100"}`}
            onClick={() => setWidth(w)}
          >
            {w}
          </button>
        ))}
        <button className="ml-auto text-zinc-400 hover:text-red-600" onClick={clear}>
          지우기
        </button>
      </div>
      {!ready && <p className="text-[10px] text-zinc-400">이미지 불러오는 중…</p>}
    </div>
  );
}
