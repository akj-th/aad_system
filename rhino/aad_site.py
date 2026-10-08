# -*- coding: utf-8 -*-
"""
AAD Site Import — 브이월드 대지 컨텍스트를 라이노로 가져오기

Rhino 7 (IronPython 2.7). _RunPythonScript 로 실행한다.
데이터는 AAD 서버(Next.js)를 경유한다 — API 키는 서버에만 있다.

두 단계로 범위를 정한다
  1) 광역 범위: 조감도용 지형·항공사진을 어디까지 가져올지 (0.5~5km)
     → 예상 규모(정점 수·타일 수·용량)를 먼저 보여주고 확인받는다
  2) 코어 반경: 대상지 주변 어디까지를 최고 해상도로 볼지 (100~500m)
     → 이 안쪽만 고해상도 지형·항공사진·필지선·건물 매스를 만든다

이렇게 나누는 이유는 광역을 통째로 고해상도로 가져오면 라이노가 감당하지 못하기 때문이다.
필지선도 광역 전체가 아니라 대상지와 인접 필지만 만든다.

좌표계
  대지 중심을 원점으로 하는 로컬 미터 좌표(등장방형 근사).
  웹 앱 lib/map/draw.ts 와 같은 방식이며 EarthAnchorPoint 도 설정한다.
"""

import json
import math
import os
import tempfile
import threading
import time

import Rhino
import rhinoscriptsyntax as rs
import scriptcontext as sc
import System
import clr

clr.AddReference("System.IO.Compression.FileSystem")
from System.IO.Compression import ZipFile
from System.Net import WebClient
from System.Drawing import Bitmap, Graphics, Rectangle
from System.Drawing.Drawing2D import InterpolationMode
from System.Drawing.Imaging import Encoder, EncoderParameter, EncoderParameters, ImageCodecInfo

# 항공사진 텍스처 상한. 이보다 크면 라이노가 파일을 열 때 디코딩에 오래 걸려
# "응답 없음" 상태가 된다 (실측: 13.4MB PNG 2장이 붙으면 열리지 않았다).
MAX_TEXTURE_PX = 4096
JPEG_QUALITY = 85


def _jpeg_codec():
    for codec in ImageCodecInfo.GetImageEncoders():
        if codec.MimeType == "image/jpeg":
            return codec
    return None


def save_texture(bitmap, path_without_ext):
    """
    항공사진을 JPEG 로 저장한다 — PNG 는 같은 그림이 5~10배 크고 디코딩도 느리다.
    상한을 넘으면 줄여서 저장한다.
    """
    source = bitmap
    longest = max(bitmap.Width, bitmap.Height)
    if longest > MAX_TEXTURE_PX:
        scale = float(MAX_TEXTURE_PX) / longest
        w = int(bitmap.Width * scale)
        h = int(bitmap.Height * scale)
        resized = Bitmap(w, h)
        g = Graphics.FromImage(resized)
        g.InterpolationMode = InterpolationMode.HighQualityBicubic
        g.DrawImage(bitmap, 0, 0, w, h)
        g.Dispose()
        source = resized

    codec = _jpeg_codec()
    if codec:
        path = path_without_ext + ".jpg"
        params = EncoderParameters(1)
        params.Param[0] = EncoderParameter(Encoder.Quality, JPEG_QUALITY)
        source.Save(path, codec, params)
    else:
        path = path_without_ext + ".png"
        source.Save(path, System.Drawing.Imaging.ImageFormat.Png)
    if source is not bitmap:
        source.Dispose()
    return path

SERVER = os.environ.get("AAD_SERVER", "http://localhost:3000")

# 이 스크립트가 있는 폴더의 상위가 AAD 프로젝트 폴더다 (rhino/aad_site.py)
PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def server_alive(timeout_ms=1500):
    try:
        request = System.Net.WebRequest.Create(SERVER + "/api/health")
        request.Timeout = timeout_ms
        response = request.GetResponse()
        response.Close()
        return True
    except Exception:
        return False


def ensure_server(wait_sec=90):
    """
    서버가 꺼져 있으면 대신 띄운다 — 라이노만 열고 쓸 수 있어야 한다.
    이미 떠 있으면 아무것도 하지 않는다 (중복 기동 금지).
    """
    if server_alive():
        return True
    if os.environ.get("AAD_SERVER"):
        # 원격 서버를 가리키는 중이면 우리가 띄울 대상이 아니다
        return False
    if not os.path.isfile(os.path.join(PROJECT_DIR, "package.json")):
        return False

    info = System.Diagnostics.ProcessStartInfo()
    info.FileName = "cmd.exe"
    info.Arguments = "/c npm run dev"
    info.WorkingDirectory = PROJECT_DIR
    info.CreateNoWindow = True
    info.UseShellExecute = False
    try:
        System.Diagnostics.Process.Start(info)
    except Exception:
        return False

    # 첫 기동은 컴파일 때문에 수십 초 걸린다
    deadline = time.time() + wait_sec
    while time.time() < deadline:
        if server_alive():
            return True
        time.sleep(1.0)
    return False

