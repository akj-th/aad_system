import {
  getImageProvider,
  RenderError,
} from "@/lib/server/imageProvider";

export interface RenderOptions {
  material: string;
  timeOfDay: string;
  season: string;
  extra?: string;
  /** (b)안: 실루엣을 형태 참조로 함께 보낸다 */
  useSilhouette?: boolean;
  /**
   * initial: 흰색 매스 캡처 → 포토리얼 렌더
   * resketch: 렌더 결과에 손스케치 주석을 얹은 이미지 → 주석대로 수정 (재생성 루프)
   */
  mode?: "initial" | "resketch";
}

export interface RenderRequestBody {
  beauty: string; // dataURL
  silhouette?: string; // dataURL
  options: RenderOptions;
}

// B-4 Phase 4 템플릿의 Gemini(마스크 미지원) 적응판.
// 형태·층수·개구부·카메라 고정을 최우선 제약으로 명시한다.
/** 재생성 루프: 주석이 그려진 렌더 이미지를 입력으로 받아 주석대로만 고친다 */
function buildResketchPrompt(o: RenderOptions): string {
  const lines = [
    "The input image is a photorealistic architectural visualization with hand-drawn",
    "annotations (lines, arrows, shapes, and text) marking requested design changes.",
    "",
    "Produce a clean photorealistic rendering that applies those annotated changes.",
    "",
    "CRITICAL CONSTRAINT: Remove every hand-drawn mark from the output. Keep the",
    "camera angle, the building's overall mass, floor count, and the surrounding",
    "context EXACTLY as in the input. Change ONLY what the annotations indicate.",
    "Everything not annotated must stay pixel-faithful to the input.",
    "",
    `Materials context — ${o.material}. Time of day — ${o.timeOfDay}. Season — ${o.season}.`,
    "Korean urban context. No text, no labels, no watermarks, no signage.",
  ];
  if (o.extra?.trim()) {
    lines.push("", "Additional instruction for the annotated areas:", o.extra.trim());
  }
  return lines.join("\n");
}

function buildPrompt(o: RenderOptions, withSilhouette: boolean): string {
  const lines = [
    "Photorealistic architectural visualization of the white building in the first input image.",
    "",
    "CRITICAL CONSTRAINT: Preserve the building's geometry, mass proportions,",
    "floor count, roof shape, window and opening layout, and the camera angle",
    "EXACTLY as shown. Do not add, remove, resize, or reshape any part of the",
    "building. Do not change the perspective or crop.",
  ];
  if (withSilhouette) {
    lines.push(
      "",
      "The second input image marks the exact building silhouette in magenta.",
      "The building must stay strictly within that silhouette; everything outside",
      "it is surroundings to be rendered realistically.",
    );
  }
  lines.push(
    "",
    `Apply: exterior materials — ${o.material}. Time of day — ${o.timeOfDay}. Season — ${o.season}.`,
    "Add a realistic sky, surrounding vegetation, street furniture, and a few",
    "people for scale, consistent with a Korean urban context. Keep the real",
    "surrounding buildings and roads recognizable.",
    "Lighting and shadows must match the sun position already visible in the image.",
    "",
    "No text, no labels, no watermarks, no signage.",
  );
  if (o.extra?.trim()) lines.push(o.extra.trim());
  return lines.join("\n");
}

function stripDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function POST(request: Request) {
  let body: RenderRequestBody;
  try {
    body = (await request.json()) as RenderRequestBody;
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.beauty || !body.options?.material) {
    return Response.json(
      { error: "beauty image and options.material are required" },
      { status: 400 },
    );
  }

  const resketch = body.options.mode === "resketch";
  // 재생성 루프에서는 실루엣을 보내지 않는다 — 형태 기준은 입력 렌더 자체다
  const withSilhouette = !resketch && !!(body.options.useSilhouette && body.silhouette);
  const prompt = resketch
    ? buildResketchPrompt(body.options)
    : buildPrompt(body.options, withSilhouette);

  try {
    const provider = getImageProvider();
    const result = await provider.render({
      beautyPng: stripDataUrl(body.beauty),
      silhouettePng: withSilhouette
        ? stripDataUrl(body.silhouette!)
        : undefined,
      prompt,
    });
    return Response.json({ image: result.image, prompt, provider: provider.name });
  } catch (e) {
    if (e instanceof RenderError) {
      return Response.json(
        { error: e.message, detail: e.detail ?? null },
        { status: 502 },
      );
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "render failed" },
      { status: 500 },
    );
  }
}
