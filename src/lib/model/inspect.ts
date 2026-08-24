// glb 사전 검사. Cesium은 glTF 노드 계층을 재귀로 순회하므로 계층이 깊거나
// 순환 참조가 있으면 렌더 중 "Maximum call stack size exceeded"로 렌더 루프가 죽는다.
// 업로드 전에 구조를 읽어 위험을 미리 알린다.

export interface GlbReport {
  ok: boolean;
  /** 치명적 — 로드하면 렌더가 멈출 가능성이 높다 */
  fatal: string[];
  /** 경고 — 로드는 되지만 무겁다 */
  warnings: string[];
  stats: {
    fileMB: number;
    nodes: number;
    meshes: number;
    primitives: number;
    materials: number;
    images: number;
    /** 노드 계층 최대 깊이 */
    maxDepth: number;
    hasCycle: boolean;
    extensions: string[];
    generator?: string;
  };
}

/** Cesium 재귀 순회가 감당하는 대략적 한계 (경험값) */
const DEPTH_FATAL = 400;
const DEPTH_WARN = 80;
const NODE_WARN = 20_000;
const PRIM_WARN = 30_000;

interface GltfJson {
  asset?: { generator?: string };
  nodes?: { children?: number[]; mesh?: number }[];
  meshes?: { primitives?: unknown[] }[];
  materials?: unknown[];
  images?: unknown[];
  scenes?: { nodes?: number[] }[];
  scene?: number;
  extensionsUsed?: string[];
}

/** glb 컨테이너에서 JSON 청크를 꺼낸다 (.gltf면 그대로 파싱) */
export function extractGltfJson(buffer: ArrayBuffer, isGlb: boolean): GltfJson | null {
  try {
    if (!isGlb) {
      return JSON.parse(new TextDecoder().decode(buffer)) as GltfJson;
    }
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x46546c67) return null; // 'glTF'
    let offset = 12;
    while (offset + 8 <= buffer.byteLength) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (chunkType === 0x4e4f534a) {
        // 'JSON'
        return JSON.parse(
          new TextDecoder().decode(new Uint8Array(buffer, start, chunkLength)),
        ) as GltfJson;
      }
      offset = start + chunkLength;
    }
    return null;
  } catch {
    return null;
  }
}

/** 노드 계층의 최대 깊이와 순환 여부 (반복 기반 — 여기서 스택이 터지면 안 된다) */
function analyzeHierarchy(nodes: NonNullable<GltfJson["nodes"]>, roots: number[]) {
  let maxDepth = 0;
  let hasCycle = false;
  // 방문 중(path) 집합으로 순환 감지, 명시적 스택으로 반복 순회
  const state = new Uint8Array(nodes.length); // 0=미방문 1=방문중 2=완료
  for (const root of roots) {
    const stack: { i: number; depth: number; phase: 0 | 1 }[] = [
      { i: root, depth: 1, phase: 0 },
    ];
    while (stack.length) {
      const top = stack[stack.length - 1];
      if (top.i < 0 || top.i >= nodes.length) {
        stack.pop();
        continue;
      }
      if (top.phase === 0) {
        if (state[top.i] === 1) {
          hasCycle = true;
          stack.pop();
          continue;
        }
        state[top.i] = 1;
        top.phase = 1;
        maxDepth = Math.max(maxDepth, top.depth);
        const children = nodes[top.i].children ?? [];
        for (const c of children) stack.push({ i: c, depth: top.depth + 1, phase: 0 });
      } else {
        state[top.i] = 2;
        stack.pop();
      }
      // 폭주 방지 — 비정상 구조에서 무한 루프를 막는다
      if (stack.length > 100_000) {
        hasCycle = true;
        break;
      }
    }
  }
  return { maxDepth, hasCycle };
}

export function inspectGlb(buffer: ArrayBuffer, fileName: string): GlbReport {
  const fileMB = buffer.byteLength / 1024 / 1024;
  const fatal: string[] = [];
  const warnings: string[] = [];
  const isGlb = /\.glb$/i.test(fileName);
  const json = extractGltfJson(buffer, isGlb);

  if (!json) {
    return {
      ok: false,
      fatal: ["glTF 데이터를 읽을 수 없습니다 (손상되었거나 지원하지 않는 형식)"],
      warnings: [],
      stats: {
        fileMB, nodes: 0, meshes: 0, primitives: 0, materials: 0, images: 0,
        maxDepth: 0, hasCycle: false, extensions: [],
      },
    };
  }

  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const primitives = meshes.reduce((n, m) => n + (m.primitives?.length ?? 0), 0);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  const { maxDepth, hasCycle } = analyzeHierarchy(nodes, roots);
  const extensions = json.extensionsUsed ?? [];

  if (hasCycle) {
    fatal.push("노드 계층에 순환 참조가 있습니다 — 렌더 중 무한 재귀로 지도가 멈춥니다");
  }
  if (maxDepth >= DEPTH_FATAL) {
    fatal.push(
      `노드 계층이 ${maxDepth}단으로 너무 깊습니다 (한계 ${DEPTH_FATAL}단) — 렌더 중 스택 오버플로가 발생합니다`,
    );
  } else if (maxDepth >= DEPTH_WARN) {
    warnings.push(`노드 계층이 ${maxDepth}단으로 깊습니다 — 성능 저하나 렌더 오류가 날 수 있습니다`);
  }
  if (nodes.length >= NODE_WARN) {
    warnings.push(`노드가 ${nodes.length.toLocaleString("ko-KR")}개로 많습니다 — 로딩이 느립니다`);
  }
  if (primitives >= PRIM_WARN) {
    warnings.push(`메시 조각이 ${primitives.toLocaleString("ko-KR")}개입니다 — 병합 후 내보내기를 권합니다`);
  }
  if (fileMB > 150) {
    warnings.push(`파일이 ${fileMB.toFixed(0)}MB로 큽니다 — 브라우저 메모리 부족이 날 수 있습니다`);
  }
  const unsupported = extensions.filter((e) => e === "KHR_draco_mesh_compression");
  if (unsupported.length) {
    warnings.push(`압축 확장(${unsupported.join(", ")}) 사용 — 브이월드 Cesium 버전에 따라 안 열릴 수 있습니다`);
  }

  return {
    ok: fatal.length === 0,
    fatal,
    warnings,
    stats: {
      fileMB,
      nodes: nodes.length,
      meshes: meshes.length,
      primitives,
      materials: json.materials?.length ?? 0,
      images: json.images?.length ?? 0,
      maxDepth,
      hasCycle,
      extensions,
      generator: json.asset?.generator,
    },
  };
}