# --- 범위 옵션 --------------------------------------------------------------
# 광역: 지형·항공사진이 커버할 전체 범위. 반경이 커질수록 해상도를 낮춘다.
#   grid  = 지형 메시 한 변 정점 수 (129 → 16,641 정점 / 32,768 삼각형)
#   zoom  = 항공사진 타일 줌 (z18 ≈ 0.47m/px, z16 ≈ 1.9m/px)
WIDE_OPTIONS = [
    {"label": u"1km — 가로 구역", "radius": 1000, "grid": 161, "zoom": 17},
    {"label": u"2.5km — 근린 생활권", "radius": 2500, "grid": 193, "zoom": 16},
    {"label": u"5km — 도시 스케일 (기본)", "radius": 5000, "grid": 257, "zoom": 14},
    {"label": u"10km — 광역 조감", "radius": 10000, "grid": 289, "zoom": 13},
    {"label": u"25km — 도시권", "radius": 25000, "grid": 337, "zoom": 11},
    {"label": u"50km — 수도권 스케일", "radius": 50000, "grid": 385, "zoom": 10},
]
DEFAULT_WIDE = 2  # 5km

# 코어: 대상지 주변 최고 해상도 구간. 지형·항공사진·필지선·건물이 여기 들어간다.
# 지형 grid 는 DEM API 상한(400)까지. 괄호는 지형 정점 간격이다.
CORE_OPTIONS = [
    {"label": u"100m — 대상지만", "radius": 100, "grid": 129, "zoom": 20},
    {"label": u"200m", "radius": 200, "grid": 161, "zoom": 20},
    {"label": u"300m", "radius": 300, "grid": 193, "zoom": 19},
    {"label": u"500m (기본) — 4.4m 간격", "radius": 500, "grid": 225, "zoom": 19},
    {"label": u"1km — 6.2m 간격", "radius": 1000, "grid": 321, "zoom": 18},
    {"label": u"1.5km — 7.8m 간격", "radius": 1500, "grid": 385, "zoom": 17},
    {"label": u"2km — 10.0m 간격", "radius": 2000, "grid": 400, "zoom": 17},
]
DEFAULT_CORE = 3  # 500m

MAX_TILES = 240

# 3D 건물 타일 상한. 상한에 걸리면 건물이 잘린 채로 들어오므로 넉넉히 둔다.
# 실측(detail=0): 500m → 254장 · 11초 · 정점 165,526
#                 1km  → 879장 · 29초 · 정점 859,216
BUILDING_TILE_CAP = 1200

# 건물을 가져올 최대 반경. 지형·항공사진과 달리 건물은 면적에 비례해 폭증한다.
# 실측: 1.5km 1,926장 / 2km 3,615장 · 443초 · 정점 372만 · zip 82MB — 라이노가 감당하지 못한다.
# 코어를 그보다 넓게 잡아도 건물만 이 반경까지 가져온다.
BUILDING_MAX_RADIUS = 1000

# 필지를 받을 반경. 대상지와 '인접' 필지만 그리므로 넓게 받을 이유가 없고,
# 필지 API 는 bbox 변이 0.025도(약 2km)를 넘으면 거부한다 — 코어 2km 로 요청하면
# 대상 필지조차 못 받는다. 실측: 500m → 544개, 1km → 1,000개(상한), 2km → 거부.
PARCEL_RADIUS = 300

# 건물 LOD 목표. 이 값보다 큰 geometricError 노드는 자식으로 내려간다.
# 5 로 두면 중간 LOD 에서 멈춰 큰 건물만 들어온다 (실측 105동).
# 0 이면 최하위까지 내려가 저층 건물까지 들어온다 (381동, 정점은 오히려 더 적다).
BUILDING_DETAIL = 0
LAYERS = {
    "site": u"AAD::대상필지",
    "parcels": u"AAD::인접필지",
    "buildings": u"AAD::주변건물",
    # 항공사진은 지형 메시의 텍스처로 들어간다 — 별도 레이어를 두지 않는다
    "core_terrain": u"AAD::지형_코어",
    "wide_terrain": u"AAD::지형_광역",
    "info": u"AAD::대지정보",
}


# --- HTTP -------------------------------------------------------------------

class PatientWebClient(WebClient):
    """
    WebClient 는 Timeout 속성이 없고 기본 100초에서 끊는다.
    건물 타일 수백 장을 변환해 받는 요청은 그보다 오래 걸려서, 조용히 실패한 뒤
    건축물대장 압출로 폴백해 버린다 (실측: 코어 2km 에서 1,931동 → 103동).
    """

    def __init__(self, timeout_ms):
        self._timeout_ms = timeout_ms

    def GetWebRequest(self, uri):
        request = super(PatientWebClient, self).GetWebRequest(uri)
        request.Timeout = self._timeout_ms
        try:
            request.ReadWriteTimeout = self._timeout_ms
        except Exception:
            pass
        return request


def get_json(path):
    client = WebClient()
    client.Encoding = System.Text.Encoding.UTF8
    try:
        return json.loads(client.DownloadString(SERVER + path))
    finally:
        client.Dispose()


def _download(url, index, results):
    client = WebClient()
    try:
        results[index] = client.DownloadData(url)
    except Exception:
        results[index] = None
    finally:
        client.Dispose()


def download_parallel(urls, batch=12):
    results = [None] * len(urls)
    for start in range(0, len(urls), batch):
        threads = []
        for i in range(start, min(start + batch, len(urls))):
            t = threading.Thread(target=_download, args=(urls[i], i, results))
            t.start()
            threads.append(t)
        for t in threads:
            t.join()
    return results


# --- 좌표 -------------------------------------------------------------------

