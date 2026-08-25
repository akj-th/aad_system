// 브이월드 3D Tiles(건물) → 라이노용 glb 변환.
//
// 브이월드는 서울 자치구 단위로 b3dm 타일셋을 제공한다 (텍스처 포함, Draco 압축).
//   cdn.vworld.kr/TDServer/services/map4/TG9ENA.json  →  자치구 tileset.json  →  *.b3dm
//
// b3dm = 28바이트 헤더 + featureTable + batchTable + glTF(glb).
// featureTable 의 RTC_CENTER(ECEF)를 기준으로 glTF 정점이 상대 배치된다.
// 이를 대지 중심 기준 로컬 미터(ENU) 좌표로 옮겨 하나의 glb 로 합친다.
//
// B-5: 지형·3D 데이터는 서버에 저장하지 않는다 — 메모리에서 변환해 즉시 전달한다.

import { NodeIO, type Document } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { mergeDocuments, unpartition } from "@gltf-transform/functions";
// @ts-expect-error — draco3dgltf 는 타입 선언을 제공하지 않는다
import draco3d from "draco3dgltf";

const ROOT = "https://cdn.vworld.kr/TDServer/services/map4/";
const ROOT_TILESET = ROOT + "TG9ENA.json";
const WGS84_A = 6378137.0;
const WGS84_E2 = 6.69437999014e-3;

export interface TileRef {
  url: string;
  geometricError: number;
  region?: number[];
}

interface TilesetNode {
  content?: { uri?: string; url?: string };
  children?: TilesetNode[];
  geometricError?: number;
  boundingVolume?: { region?: number[] };
}

function regionIntersects(region: number[] | undefined, b: number[]): boolean {
  if (!region) return true; // 경계 정보가 없으면 후보로 둔다
  const [w, s, e, n] = region; // 라디안
  return !(e < b[0] || w > b[2] || n < b[1] || s > b[3]);
}

/** ECEF 변환 (WGS84) */
function lonLatToEcef(lonDeg: number, latDeg: number, h = 0): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + h) * Math.cos(lat) * Math.cos(lon),
    (N + h) * Math.cos(lat) * Math.sin(lon),
    (N * (1 - WGS84_E2) + h) * sinLat,
  ];
}

/**
 * ECEF → 로컬 ENU(East-North-Up) 회전의 전치.
 * 여기에 glTF Y-up → Z-up 변환을 곱해 두면 타일 정점을 바로 로컬 좌표로 옮길 수 있다.
 */
function ecefToEnuMatrix(lonDeg: number, latDeg: number) {
  const lon = (lonDeg * Math.PI) / 180;
  const lat = (latDeg * Math.PI) / 180;
  const sl = Math.sin(lon), cl = Math.cos(lon);
  const sp = Math.sin(lat), cp = Math.cos(lat);
  // 행 = ENU 축의 ECEF 성분
  return [
    [-sl, cl, 0],
    [-sp * cl, -sp * sl, cp],
    [cp * cl, cp * sl, sp],
  ];
}

/** 타일 하나를 로컬 좌표에 놓는 4×4 행렬 (column-major, glTF 규약) */
function tileMatrix(
  rtc: [number, number, number],
  originEcef: [number, number, number],
  R: number[][],
): number[] {
  // glTF(Y-up) → Z-up:  (x, y, z) → (x, -z, y)
  // 회전부 = R · Yup2Zup
  const yz = [
    [1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ];
  const M: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      M[i][j] = R[i][0] * yz[0][j] + R[i][1] * yz[1][j] + R[i][2] * yz[2][j];
    }
  }
  const d = [rtc[0] - originEcef[0], rtc[1] - originEcef[1], rtc[2] - originEcef[2]];
  const t = [
    R[0][0] * d[0] + R[0][1] * d[1] + R[0][2] * d[2],
    R[1][0] * d[0] + R[1][1] * d[1] + R[1][2] * d[2],
    R[2][0] * d[0] + R[2][1] * d[1] + R[2][2] * d[2],
  ];
  // column-major
  return [
    M[0][0], M[1][0], M[2][0], 0,
    M[0][1], M[1][1], M[2][1], 0,
    M[0][2], M[1][2], M[2][2], 0,
    t[0], t[1], t[2], 1,
  ];
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`tileset ${res.status}`);
  return res.json();
}

/**
 * bbox(도) 와 겹치는 b3dm 목록을 찾는다.
 * targetError 보다 작은 geometricError 를 만나면 더 내려가지 않는다 —
 * 값이 작을수록 상세하고 타일이 많아진다.
 */
