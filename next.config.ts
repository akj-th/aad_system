import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // glTF 변환 라이브러리는 wasm·네이티브 자원을 런타임에 직접 읽는다.
  // 번들에 넣으면 경로가 깨지므로 서버에서 그대로 require 하게 둔다.
  serverExternalPackages: [
    // emscripten 빌드라 번들하면 존재하지 않는 'ws' 참조에서 깨진다
    "rhino3dm",
    "draco3dgltf",
    "@gltf-transform/core",
    "@gltf-transform/extensions",
    "@gltf-transform/functions",
  ],
};

export default nextConfig;