class Frame(object):
    def __init__(self, lon, lat):
        self.lon0 = lon
        self.lat0 = lat
        self.kx = 111320.0 * math.cos(math.radians(lat))
        self.ky = 111320.0

    def to_local(self, lon, lat):
        return ((lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky)

    def bbox(self, radius):
        dlon = radius / self.kx
        dlat = radius / self.ky
        return (self.lon0 - dlon, self.lat0 - dlat, self.lon0 + dlon, self.lat0 + dlat)


def deg2tile(lon, lat, z):
    n = 2.0 ** z
    rad = math.radians(lat)
    return (
        int((lon + 180.0) / 360.0 * n),
        int((1.0 - math.log(math.tan(rad) + 1.0 / math.cos(rad)) / math.pi) / 2.0 * n),
    )


def tile2deg(x, y, z):
    n = 2.0 ** z
    lon = x / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / n))))
    return lon, lat


def tile_count(frame, radius, zoom):
    west, south, east, north = frame.bbox(radius)
    x0, y0 = deg2tile(west, north, zoom)
    x1, y1 = deg2tile(east, south, zoom)
    return (x1 - x0 + 1) * (y1 - y0 + 1)


# --- 레이어 -----------------------------------------------------------------

def ensure_layer(name, color):
    if not rs.IsLayer(name):
        rs.AddLayer(name, color)
    return name


def setup_layers():
    ensure_layer(LAYERS["site"], (255, 120, 0))
    ensure_layer(LAYERS["parcels"], (120, 120, 120))
    ensure_layer(LAYERS["buildings"], (190, 190, 200))
    ensure_layer(LAYERS["core_terrain"], (150, 170, 140))
    ensure_layer(LAYERS["wide_terrain"], (170, 180, 165))
    ensure_layer(LAYERS["info"], (0, 0, 0))


# --- 지형 -------------------------------------------------------------------

class Terrain(object):
    """지형 격자 — 메시 생성과 임의 지점 고도 조회에 함께 쓴다"""

    def __init__(self, radius, grid, heights, level, hmin, hmax):
        self.radius = radius
        self.grid = grid
        self.heights = heights
        self.level = level
        self.min = hmin
        self.max = hmax
        self.step = (2.0 * radius) / (grid - 1)

    def height_at(self, x, y):
        """로컬 좌표의 지형 고도 (격자 최근접). 범위 밖이면 None"""
        if abs(x) > self.radius or abs(y) > self.radius:
            return None
        c = int(round((x + self.radius) / self.step))
        r = int(round((y + self.radius) / self.step))
        c = max(0, min(self.grid - 1, c))
        r = max(0, min(self.grid - 1, r))
        return self.heights[r * self.grid + c]


def fetch_terrain(frame, radius, grid):
    west, south, east, north = frame.bbox(radius)
    data = get_json(
        "/api/vworld/elevation?bbox=%f,%f,%f,%f&grid=%d" % (west, south, east, north, grid)
    )
    if data.get("error"):
        return None, data["error"]
    return (
        Terrain(radius, data["grid"], data["heights"], data["level"], data["min"], data["max"]),
        u"level %d · %d×%d · %.0f~%.0fm" % (data["level"], data["grid"], data["grid"], data["min"], data["max"]),
    )


def build_terrain_mesh(terrain, layer, photo=None, hole_radius=None):
    """
    지형 메시를 만들고 항공사진을 텍스처로 입힌다.

    사진을 별도 평면(PictureFrame)으로 깔면 지형에 가려 보이지 않는다 —
    메시 정점마다 UV 를 계산해 재질 텍스처로 붙여야 지형 위에 사진이 얹힌다.
    hole_radius 안쪽 면은 비워 코어 메시와 겹치지 않게 한다.
    """
    g = terrain.grid
    radius = terrain.radius
    step = terrain.step
    mesh = Rhino.Geometry.Mesh()

    px0 = py0 = px1 = py1 = None
    if photo:
        (px0, py0), (px1, py1) = photo["extent"]

    for r in range(g):
        y = -radius + step * r
        for c in range(g):
            x = -radius + step * c
            mesh.Vertices.Add(x, y, terrain.heights[r * g + c])
            if photo:
                u = (x - px0) / (px1 - px0)
                v = (y - py0) / (py1 - py0)
                mesh.TextureCoordinates.Add(u, v)

    # 셀 '중심'이 구멍 안인지로 판정하면 셀 절반(step/2)만큼 구멍이 커져
    # 코어 메시와의 사이에 빈 띠가 생긴다. 광역이 넓을수록 step 이 커져
    # 띠도 넓어진다 (5km→약 20m, 25km→약 74m).
    # 셀 '전체'가 구멍 안일 때만 비운다 — 구멍은 절대 코어보다 커지지 않는다.
    eps = step * 1e-6
    for r in range(g - 1):
        for c in range(g - 1):
            if hole_radius is not None:
                x0 = -radius + step * c
                y0 = -radius + step * r
                if (
                    max(abs(x0), abs(x0 + step)) <= hole_radius + eps
                    and max(abs(y0), abs(y0 + step)) <= hole_radius + eps
                ):
                    continue
            i = r * g + c
            mesh.Faces.AddFace(i, i + 1, i + g + 1, i + g)
    mesh.Normals.ComputeNormals()
    mesh.Compact()

    rs.CurrentLayer(layer)
    obj = sc.doc.Objects.AddMesh(mesh)
    if obj and photo:
        index = sc.doc.Materials.Add()
        material = sc.doc.Materials[index]
        material.SetBitmapTexture(photo["path"])
        material.CommitChanges()
        attrs = sc.doc.Objects.Find(obj).Attributes
        attrs.MaterialIndex = index
        attrs.MaterialSource = Rhino.DocObjects.ObjectMaterialSource.MaterialFromObject
        sc.doc.Objects.ModifyAttributes(obj, attrs, True)
    return obj


