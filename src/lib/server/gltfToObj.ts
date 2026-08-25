// glTF Document → OBJ + MTL + 텍스처 zip.
//
// Rhino 7 은 glTF 를 내보내기만 하고 가져오지는 못한다(가져오기는 Rhino 8부터).
// 그래서 OBJ 로 바꿔 넘긴다 — 텍스처 좌표와 재질이 함께 유지된다.

import type { Document } from "@gltf-transform/core";
import { flatten, dequantize, unpartition } from "@gltf-transform/functions";
import JSZip from "jszip";

/** 3×3 회전/스케일 + 이동을 적용 (glTF 행렬은 column-major) */
function applyMatrix(m: number[], x: number, y: number, z: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

export async function documentToObjZip(
  doc: Document,
  name = "vworld_buildings",
): Promise<{ zip: Uint8Array; stats: { vertices: number; faces: number; materials: number; textures: number } }> {
  // 노드 계층 변환을 정점에 굽고, 양자화·버퍼 분산을 정리한다
  await doc.transform(dequantize(), flatten(), unpartition());

  const objLines: string[] = ["# AAD Site Import — 브이월드 3D 건물", `mtllib ${name}.mtl`];
  const mtlLines: string[] = ["# AAD Site Import"];
  const zip = new JSZip();

  const materialNames = new Map<unknown, string>();
  const textureFiles = new Map<unknown, string>();
  let vOffset = 1; // OBJ 인덱스는 1부터
  let vtOffset = 1;
  let totalVerts = 0;
  let totalFaces = 0;

  const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
  if (!scene) throw new Error("씬이 없습니다");

  // flatten 이후에도 노드에 변환이 남을 수 있어 월드 행렬을 직접 적용한다
  const walk = (node: ReturnType<typeof scene.listChildren>[number], parent: number[] | null) => {
    const local = node.getMatrix() as number[];
    const world = parent ? multiply(parent, local) : local;
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const position = prim.getAttribute("POSITION");
        if (!position) continue;
        const uv = prim.getAttribute("TEXCOORD_0");
        const indices = prim.getIndices();
        const material = prim.getMaterial();

        // 재질 (텍스처는 zip 안에 파일로 넣는다)
        let matName = "default";
        if (material) {
          if (!materialNames.has(material)) {
            const idx = materialNames.size;
            matName = `mat_${idx}`;
            materialNames.set(material, matName);
            const base = material.getBaseColorTexture();
            mtlLines.push(`newmtl ${matName}`, "Ka 1 1 1", "Kd 1 1 1", "d 1", "illum 1");
            if (base) {
              if (!textureFiles.has(base)) {
                const image = base.getImage();
                if (image) {
                  const mime = base.getMimeType() ?? "image/png";
                  const ext = mime.includes("jpeg") ? "jpg" : "png";
                  const file = `tex_${textureFiles.size}.${ext}`;
                  textureFiles.set(base, file);
                  zip.file(file, image);
                }
              }
              const file = textureFiles.get(base);
              if (file) mtlLines.push(`map_Kd ${file}`);
            } else {
              const c = material.getBaseColorFactor();
              mtlLines.push(`Kd ${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}`);
            }
            mtlLines.push("");
          } else {
            matName = materialNames.get(material)!;
          }
        }

        const posArray = position.getArray();
        const count = position.getCount();
        if (!posArray) continue;
        objLines.push(`o ${node.getName() || "tile"}_${totalFaces}`);
        objLines.push(`usemtl ${matName}`);
        for (let i = 0; i < count; i++) {
          const [x, y, z] = applyMatrix(world, posArray[i * 3], posArray[i * 3 + 1], posArray[i * 3 + 2]);
          objLines.push(`v ${x.toFixed(4)} ${y.toFixed(4)} ${z.toFixed(4)}`);
        }
        const uvArray = uv?.getArray();
        if (uvArray) {
          for (let i = 0; i < count; i++) {
            // OBJ 의 v 축은 glTF 와 반대다
            objLines.push(`vt ${uvArray[i * 2].toFixed(6)} ${(1 - uvArray[i * 2 + 1]).toFixed(6)}`);
          }
        }

        const idxArray = indices?.getArray();
        const triCount = idxArray ? idxArray.length / 3 : count / 3;
        for (let t = 0; t < triCount; t++) {
          const a = (idxArray ? idxArray[t * 3] : t * 3) + vOffset;
          const b = (idxArray ? idxArray[t * 3 + 1] : t * 3 + 1) + vOffset;
          const c = (idxArray ? idxArray[t * 3 + 2] : t * 3 + 2) + vOffset;
          if (uvArray) {
            const ta = a - vOffset + vtOffset;
            const tb = b - vOffset + vtOffset;
            const tc = c - vOffset + vtOffset;
            objLines.push(`f ${a}/${ta} ${b}/${tb} ${c}/${tc}`);
          } else {
            objLines.push(`f ${a} ${b} ${c}`);
          }
        }
        vOffset += count;
        if (uvArray) vtOffset += count;
        totalVerts += count;
        totalFaces += triCount;
      }
    }
    for (const child of node.listChildren()) walk(child, world);
  };

  for (const node of scene.listChildren()) walk(node, null);

  zip.file(`${name}.obj`, objLines.join("\n"));
  zip.file(`${name}.mtl`, mtlLines.join("\n"));
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return {
    zip: out,
    stats: {
      vertices: totalVerts,
      faces: totalFaces,
      materials: materialNames.size,
      textures: textureFiles.size,
    },
  };
}

/** 4×4 행렬 곱 (column-major) */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}