export async function findBuildingTiles(
  bboxDeg: [number, number, number, number],
  targetError: number,
  maxTiles: number,
): Promise<TileRef[]> {
  const b = bboxDeg.map((v) => (v * Math.PI) / 180);
  const out: TileRef[] = [];

  async function walkTileset(url: string, depth: number): Promise<void> {
    if (out.length >= maxTiles || depth > 8) return;
    let json: { root?: TilesetNode };
    try {
      json = (await getJson(url)) as { root?: TilesetNode };
    } catch {
      return;
    }
    const base = url.slice(0, url.lastIndexOf("/") + 1);
    const stack: TilesetNode[] = json.root ? [json.root] : [];
    const nested: string[] = [];

    while (stack.length) {
      const node = stack.pop()!;
      if (!regionIntersects(node.boundingVolume?.region, b)) continue;
      const uri = node.content?.uri ?? node.content?.url;
      const ge = node.geometricError ?? 0;
      if (uri) {
        const abs = uri.startsWith("http") ? uri : base + uri;
        if (/\.json$/i.test(uri)) {
          nested.push(abs);
        } else if (/\.b3dm$/i.test(uri)) {
          // 목표 정밀도에 도달한 타일만 담는다 (자식이 있으면 자식이 더 상세하다)
          const hasFinerChild = (node.children ?? []).some(
            (c) => (c.geometricError ?? 0) < ge && regionIntersects(c.boundingVolume?.region, b),
          );
          if (!hasFinerChild || ge <= targetError) {
            if (out.length < maxTiles) out.push({ url: abs, geometricError: ge, region: node.boundingVolume?.region });
          }
        }
      }
      // 더 상세한 자식이 필요하면 내려간다
      if (ge > targetError) {
        for (const child of node.children ?? []) stack.push(child);
      }
    }
    for (const n of nested) {
      if (out.length >= maxTiles) break;
      await walkTileset(n, depth + 1);
    }
  }

  await walkTileset(ROOT_TILESET, 0);
  return out;
}

/** b3dm 바이너리에서 RTC_CENTER 와 내장 glb 를 꺼낸다 */
export function parseB3dm(buf: Buffer): { rtc: [number, number, number]; glb: Buffer } | null {
  if (buf.length < 28 || buf.toString("ascii", 0, 4) !== "b3dm") return null;
  const ftJson = buf.readUInt32LE(12);
  const ftBin = buf.readUInt32LE(16);
  const btJson = buf.readUInt32LE(20);
  const btBin = buf.readUInt32LE(24);
  let off = 28;
  let rtc: [number, number, number] = [0, 0, 0];
  if (ftJson > 0) {
    try {
      const ft = JSON.parse(buf.toString("utf8", off, off + ftJson)) as {
        RTC_CENTER?: [number, number, number];
      };
      if (ft.RTC_CENTER) rtc = ft.RTC_CENTER;
    } catch {
      /* featureTable 이 없어도 진행한다 */
    }
  }
  off += ftJson + ftBin + btJson + btBin;
  if (buf.toString("ascii", off, off + 4) !== "glTF") return null;
  return { rtc, glb: buf.subarray(off) };
}

let ioPromise: Promise<NodeIO> | null = null;
async function getIO(): Promise<NodeIO> {
  if (!ioPromise) {
    ioPromise = (async () => {
      // Next 번들러가 wasm 경로를 잘못 잡으므로(C:\ROOT\...) 바이너리를 직접 읽어 넘긴다
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      const dir = join(process.cwd(), "node_modules", "draco3dgltf");
      const decoderWasm = await readFile(join(dir, "draco_decoder_gltf.wasm"));
      const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
      io.registerDependencies({
        "draco3d.decoder": await draco3d.createDecoderModule({
          wasmBinary: new Uint8Array(decoderWasm).buffer,
        }),
      });
      return io;
    })();
  }
  return ioPromise;
}

/** 여러 b3dm 을 로컬 좌표로 옮겨 하나의 glb 로 합친다 */
export async function buildLocalDocument(
  tiles: TileRef[],
  originLon: number,
  originLat: number,
): Promise<{ doc: Document | null; merged: number; failed: number }> {
  const io = await getIO();
  const originEcef = lonLatToEcef(originLon, originLat, 0);
  const R = ecefToEnuMatrix(originLon, originLat);

  let target: Document | null = null;
  let merged = 0;
  let failed = 0;

  for (const tile of tiles) {
    try {
      const res = await fetch(tile.url, { cache: "no-store" });
      if (!res.ok) {
        failed++;
        continue;
      }
      const parsed = parseB3dm(Buffer.from(await res.arrayBuffer()));
      if (!parsed) {
        failed++;
        continue;
      }
      const doc = await io.readBinary(new Uint8Array(parsed.glb));
      const matrix = tileMatrix(parsed.rtc, originEcef, R);

      // 타일 전체를 감싸는 노드에 변환을 걸어 로컬 좌표로 옮긴다
      const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0];
      if (!scene) {
        failed++;
        continue;
      }
      const wrapper = doc.createNode("tile").setMatrix(matrix as never);
      for (const child of scene.listChildren()) {
        scene.removeChild(child);
        wrapper.addChild(child);
      }
      scene.addChild(wrapper);

      if (!target) {
        target = doc;
      } else {
        mergeDocuments(target, doc);
        // 병합하면 씬이 여러 개가 된다 — 하나로 모은다
        const scenes = target.getRoot().listScenes();
        const main = scenes[0];
        for (const s of scenes.slice(1)) {
          for (const child of s.listChildren()) {
            s.removeChild(child);
            main.addChild(child);
          }
          s.dispose();
        }
        target.getRoot().setDefaultScene(main);
      }
      merged++;
    } catch {
      failed++;
    }
  }

  if (!target) return { doc: null, merged: 0, failed };
  // Draco·KTX2 는 다운스트림(OBJ 변환, 라이노)에서 다루지 못한다 — 디코딩된 상태로 둔다
  for (const ext of target.getRoot().listExtensionsUsed()) {
    if (
      ext.extensionName === "KHR_draco_mesh_compression" ||
      ext.extensionName === "KHR_texture_basisu"
    ) {
      ext.dispose();
    }
  }
  await target.transform(unpartition());
  return { doc: target, merged, failed };
}

/** glb 바이너리로 내보낸다 (Rhino 8 이상·다른 툴용) */
export async function documentToGlb(doc: Document): Promise<Uint8Array> {
  const io = await getIO();
  return io.writeBinary(doc);
}