# --- 항공사진 ---------------------------------------------------------------

def build_aerial(frame, radius, zoom):
    """타일을 받아 한 장으로 합성한다. 지형 메시의 텍스처로 쓰이므로 객체는 만들지 않는다"""
    west, south, east, north = frame.bbox(radius)
    x0, y0 = deg2tile(west, north, zoom)
    x1, y1 = deg2tile(east, south, zoom)
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    if cols * rows > MAX_TILES:
        return None, u"타일 %d장 초과" % (cols * rows)

    urls = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            urls.append("%s/api/vworld/tile/Satellite/%d/%d/%d" % (SERVER, zoom, ty, tx))
    results = download_parallel(urls)

    bitmap = Bitmap(cols * 256, rows * 256)
    graphics = Graphics.FromImage(bitmap)
    ok = 0
    for i, data in enumerate(results):
        if not data:
            continue
        stream = System.IO.MemoryStream(data)
        try:
            graphics.DrawImage(Bitmap(stream), Rectangle((i % cols) * 256, (i // cols) * 256, 256, 256))
            ok += 1
        except Exception:
            pass
        finally:
            stream.Dispose()
    graphics.Dispose()

    path = save_texture(
        bitmap,
        os.path.join(
            tempfile.gettempdir(), "aad_aerial_%d_%d" % (radius, System.Environment.TickCount)
        ),
    )
    bitmap.Dispose()

    nw_lon, nw_lat = tile2deg(x0, y0, zoom)
    se_lon, se_lat = tile2deg(x1 + 1, y1 + 1, zoom)
    px0, py0 = frame.to_local(nw_lon, se_lat)
    px1, py1 = frame.to_local(se_lon, nw_lat)

    return (
        {"path": path, "extent": ((px0, py0), (px1, py1))},
        u"%d/%d장 · %dpx · %.1fMB"
        % (ok, cols * rows, min(cols * 256, MAX_TEXTURE_PX), os.path.getsize(path) / 1048576.0),
    )


# --- 필지·건물 --------------------------------------------------------------

def parcel_rings(feature, frame):
    geom = feature.get("geometry", {})
    polys = (
        [geom.get("coordinates", [])]
        if geom.get("type") == "Polygon"
        else geom.get("coordinates", [])
    )
    out = []
    for rings in polys:
        for ring in rings:
            pts = [frame.to_local(p[0], p[1]) for p in ring]
            if len(pts) >= 3:
                out.append(pts)
    return out


def add_parcels(features, frame, target_pnu, core_radius, terrain=None):
    """
    대상 필지와 그 인접 필지만 만든다 — 광역 전체 필지선은 도면을 어지럽히기만 한다.
    인접 판정: 대상 필지 경계에서 일정 거리(기본 40m) 안에 걸치는 필지.
    도로·하천처럼 지나치게 긴 필지는 제외한다.
    """
    target_rings = None
    for f in features:
        if target_pnu and f.get("properties", {}).get("pnu") == target_pnu:
            target_rings = parcel_rings(f, frame)
            break

    if target_rings:
        txs = [p[0] for r in target_rings for p in r]
        tys = [p[1] for r in target_rings for p in r]
        tminx, tmaxx, tminy, tmaxy = min(txs), max(txs), min(tys), max(tys)
    else:
        tminx = tminy = -30.0
        tmaxx = tmaxy = 30.0

    NEIGHBOR_PAD = 40.0
    max_span = core_radius * 1.5
    made, neighbors, skipped = 0, 0, 0

    for f in features:
        props = f.get("properties", {})
        rings = parcel_rings(f, frame)
        if not rings:
            continue
        is_target = target_pnu and props.get("pnu") == target_pnu
        if not is_target:
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            if max(max(xs) - min(xs), max(ys) - min(ys)) > max_span:
                skipped += 1
                continue
            # 대상 필지 근방과 겹치지 않으면 제외
            if (
                max(xs) < tminx - NEIGHBOR_PAD
                or min(xs) > tmaxx + NEIGHBOR_PAD
                or max(ys) < tminy - NEIGHBOR_PAD
                or min(ys) > tmaxy + NEIGHBOR_PAD
            ):
                continue
            neighbors += 1

        rs.CurrentLayer(LAYERS["site"] if is_target else LAYERS["parcels"])
        for pts in rings:
            # 지형 위로 살짝 띄운다 — Z=0 에 두면 지형 메시에 묻혀 보이지 않는다
            pts3 = []
            for x, y in pts:
                z = 0.0
                if terrain:
                    h = terrain.height_at(x, y)
                    if h is not None:
                        z = h + 0.3
                pts3.append((x, y, z))
            if pts3[0] != pts3[-1]:
                pts3.append(pts3[0])
            curve = rs.AddPolyline(pts3)
            if curve:
                made += 1
                if props.get("jibun"):
                    rs.SetUserText(curve, "jibun", props["jibun"])
                if props.get("pnu"):
                    rs.SetUserText(curve, "pnu", props["pnu"])
    return made, neighbors, skipped


def add_buildings3d(frame, radius, detail, max_tiles=None, textures=True):
    """
    브이월드 3D 건물(b3dm)을 그대로 가져온다 — 텍스처가 입혀진 실제 형상이다.

    서버가 타일을 받아 대지 중심 로컬 좌표로 옮긴 뒤 .3dm + 텍스처 zip 으로 준다.
    Rhino 7 은 glTF 가져오기를 지원하지 않고, OBJ 가져오기는 스크립트로 억제할 수 없는
    모달 대화상자를 띄운다 — 네이티브 3dm 이라야 조용히 들어온다.

    max_tiles 를 고정값으로 두면 범위가 넓을 때 건물이 잘린 채로 들어온다
    (반경 500m 는 239장이 필요한데 40장만 받아 1/3 만 나왔다).
    먼저 probe 로 필요한 장수를 세고 그만큼 요청한다.
    """
    west, south, east, north = frame.bbox(radius)
    capped = False
    if max_tiles is None:
        probe = (
            "/api/vworld/buildings3d?bbox=%f,%f,%f,%f&detail=%d&maxTiles=%d&probe=1"
            % (west, south, east, north, detail, BUILDING_TILE_CAP)
        )
        try:
            max_tiles = int(get_json(probe).get("tiles", 0)) or BUILDING_TILE_CAP
        except Exception:
            max_tiles = BUILDING_TILE_CAP
        # 상한과 같으면 더 있는데 잘렸을 수 있다 — 조용히 넘어가면 안 된다
        capped = max_tiles >= BUILDING_TILE_CAP
    url = (
        "%s/api/vworld/buildings3d?bbox=%f,%f,%f,%f&lon=%f&lat=%f&detail=%d&maxTiles=%d&format=3dm&textures=%d"
        % (SERVER, west, south, east, north, frame.lon0, frame.lat0, detail, max_tiles, 1 if textures else 0)
    )
    stamp = System.Environment.TickCount
    zip_path = os.path.join(tempfile.gettempdir(), "aad_bldg_%d.zip" % stamp)
    out_dir = os.path.join(tempfile.gettempdir(), "aad_bldg_%d" % stamp)

    # 타일 수백 장이면 서버 변환에만 수 분이 걸린다 (실측 1km 29초 / 2km 443초)
    client = PatientWebClient(15 * 60 * 1000)
    try:
        client.DownloadFile(url, zip_path)
    except Exception as e:
        client.Dispose()
        return 0, u"내려받기 실패 (%s)" % e
    client.Dispose()

    if os.path.getsize(zip_path) < 2000:  # 오류 JSON
        return 0, u"3D 건물 데이터 없음"

    try:
        ZipFile.ExtractToDirectory(zip_path, out_dir)
    except Exception as e:
        return 0, u"압축 해제 실패 (%s)" % e

    model_path = None
    for name in os.listdir(out_dir):
        if name.lower().endswith(".3dm"):
            model_path = os.path.join(out_dir, name)
            break
    if not model_path:
        return 0, u"3dm 파일 없음"

    # _-Import 는 3dm·OBJ 모두 모달 대화상자를 띄워 스크립트가 멈춘다.
    # RhinoCommon 으로 직접 읽어 문서에 넣는다.
    try:
        source = Rhino.FileIO.File3dm.Read(model_path)
    except Exception as e:
        return 0, u"3dm 읽기 실패 (%s)" % e
    if source is None:
        return 0, u"3dm 을 열 수 없음"

    layer_index = sc.doc.Layers.FindByFullPath(LAYERS["buildings"], -1)
    # 재질을 먼저 문서에 등록하고 인덱스를 다시 매핑한다 (텍스처 경로 유지)
    # File3dmMaterialTable 은 인덱서를 노출하지 않아 순회로 다룬다
    #
    # 단색 모드에서는 객체마다 재질을 붙이지 않고 레이어 재질을 상속시킨다.
    # 객체 재질로 붙이면 라이노가 저장할 때 객체 수만큼 재질을 복제해
    # (38동 → 재질 38개) 파일을 열 때마다 그만큼 프리뷰를 만든다.
    material_map = {}
    if not textures:
        if layer_index >= 0 and sc.doc.Layers[layer_index].RenderMaterialIndex < 0:
            mi = sc.doc.Materials.Add()
            mat = sc.doc.Materials[mi]
            mat.Name = "AAD 주변건물"
            mat.DiffuseColor = System.Drawing.Color.FromArgb(205, 205, 200)
            mat.CommitChanges()
            layer = sc.doc.Layers[layer_index]
            layer.RenderMaterialIndex = mi
            layer.CommitChanges()
    else:
        for i, material in enumerate(source.AllMaterials):
            # 텍스처 파일은 3dm 옆에 풀려 있으므로 절대경로로 바꿔 준다
            try:
                bitmap = material.GetBitmapTexture()
                if bitmap and bitmap.FileName and not os.path.isabs(bitmap.FileName):
                    bitmap.FileName = os.path.join(out_dir, os.path.basename(bitmap.FileName))
                    material.SetBitmapTexture(bitmap)
            except Exception:
                pass
            material_map[i] = sc.doc.Materials.Add(material)

    count = 0
    for obj in source.Objects:
        geometry = obj.Geometry
        attributes = obj.Attributes.Duplicate()
        if attributes.MaterialIndex in material_map:
            attributes.MaterialIndex = material_map[attributes.MaterialIndex]
            attributes.MaterialSource = Rhino.DocObjects.ObjectMaterialSource.MaterialFromObject
        else:
            attributes.MaterialIndex = -1
            attributes.MaterialSource = Rhino.DocObjects.ObjectMaterialSource.MaterialFromLayer
        if layer_index >= 0:
            attributes.LayerIndex = layer_index
        if sc.doc.Objects.Add(geometry, attributes) != System.Guid.Empty:
            count += 1
    source.Dispose()
    note = u"%d개 객체 · 타일 %d장 · %.1fMB" % (
        count,
        max_tiles,
        os.path.getsize(zip_path) / 1048576.0,
    )
    if capped:
        note += u" ⚠ 타일 상한(%d)에 걸림 — 일부가 빠졌을 수 있음" % BUILDING_TILE_CAP
    return count, note


def add_buildings(features, frame, target_pnu, core_radius, terrain=None):
    """(대체 경로) 건축물대장 높이로 매스를 세운다 — 3D 건물 데이터가 없는 지역용"""
    candidates = []
    for f in features:
        props = f.get("properties", {})
        pnu = props.get("pnu")
        if not pnu or pnu == target_pnu:
            continue
        rings = parcel_rings(f, frame)
        if not rings:
            continue
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        # 코어 안쪽에 있고, 지나치게 큰 필지(도로 등)는 제외
        cx = (min(xs) + max(xs)) / 2.0
        cy = (min(ys) + max(ys)) / 2.0
        if math.hypot(cx, cy) > core_radius:
            continue
        if max(max(xs) - min(xs), max(ys) - min(ys)) > core_radius:
            continue
        candidates.append((pnu, rings))

    if not candidates:
        return 0, 0

    # 서버가 병렬로 묶어서 조회한다
    heights = {}
    step = 100
    for i in range(0, len(candidates), step):
        pnus = ",".join([c[0] for c in candidates[i : i + step]])
        try:
            data = get_json("/api/vworld/buildings?pnus=" + pnus)
            for b in data.get("buildings", []):
                if b.get("height"):
                    heights[b["pnu"]] = b
        except Exception:
            pass

    rs.CurrentLayer(LAYERS["buildings"])
    made = 0
    for pnu, rings in candidates:
        info = heights.get(pnu)
        if not info or not info.get("height"):
            continue
        # 필지 바닥을 지형 고도에 맞춘다 (지형이 없으면 0)
        base_z = 0.0
        if terrain:
            zs = [terrain.height_at(x, y) for x, y in rings[0]]
            zs = [z for z in zs if z is not None]
            if zs:
                base_z = min(zs)
        pts3 = [(x, y, base_z) for x, y in rings[0]]
        if pts3[0] != pts3[-1]:
            pts3.append(pts3[0])
        base = rs.AddPolyline(pts3)
        if not base:
            continue
        solid = rs.ExtrudeCurveStraight(base, (0, 0, 0), (0, 0, float(info["height"])))
        rs.DeleteObject(base)
        if solid:
            rs.CapPlanarHoles(solid)
            rs.SetUserText(solid, "pnu", pnu)
            if info.get("mainUse"):
                rs.SetUserText(solid, "use", info["mainUse"])
            if info.get("floors"):
                rs.SetUserText(solid, "floors", str(info["floors"]))
            made += 1
    return made, len(candidates)


# --- 정보 텍스트 ------------------------------------------------------------

def add_info_text(lines, radius):
    rs.CurrentLayer(LAYERS["info"])
    height = max(2.0, radius * 0.012)
    y = radius * 0.92
    for line in lines:
        rs.AddText(line, (-radius * 0.95, y, 0), height)
        y -= height * 1.6


def set_earth_anchor(lon, lat):
    anchor = Rhino.DocObjects.EarthAnchorPoint()
    anchor.EarthBasepointLatitude = lat
    anchor.EarthBasepointLongitude = lon
    anchor.EarthBasepointElevation = 0.0
    anchor.ModelBasePoint = Rhino.Geometry.Point3d(0, 0, 0)
    anchor.ModelNorth = Rhino.Geometry.Vector3d(0, 1, 0)
    anchor.ModelEast = Rhino.Geometry.Vector3d(1, 0, 0)
    sc.doc.EarthAnchorPoint = anchor


# --- 메인 -------------------------------------------------------------------

def building_estimate(frame, radius):
    """건물 타일 수를 미리 세어 둔다 — 반경이 커지면 비용이 면적에 비례해 뛴다"""
    west, south, east, north = frame.bbox(radius)
    probe = (
        "/api/vworld/buildings3d?bbox=%f,%f,%f,%f&detail=%d&maxTiles=%d&probe=1"
        % (west, south, east, north, BUILDING_DETAIL, BUILDING_TILE_CAP)
    )
    try:
        return int(get_json(probe).get("tiles", 0))
    except Exception:
        return 0


def estimate(wide, core, bldg_radius=None, bldg_tiles=0):
    """가져오기 전에 규모를 알려준다 — 라이노가 감당할지 스스로 판단할 수 있게"""
    wide_v = wide["grid"] ** 2
    core_v = core["grid"] ** 2
    text = (
        u"[광역 %.1fkm] 지형 %s정점 · 항공사진 타일 %d장\n"
        u"[코어 %dm] 지형 %s정점 · 항공사진 타일 %d장\n"
        u"지형 정점 합계 약 %s개\n"
        % (
            wide["radius"] / 1000.0,
            "{:,}".format(wide_v),
            wide["tiles"],
            core["radius"],
            "{:,}".format(core_v),
            core["tiles"],
            "{:,}".format(wide_v + core_v),
        )
    )
    if bldg_tiles:
        # 실측 기준: 타일 1장당 약 0.033초 · 정점 약 980개
        text += u"[건물 %dm] 타일 %s장 · 정점 약 %s개 · 약 %d초\n" % (
            bldg_radius,
            "{:,}".format(bldg_tiles),
            "{:,}".format(bldg_tiles * 980),
            max(5, int(bldg_tiles * 0.033)),
        )
        if bldg_radius < core["radius"]:
            text += u"  (건물은 %dm 상한까지 — 그 이상은 라이노가 버거워진다)\n" % BUILDING_MAX_RADIUS
    return text + u"\n계속할까요?"


def run(address=None, wide_index=None, core_index=None, skip_confirm=False, textures=None):
    # 0) 서버 — 꺼져 있으면 대신 띄운다
    if not server_alive():
        Rhino.RhinoApp.WriteLine("AAD 서버를 시작하는 중… (처음 한 번은 30초 정도 걸립니다)")
        if not ensure_server():
            rs.MessageBox(
                u"AAD 서버에 연결할 수 없습니다.\n\n%s\n\n"
                u"프로젝트 폴더에서 'npm run dev' 를 실행한 뒤 다시 시도하세요.\n"
                u"폴더: %s" % (SERVER, PROJECT_DIR),
                16,
                u"AAD Site",
            )
            return

    # 1) 대상지
    if address is None:
        address = rs.GetString(u"대지 주소 또는 지번 (예: 압구정로29길 17)")
    if not address:
        return
    try:
        found = get_json("/api/vworld/search?q=" + System.Uri.EscapeDataString(address))
    except Exception as e:
        rs.MessageBox(u"서버에 연결할 수 없습니다.\n%s\n\n%s" % (SERVER, e), 16)
        return
    items = found.get("items", [])
    if not items:
        rs.MessageBox(u"검색 결과가 없습니다: %s" % address, 48)
        return
    if len(items) == 1 or wide_index is not None:
        picked = items[0]
    else:
        labels = [it.get("title") or it.get("parcelAddr") for it in items]
        chosen = rs.ListBox(labels, u"대지를 선택하세요", u"AAD Site")
        if not chosen:
            return
        picked = items[labels.index(chosen)]

    lon, lat = float(picked["lon"]), float(picked["lat"])
    frame = Frame(lon, lat)

    # 2) 광역 범위
    if wide_index is None:
        labels = [w["label"] for w in WIDE_OPTIONS]
        chosen = rs.ListBox(labels, u"1단계 — 지형·항공사진 전체 범위", u"AAD Site")
        if not chosen:
            return
        wide = dict(WIDE_OPTIONS[labels.index(chosen)])
    else:
        wide = dict(WIDE_OPTIONS[wide_index])

    # 3) 코어 반경
    # 코어가 광역에 가까우면 광역에 뚫는 구멍이 광역을 통째로 먹는다.
    # 광역의 절반 이하만 고를 수 있게 한다 (radius 만 줄이면 grid·zoom 이 어긋난다).
    usable = [c for c in CORE_OPTIONS if c["radius"] * 2 <= wide["radius"]]
    if not usable:
        usable = [CORE_OPTIONS[0]]
    if core_index is None:
        labels = [c["label"] for c in usable]
        chosen = rs.ListBox(labels, u"2단계 — 최고 해상도로 볼 대상지 반경", u"AAD Site")
        if not chosen:
            return
        core = dict(usable[labels.index(chosen)])
    else:
        core = dict(CORE_OPTIONS[min(core_index, len(CORE_OPTIONS) - 1)])
        if core["radius"] * 2 > wide["radius"]:
            core = dict(usable[-1])

    # 4) 주변 건물 재질 — 단색이면 재질이 1개라 파일이 훨씬 가볍고 빨리 열린다
    if textures is None:
        labels = [
            u"단색 매스 (가볍고 빠름 · 권장)",
            u"실사 텍스처 (사진 재질, 무거움)",
        ]
        chosen = rs.ListBox(labels, u"3단계 — 주변 건물 재질", u"AAD Site")
        if not chosen:
            return
        textures = labels.index(chosen) == 1

    # 4) 규모 확인
    wide["tiles"] = tile_count(frame, wide["radius"], wide["zoom"])
    core["tiles"] = tile_count(frame, core["radius"], core["zoom"])
    while wide["tiles"] > MAX_TILES and wide["zoom"] > 12:
        wide["zoom"] -= 1
        wide["tiles"] = tile_count(frame, wide["radius"], wide["zoom"])
    while core["tiles"] > MAX_TILES and core["zoom"] > 14:
        core["zoom"] -= 1
        core["tiles"] = tile_count(frame, core["radius"], core["zoom"])

    if not skip_confirm:
        bldg_radius = min(core["radius"], BUILDING_MAX_RADIUS)
        bldg_tiles = building_estimate(frame, bldg_radius)
        if rs.MessageBox(estimate(wide, core, bldg_radius, bldg_tiles), 1 | 32, u"가져올 규모") != 1:
            return

    rs.EnableRedraw(False)
    prev = rs.CurrentLayer()
    notes = []
    try:
        setup_layers()
        set_earth_anchor(lon, lat)

        # 광역 지형을 먼저 받아 '실제' 격자 간격을 알아낸다.
        # 서버가 grid 를 조정할 수 있으므로 옵션값이 아니라 받은 값을 써야 한다.
        wide_terrain, wide_note = fetch_terrain(frame, wide["radius"], wide["grid"])
        notes.append(u"지형(광역): " + wide_note)

        # 코어 반경을 광역 격자선에 맞춘다 — 그래야 구멍과 코어가 정확히 맞물린다.
        if wide_terrain:
            snapped = wide_terrain.step * math.ceil(core["radius"] / wide_terrain.step)
            if abs(snapped - core["radius"]) > 0.5:
                notes.append(
                    u"코어 반경 %dm → %.0fm (광역 격자 %.1fm 에 맞춤)"
                    % (core["radius"], snapped, wide_terrain.step)
                )
            core["radius"] = snapped

        # 항공사진은 지형 메시의 텍스처로 쓴다 (반경이 확정된 뒤에 받는다)
        wide_photo, wide_photo_note = build_aerial(frame, wide["radius"], wide["zoom"])
        notes.append(u"항공(광역): " + wide_photo_note)
        core_photo, core_photo_note = build_aerial(frame, core["radius"], core["zoom"])
        notes.append(u"항공(코어): " + core_photo_note)

        # 광역은 코어 부분을 비워 겹치지 않게 한다
        if wide_terrain:
            build_terrain_mesh(
                wide_terrain, LAYERS["wide_terrain"], wide_photo, core["radius"]
            )
        core_terrain, core_note = fetch_terrain(frame, core["radius"], core["grid"])
        notes.append(u"지형(코어): " + core_note)
        if core_terrain:
            build_terrain_mesh(core_terrain, LAYERS["core_terrain"], core_photo)

        # 필지 — 대상지+인접만 그리므로 코어가 아무리 넓어도 이 반경으로 받는다
        west, south, east, north = frame.bbox(min(core["radius"], PARCEL_RADIUS))
        fc = get_json("/api/vworld/parcels?bbox=%f,%f,%f,%f" % (west, south, east, north))
        features = fc.get("features", [])
        target_pnu = None
        try:
            one = get_json("/api/vworld/parcel?lon=%f&lat=%f" % (lon, lat))
            if one.get("parcel"):
                target_pnu = one["parcel"].get("pnu")
        except Exception:
            pass
        # 도로 필지를 걸러내는 기준(span)도 받아온 범위에 맞춰야 한다 —
        # 코어 반경을 넘기면 2km 짜리 도로 필지가 통과해 도면을 뒤덮는다
        made, neighbors, skipped = add_parcels(
            features, frame, target_pnu, min(core["radius"], PARCEL_RADIUS), core_terrain
        )
        notes.append(u"필지: 대상 1 + 인접 %d (폴리라인 %d)" % (neighbors, made))

        # 주변 건물 — 브이월드 3D 객체를 우선 쓰고, 없는 지역이면 대장 높이로 압출한다
        bldg_radius = min(core["radius"], BUILDING_MAX_RADIUS)
        count, bnote = add_buildings3d(frame, bldg_radius, BUILDING_DETAIL, None, textures)
        if bldg_radius < core["radius"]:
            bnote += u" · 반경 %dm 까지만 (건물은 %dm 상한)" % (bldg_radius, BUILDING_MAX_RADIUS)
        if count:
            notes.append(
                u"주변건물(3D 실물, %s): %s" % (u"텍스처" if textures else u"단색", bnote)
            )
        else:
            # 3D 실물을 못 받으면 대장 높이로 세운다. 형상이 박스로 바뀌는 큰 차이라
            # 조용히 넘어가면 안 된다 — 명령행에도 띄운다.
            built, tried = add_buildings(
                features, frame, target_pnu, min(core["radius"], PARCEL_RADIUS), core_terrain
            )
            notes.append(u"⚠ 주변건물(대장 압출 대체): %d동 — 3D 실물 실패: %s" % (built, bnote))
            Rhino.RhinoApp.WriteLine(
                "AAD 경고: 3D 건물을 받지 못해 대장 높이 박스로 대체했습니다 (%d동). %s"
                % (built, bnote)
            )

        # 대지 정보
        info = [u"AAD 대지 컨텍스트", picked.get("title", address)]
        if target_pnu:
            try:
                land = get_json("/api/vworld/landinfo?pnu=" + target_pnu).get("landInfo", {})
                if land.get("useZone"):
                    info.append(u"용도지역: %s" % land["useZone"])
                if land.get("officialArea"):
                    info.append(u"대지면적: %s m2 (공부)" % land["officialArea"])
                if land.get("roadSide"):
                    info.append(u"도로접면: %s / 지형: %s" % (land.get("roadSide"), land.get("terrain")))
            except Exception:
                pass
        info.append(u"광역 %.1fkm / 코어 %dm" % (wide["radius"] / 1000.0, core["radius"]))
        info.extend(notes)
        info.append(u"참고용 — 최종 확인은 담당 건축사 책임")
        add_info_text(info, core["radius"])
    finally:
        rs.CurrentLayer(prev)
        rs.EnableRedraw(True)

    site_objs = rs.ObjectsByLayer(LAYERS["site"])
    if site_objs:
        rs.ZoomBoundingBox(rs.BoundingBox(site_objs), None, True)
    else:
        rs.ZoomExtents()
    for line in notes:
        print(line.encode("utf-8") if isinstance(line, unicode) else line)


if __name__ == "__main__":
    addr = os.environ.get("AAD_TEST_ADDRESS")
    if addr:
        run(
            addr,
            int(os.environ.get("AAD_TEST_WIDE", "2")),
            int(os.environ.get("AAD_TEST_CORE", "3")),
            True,
            os.environ.get("AAD_TEST_TEXTURES", "0") == "1",
        )
    else:
        run()
