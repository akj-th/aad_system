// AI 리터칭 프로바이더 추상화 (C-6: 교체 가능하게).
// 현재 구현은 Gemini 이미지 API 하나지만, 로컬 모델·타 프로바이더 교체를
// 여기 인터페이스 뒤에서 처리한다. 서버 전용 — API 키를 다루므로 클라이언트 금지.

export interface RenderRequest {
  /** base64 PNG (dataURL 접두어 없이) */
  beautyPng: string;
  /** (b)안: 마젠타 실루엣 참조 이미지 */
  silhouettePng?: string;
  prompt: string;
}

export interface RenderResult {
  /** dataURL 형태의 결과 이미지 */
  image: string;
}

export class RenderError extends Error {
  constructor(
    message: string,
    /** 안전 필터 등 사용자에게 그대로 보여줄 상세 */
    public readonly detail?: string,
  ) {
    super(message);
  }
}

export interface ImageProvider {
  readonly name: string;
  render(req: RenderRequest): Promise<RenderResult>;
}

// --- Gemini (generativelanguage.googleapis.com, Interactions API) -----------
// 형식은 2026-08 기준 공식 문서 + 라이브 호출로 검증:
//   POST /v1beta/interactions  { model, input: [{type:text},{type:image,...}] }
//   응답: steps[] 중 type=model_output 의 content[]에 {type:image, data(base64)}
// 마스크 인페인팅은 미지원 — 프롬프트로 형태 보존을 지시한다.

const GEMINI_MODEL = "gemini-3.1-flash-image";

interface GeminiStep {
  type: string;
  content?: { type: string; mime_type?: string; data?: string; text?: string }[];
}

interface GeminiInteraction {
  status?: string;
  steps?: GeminiStep[];
  error?: { message?: string };
}

class GeminiProvider implements ImageProvider {
  readonly name = "gemini";

  async render(req: RenderRequest): Promise<RenderResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new RenderError("GEMINI_API_KEY is not set in .env.local");

    const input: Record<string, string>[] = [
      { type: "text", text: req.prompt },
      { type: "image", mime_type: "image/png", data: req.beautyPng },
    ];
    if (req.silhouettePng) {
      input.push({
        type: "image",
        mime_type: "image/png",
        data: req.silhouettePng,
      });
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: GEMINI_MODEL, input }),
      },
    );

    const json = (await res.json().catch(() => null)) as GeminiInteraction | null;
    if (!res.ok) {
      throw new RenderError(
        `Gemini API 오류 (HTTP ${res.status})`,
        json?.error?.message,
      );
    }
    if (!json) throw new RenderError("Gemini 응답을 해석할 수 없습니다");

    const output = json.steps?.find((s) => s.type === "model_output");
    const imagePart = output?.content?.find(
      (p) => p.type === "image" && p.data,
    );
    if (!imagePart?.data) {
      // 이미지 없이 텍스트만 오면 대부분 안전 필터 거부 — 사유를 그대로 전달
      const text = output?.content
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join(" ");
      throw new RenderError(
        "이미지가 생성되지 않았습니다 (안전 필터 거부 가능성)",
        text || `status: ${json.status ?? "unknown"}`,
      );
    }

    const mime = imagePart.mime_type ?? "image/png";
    return { image: `data:${mime};base64,${imagePart.data}` };
  }
}

const providers: Record<string, ImageProvider> = {
  gemini: new GeminiProvider(),
};

export function getImageProvider(): ImageProvider {
  const name = process.env.IMAGE_PROVIDER ?? "gemini";
  const provider = providers[name];
  if (!provider) throw new RenderError(`unknown image provider: ${name}`);
  return provider;
}
