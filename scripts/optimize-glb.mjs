// SketchUp 등에서 내보낸 glb를 브이월드 3D 뷰어가 감당할 수 있게 정리한다.
//   node scripts/optimize-glb.mjs "C:/경로/모델.glb" [출력.glb]
//
// 핵심은 메시 조각 병합(join)이다. 조각이 수만 개면 Cesium이 로딩 중
// "Maximum call stack size exceeded"로 렌더 루프를 멈춘다.
// 형태를 바꾸는 simplify와 호환성이 불확실한 draco/instancing은 끈다.

import { execFileSync } from "node:child_process";
import { existsSync, statSync, readFileSync } from "node:fs";
import { dirname, basename, extname, join } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error('사용법: node scripts/optimize-glb.mjs "C:/경로/모델.glb" [출력.glb]');
  process.exit(1);
}
if (!existsSync(input)) {
  console.error(`파일을 찾을 수 없습니다: ${input}`);
  process.exit(1);
}
const output =
  process.argv[3] ??
  join(dirname(input), `${basename(input, extname(input))}-optimized.glb`);

/** glb의 glTF JSON 청크에서 구조 통계를 읽는다 */
function stats(path) {
  const buf = readFileSync(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) return null;
  let off = 12;
  while (off + 8 <= buf.byteLength) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    if (type === 0x4e4f534a) {
      const json = JSON.parse(
        new TextDecoder().decode(new Uint8Array(buf.buffer, buf.byteOffset + off + 8, len)),
      );
      return {
        MB: +(buf.length / 1048576).toFixed(1),
        nodes: (json.nodes ?? []).length,
        meshes: (json.meshes ?? []).length,
        prims: (json.meshes ?? []).reduce((n, m) => n + (m.primitives?.length ?? 0), 0),
        materials: (json.materials ?? []).length,
        extensions: json.extensionsUsed ?? [],
      };
    }
    off += 8 + len;
  }
  return null;
}

const before = stats(input);
console.log("입력:", input);
if (before) console.log("  ", JSON.stringify(before));

console.log("\n병합 중… (조각이 많으면 몇 분 걸릴 수 있습니다)");
// npx 셸 래퍼 대신 설치된 CLI를 직접 실행한다 (Windows에서 execFile이 .cmd를 못 찾는 경우가 있다)
const cliEntry = join(process.cwd(), "node_modules", "@gltf-transform", "cli", "bin", "cli.js");
execFileSync(
  process.execPath,
  [
    cliEntry,
    "optimize",
    input,
    output,
    // 형태를 바꾸는 단순화는 끈다 — 우리 시스템은 형태 정합이 핵심이다
    "--simplify", "false",
    // 브이월드 Cesium 호환성 우선: draco 압축·GPU 인스턴싱 확장 사용 안 함
    "--compress", "false",
    "--instance", "false",
  ],
  { stdio: "inherit", cwd: process.cwd() },
);

const after = stats(output);
console.log("\n출력:", output);
if (after) console.log("  ", JSON.stringify(after));
if (before && after) {
  console.log(
    `\n조각 ${before.prims.toLocaleString()} → ${after.prims.toLocaleString()} · ` +
      `노드 ${before.nodes.toLocaleString()} → ${after.nodes.toLocaleString()} · ` +
      `${before.MB}MB → ${after.MB}MB`,
  );
  console.log(after.prims < 20000 ? "판정: 업로드 가능" : "판정: 아직 조각이 많습니다 — 재질 수를 줄여보세요");
}
if (statSync(output).size > 80 * 1048576) {
  console.log("주의: 여전히 80MB를 넘습니다. 텍스처 해상도를 줄이거나 --texture-compress webp 를 추가하세요.");
}
