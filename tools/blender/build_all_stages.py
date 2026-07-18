"""Generate all 31 Hibana stage shells in the visible Blender session.

The TypeScript layout JSON remains authoritative. This script adds optimized visual
geometry around that layout, exports three GLB levels, renders deterministic QA
thumbnails, and keeps the UI responsive by processing one stage per Blender timer tick.
"""

import bpy
import json
import math
from mathutils import Vector


PROJECT = "/Users/h_miruky/Library/Mobile Documents/com~apple~CloudDocs/develop/100リポジトリ作成計画トップ/hibana"
LAYOUT_PATH = PROJECT + "/tools/blender/generated/stage-layouts.json"
PROFILE_PATH = PROJECT + "/tools/blender/stage-profiles.json"
OUTPUT_DIR = PROJECT + "/public/assets/aaa/stages"
WORK_DIR = PROJECT + "/tools/blender/work"
RENDER_DIR = PROJECT + "/tools/blender/renders"
PROGRESS_PATH = PROJECT + "/tools/blender/progress.json"
MANIFEST_PATH = PROJECT + "/public/assets/aaa/manifest.json"
PREFIX = "HB_"


IDENTITIES = {
    "kunren": ("military", "range-radar"),
    "souko": ("industrial", "container-crane"),
    "nakaniwa": ("heritage", "palace-dome"),
    "kairou": ("heritage", "desert-gate"),
    "kouwan": ("industrial", "harbor-crane"),
    "takadai": ("heritage", "grand-abbey"),
    "sakyuu": ("wilderness", "desert-rig"),
    "setsugen": ("arctic", "polar-array"),
    "koushou": ("industrial", "refinery-stack"),
    "yoichi": ("urban", "neon-spire"),
    "okujou": ("urban", "rooftop-helipad"),
    "saisekiba": ("industrial", "quarry-conveyor"),
    "chikurin": ("heritage", "bamboo-pagoda"),
    "tanada": ("wilderness", "terrace-village"),
    "misaki": ("military", "coastal-lighthouse"),
    "haieki": ("industrial", "rail-terminal"),
    "kyokoku": ("wilderness", "canyon-bridge"),
    "kohan": ("wilderness", "lakeside-observatory"),
    "kuko": ("airport", "airport-control"),
    "onsengai": ("heritage", "onsen-pagoda"),
    "z01": ("undead", "ruined-city"),
    "z02": ("undead", "burning-block"),
    "z03": ("undead", "wrecked-port"),
    "z04": ("undead", "ruined-abbey"),
    "z05": ("geothermal", "lava-mine"),
    "z06": ("undead", "slaughter-stack"),
    "z07": ("undead", "quarantine-gate"),
    "z08": ("undead", "subway-vault"),
    "z09": ("undead", "broken-ferris-wheel"),
    "z10": ("geothermal", "volcano-fortress"),
    "renshujo": ("military", "training-tower"),
}


def stable_unit(seed, index, salt=0):
    value = (seed ^ (index * 0x9E3779B1) ^ salt) & 0xFFFFFFFF
    value ^= value >> 16
    value = (value * 0x7FEB352D) & 0xFFFFFFFF
    value ^= value >> 15
    value = (value * 0x846CA68B) & 0xFFFFFFFF
    value ^= value >> 16
    return value / 0xFFFFFFFF


def hex_rgb(value):
    value = value.lstrip("#")
    channels = tuple(int(value[i:i + 2], 16) / 255.0 for i in (0, 2, 4))

    def to_linear(channel):
        return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4

    return tuple(to_linear(channel) for channel in channels)


def blend_rgb(a, b, amount):
    return tuple(a[i] * (1.0 - amount) + b[i] * amount for i in range(3))


def runtime_point(x, y, z):
    """Map Three runtime X/Y-up/Z into Blender X/Y/Z-up."""
    return Vector((x, -z, y))


def new_collection(name, parent=None):
    collection = bpy.data.collections.new(name)
    (parent.children if parent else bpy.context.scene.collection.children).link(collection)
    return collection


def remove_collection_tree(collection):
    for child in list(collection.children):
        remove_collection_tree(child)
    for obj in list(collection.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def clear_generated():
    # Re-resolve by name on every removal.  Removing a root also removes its
    # children, so keeping StructRNA references from the original list makes a
    # second build attempt touch already-removed collections.
    collection_names = [collection.name for collection in bpy.data.collections if collection.name.startswith(PREFIX)]
    root_names = [name for name in collection_names if name.endswith("_ROOT")]
    for name in root_names + collection_names:
        collection = bpy.data.collections.get(name)
        if collection is not None:
            remove_collection_tree(collection)
    for name in [obj.name for obj in bpy.data.objects if obj.name.startswith(PREFIX)]:
        obj = bpy.data.objects.get(name)
        if obj is not None:
            bpy.data.objects.remove(obj, do_unlink=True)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for datablock in list(datablocks):
            if datablock.name.startswith(PREFIX) and datablock.users == 0:
                datablocks.remove(datablock)
    for material in list(bpy.data.materials):
        if material.name.startswith("HBMAT_") and material.users == 0:
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.name.startswith("HBIMG_") and image.users == 0:
            bpy.data.images.remove(image)


def make_surface_image(name, color, kind, size=128):
    image = bpy.data.images.new("HBIMG_" + name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = "sRGB"
    seed = sum((index + 1) * ord(char) for index, char in enumerate(name)) & 0xFFFFFFFF
    stage_id = name.split("_", 1)[0]
    family = IDENTITIES.get(stage_id, ("industrial", ""))[0]

    def to_srgb(channel):
        channel = min(1.0, max(0.0, channel))
        return channel * 12.92 if channel <= 0.0031308 else 1.055 * (channel ** (1.0 / 2.4)) - 0.055

    pixels = []
    for y in range(size):
        for x in range(size):
            index = y * size + x
            fine = stable_unit(seed, index, 0x913) - 0.5
            broad = math.sin((x + seed % 17) * 0.31) * math.sin((y + seed % 11) * 0.27)
            factor = 0.90 + fine * 0.16 + broad * 0.055
            if kind in {"wall", "wall_alt", "obstacle"}:
                if family in {"heritage", "wilderness"}:
                    # Staggered masonry with 50-100cm real-scale courses.
                    course = y // 14
                    shifted_x = x + (12 if course & 1 else 0)
                    mortar = shifted_x % 24 in {0, 1} or y % 14 in {0, 1}
                    cell_tone = stable_unit(seed, (shifted_x // 24) + course * 19, 0xB21)
                    factor *= 0.82 if mortar else 0.92 + cell_tone * 0.16
                elif family in {"military", "industrial", "airport"}:
                    # Cast-concrete/steel panel seams, bolt shadows and mild
                    # rain streaking. The grid is construction scale, not a
                    # pixel-noise substitute for geometry.
                    seam = x % 32 in {0, 1} or y % 32 in {0, 1}
                    bolt = (x % 32 in {4, 27}) and (y % 32 in {4, 27})
                    streak = max(0.0, 1.0 - (y % 32) / 32) * stable_unit(seed, x // 5, 0x319)
                    factor *= 0.76 if seam else 1.04 if bolt else 0.92 - streak * 0.075
                else:
                    course = y // 16
                    shifted_x = x + (14 if course & 1 else 0)
                    mortar = shifted_x % 28 in {0, 1} or y % 16 in {0, 1}
                    grime = stable_unit(seed, x // 8 + (y // 8) * 23, 0x911)
                    factor *= 0.72 if mortar else 0.88 + grime * 0.18
            elif kind in {"floor", "road"}:
                aggregate = stable_unit(seed, (x // 3) + (y // 3) * 47, 0xF10)
                crack = ((x * 7 + y * 11 + seed) % 97) in {0, 1}
                factor *= 0.74 if crack else 0.88 + aggregate * 0.18
            elif kind in {"natural", "terrain"}:
                coarse = stable_unit(seed, (x // 6) + (y // 6) * 31, 0xA17)
                factor *= 0.80 + coarse * 0.28
            elif kind in {"trim", "accent"}:
                scratch = ((x * 13 + y * 5 + seed) % 113) in {0, 1}
                factor *= 0.74 if scratch else 0.94 + stable_unit(seed, index // 8, 0x817) * 0.10
            pixels.extend((
                to_srgb(color[0] * factor),
                to_srgb(color[1] * factor),
                to_srgb(color[2] * factor),
                1.0,
            ))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def make_surface_detail_images(name, kind, roughness, size=64):
    """Create tiny deterministic PBR maps that survive GLB export.

    The maps are intentionally small and tileable.  In game they provide the
    grazing-angle breakup which makes concrete, rock and water read as a real
    surface without adding geometry or a second reflection render pass.
    """
    roughness_image = bpy.data.images.new("HBIMG_" + name + "_roughness", width=size, height=size, alpha=False)
    roughness_image.colorspace_settings.name = "Non-Color"
    normal_image = bpy.data.images.new("HBIMG_" + name + "_normal", width=size, height=size, alpha=False)
    normal_image.colorspace_settings.name = "Non-Color"
    seed = sum((index + 7) * ord(char) for index, char in enumerate(name)) & 0xFFFFFFFF
    stage_id = name.split("_", 1)[0]
    family = IDENTITIES.get(stage_id, ("industrial", ""))[0]
    roughness_pixels = []
    normal_pixels = []
    for y in range(size):
        for x in range(size):
            index = y * size + x
            u = x / size
            v = y / size
            fine = stable_unit(seed, index, 0xA53) - 0.5
            if kind == "water":
                # Two crossing capillary-wave families.  Periods divide the
                # image size, keeping the packed texture perfectly tileable.
                wave_x = math.sin(math.tau * (u * 6.0 + v * 2.0)) * 0.46 + math.sin(math.tau * v * 13.0) * 0.18
                wave_y = math.cos(math.tau * (v * 5.0 - u * 1.0)) * 0.42 + math.cos(math.tau * u * 11.0) * 0.16
                nx = 0.5 + wave_x * 0.19
                ny = 0.5 + wave_y * 0.19
                nz = 0.94
                rough = min(0.19, max(0.035, roughness + fine * 0.035 + abs(wave_x) * 0.018))
            else:
                broad_x = math.sin(math.tau * u * 4.0) * math.cos(math.tau * v * 3.0)
                broad_y = math.cos(math.tau * v * 5.0) * math.sin(math.tau * u * 2.0)
                if kind in {"wall", "wall_alt", "obstacle"}:
                    cell_x = 12 if family in {"heritage", "wilderness"} else 16
                    cell_y = 7 if family in {"heritage", "wilderness"} else 16
                    seam_x = min(x % cell_x, cell_x - (x % cell_x))
                    seam_y = min(y % cell_y, cell_y - (y % cell_y))
                    edge_x = 1.0 if seam_x <= 1 else -0.35 if seam_x == 2 else 0.0
                    edge_y = 1.0 if seam_y <= 1 else -0.35 if seam_y == 2 else 0.0
                    broad_x += edge_x * 0.85
                    broad_y += edge_y * 0.85
                strength = 0.095 if kind in {"wall", "wall_alt", "obstacle"} else 0.16 if kind in {"natural", "terrain"} else 0.07
                nx = 0.5 + (broad_x * 0.55 + fine * 0.45) * strength
                ny = 0.5 + (broad_y * 0.55 - fine * 0.45) * strength
                nz = 0.96
                rough = min(1.0, max(0.18, roughness + fine * 0.13 + broad_x * 0.035))
            roughness_pixels.extend((rough, rough, rough, 1.0))
            normal_pixels.extend((nx, ny, nz, 1.0))
    roughness_image.pixels.foreach_set(roughness_pixels)
    normal_image.pixels.foreach_set(normal_pixels)
    roughness_image.pack()
    normal_image.pack()
    return roughness_image, normal_image


def make_material(name, color, roughness=0.75, metallic=0.0, emission=None, emission_strength=0.0):
    material = bpy.data.materials.new("HBMAT_" + name)
    material.use_nodes = True
    material.diffuse_color = (*color, 1.0)
    # Blender localizes node display names (for example, the Japanese UI calls
    # this node "プリンシプルBSDF").  bl_idname is stable across locales.
    bsdf = next(
        (node for node in material.node_tree.nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"),
        None,
    )
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*color, 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if emission and emission_strength > 0:
            emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
            if emission_input:
                emission_input.default_value = (*emission, 1.0)
            strength_input = bsdf.inputs.get("Emission Strength")
            if strength_input:
                strength_input.default_value = emission_strength
        kind = name.rsplit("_", 1)[-1]
        texture_kind = "wall_alt" if kind == "alt" else kind
        if kind in {"floor", "road", "wall", "alt", "obstacle", "natural", "terrain", "trim", "accent"}:
            image = make_surface_image(name, color, texture_kind)
            texture = material.node_tree.nodes.new("ShaderNodeTexImage")
            texture.name = "HB Surface Color"
            texture.image = image
            texture.extension = "REPEAT"
            texture.interpolation = "Linear"
            material.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
        if kind in {"floor", "road", "wall", "alt", "obstacle", "natural", "terrain", "water", "trim", "accent"}:
            roughness_image, normal_image = make_surface_detail_images(name, texture_kind, roughness)
            roughness_texture = material.node_tree.nodes.new("ShaderNodeTexImage")
            roughness_texture.name = "HB Surface Roughness"
            roughness_texture.image = roughness_image
            roughness_texture.extension = "REPEAT"
            roughness_texture.interpolation = "Linear"
            material.node_tree.links.new(roughness_texture.outputs["Color"], bsdf.inputs["Roughness"])
            normal_texture = material.node_tree.nodes.new("ShaderNodeTexImage")
            normal_texture.name = "HB Surface Normal"
            normal_texture.image = normal_image
            normal_texture.extension = "REPEAT"
            normal_texture.interpolation = "Linear"
            normal_map = material.node_tree.nodes.new("ShaderNodeNormalMap")
            normal_map.name = "HB Surface Normal Map"
            normal_map.inputs["Strength"].default_value = 0.58 if texture_kind == "water" else 0.34
            material.node_tree.links.new(normal_texture.outputs["Color"], normal_map.inputs["Color"])
            material.node_tree.links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
        if kind == "water":
            # Alpha survives GLB export; the runtime completes the lightweight
            # IBL/refraction-like presentation without a planar reflection pass.
            material.diffuse_color = (*color, 0.72)
            if bsdf.inputs.get("Alpha"):
                bsdf.inputs["Alpha"].default_value = 0.72
            try:
                material.surface_render_method = "DITHERED"
            except (AttributeError, TypeError):
                try:
                    material.blend_method = "BLEND"
                except AttributeError:
                    pass
        elif kind == "glass":
            # Windows must reveal the playable interior. Opaque coloured
            # rectangles were the main source of the cardboard-facade look.
            material.diffuse_color = (*color, 0.46)
            if bsdf.inputs.get("Alpha"):
                bsdf.inputs["Alpha"].default_value = 0.46
            if bsdf.inputs.get("Coat Weight"):
                bsdf.inputs["Coat Weight"].default_value = 0.28
            try:
                material.surface_render_method = "DITHERED"
            except (AttributeError, TypeError):
                try:
                    material.blend_method = "BLEND"
                except AttributeError:
                    pass
    return material


def build_materials(stage):
    palette = stage["palette"]
    floor = hex_rgb(palette["floor"])
    wall = hex_rgb(palette["wall"])
    obstacle = hex_rgb(palette["obstacle"])
    accent = hex_rgb(palette["accent"])
    if palette.get("mood") == "night":
        floor = blend_rgb(floor, (0.17, 0.18, 0.21), 0.70)
        wall = blend_rgb(wall, (0.19, 0.20, 0.23), 0.66)
        obstacle = blend_rgb(obstacle, (0.16, 0.17, 0.20), 0.62)
    family = IDENTITIES[stage["id"]][0]
    profile = PROFILES[stage["id"]]
    natural_target = (0.055, 0.12, 0.035)
    if profile["surface"] in {"desert-stone", "dune-sand", "canyon-stone", "quarry-gravel"}:
        natural_target = (0.27, 0.13, 0.055)
    elif family == "arctic":
        natural_target = (0.42, 0.52, 0.62)
    elif family == "geothermal" or stage["id"] in {"z05", "z09", "z10"}:
        natural_target = (0.045, 0.028, 0.024)
    elif family in {"industrial", "airport", "urban", "undead"}:
        natural_target = (0.10, 0.085, 0.065)
    return {
        "floor": make_material(stage["id"] + "_floor", blend_rgb(floor, (0.12, 0.13, 0.14), 0.15), 0.88),
        "road": make_material(stage["id"] + "_road", blend_rgb(floor, (0.055, 0.06, 0.065), 0.48), 0.72),
        "wall": make_material(stage["id"] + "_wall", blend_rgb(wall, (0.65, 0.67, 0.68), 0.08), 0.74),
        "wall_alt": make_material(stage["id"] + "_wall_alt", blend_rgb(wall, (0.04, 0.045, 0.05), 0.24), 0.82),
        "obstacle": make_material(stage["id"] + "_obstacle", obstacle, 0.68, 0.08 if family in {"industrial", "airport"} else 0.01),
        "accent": make_material(stage["id"] + "_accent", accent, 0.46, 0.16),
        "trim": make_material(stage["id"] + "_trim", blend_rgb(wall, (0.025, 0.03, 0.035), 0.66), 0.52, 0.32),
        "glass": make_material(stage["id"] + "_glass", blend_rgb(accent, (0.03, 0.08, 0.12), 0.64), 0.2, 0.38),
        "natural": make_material(stage["id"] + "_natural", blend_rgb(obstacle, natural_target, 0.58), 0.94),
        "terrain": make_material(stage["id"] + "_terrain", blend_rgb(obstacle, natural_target, 0.24), 0.97),
        "water": make_material(stage["id"] + "_water", blend_rgb(hex_rgb(palette["sky"]), (0.012, 0.045, 0.065), 0.62), 0.07, 0.34),
        "emissive": make_material(stage["id"] + "_emissive", accent, 0.36, 0.08, accent, 3.4 if palette.get("mood") == "night" else 1.8),
    }


class MeshBuilder:
    def __init__(self, collection, prefix, materials, bevel=0.0):
        self.collection = collection
        self.prefix = prefix
        self.materials = materials
        self.bevel = bevel
        self.parts = {}

    def _part(self, key):
        return self.parts.setdefault(key, {"verts": [], "faces": []})

    def add_box_blender(self, center, size, key="wall"):
        part = self._part(key)
        base = len(part["verts"])
        cx, cy, cz = center
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        part["verts"].extend([
            (cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
            (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
            (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
            (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz),
        ])
        part["faces"].extend([
            (base + 0, base + 3, base + 2, base + 1),
            (base + 4, base + 5, base + 6, base + 7),
            (base + 0, base + 1, base + 5, base + 4),
            (base + 1, base + 2, base + 6, base + 5),
            (base + 2, base + 3, base + 7, base + 6),
            (base + 3, base + 0, base + 4, base + 7),
        ])

    def add_box(self, x, y, z, w, h, d, key="wall"):
        center = runtime_point(x, y, z)
        self.add_box_blender(center, (w, d, h), key)

    def add_oriented_box(self, x, y, z, w, h, d, yaw=0.0, key="wall"):
        """Add a Y-up box with an arbitrary runtime-space yaw.

        Stage prop placements carry continuous yaw jitter.  Baking that
        transform into the merged mesh lets Blender replace the old axis-
        aligned JavaScript props without adding an object/draw call per item.
        """
        part = self._part(key)
        base = len(part["verts"])
        hw, hh, hd = w / 2, h / 2, d / 2
        cosine = math.cos(yaw)
        sine = math.sin(yaw)
        runtime_vertices = []
        for lx, ly, lz in (
            (-hw, -hh, -hd), (hw, -hh, -hd), (hw, -hh, hd), (-hw, -hh, hd),
            (-hw, hh, -hd), (hw, hh, -hd), (hw, hh, hd), (-hw, hh, hd),
        ):
            rx = x + lx * cosine - lz * sine
            rz = z + lx * sine + lz * cosine
            runtime_vertices.append((rx, y + ly, rz))
        part["verts"].extend(tuple(runtime_point(*vertex)) for vertex in runtime_vertices)
        part["faces"].extend([
            (base + 0, base + 3, base + 2, base + 1),
            (base + 4, base + 5, base + 6, base + 7),
            (base + 0, base + 1, base + 5, base + 4),
            (base + 1, base + 2, base + 6, base + 5),
            (base + 2, base + 3, base + 7, base + 6),
            (base + 3, base + 0, base + 4, base + 7),
        ])

    def add_cylinder_between(self, start_runtime, end_runtime, radius, key="trim", segments=10, end_radius=None):
        """Add a capped low-poly cylinder between arbitrary runtime points."""
        start = runtime_point(*start_runtime)
        end = runtime_point(*end_runtime)
        forward = end - start
        if forward.length < 1e-5:
            return
        forward.normalize()
        reference = Vector((0, 0, 1)) if abs(forward.z) < 0.94 else Vector((1, 0, 0))
        right = forward.cross(reference).normalized()
        up = right.cross(forward).normalized()
        end_radius = radius if end_radius is None else end_radius
        part = self._part(key)
        base = len(part["verts"])
        for center, ring_radius in ((start, radius), (end, end_radius)):
            for index in range(segments):
                angle = math.tau * index / segments
                point = center + right * math.cos(angle) * ring_radius + up * math.sin(angle) * ring_radius
                part["verts"].append(tuple(point))
        part["verts"].append(tuple(start))
        part["verts"].append(tuple(end))
        bottom_center = base + segments * 2
        top_center = bottom_center + 1
        for index in range(segments):
            nxt = (index + 1) % segments
            part["faces"].append((base + index, base + nxt, base + segments + nxt, base + segments + index))
            part["faces"].append((bottom_center, base + nxt, base + index))
            part["faces"].append((top_center, base + segments + index, base + segments + nxt))

    def add_oriented_gable_roof(self, x, base_y, z, width, roof_height, depth, yaw=0.0, key="accent"):
        """Add a watertight gabled roof with arbitrary plan rotation."""
        half_w = width / 2
        half_d = depth / 2
        cosine = math.cos(yaw)
        sine = math.sin(yaw)

        def world(lx, ly, lz):
            return (
                x + lx * cosine - lz * sine,
                ly,
                z + lx * sine + lz * cosine,
            )

        runtime_vertices = [
            world(-half_w, base_y, -half_d), world(half_w, base_y, -half_d),
            world(-half_w, base_y, half_d), world(half_w, base_y, half_d),
            world(-half_w, base_y + roof_height, 0), world(half_w, base_y + roof_height, 0),
        ]
        part = self._part(key)
        base = len(part["verts"])
        part["verts"].extend(tuple(runtime_point(*vertex)) for vertex in runtime_vertices)
        part["faces"].extend([
            (base + 0, base + 2, base + 3, base + 1),
            (base + 0, base + 1, base + 5, base + 4),
            (base + 2, base + 4, base + 5, base + 3),
            (base + 0, base + 4, base + 2),
            (base + 1, base + 3, base + 5),
        ])

    def add_cylinder(self, x, y, z, radius, height, key="trim", segments=12, top_radius=None):
        top_radius = radius if top_radius is None else top_radius
        part = self._part(key)
        base = len(part["verts"])
        for ring, ring_radius, height_offset in ((0, radius, -height / 2), (1, top_radius, height / 2)):
            for i in range(segments):
                angle = i * math.tau / segments
                p = runtime_point(x + math.cos(angle) * ring_radius, y + height_offset, z + math.sin(angle) * ring_radius)
                part["verts"].append(tuple(p))
        part["verts"].append(tuple(runtime_point(x, y - height / 2, z)))
        part["verts"].append(tuple(runtime_point(x, y + height / 2, z)))
        bottom_center = base + segments * 2
        top_center = bottom_center + 1
        for i in range(segments):
            nxt = (i + 1) % segments
            part["faces"].append((base + i, base + nxt, base + segments + nxt, base + segments + i))
            part["faces"].append((bottom_center, base + nxt, base + i))
            part["faces"].append((top_center, base + segments + i, base + segments + nxt))

    def add_beam(self, start_runtime, end_runtime, width, depth, key="trim"):
        start = runtime_point(*start_runtime)
        end = runtime_point(*end_runtime)
        forward = end - start
        if forward.length < 1e-5:
            return
        forward.normalize()
        reference = Vector((0, 0, 1)) if abs(forward.z) < 0.96 else Vector((1, 0, 0))
        right = forward.cross(reference).normalized()
        up = right.cross(forward).normalized()
        part = self._part(key)
        base = len(part["verts"])
        for point in (start, end):
            for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                part["verts"].append(tuple(point + right * width * sx + up * depth * sy))
        part["faces"].extend([
            (base + 0, base + 1, base + 5, base + 4),
            (base + 1, base + 2, base + 6, base + 5),
            (base + 2, base + 3, base + 7, base + 6),
            (base + 3, base + 0, base + 4, base + 7),
            (base + 0, base + 3, base + 2, base + 1),
            (base + 4, base + 5, base + 6, base + 7),
        ])

    def add_gable_roof(self, x, base_y, z, width, roof_height, depth, key="accent", ridge_axis="x"):
        """Add a watertight six-vertex gabled roof prism."""
        half_w = width / 2
        half_d = depth / 2
        if ridge_axis == "x":
            runtime_vertices = [
                (x - half_w, base_y, z - half_d),
                (x + half_w, base_y, z - half_d),
                (x - half_w, base_y, z + half_d),
                (x + half_w, base_y, z + half_d),
                (x - half_w, base_y + roof_height, z),
                (x + half_w, base_y + roof_height, z),
            ]
        else:
            runtime_vertices = [
                (x - half_w, base_y, z - half_d),
                (x - half_w, base_y, z + half_d),
                (x + half_w, base_y, z - half_d),
                (x + half_w, base_y, z + half_d),
                (x, base_y + roof_height, z - half_d),
                (x, base_y + roof_height, z + half_d),
            ]
        part = self._part(key)
        base = len(part["verts"])
        part["verts"].extend(tuple(runtime_point(*vertex)) for vertex in runtime_vertices)
        part["faces"].extend([
            (base + 0, base + 2, base + 3, base + 1),
            (base + 0, base + 1, base + 5, base + 4),
            (base + 2, base + 4, base + 5, base + 3),
            (base + 0, base + 4, base + 2),
            (base + 1, base + 3, base + 5),
        ])

    def add_rock(self, x, y, z, radius, height, key="natural", segments=7, seed=1):
        part = self._part(key)
        base = len(part["verts"])
        rings = []
        # A four-ring tapered profile reads as an eroded rock or mountain.  The
        # old three-ring profile had a wide flat cap and looked like a pillar.
        for ring_index, (ring_y, ring_scale) in enumerate((
            (0.0, 0.94),
            (height * 0.30, 1.0),
            (height * 0.70, 0.66),
            (height, 0.14),
        )):
            ring = []
            for i in range(segments):
                jitter = 0.78 + stable_unit(seed, i + ring_index * segments, 0x45D9F3B) * 0.38
                angle = i * math.tau / segments + stable_unit(seed, i, 0xA1B2) * 0.12
                p = runtime_point(x + math.cos(angle) * radius * ring_scale * jitter, y + ring_y, z + math.sin(angle) * radius * ring_scale * jitter)
                ring.append(len(part["verts"]))
                part["verts"].append(tuple(p))
            rings.append(ring)
        for lower, upper in zip(rings, rings[1:]):
            for i in range(segments):
                nxt = (i + 1) % segments
                part["faces"].append((lower[i], lower[nxt], upper[nxt], upper[i]))
        part["faces"].append(tuple(reversed(rings[0])))
        part["faces"].append(tuple(rings[-1]))

    def flush(self):
        objects = []
        for key, data in self.parts.items():
            if not data["verts"]:
                continue
            mesh = bpy.data.meshes.new(self.prefix + "_" + key + "_MESH")
            mesh.from_pydata(data["verts"], [], data["faces"])
            mesh.validate(verbose=False)
            mesh.update(calc_edges=True)
            uv_layer = mesh.uv_layers.new(name="UVMap")
            for polygon in mesh.polygons:
                normal = polygon.normal
                axis = max(range(3), key=lambda component: abs(normal[component]))
                for loop_index in polygon.loop_indices:
                    coordinate = mesh.vertices[mesh.loops[loop_index].vertex_index].co
                    if axis == 0:
                        u, v = coordinate.y, coordinate.z
                    elif axis == 1:
                        u, v = coordinate.x, coordinate.z
                    else:
                        u, v = coordinate.x, coordinate.y
                    uv_layer.data[loop_index].uv = (u * 0.12, v * 0.12)
            if key in {"natural", "terrain"}:
                for polygon in mesh.polygons:
                    polygon.use_smooth = True
            obj = bpy.data.objects.new(self.prefix + "_" + key, mesh)
            self.collection.objects.link(obj)
            obj.data.materials.append(self.materials[key])
            obj["hibanaMaterial"] = key
            obj["hibanaExport"] = True
            if self.bevel > 0 and key not in {"floor", "road", "water", "glass", "emissive"}:
                modifier = obj.modifiers.new("HB_micro_chamfer", "BEVEL")
                modifier.width = self.bevel
                modifier.segments = 1
                modifier.limit_method = "ANGLE"
            objects.append(obj)
        return objects


def choose_box_material(box, stage, index):
    palette = stage["palette"]
    if box.get("glazing"):
        return "glass"
    if box.get("emissive"):
        return "emissive"
    if box.get("district"):
        return "wall_alt" if stable_unit(stage["seed"], index, 0x81) < 0.26 else "wall"
    color = box.get("color", palette["obstacle"]).lower()
    if color == palette["accent"].lower():
        volume = box["w"] * box["h"] * box["d"]
        return "accent" if box.get("district") or volume >= 24 else "obstacle"
    if color == palette["wall"].lower():
        return "wall"
    return "obstacle"


def add_cover_skin(builder, box, stage, index, lod):
    """Turn an authoritative random cover box into a readable real-world prop.

    The collider-sized core is emitted by add_layout_shell before this call.
    Every piece here is a flush panel, cap, inset or roof seated on that core;
    no new route obstruction or walk-through house is introduced.  This lets
    the 80-150 ordinary cover blocks in every map carry most of the first-
    person density instead of concentrating all detail in a distant landmark.
    """
    if lod != 0:
        return
    family = IDENTITIES[stage["id"]][0]
    seed = stage["seed"]
    x, y, z = box["x"], box["y"], box["z"]
    width, height, depth = box["w"], box["h"], box["d"]
    base_y = y - height / 2
    top = y + height / 2
    long_x = width >= depth
    span = width if long_x else depth
    thickness = depth if long_x else width
    variation = int(stable_unit(seed, index, 0xC05E) * 4)

    def face_panel(offset, panel_y, panel_w, panel_h, key="trim"):
        if long_x:
            builder.add_box(x + offset, panel_y, z - depth / 2 - 0.044, panel_w, panel_h, 0.088, key)
        else:
            builder.add_box(x + width / 2 + 0.044, panel_y, z + offset, 0.088, panel_h, panel_w, key)

    # Waist-high cover receives construction logic instead of remaining a
    # scaled cube: concrete shoulders, stone coping, cargo straps or snow cap.
    if height <= 1.65:
        if family in {"wilderness", "geothermal"}:
            # Continuous plinth already represents collision. Overlapping
            # stones break the silhouette while never implying passable gaps.
            stones = max(2, min(6, int(span // 1.55)))
            for stone in range(stones):
                along = (stone - (stones - 1) / 2) * span * 0.82 / max(1, stones - 1)
                radius = min(0.82, span / stones * 0.56)
                sx, sz = (x + along, z) if long_x else (x, z + along)
                builder.add_rock(
                    sx,
                    top - height * 0.22,
                    sz,
                    radius,
                    height * (0.44 + stable_unit(seed, index * 7 + stone, 0x771) * 0.24),
                    "natural" if family == "wilderness" else "wall_alt",
                    7,
                    seed + index * 31 + stone,
                )
        elif family == "heritage":
            builder.add_box(x, top + 0.09, z, width + 0.24, 0.18, depth + 0.28, "accent")
            bays = max(2, min(6, int(span // 1.8)))
            for bay in range(bays):
                along = (bay - (bays - 1) / 2) * span * 0.82 / max(1, bays - 1)
                face_panel(along, base_y + height * 0.52, min(0.72, span / bays * 0.54), height * 0.48, "wall_alt")
        else:
            # Jersey/cargo cover: narrower shoulder, reflector plates and
            # seated end posts make the footprint legible at sprint speed.
            cap_w = width * (0.82 if long_x else 0.92)
            cap_d = depth * (0.92 if long_x else 0.82)
            builder.add_box(x, top + 0.08, z, cap_w, 0.16, cap_d, "trim")
            bays = max(2, min(5, int(span // 2.1)))
            for bay in range(bays):
                along = (bay - (bays - 1) / 2) * span * 0.78 / max(1, bays - 1)
                face_panel(along, base_y + height * 0.58, min(0.76, span / bays * 0.58), 0.20, "accent" if bay % 2 == variation % 2 else "trim")
        return

    # Human-height boxes become equipment cabinets, market kiosks or stacked
    # field stores. Door seams and service vents sit directly on the collider.
    if height <= 3.45 or min(width, depth) < 3.6:
        bays = max(1, min(5, int(span // 2.15)))
        for bay in range(bays):
            along = (bay - (bays - 1) / 2) * span * 0.76 / max(1, bays - 1)
            panel_key = "accent" if family == "heritage" and bay % 3 == 0 else "glass" if family in {"urban", "airport"} and bay == variation % bays else "trim"
            face_panel(along, base_y + height * 0.54, min(1.18, span / (bays + 0.4) * 0.62), min(1.62, height * 0.56), panel_key)
        builder.add_box(x, top + 0.10, z, width + 0.20, 0.20, depth + 0.20, "wall_alt")
        if family in {"industrial", "military", "airport", "undead", "geothermal"}:
            # Flush corner guards and a roof vent sell a manufactured shell.
            for sx in (-1, 1):
                for sz in (-1, 1):
                    builder.add_box(x + sx * width / 2, y, z + sz * depth / 2, 0.12, height * 0.88, 0.12, "trim")
            if top > 2.4 and min(width, depth) >= 2.1:
                builder.add_cylinder(x, top + 0.36, z, min(0.32, thickness * 0.11), 0.52, "trim", 8, min(0.22, thickness * 0.08))
        return

    # Larger random covers are promoted to fully collidable outbuildings.
    # The rectangular collider remains the wall mass; roof, windows, canopy,
    # gutters and door are facade-only, so this is not a hollow visual shell.
    roof_h = max(0.72, min(1.75, min(width, depth) * 0.24))
    if family in {"heritage", "wilderness"}:
        builder.add_gable_roof(x, top - 0.04, z, width + 0.54, roof_h, depth + 0.64, "accent", "x" if long_x else "z")
    else:
        builder.add_box(x, top + 0.18, z, width + 0.22, 0.36, depth + 0.22, "wall_alt")
        builder.add_box(x, top + 0.54, z, min(2.8, width * 0.34), 0.72, min(2.2, depth * 0.34), "trim")
    bays = max(2, min(5, int(span // 2.4)))
    for bay in range(bays):
        along = (bay - (bays - 1) / 2) * span * 0.74 / max(1, bays - 1)
        key = "emissive" if stage["palette"].get("mood") == "night" and (bay + index) % 5 == 0 else "glass"
        face_panel(along, base_y + min(2.25, height * 0.56), min(1.22, span / bays * 0.58), min(1.20, height * 0.28), key)
    door_offset = -span * 0.28 if variation & 1 else span * 0.28
    face_panel(door_offset, base_y + 1.22, min(1.16, span * 0.18), 2.18, "trim")
    if long_x:
        builder.add_box(x + door_offset, base_y + 2.48, z - depth / 2 - 0.46, min(2.2, span * 0.28), 0.16, 0.92, "accent")
    else:
        builder.add_box(x + width / 2 + 0.46, base_y + 2.48, z + door_offset, 0.92, 0.16, min(2.2, span * 0.28), "accent")


def add_layout_shell(builder, stage, lod):
    seed = stage["seed"]
    for index, box in enumerate(stage["boxes"]):
        if box.get("ghost") or box.get("decor") or box.get("legacyHorizon") or box.get("prop") or box.get("breakable"):
            continue
        district = box.get("district")
        volume = box["w"] * box["h"] * box["d"]
        if lod == 1 and not district and volume < 22:
            continue
        if lod == 2 and (not district or box["h"] < 4 or volume < 90):
            continue
        expansion = 0.06 if lod == 0 else 0.03
        key = choose_box_material(box, stage, index)
        builder.add_box(box["x"], box["y"], box["z"], box["w"] + expansion, box["h"] + expansion, box["d"] + expansion, key)

        if not district:
            add_cover_skin(builder, box, stage, index, lod)

        if lod != 0 or not district or box["h"] < 3.2 or index % 3:
            continue
        # Thin seated facade bands break large blank walls without changing collision.
        panel_count = max(1, min(5, int(max(box["w"], box["d"]) // 5)))
        if box["w"] >= box["d"]:
            for panel in range(panel_count):
                x = box["x"] + (panel - (panel_count - 1) / 2) * min(4.2, box["w"] / panel_count)
                builder.add_box(x, box["y"] + box["h"] * 0.12, box["z"] - box["d"] / 2 - 0.035, min(2.2, box["w"] / panel_count * 0.62), min(2.2, box["h"] * 0.34), 0.07, "glass" if panel % 2 == 0 else "trim")
        else:
            for panel in range(panel_count):
                z = box["z"] + (panel - (panel_count - 1) / 2) * min(4.2, box["d"] / panel_count)
                builder.add_box(box["x"] + box["w"] / 2 + 0.035, box["y"] + box["h"] * 0.12, z, 0.07, min(2.2, box["h"] * 0.34), min(2.2, box["d"] / panel_count * 0.62), "glass" if panel % 2 == 0 else "trim")


def add_architectural_skin(builder, stage, lod):
    """Seat detail directly onto authoritative collision shells.

    These panels do not create walk-through props in lanes: facade pieces sit
    3-5 cm outside existing walls, while roof equipment is limited to high,
    inaccessible district masses.  Everything is merged by material.
    """
    if lod == 2:
        return
    family = IDENTITIES[stage["id"]][0]
    mood = stage["palette"].get("mood")
    candidates = [
        box for box in stage["boxes"]
        if box.get("district")
        and not box.get("ghost")
        and not box.get("legacyHorizon")
        and not box.get("decor")
        and box["h"] >= 4.0
        and box["w"] * box["d"] >= 24
    ]
    limit = 34 if lod == 0 else 18
    candidates = sorted(candidates, key=lambda box: box["w"] * box["h"] * box["d"], reverse=True)[:limit]
    for index, box in enumerate(candidates):
        wide_x = box["w"] >= box["d"]
        span = box["w"] if wide_x else box["d"]
        bays = max(2, min(7 if lod == 0 else 4, int(span // 4.8)))
        levels = max(1, min(4 if lod == 0 else 2, int(box["h"] // 4.2)))
        facade_y0 = box["y"] - box["h"] / 2
        for level in range(levels):
            pane_y = facade_y0 + (level + 0.58) * box["h"] / levels
            pane_h = max(0.6, min(1.65, box["h"] / levels * 0.38))
            for bay in range(bays):
                offset = (bay - (bays - 1) / 2) * span / bays
                pane_w = max(0.7, span / bays * 0.58)
                if family in {"urban", "undead"} and mood == "night" and (bay + level + index) % 5 == 0:
                    key = "emissive"
                elif family in {"heritage", "wilderness"}:
                    key = "wall_alt" if (bay + level) % 3 else "accent"
                else:
                    key = "glass" if (bay + level + index) % 3 else "trim"
                if wide_x:
                    builder.add_box(box["x"] + offset, pane_y, box["z"] - box["d"] / 2 - 0.045, pane_w, pane_h, 0.09, key)
                else:
                    builder.add_box(box["x"] + box["w"] / 2 + 0.045, pane_y, box["z"] + offset, 0.09, pane_h, pane_w, key)
        # Flush vertical service ribs break the toy-like unbounded rectangles.
        for rib in range(1, bays):
            offset = (rib - bays / 2) * span / bays
            if wide_x:
                builder.add_box(box["x"] + offset, box["y"], box["z"] - box["d"] / 2 - 0.052, 0.12, box["h"] * 0.84, 0.10, "trim")
            else:
                builder.add_box(box["x"] + box["w"] / 2 + 0.052, box["y"], box["z"] + offset, 0.10, box["h"] * 0.84, 0.12, "trim")
        top = box["y"] + box["h"] / 2
        if lod == 0 and top > 7.5 and index % 2 == 0:
            # Roof equipment is kept low and only placed on tall district
            # masses, so players never encounter collider-free cover.
            unit_w = min(4.5, box["w"] * 0.28)
            unit_d = min(3.5, box["d"] * 0.28)
            builder.add_box(box["x"], top + 0.48, box["z"], unit_w, 0.96, unit_d, "wall_alt")
            if family in {"industrial", "airport", "undead"}:
                builder.add_cylinder(box["x"] + unit_w * 0.22, top + 1.65, box["z"], 0.32, 2.35, "trim", 8, 0.22)
            elif family == "urban":
                builder.add_box(box["x"], top + 1.12, box["z"] - unit_d * 0.52, unit_w * 0.82, 0.26, 0.08, "emissive" if mood == "night" else "accent")


def add_routes(builder, stage, lod):
    size = stage["size"]
    family = IDENTITIES[stage["id"]][0]
    road_width = 12 if family == "airport" else 8 if family in {"industrial", "urban", "undead"} else 6.5
    builder.add_box(0, 0.012, 0, road_width, 0.024, size * 0.91, "road")
    builder.add_box(0, 0.014, 0, size * 0.91, 0.024, road_width, "road")
    if lod == 0:
        offset = size * 0.21
        builder.add_box(offset, 0.016, -offset * 0.55, road_width * 0.7, 0.022, size * 0.44, "road")
        for i in range(-8, 9):
            builder.add_box(0, 0.03, i * size * 0.048, 0.18, 0.014, size * 0.026, "accent")


def add_route_set_dressing(builder, stage, lod):
    """Add low-profile infrastructure without creating fake cover."""
    if lod == 2:
        return
    size = stage["size"]
    family = IDENTITIES[stage["id"]][0]
    road_width = 12 if family == "airport" else 8 if family in {"industrial", "urban", "undead"} else 6.5
    interval = 14 if lod == 0 else 28
    count = max(5, int(size * 0.76 // interval))
    start = -(count - 1) * interval / 2
    # Curbs and storm drains are only 8-14cm tall: they enrich the near field
    # but cannot be mistaken for collision-bearing cover.
    for axis in (0, 1):
        for side in (-1, 1):
            offset = side * (road_width / 2 + 0.72)
            if axis == 0:
                builder.add_box(offset, 0.07, 0, 0.26, 0.14, size * 0.76, "wall_alt")
            else:
                builder.add_box(0, 0.075, offset, size * 0.76, 0.15, 0.26, "wall_alt")
        for index in range(count):
            along = start + index * interval
            if axis == 0:
                builder.add_box(road_width / 2 + 0.48, 0.026, along, 0.46, 0.052, 1.08, "trim")
                builder.add_box(-road_width / 2 - 0.48, 0.026, along + interval * 0.45, 0.46, 0.052, 1.08, "trim")
            else:
                builder.add_box(along, 0.026, road_width / 2 + 0.48, 1.08, 0.052, 0.46, "trim")
                builder.add_box(along + interval * 0.45, 0.026, -road_width / 2 - 0.48, 1.08, 0.052, 0.46, "trim")
    if lod == 0:
        # Utility pads under authored props visually connect them to the site.
        for index, placement in enumerate(blender_prop_placements(stage)):
            if placement["kind"] in {"conifer", "broadleaf", "deadtree", "sakura", "bamboo", "rock", "rubble"}:
                continue
            radius = 1.05 + (index % 3) * 0.28
            builder.add_oriented_box(
                placement["cx"], 0.018, placement["cz"],
                radius * 2.0, 0.036, radius * 1.55,
                placement["rotRad"], "road",
            )


def add_district_public_realm(builder, stage, lod):
    """Connect every playable district with roads, pavements and street life.

    DistrictPlacement is exported from the same StageLayout that owns physics,
    so aprons and entrances are never guessed from rendered pixels.  All added
    furniture is knee-height or thin-pole scenery placed outside the building
    footprint; it enriches first-person views without inventing fake cover.
    """
    if lod == 2:
        return
    placements = stage.get("districtPlacements", [])
    if not placements:
        return
    family = IDENTITIES[stage["id"]][0]
    mood = stage["palette"].get("mood")
    detailed = lod == 0
    for index, district in enumerate(placements):
        x, z = district["cx"], district["cz"]
        width, depth = district["width"], district["depth"]
        yaw = district["rot"] * math.pi / 2
        cosine, sine = math.cos(yaw), math.sin(yaw)

        def point(lx, lz):
            return x + lx * cosine - lz * sine, z + lx * sine + lz * cosine

        # A construction apron seats each building into the world.  The four
        # narrow pavement strips leave the gameplay floor visible in the yard.
        pavement = 1.55 if family in {"urban", "airport", "industrial", "military"} else 1.05
        builder.add_oriented_box(x, 0.026, z, width + pavement * 2.8, 0.052, depth + pavement * 2.8, yaw, "road")
        for lx, lz, w, d in (
            (0, -depth / 2 - pavement * 0.72, width + pavement * 2.0, pavement, ),
            (0, depth / 2 + pavement * 0.72, width + pavement * 2.0, pavement, ),
            (-width / 2 - pavement * 0.72, 0, pavement, depth + pavement * 2.0),
            (width / 2 + pavement * 0.72, 0, pavement, depth + pavement * 2.0),
        ):
            px, pz = point(lx, lz)
            builder.add_oriented_box(px, 0.075, pz, w, 0.15, d, yaw, "wall_alt")

        # Link the district apron to the central crossroads.  One merged road
        # material means ten districts still cost one draw call.
        if index > 0:
            road_end_x, road_end_z = point(0, -depth / 2 - pavement * 1.8)
            builder.add_beam((0, 0.035, 0), (road_end_x, 0.035, road_end_z), 3.2 if detailed else 2.6, 0.025, "road")

        if not detailed:
            continue
        front_z = -depth / 2 - pavement * 1.22
        # Thin lamps, entrance bollards, address sign and planted corners give
        # human scale. Their footprints are deliberately below cover size.
        for side in (-1, 1):
            lamp_x, lamp_z = point(side * min(width * 0.36, width / 2 - 1.1), front_z)
            builder.add_cylinder(lamp_x, 2.75, lamp_z, 0.075, 5.5, "trim", 8, 0.055)
            builder.add_box(lamp_x, 5.42, lamp_z, 0.48, 0.18, 0.48, "emissive" if mood == "night" else "accent")
            bollard_x, bollard_z = point(side * 1.45, -depth / 2 - pavement * 0.42)
            builder.add_cylinder(bollard_x, 0.42, bollard_z, 0.12, 0.84, "trim", 8, 0.095)
        sign_x, sign_z = point(-width / 2 - pavement * 0.34, front_z)
        builder.add_box(sign_x, 1.05, sign_z, 1.35, 1.48, 0.12, "accent")
        builder.add_box(sign_x, 0.30, sign_z, 0.16, 0.62, 0.16, "trim")
        for side in (-1, 1):
            planter_x, planter_z = point(side * (width / 2 + pavement * 0.42), depth / 2 + pavement * 0.34)
            builder.add_oriented_box(planter_x, 0.18, planter_z, 1.55, 0.36, 0.74, yaw, "wall_alt")
            # Compact multi-lobed shrub, 45cm high: decoration rather than
            # collisionless player-height cover.
            for lobe in (-0.42, 0, 0.42):
                shrub_x, shrub_z = point(side * (width / 2 + pavement * 0.42) + lobe, depth / 2 + pavement * 0.34)
                builder.add_rock(shrub_x, 0.28, shrub_z, 0.34, 0.48, "natural", 8, stage["seed"] + index * 41 + int((lobe + 1) * 10))


def add_boundary(builder, stage, lod):
    size = stage["size"]
    half = size / 2
    seed = stage["seed"]
    profile = PROFILES[stage["id"]]
    boundary = profile["boundary"]
    water_stage = boundary in {"harbor-seawall", "coastal-cliffs", "lake-shore", "flooded-port", "terraced-hills", "tidal-abbey-shore"}
    count = 42 if lod == 0 else 24 if lod == 1 else 14
    # 竹林は竹・寺院・住宅のシルエットが既に非常に濃いため、同じ外周岩数を
    # 重ねるとLOD0だけが260k三角形を越える。輪郭は連続したまま外周サンプルを減らす。
    if stage["id"] == "chikurin":
        count = 34 if lod == 0 else 22 if lod == 1 else 14

    # Continuous outer ground seats midground districts and the skyline.
    # Four overlapping strips avoid a giant central duplicate over the runtime
    # floor while removing the floating-building / diorama edge outside it.
    outer_depth = 210 if lod == 0 else 170 if lod == 1 else 130
    outer_span = size + outer_depth * 2
    if not water_stage:
        builder.add_box(0, -0.34, -half - outer_depth / 2, outer_span, 0.62, outer_depth, "terrain")
        builder.add_box(0, -0.34, half + outer_depth / 2, outer_span, 0.62, outer_depth, "terrain")
        builder.add_box(-half - outer_depth / 2, -0.34, 0, outer_depth, 0.62, size, "terrain")
        builder.add_box(half + outer_depth / 2, -0.34, 0, outer_depth, 0.62, size, "terrain")

    if water_stage:
        builder.add_box(0, -0.16, -half - 36, size * 1.35, 0.12, 72, "water")
        # An L-shaped offshore sheet makes the coastline readable from more
        # than one spawn direction.  It stays beyond the playable shell and
        # costs one merged primitive regardless of size.
        if boundary in {"harbor-seawall", "coastal-cliffs", "flooded-port", "lake-shore"}:
            side = -1 if stage["seed"] & 1 else 1
            builder.add_box(side * (half + 36), -0.17, 0, 72, 0.10, size * 1.04, "water")
        elif boundary == "tidal-abbey-shore":
            # Four lightweight sheets make a continuous tidal bay.  A stone
            # causeway crosses the north sheet and visually connects the
            # playable fortress to the distant mainland.
            builder.add_box(0, -0.17, half + 36, size * 1.35, 0.10, 72, "water")
            builder.add_box(-half - 36, -0.18, 0, 72, 0.10, size * 1.02, "water")
            builder.add_box(half + 36, -0.18, 0, 72, 0.10, size * 1.02, "water")
            builder.add_box(0, 0.03, -half - 36, 13.5, 0.18, 74, "road")
            builder.add_box(-7.1, 0.34, -half - 36, 0.55, 0.68, 74, "wall_alt")
            builder.add_box(7.1, 0.34, -half - 36, 0.55, 0.68, 74, "wall_alt")
        # Quay lip and mooring rhythm stop the water/land junction reading as
        # a razor-straight map edge.
        builder.add_box(0, 0.26, -half - 0.55, size * 0.82, 0.52, 1.1, "trim")
        if lod == 0:
            for index in range(-8, 9):
                builder.add_cylinder(index * size * 0.043, 0.72, -half - 1.2, 0.22, 1.44, "trim", 8, 0.18)

    natural_boundary = boundary in {
        "range-earthworks", "hill-ramparts", "dune-ridges", "ice-ridge", "quarry-terraces",
        "bamboo-slopes", "terraced-hills", "coastal-cliffs", "canyon-cliffs", "lake-shore",
        "basalt-tunnels", "amusement-ruins", "crater-rim", "mountain-base", "tidal-abbey-shore",
    }
    arcade_boundary = boundary in {
        "palace-arcades", "temple-cliffs", "gothic-precinct", "underground-vaults", "mountain-town",
    }

    for side in range(4):
        for i in range(count):
            t = -half + (i + 0.5) * size / count
            jitter = stable_unit(seed, i + side * count, 0xBA11) - 0.5
            if side == 0:
                x, z = t, -half - 2.2 - jitter * 4
            elif side == 1:
                x, z = t, half + 2.2 + jitter * 4
            elif side == 2:
                x, z = -half - 2.2 - jitter * 4, t
            else:
                x, z = half + 2.2 + jitter * 4, t
            if water_stage and side == 0 and count * 0.14 < i < count * 0.86:
                continue
            if natural_boundary:
                # A continuous overlapping ridge replaces the old every-third
                # low-poly cone rhythm.  More segments and a secondary shoulder
                # give a believable eroded silhouette without texture cards.
                radius = size / count * (0.92 + stable_unit(seed, i, side) * 0.72)
                height_scale = 1.55 if boundary in {"canyon-cliffs", "quarry-terraces", "crater-rim"} else 1.0
                base_height = 3.0 if boundary in {"range-earthworks", "mountain-base"} else 4.5
                height_range = 7 if boundary in {"range-earthworks", "mountain-base"} else 12 if lod == 0 else 8
                height = (base_height + stable_unit(seed, i, side + 91) * height_range) * height_scale
                builder.add_rock(x, -0.8, z, radius, height, "terrain", 10 if lod == 0 else 7 if lod == 1 else 6, seed + i + side * 100)
                if lod == 0 and i % (3 if stage["id"] == "chikurin" else 2) == 0:
                    shoulder_x = x + (1.8 + stable_unit(seed, i, side + 211) * 2.6) * (1 if side in {0, 2} else -1)
                    shoulder_z = z + (stable_unit(seed, i, side + 212) - 0.5) * 3.2
                    builder.add_rock(shoulder_x, -0.55, shoulder_z, radius * 0.72, height * 0.56, "natural", 9, seed + i + side * 181)
                if lod == 0 and boundary in {"hill-ramparts", "range-earthworks", "mountain-base"} and i % 4 == 0:
                    builder.add_box(x, 1.1, z, radius * 1.25, 2.2, radius * 0.45, "wall_alt")
            elif arcade_boundary:
                width = size / count * 0.94
                height = 7 + stable_unit(seed, i, side + 71) * (6 if lod == 0 else 3)
                if i % 3:
                    builder.add_box(x, height / 2, z, width if side < 2 else 3.2, height, 3.2 if side < 2 else width, "wall")
                else:
                    if side < 2:
                        add_arch(builder, x, 0, z, width * 1.5, height, 2.8, "wall_alt")
                    else:
                        builder.add_box(x, height / 2, z, 3.2, height, width, "wall_alt")
            else:
                width = size / count * 0.92
                depth = 4.5 + stable_unit(seed, i, side + 44) * 5
                height = 4 + stable_unit(seed, i, side + 71) * (10 if lod == 0 else 7)
                if i in {count // 3, count * 2 // 3}:
                    height *= 0.36
                builder.add_box(x, height / 2 - 0.2, z, width if side < 2 else depth, height, depth if side < 2 else width, "wall_alt" if i % 3 else "wall")


def add_skyline(builder, stage, lod):
    size = stage["size"]
    half = size / 2
    seed = stage["seed"]
    profile = PROFILES[stage["id"]]
    skyline = profile["skyline"]
    count = 30 if lod == 0 else 18 if lod == 1 else 10
    natural_skyline = skyline in {
        "sunset-ridges", "desert-mesas", "cut-mountain", "forest-pagoda", "rural-valley",
        "ocean-headland", "red-mesas", "alpine-lake", "volcanic-mine", "volcanic-fairground",
        "eruption-caldera", "alpine-military", "coastal-abbey",
    }
    for i in range(count):
        angle = math.tau * i / count + stable_unit(seed, i, 0x51) * 0.08
        radius = half + 82 + stable_unit(seed, i, 0x72) * 74
        x, z = math.cos(angle) * radius, math.sin(angle) * radius
        if natural_skyline:
            rock_radius = 22 + stable_unit(seed, i, 0x37) * 38
            mountain_scale = 1.38 if skyline in {"red-mesas", "cut-mountain", "eruption-caldera"} else 0.62 if skyline == "coastal-abbey" else 0.88 if skyline == "alpine-military" else 1.0
            height = (22 + stable_unit(seed, i, 0x82) * 42) * mountain_scale
            builder.add_rock(x, -2, z, rock_radius, height, "terrain", 18 if lod == 0 else 10 if lod == 1 else 6, seed ^ i)
            if lod == 0 and skyline in {"forest-pagoda", "rural-valley", "alpine-lake", "alpine-military", "coastal-abbey"} and i % 2 == 0:
                tree_radius = radius - 15
                add_tree(builder, math.cos(angle) * tree_radius, math.sin(angle) * tree_radius, 9 + stable_unit(seed, i, 0x83) * 10, seed ^ (i * 17), True, lod)
        elif skyline == "polar-campus":
            rock_radius = 14 + stable_unit(seed, i, 0x37) * 20
            height = 24 + stable_unit(seed, i, 0x82) * 52
            builder.add_rock(x, -3, z, rock_radius, height, "terrain", 18 if lod == 0 else 10 if lod == 1 else 6, seed ^ i)
            if i % 5 == 0:
                builder.add_cylinder(x * 0.86, 5, z * 0.86, 8, 8, "wall", 12 if lod == 0 else 8, 6)
        else:
            width = 8 + stable_unit(seed, i, 0x11) * 18
            depth = 8 + stable_unit(seed, i, 0x12) * 16
            tall_city = skyline in {"neon-megacity", "dense-highrise", "dead-neon-city", "firestorm-blocks", "broken-spires"}
            low_city = skyline in {"garden-palace", "desert-temple", "steaming-ryokan", "military-campus", "port-logistics", "working-harbor", "ghost-harbor"}
            height = 12 + stable_unit(seed, i, 0x13) * (64 if tall_city else 25 if low_city else 42)
            port_city = skyline in {"port-logistics", "working-harbor", "ghost-harbor"}
            airport_city = skyline == "terminal-airfield"
            if port_city and lod <= 1:
                variant = i % 4
                if variant == 0:
                    # Tank farm: round silhouettes prevent the harbor horizon
                    # collapsing into another generic city wall.
                    tank_h = max(9, height * 0.42)
                    builder.add_cylinder(x, tank_h / 2 - 1, z, width * 0.42, tank_h, "wall_alt", 12 if lod == 0 else 8, width * 0.38)
                    builder.add_cylinder(x, tank_h + 0.35, z, width * 0.44, 0.7, "trim", 12 if lod == 0 else 8, width * 0.20)
                elif variant == 1:
                    add_hangar(builder, x, z, width * 1.55, depth, max(7, height * 0.36), "wall_alt")
                elif variant == 2:
                    stack_h = max(18, height * 0.82)
                    builder.add_cylinder(x, stack_h / 2 - 1, z, max(1.2, width * 0.12), stack_h, "trim", 10 if lod == 0 else 7, max(0.8, width * 0.085))
                    builder.add_cylinder(x, stack_h + 0.5, z, max(1.35, width * 0.14), 1.0, "accent", 10 if lod == 0 else 7)
                else:
                    builder.add_box(x, height * 0.28 - 1, z, width * 1.35, height * 0.56, depth, "wall_alt")
                    add_pipe_rack(builder, x, z - depth * 0.58, min(20, width), min(13, height * 0.44), 3)
            elif airport_city and lod <= 1:
                if i % 5:
                    add_hangar(builder, x, z, width * 1.55, depth * 1.15, max(8, height * 0.32), "wall_alt")
                else:
                    add_tower(builder, x, z, -1, max(22, height * 0.85), "wall_alt", "glass", 10 if lod == 0 else 8)
            elif lod == 2:
                builder.add_box(x, height / 2 - 1, z, width, height, depth, "wall_alt")
            else:
                # Three setback masses give real high-rise/industrial rooflines
                # while remaining a single merged material draw call.
                base_h = height * 0.54
                mid_h = height * 0.29
                top_h = height * 0.17
                builder.add_box(x, base_h / 2 - 1, z, width, base_h, depth, "wall_alt")
                shift_x = (stable_unit(seed, i, 0x91) - 0.5) * width * 0.22
                shift_z = (stable_unit(seed, i, 0x92) - 0.5) * depth * 0.22
                builder.add_box(x + shift_x, base_h + mid_h / 2 - 1, z + shift_z, width * 0.76, mid_h, depth * 0.78, "wall_alt")
                builder.add_box(x + shift_x * 1.25, base_h + mid_h + top_h / 2 - 1, z + shift_z * 1.25, width * 0.48, top_h, depth * 0.52, "wall")
                # Inner-facing window/service bands give scale and stop the
                # skyline reading as floating grey blocks.  They remain one
                # merged glass/emissive material batch for the entire map.
                if lod == 0:
                    band_key = "emissive" if tall_city and i % 3 == 0 else "glass"
                    for level in range(3):
                        band_y = max(2.2, base_h * (0.26 + level * 0.22))
                        if abs(x) > abs(z):
                            face_x = x - math.copysign(width / 2 + 0.045, x)
                            builder.add_box(face_x, band_y, z, 0.09, 0.58, depth * 0.72, band_key)
                        else:
                            face_z = z - math.copysign(depth / 2 + 0.045, z)
                            builder.add_box(x, band_y, face_z, width * 0.72, 0.58, 0.09, band_key)
                    if i % 5 == 0:
                        builder.add_cylinder(x, height + 3.4, z, 0.14, 6.4, "trim", 7, 0.07)
            if lod == 0 and i % 4 == 0 and not (port_city or airport_city):
                cap_key = "emissive" if skyline in {"neon-megacity", "dead-neon-city", "firestorm-blocks"} else "accent"
                builder.add_box(x, height + 0.8, z, width * 0.58, 1.2, depth * 0.58, cap_key)
            if lod == 0 and skyline in {"neon-megacity", "dead-neon-city", "firestorm-blocks", "dense-highrise", "broken-spires"} and i % 2 == 0:
                panel_x = x * 0.965
                panel_z = z * 0.965
                builder.add_box(panel_x, height * 0.58, panel_z, width * 0.56, max(1.8, height * 0.16), 0.16, "emissive")
            if lod == 0 and skyline in {"port-logistics", "working-harbor", "ghost-harbor", "furnace-city", "factory-stacks"} and i % 6 == 0:
                add_pipe_rack(builder, x, z - depth * 0.6, min(20, width * 1.1), min(16, height * 0.5), 3)


def add_arch(builder, x, y, z, width, height, depth, key="wall"):
    pillar = max(1.2, width * 0.16)
    builder.add_box(x - width / 2 + pillar / 2, y + height / 2, z, pillar, height, depth, key)
    builder.add_box(x + width / 2 - pillar / 2, y + height / 2, z, pillar, height, depth, key)
    builder.add_box(x, y + height - pillar / 2, z, width, pillar, depth, key)


def add_tower(builder, x, z, base_y, height, key="wall", cap="accent", segments=12):
    builder.add_cylinder(x, base_y + height / 2, z, 3.4, height, key, segments, 2.8)
    builder.add_cylinder(x, base_y + height + 1.2, z, 5.0, 2.4, cap, segments, 4.2)
    builder.add_cylinder(x, base_y + height + 5.0, z, 0.45, 7.6, "trim", 8, 0.22)


def add_hangar(builder, x, z, width=30, depth=18, height=9, key="wall_alt", open_front=True):
    wall = max(0.75, min(1.25, width * 0.035))
    builder.add_box(x - width / 2 + wall / 2, height / 2, z, wall, height, depth, key)
    builder.add_box(x + width / 2 - wall / 2, height / 2, z, wall, height, depth, key)
    builder.add_box(x, height / 2, z - depth / 2 + wall / 2, width, height, wall, key)
    if not open_front:
        builder.add_box(x, height / 2, z + depth / 2 - wall / 2, width, height, wall, key)
    builder.add_box(x, height + 0.4, z, width + 1.4, 0.8, depth + 1.2, "trim")
    builder.add_box(x, height * 0.62, z + depth / 2 + 0.035, width * 0.58, height * 0.42, 0.07, "glass")


def add_tree(builder, x, z, height, seed, conifer=False, lod=0):
    segments = 7 if lod == 0 else 5
    trunk_height = height * (0.38 if conifer else 0.52)
    builder.add_cylinder(x, trunk_height / 2, z, max(0.14, height * 0.025), trunk_height, "trim", segments)
    if conifer:
        tiers = 3 if lod == 0 else 2
        for tier in range(tiers):
            tier_height = height * (0.32 - tier * 0.035)
            tier_y = height * (0.42 + tier * 0.18)
            radius = height * (0.20 - tier * 0.035)
            builder.add_cylinder(x, tier_y, z, radius, tier_height, "natural", segments, 0.06)
    else:
        crown_y = height * 0.58
        builder.add_rock(x, crown_y, z, height * 0.20, height * 0.38, "natural", segments, seed)


def add_bamboo(builder, x, z, height, seed, lod=0):
    # Silhouette-first bamboo: two irregular stalks and three collars read as
    # a cluster at FPS distance.  The older 3x5-collar construction exploded
    # UV-split GLB vertices without a visible gain.
    stalks = 2 if lod == 0 else 1
    for index in range(stalks):
        sx = x + (stable_unit(seed, index, 0xB01) - 0.5) * 1.25
        sz = z + (stable_unit(seed, index, 0xB02) - 0.5) * 1.25
        stalk_height = height * (0.82 + stable_unit(seed, index, 0xB03) * 0.28)
        builder.add_cylinder(sx, stalk_height / 2, sz, 0.11 if lod == 0 else 0.09, stalk_height, "natural", 5, 0.085)
        if lod == 0:
            for node in (2, 4, 6):
                builder.add_cylinder(sx, stalk_height * node / 8, sz, 0.15, 0.045, "trim", 5, 0.15)
            builder.add_rock(sx, stalk_height * 0.74, sz, 1.05, stalk_height * 0.20, "natural", 5, seed + index * 31)


def add_container_stack(builder, x, z, columns=3, levels=2, accent_every=3):
    for column in range(columns):
        for level in range(levels - (1 if column == columns - 1 and levels > 1 else 0)):
            key = "accent" if (column + level) % accent_every == 0 else "wall_alt"
            builder.add_box(x + column * 6.5, 1.45 + level * 3.0, z, 6.0, 2.8, 2.55, key)
            builder.add_box(x + column * 6.5, 1.45 + level * 3.0, z + 1.31, 5.0, 2.1, 0.06, "trim")


def add_vehicle_silhouette(builder, x, z, length=6.0, width=2.8, height=2.2):
    builder.add_box(x, height * 0.38, z, length, height * 0.62, width, "obstacle")
    builder.add_box(x - length * 0.12, height * 0.78, z, length * 0.46, height * 0.46, width * 0.82, "wall_alt")
    for sx in (-length * 0.32, length * 0.32):
        for sz in (-width * 0.47, width * 0.47):
            builder.add_box(x + sx, 0.34, z + sz, length * 0.20, 0.68, 0.24, "trim")


def add_gabled_house(
    builder,
    x,
    z,
    width=10.0,
    depth=8.0,
    storeys=1,
    style="rural",
    lod=0,
    damaged=False,
    yaw=0.0,
):
    """Build a production-style modular house, merged by material.

    Geometry is concentrated on first-person silhouette and contact: stone
    plinth, deep eaves, gutters, framed windows on two facades, door recess,
    chimney, dormer/balcony and optional exposed ruin rafters.  It remains a
    handful of material batches after export instead of one draw call per part.
    """
    storey_h = 3.18 if style in {"rural", "timber"} else 3.48 if style in {"heritage", "ryokan"} else 3.72
    body_h = storeys * storey_h
    heritage = style in {"timber", "heritage", "ryokan"}
    modern = style in {"modern", "urban"}
    wall_key = "wall" if heritage or style == "rural" else "wall_alt"
    roof_key = "accent" if heritage else "trim"
    cosine = math.cos(yaw)
    sine = math.sin(yaw)

    def point(lx, lz):
        return x + lx * cosine - lz * sine, z + lx * sine + lz * cosine

    def box(lx, ly, lz, w, h, d, key):
        px, pz = point(lx, lz)
        builder.add_oriented_box(px, ly, pz, w, h, d, yaw, key)

    # Seated foundation and wall mass.  The darker plinth removes the floating
    # dollhouse read on uneven terrain and wet streets.
    box(0, 0.22, 0, width + 0.34, 0.44, depth + 0.34, "wall_alt")
    box(0, body_h / 2 + 0.42, 0, width, body_h, depth, wall_key)
    overhang = 0.92 if heritage else 0.58
    roof_h = max(1.55, width * (0.21 if heritage else 0.15))
    if not damaged or lod > 0:
        builder.add_oriented_gable_roof(
            x,
            body_h + 0.42,
            z,
            width + overhang * 2,
            roof_h,
            depth + overhang * 2,
            yaw,
            roof_key,
        )
    else:
        # One seated roof fragment plus exposed rafters; damage changes the
        # silhouette, not only its colour.
        fragment_x, fragment_z = point(-width * 0.25, 0)
        builder.add_oriented_gable_roof(
            fragment_x,
            body_h + 0.42,
            fragment_z,
            width * 0.52,
            roof_h,
            depth + overhang,
            yaw,
            roof_key,
        )
        for index in range(5 if lod == 0 else 3):
            lx = -width * 0.05 + index * width * 0.12
            start = point(lx, -depth * 0.48)
            end = point(lx + width * (0.16 if index % 2 else -0.08), depth * 0.28)
            builder.add_beam(
                (start[0], body_h + 0.55, start[1]),
                (end[0], body_h + roof_h * (0.82 - index * 0.08), end[1]),
                0.11,
                0.09,
                "trim",
            )

    front = depth / 2 + 0.056
    # Recessed door, lintel, threshold and canopy.
    door_x = -width * 0.18 if width > 11 else 0
    box(door_x, 1.48, front, min(1.42, width * 0.15), 2.38, 0.11, "trim")
    box(door_x, 2.80, front + 0.02, min(1.72, width * 0.19), 0.16, 0.16, "accent")
    box(door_x, 0.48, front + 0.17, min(1.78, width * 0.19), 0.12, 0.46, "wall_alt")
    if lod == 0:
        box(door_x, 3.03, front + 0.54, min(2.5, width * 0.26), 0.18, 1.08, roof_key)
        for sx in (-0.92, 0.92):
            box(door_x + sx, 1.55, front + 0.48, 0.11, 2.7, 0.11, "trim")

    bays = 2 if lod > 0 else max(3, min(6, int(width // 2.8)))
    for level in range(storeys):
        pane_y = 0.42 + level * storey_h + storey_h * 0.56
        for bay in range(bays):
            lx = (bay - (bays - 1) / 2) * width * 0.76 / max(1, bays - 1)
            if abs(lx - door_x) < width * 0.12 and level == 0:
                continue
            pane_w = min(1.34, width / (bays + 1) * 0.58)
            pane_h = 1.18 if modern else 1.02
            pane_key = "emissive" if (style in {"heritage", "urban"} and (bay + level) % 4 == 0) else "glass"
            box(lx, pane_y, front + 0.014, pane_w, pane_h, 0.08, pane_key)
            if lod == 0:
                box(lx, pane_y, front + 0.067, pane_w + 0.20, 0.10, 0.10, "trim")
                box(lx, pane_y, front + 0.068, 0.08, pane_h + 0.18, 0.10, "trim")
        box(0, 0.42 + level * storey_h + 0.18, front + 0.018, width * 0.94, 0.13, 0.12, "trim")

    # Side facade windows stop houses reading as flat theatrical fronts.
    if lod == 0:
        side_x = width / 2 + 0.055
        for level in range(storeys):
            pane_y = 0.42 + level * storey_h + storey_h * 0.56
            for lz in (-depth * 0.24, depth * 0.24):
                box(side_x, pane_y, lz, 0.08, 1.0, min(1.25, depth * 0.22), "glass")
                box(side_x + 0.02, pane_y, lz, 0.11, 0.08, min(1.45, depth * 0.26), "trim")

    if heritage:
        for lx in (-width * 0.44, 0, width * 0.44):
            box(lx, body_h / 2 + 0.42, front + 0.024, 0.16, body_h * 0.92, 0.13, "trim")
        box(0, body_h + 0.34, front + 0.024, width * 0.96, 0.22, 0.15, "trim")
        if lod == 0 and storeys >= 2:
            # Shallow balcony with posts and four rail segments.
            box(width * 0.20, storey_h + 0.58, front + 0.74, width * 0.48, 0.18, 1.42, "wall_alt")
            for index in range(5):
                box(width * (0.00 + index * 0.10), storey_h + 1.13, front + 1.34, 0.08, 1.0, 0.08, "trim")
            box(width * 0.20, storey_h + 1.52, front + 1.34, width * 0.48, 0.10, 0.10, "trim")

    if lod == 0:
        # Chimney, rain gutters and one dormer provide roof-scale cues.
        chimney_x, chimney_z = point(width * 0.30, -depth * 0.12)
        builder.add_oriented_box(chimney_x, body_h + roof_h * 0.62, chimney_z, 0.72, roof_h * 1.16, 0.72, yaw, "wall_alt")
        for local_z in (-depth / 2 - overhang * 0.72, depth / 2 + overhang * 0.72):
            a = point(-width / 2 - overhang * 0.72, local_z)
            b = point(width / 2 + overhang * 0.72, local_z)
            builder.add_cylinder_between((a[0], body_h + 0.34, a[1]), (b[0], body_h + 0.34, b[1]), 0.075, "trim", 6)
        if storeys >= 2 and width >= 10 and not damaged:
            dormer_x, dormer_z = point(width * 0.18, depth * 0.18)
            builder.add_oriented_box(dormer_x, body_h + roof_h * 0.42, dormer_z, 2.0, 1.55, 1.6, yaw, "wall")
            builder.add_oriented_gable_roof(dormer_x, body_h + roof_h * 0.78, dormer_z, 2.4, 0.85, 2.1, yaw, roof_key)
            pane_x, pane_z = point(width * 0.18, depth * 0.18 + 0.84)
            builder.add_oriented_box(pane_x, body_h + roof_h * 0.43, pane_z, 0.72, 0.82, 0.08, yaw, "glass")


def add_stone_lantern(builder, x, z, height=2.2, emissive=False):
    builder.add_box(x, height * 0.28, z, 0.42, height * 0.56, 0.42, "wall_alt")
    builder.add_box(x, height * 0.61, z, 0.82, 0.22, 0.82, "trim")
    builder.add_box(x, height * 0.76, z, 0.58, 0.42, 0.58, "emissive" if emissive else "wall")
    builder.add_gable_roof(x, height * 0.97, z, 1.05, 0.32, 0.82, "accent", "x")


def add_train_car(builder, x, z, length=24.0, lod=0, ruined=False):
    builder.add_box(x, 1.65, z, length, 3.3, 3.1, "wall_alt")
    builder.add_box(x, 3.48, z, length * 0.92, 0.36, 3.2, "trim")
    windows = 7 if lod == 0 else 4
    for index in range(windows):
        px = x + (index - (windows - 1) / 2) * length * 0.82 / max(1, windows - 1)
        if ruined and index in {2, 5}:
            continue
        builder.add_box(px, 2.15, z + 1.57, length / windows * 0.52, 0.92, 0.08, "glass")
    for wheel_x in (-length * 0.34, length * 0.34):
        builder.add_box(x + wheel_x, 0.30, z - 1.48, length * 0.16, 0.60, 0.28, "trim")
        builder.add_box(x + wheel_x, 0.30, z + 1.48, length * 0.16, 0.60, 0.28, "trim")


def add_workboat(builder, x, z, length=18.0, lod=0, wrecked=False):
    hull_y = -0.02 if wrecked else 0.22
    builder.add_box(x, hull_y + 0.72, z, length, 1.44, 4.2, "wall_alt")
    builder.add_beam((x - length / 2, hull_y + 0.16, z - 2.1), (x + length / 2, hull_y + 0.16, z - 1.45), 0.18, 0.24, "trim")
    builder.add_beam((x - length / 2, hull_y + 0.16, z + 2.1), (x + length / 2, hull_y + 0.16, z + 1.45), 0.18, 0.24, "trim")
    builder.add_box(x - length * 0.12, hull_y + 2.15, z, length * 0.34, 1.65, 3.0, "wall")
    builder.add_box(x - length * 0.12, hull_y + 2.45, z + 1.52, length * 0.23, 0.62, 0.08, "glass")
    builder.add_beam((x, hull_y + 2.4, z), (x + length * 0.24, hull_y + (4.2 if not wrecked else 3.2), z), 0.10, 0.10, "trim")


# Blender replacement connection map (all dimensions are metres):
# - vehicle body bottom <-> wheel crown: 0.08m overlap on Y
# - cab / turret / machine shell <-> chassis top: 0.06m overlap on Y
# - crane mast top <-> boom underside: 0.12m overlap on Y
# - roof underside <-> authoritative district wall top: 0.06m overlap on Y
# - fence/sign cross-member <-> vertical post: 0.04m overlap in plan
# - house wall bottom <-> stone plinth: 0.20m overlap on Y
# Every prop is generated at PropPlacement.cx/cz/rotRad.  Runtime BoxSpec
# colliders remain authoritative and are deliberately not exported from Blender.


def prop_point(placement, lx=0.0, lz=0.0):
    """Transform a local prop point with the placement's continuous yaw."""
    yaw = placement["rotRad"]
    scale = placement.get("scaleJitter", 1.0)
    cosine = math.cos(yaw)
    sine = math.sin(yaw)
    lx *= scale
    lz *= scale
    return (
        placement["cx"] + lx * cosine - lz * sine,
        placement["cz"] + lx * sine + lz * cosine,
    )


def prop_box(builder, placement, lx, y, lz, width, height, depth, key="obstacle"):
    x, z = prop_point(placement, lx, lz)
    scale = placement.get("scaleJitter", 1.0)
    builder.add_oriented_box(
        x,
        y * scale,
        z,
        width * scale,
        height * scale,
        depth * scale,
        placement["rotRad"],
        key,
    )


def prop_cylinder(builder, placement, lx, y, lz, radius, height, key="trim", segments=10, top_radius=None):
    x, z = prop_point(placement, lx, lz)
    scale = placement.get("scaleJitter", 1.0)
    builder.add_cylinder(
        x,
        y * scale,
        z,
        radius * scale,
        height * scale,
        key,
        segments,
        None if top_radius is None else top_radius * scale,
    )


def prop_beam(builder, placement, start, end, width, depth, key="trim"):
    sx, sz = prop_point(placement, start[0], start[2])
    ex, ez = prop_point(placement, end[0], end[2])
    scale = placement.get("scaleJitter", 1.0)
    builder.add_beam(
        (sx, start[1] * scale, sz),
        (ex, end[1] * scale, ez),
        width * scale,
        depth * scale,
        key,
    )


def prop_axle(builder, placement, lx, y, half_width, radius, key="trim", segments=10):
    start_x, start_z = prop_point(placement, lx, -half_width)
    end_x, end_z = prop_point(placement, lx, half_width)
    scale = placement.get("scaleJitter", 1.0)
    builder.add_cylinder_between(
        (start_x, y * scale, start_z),
        (end_x, y * scale, end_z),
        radius * scale,
        key,
        segments,
    )


def add_vehicle_prop(builder, placement, kind, lod):
    """Game-scale vehicles with a readable cabin, glass, running gear and lamps."""
    if kind == "truck":
        length, width, chassis_y = 7.4, 2.55, 0.78
        prop_box(builder, placement, 0.35, chassis_y, 0, 6.9, 0.58, width, "trim")
        prop_box(builder, placement, -2.15, 1.72, 0, 2.05, 2.15, width * 0.94, "obstacle")
        prop_box(builder, placement, 1.55, 1.55, 0, 4.65, 1.75, width * 0.96, "wall_alt")
        prop_box(builder, placement, -3.20, 1.95, 0, 0.08, 0.76, width * 0.72, "glass")
        if lod == 0:
            prop_box(builder, placement, -2.12, 2.08, width * 0.475, 1.16, 0.62, 0.08, "glass")
            prop_box(builder, placement, -2.12, 2.08, -width * 0.475, 1.16, 0.62, 0.08, "glass")
            for rail_x in (-0.2, 1.7, 3.55):
                prop_box(builder, placement, rail_x, 2.42, 0, 0.10, 0.18, width * 1.02, "accent")
            prop_box(builder, placement, 3.76, 1.26, 0, 0.12, 0.56, width * 0.72, "accent")
        wheel_xs = (-2.25, 1.35, 2.85)
    elif kind in {"derelictcar", "barricadecar"}:
        length, width, chassis_y = 4.7, 1.92, 0.62
        prop_box(builder, placement, 0, chassis_y, 0, length, 0.62, width, "obstacle")
        prop_box(builder, placement, -0.20, 1.28, 0, 2.42, 0.92, width * 0.84, "wall_alt")
        prop_box(builder, placement, -1.18, 1.42, 0, 0.10, 0.56, width * 0.68, "glass")
        prop_box(builder, placement, 0.80, 1.42, 0, 0.09, 0.54, width * 0.67, "glass")
        if lod == 0:
            prop_box(builder, placement, 0, 1.02, width * 0.49, length * 0.70, 0.10, 0.08, "trim")
            prop_box(builder, placement, -2.38, 0.74, 0, 0.12, 0.26, width * 0.72, "accent")
            if kind == "barricadecar":
                prop_beam(builder, placement, (-2.25, 0.18, -1.12), (2.15, 1.74, 1.08), 0.10, 0.10, "accent")
        wheel_xs = (-1.48, 1.48)
    else:  # tankhull
        length, width, chassis_y = 6.4, 3.55, 0.78
        prop_box(builder, placement, 0, chassis_y, 0, length, 1.18, width, "obstacle")
        prop_box(builder, placement, -0.25, 1.74, 0, 3.15, 0.92, width * 0.72, "wall_alt")
        prop_cylinder(builder, placement, -0.25, 2.32, 0, 1.10, 0.62, "trim", 12, 0.82)
        prop_beam(builder, placement, (0.15, 2.38, 0), (4.15, 2.32, 0), 0.16, 0.16, "trim")
        if lod == 0:
            for lx in (-2.4, -1.2, 0, 1.2, 2.4):
                prop_axle(builder, placement, lx, 0.50, width * 0.53, 0.34, "trim", 8)
            for side in (-1, 1):
                prop_box(builder, placement, 0, 0.55, side * width * 0.55, length * 0.92, 0.58, 0.28, "wall_alt")
        return
    for wheel_x in wheel_xs:
        prop_axle(builder, placement, wheel_x, 0.48, width * 0.54, 0.42, "trim", 10 if lod == 0 else 6)


def add_crane_prop(builder, placement, kind, lod):
    detail = lod == 0
    if kind == "towercrane":
        height = 18.0
        prop_box(builder, placement, 0, height / 2, 0, 0.72, height, 0.72, "trim")
        cells = 7 if detail else 4
        for index in range(cells):
            y0 = index * height / cells
            y1 = (index + 1) * height / cells
            prop_beam(builder, placement, (-0.44, y0, 0), (0.44, y1, 0), 0.055, 0.055, "accent")
            prop_beam(builder, placement, (0.44, y0, 0), (-0.44, y1, 0), 0.055, 0.055, "accent")
        prop_beam(builder, placement, (-3.0, 17.75, 0), (8.4, 17.75, 0), 0.22, 0.22, "accent")
        prop_beam(builder, placement, (-2.8, 17.72, 0), (0, 20.8, 0), 0.16, 0.16, "trim")
        prop_beam(builder, placement, (0, 20.8, 0), (8.4, 17.72, 0), 0.13, 0.13, "trim")
        prop_box(builder, placement, -0.78, 18.38, 0, 1.55, 1.18, 1.25, "wall_alt")
        if detail:
            prop_beam(builder, placement, (4.9, 17.68, 0), (4.9, 11.2, 0), 0.045, 0.045, "trim")
            prop_box(builder, placement, 4.9, 11.05, 0, 0.58, 0.20, 0.58, "accent")
    else:
        height, span = 8.2, 9.3
        for lx in (-span / 2, span / 2):
            prop_box(builder, placement, lx, height / 2, 0, 0.72, height, 0.72, "trim")
            if detail:
                prop_beam(builder, placement, (lx - 0.8, 0, -1.3), (lx, 8.0, 0), 0.10, 0.10, "accent")
                prop_beam(builder, placement, (lx + 0.8, 0, 1.3), (lx, 8.0, 0), 0.10, 0.10, "accent")
        prop_box(builder, placement, 0, 8.05, 0, span + 0.9, 0.72, 0.86, "accent")
        prop_box(builder, placement, 0, 8.60, 0, 2.0, 0.82, 1.36, "wall_alt")
        if detail:
            for lx in (-3.1, 0, 3.1):
                prop_beam(builder, placement, (lx, 7.75, 0), (lx, 5.15, 0), 0.045, 0.045, "trim")


def add_tree_prop(builder, placement, kind, lod):
    seed = int(abs(placement["cx"] * 31 + placement["cz"] * 17)) + len(kind) * 97
    scale = placement.get("scaleJitter", 1.0)
    if kind == "bamboo":
        count = 5 if lod == 0 else 3
        for index in range(count):
            angle = index * 2.399
            radius = 0.16 + (index % 3) * 0.22
            x, z = prop_point(placement, math.cos(angle) * radius, math.sin(angle) * radius)
            height = (4.8 + (index % 4) * 0.55) * scale
            builder.add_cylinder(x, height / 2, z, 0.075 * scale, height, "natural", 6, 0.055 * scale)
            if lod == 0:
                for level in (0.40, 0.62, 0.82):
                    px, pz = prop_point(placement, math.cos(angle + level * 3) * 0.62, math.sin(angle + level * 3) * 0.62)
                    builder.add_box(px, height * level, pz, 0.92 * scale, 0.07 * scale, 0.24 * scale, "natural")
        return
    if kind == "deadtree":
        prop_cylinder(builder, placement, 0, 2.35, 0, 0.20, 4.7, "natural", 7, 0.10)
        branches = 7 if lod == 0 else 3
        for index in range(branches):
            angle = index * 2.17 + stable_unit(seed, index, 0x17) * 0.8
            start_y = 2.2 + (index % 4) * 0.52
            length = 1.0 + stable_unit(seed, index, 0x52) * 1.25
            prop_beam(
                builder,
                placement,
                (0, start_y, 0),
                (math.cos(angle) * length, start_y + 0.72 + index % 2 * 0.30, math.sin(angle) * length),
                0.07,
                0.06,
                "natural",
            )
        return
    trunk_h = 3.8 if kind == "conifer" else 3.5
    prop_cylinder(builder, placement, 0, trunk_h / 2, 0, 0.22, trunk_h, "natural", 8, 0.13)
    if kind == "conifer":
        crowns = 5 if lod == 0 else 3 if lod == 1 else 2
        for index in range(crowns):
            y = 2.0 + index * 0.72
            radius = 1.65 - index * 0.20
            prop_cylinder(builder, placement, 0, y + 0.68, 0, radius, 1.36, "natural", 9 if lod == 0 else 6, 0.12)
    else:
        crowns = 7 if lod == 0 else 4 if lod == 1 else 2
        key = "accent" if kind == "sakura" else "natural"
        for index in range(crowns):
            angle = index * 2.399
            ring = 0.72 if index else 0
            x, z = prop_point(placement, math.cos(angle) * ring, math.sin(angle) * ring)
            radius = (1.20 + stable_unit(seed, index, 0x88) * 0.38) * scale
            builder.add_rock(x, 2.62 * scale, z, radius, 1.72 * scale, key, 8 if lod == 0 else 6, seed + index)
        if lod == 0:
            for index in range(5):
                angle = index * 1.29
                prop_beam(builder, placement, (0, 2.55, 0), (math.cos(angle) * 1.45, 3.45, math.sin(angle) * 1.45), 0.08, 0.07, "natural")


def add_small_prop(builder, placement, kind, lod):
    detail = lod == 0
    if kind == "concretebarrier":
        prop_box(builder, placement, 0, 0.46, 0, 0.72, 0.92, 2.62, "wall")
        prop_box(builder, placement, 0, 0.98, 0, 0.52, 0.20, 2.42, "trim")
        if detail:
            for lz in (-0.82, 0, 0.82):
                prop_box(builder, placement, 0.37, 0.48, lz, 0.04, 0.54, 0.24, "accent")
    elif kind == "fence":
        for lx in (-2.0, 0, 2.0):
            prop_box(builder, placement, lx, 0.82, 0, 0.12, 1.64, 0.12, "trim")
        for y in (0.26, 0.82, 1.38):
            prop_box(builder, placement, 0, y, 0, 4.12, 0.07, 0.08, "trim")
        if detail:
            for lx in (-1.65, -0.85, 0, 0.85, 1.65):
                prop_beam(builder, placement, (lx - 0.45, 0.18, 0), (lx + 0.45, 1.48, 0), 0.022, 0.022, "wall_alt")
    elif kind == "bench":
        prop_box(builder, placement, 0, 0.48, 0, 1.78, 0.14, 0.58, "accent")
        prop_box(builder, placement, 0, 0.98, -0.27, 1.78, 0.70, 0.11, "accent")
        for lx in (-0.66, 0.66):
            prop_box(builder, placement, lx, 0.25, 0, 0.10, 0.50, 0.46, "trim")
        if detail:
            for lx in (-0.58, -0.20, 0.20, 0.58):
                prop_box(builder, placement, lx, 0.74, -0.34, 0.18, 0.07, 0.08, "trim")
    elif kind == "vendingmachine":
        prop_box(builder, placement, 0, 0.94, 0, 0.92, 1.88, 0.68, "wall_alt")
        prop_box(builder, placement, 0, 1.18, 0.35, 0.68, 0.86, 0.05, "emissive")
        prop_box(builder, placement, 0.22, 0.49, 0.36, 0.20, 0.16, 0.06, "accent")
        if detail:
            for row in range(3):
                for col in range(4):
                    prop_box(builder, placement, -0.25 + col * 0.17, 1.43 - row * 0.21, 0.39, 0.11, 0.12, 0.025, "glass")
    elif kind == "pallet":
        for y in (0.06, 0.20):
            for lz in (-0.38, 0, 0.38):
                prop_box(builder, placement, 0, y, lz, 1.36, 0.09, 0.19, "accent")
        for lx in (-0.48, 0, 0.48):
            prop_box(builder, placement, lx, 0.13, 0, 0.19, 0.18, 1.02, "wall_alt")
    elif kind == "supplycrate":
        for layer, (lx, lz) in enumerate(((0, 0), (0.32, 0.28))):
            prop_box(builder, placement, lx, 0.48 + layer * 0.82, lz, 1.08, 0.86, 1.08, "accent")
            if detail:
                for side in (-0.42, 0.42):
                    prop_beam(builder, placement, (side, 0.12 + layer * 0.82, -0.48), (-side, 0.84 + layer * 0.82, 0.48), 0.035, 0.035, "trim")
    elif kind == "drumgroup":
        for lx, lz, layer in ((-0.48, 0, 0), (0.48, 0, 0), (0, 0.54, 0)):
            prop_cylinder(builder, placement, lx, 0.46 + layer, lz, 0.32, 0.92, "obstacle", 10 if detail else 6)
            if detail:
                for y in (0.11, 0.46, 0.81):
                    prop_cylinder(builder, placement, lx, y, lz, 0.34, 0.05, "trim", 10)
    elif kind == "gasbottlegroup":
        for index, (lx, lz) in enumerate(((-0.42, 0), (0.42, 0), (0, 0.42))):
            prop_cylinder(builder, placement, lx, 0.52, lz, 0.18, 0.92, "obstacle", 8, 0.15)
            prop_cylinder(builder, placement, lx, 1.03, lz, 0.10, 0.12, "trim", 6)
        prop_box(builder, placement, 0, 0.48, 0.18, 1.34, 0.98, 1.08, "trim")
    elif kind == "rubble":
        pieces = 8 if detail else 4 if lod == 1 else 2
        seed = int(abs(placement["cx"] * 13 + placement["cz"] * 19))
        for index in range(pieces):
            angle = stable_unit(seed, index, 0x901) * math.tau
            ring = stable_unit(seed, index, 0x902) * 1.08
            x, z = prop_point(placement, math.cos(angle) * ring, math.sin(angle) * ring)
            radius = 0.34 + stable_unit(seed, index, 0x903) * 0.52
            builder.add_rock(x, 0, z, radius, 0.42 + radius * 0.55, "wall_alt" if index % 3 else "accent", 6, seed + index)


def add_structural_prop(builder, placement, kind, lod):
    detail = lod == 0
    if kind in {"towercrane", "portalkrane"}:
        add_crane_prop(builder, placement, kind, lod)
    elif kind == "smokestack":
        prop_cylinder(builder, placement, 0, 8.0, 0, 0.82, 16.0, "wall_alt", 12 if detail else 8, 0.52)
        bands = 6 if detail else 3
        for index in range(bands):
            prop_cylinder(builder, placement, 0, 2.0 + index * 2.45, 0, 0.87 - index * 0.035, 0.18, "accent", 10)
    elif kind in {"gastank", "watertower"}:
        tank_y = 3.75 if kind == "watertower" else 2.65
        if kind == "watertower":
            for lx, lz in ((-1.25, -1.25), (1.25, -1.25), (-1.25, 1.25), (1.25, 1.25)):
                prop_beam(builder, placement, (lx, 0, lz), (lx * 0.72, 4.2, lz * 0.72), 0.10, 0.10, "trim")
        prop_cylinder(builder, placement, 0, tank_y, 0, 2.15 if kind == "gastank" else 1.70, 3.45 if kind == "gastank" else 2.55, "wall", 14 if detail else 8, 1.92 if kind == "gastank" else 1.58)
        prop_cylinder(builder, placement, 0, tank_y + (1.85 if kind == "gastank" else 1.42), 0, 2.0 if kind == "gastank" else 1.58, 0.18, "accent", 12)
        if detail:
            prop_beam(builder, placement, (-2.3, 0.3, 0), (-2.3, tank_y + 1.2, 0), 0.055, 0.055, "trim")
            for y in (1.1, 2.1, 3.1):
                prop_box(builder, placement, -2.3, y, 0, 0.36, 0.06, 0.75, "trim")
    elif kind == "transformer":
        prop_box(builder, placement, 0, 0.82, 0, 2.25, 1.52, 1.66, "wall_alt")
        for lx in (-0.88, -0.44, 0, 0.44, 0.88):
            prop_box(builder, placement, lx, 0.82, 0.87, 0.12, 1.30, 0.12, "trim")
        for lx in (-0.65, 0.65):
            prop_cylinder(builder, placement, lx, 2.18, 0, 0.15, 1.42, "trim", 7, 0.10)
            if detail:
                for y in (1.72, 2.04, 2.36):
                    prop_cylinder(builder, placement, lx, y, 0, 0.30, 0.10, "accent", 8)
    elif kind in {"antenna", "utilitypole", "streetlight"}:
        height = 12.0 if kind == "antenna" else 8.0 if kind == "utilitypole" else 5.2
        prop_cylinder(builder, placement, 0, height / 2, 0, 0.12 if kind != "utilitypole" else 0.17, height, "trim", 8, 0.07)
        if kind == "antenna":
            for y in (4.0, 7.0, 10.0):
                prop_box(builder, placement, 0, y, 0, 1.8 if detail else 1.1, 0.10, 0.10, "accent")
            if detail:
                for angle in (0, math.pi * 0.5, math.pi, math.pi * 1.5):
                    prop_beam(builder, placement, (0, 10.8, 0), (math.cos(angle) * 2.6, 0, math.sin(angle) * 2.6), 0.025, 0.025, "trim")
        elif kind == "utilitypole":
            prop_box(builder, placement, 0, 7.25, 0, 3.8, 0.14, 0.16, "trim")
            if detail:
                for lx in (-1.4, 0, 1.4):
                    prop_cylinder(builder, placement, lx, 7.52, 0, 0.09, 0.42, "glass", 7, 0.06)
        else:
            prop_beam(builder, placement, (0, 5.0, 0), (0.72, 5.0, 0), 0.08, 0.07, "trim")
            prop_box(builder, placement, 0.78, 4.96, 0, 0.72, 0.18, 0.42, "emissive")
    elif kind == "watchpost":
        for lx, lz in ((-1.35, -1.35), (1.35, -1.35), (-1.35, 1.35), (1.35, 1.35)):
            prop_box(builder, placement, lx, 2.0, lz, 0.18, 4.0, 0.18, "trim")
        prop_box(builder, placement, 0, 4.0, 0, 3.2, 0.26, 3.2, "wall_alt")
        prop_box(builder, placement, 0, 5.03, 0, 2.76, 1.82, 2.76, "wall")
        prop_box(builder, placement, 0, 5.18, 1.42, 1.62, 0.72, 0.08, "glass")
        prop_box(builder, placement, 0, 6.05, 0, 3.5, 0.22, 3.5, "accent")
    elif kind == "scaffold":
        for lx in (-1.45, 1.45):
            for lz in (-0.95, 0.95):
                prop_box(builder, placement, lx, 1.8, lz, 0.10, 3.6, 0.10, "trim")
        for y in (0.25, 1.75, 3.45):
            prop_box(builder, placement, 0, y, 0, 3.1, 0.12, 2.08, "wall_alt")
            if detail:
                prop_beam(builder, placement, (-1.45, y, -0.98), (1.45, y + 1.28, -0.98), 0.035, 0.035, "accent")
                prop_beam(builder, placement, (1.45, y, 0.98), (-1.45, y + 1.28, 0.98), 0.035, 0.035, "accent")
    elif kind == "signboard":
        for lx in (-1.05, 1.05):
            prop_box(builder, placement, lx, 1.7, 0, 0.12, 3.4, 0.12, "trim")
        prop_box(builder, placement, 0, 2.68, 0, 2.72, 1.16, 0.16, "emissive")
        if detail:
            for lx in (-0.72, -0.24, 0.24, 0.72):
                prop_box(builder, placement, lx, 2.68, 0.10, 0.08, 0.72, 0.03, "accent")
    elif kind == "torii":
        for lx in (-1.55, 1.55):
            prop_cylinder(builder, placement, lx, 1.78, 0, 0.22, 3.56, "accent", 9, 0.18)
        prop_box(builder, placement, 0, 3.28, 0, 3.80, 0.28, 0.40, "accent")
        prop_box(builder, placement, 0, 3.70, 0, 4.60, 0.22, 0.52, "accent")
        if detail:
            prop_box(builder, placement, 0, 3.02, 0, 0.70, 0.52, 0.18, "trim")
    elif kind == "stonelantern":
        prop_box(builder, placement, 0, 0.14, 0, 0.72, 0.28, 0.72, "wall_alt")
        prop_cylinder(builder, placement, 0, 0.64, 0, 0.20, 0.86, "wall", 8, 0.17)
        prop_box(builder, placement, 0, 1.17, 0, 0.74, 0.34, 0.74, "wall")
        prop_box(builder, placement, 0, 1.48, 0, 0.62, 0.40, 0.62, "emissive" if detail else "wall_alt")
        prop_cylinder(builder, placement, 0, 1.80, 0, 0.62, 0.22, "accent", 8, 0.10)
    elif kind == "well":
        prop_cylinder(builder, placement, 0, 0.46, 0, 1.02, 0.82, "wall", 14 if detail else 8, 1.02)
        prop_cylinder(builder, placement, 0, 0.70, 0, 0.76, 0.64, "wall_alt", 12 if detail else 8, 0.76)
        for lx in (-0.92, 0.92):
            prop_box(builder, placement, lx, 1.50, 0, 0.14, 2.14, 0.14, "trim")
        prop_beam(builder, placement, (-1.12, 2.54, 0), (1.12, 2.54, 0), 0.08, 0.08, "trim")
        if detail:
            prop_cylinder(builder, placement, 0, 1.55, 0, 0.13, 1.72, "accent", 8)
    elif kind == "pier":
        for lx in (-2.75, -0.92, 0.92, 2.75):
            for lz in (-0.88, 0.88):
                prop_box(builder, placement, lx, 0.34, lz, 0.18, 0.68, 0.18, "trim")
        planks = 12 if detail else 6
        for index in range(planks):
            lx = -2.75 + index * 5.5 / max(1, planks - 1)
            prop_box(builder, placement, lx, 0.70, 0, 5.8 / planks * 0.90, 0.14, 2.12, "accent")
        if detail:
            for lx in (-2.75, 2.75):
                for lz in (-1.04, 1.04):
                    prop_box(builder, placement, lx, 1.10, lz, 0.10, 0.86, 0.10, "trim")


def add_blender_prop(builder, placement, lod):
    kind = placement["kind"]
    if kind in {"conifer", "broadleaf", "deadtree", "sakura", "bamboo"}:
        add_tree_prop(builder, placement, kind, lod)
    elif kind == "rock":
        scale = placement.get("scaleJitter", 1.0)
        builder.add_rock(placement["cx"], 0, placement["cz"], 1.35 * scale, 1.58 * scale, "natural", 9 if lod == 0 else 6, int(abs(placement["cx"] * 17 + placement["cz"] * 29)))
    elif kind in {"truck", "derelictcar", "barricadecar", "tankhull"}:
        add_vehicle_prop(builder, placement, kind, lod)
    elif kind == "forklift":
        prop_box(builder, placement, 0, 0.62, 0, 1.65, 1.05, 2.15, "accent")
        prop_box(builder, placement, -0.34, 1.55, -0.72, 1.10, 1.25, 0.10, "trim")
        for lx in (-0.45, 0.45):
            prop_box(builder, placement, lx, 0.18, 1.45, 0.12, 0.18, 2.55, "trim")
        for lx in (-0.55, 0.55):
            prop_axle(builder, placement, lx, 0.40, 1.18, 0.34, "trim", 8)
    elif kind in {"concretebarrier", "fence", "bench", "vendingmachine", "pallet", "supplycrate", "drumgroup", "gasbottlegroup", "rubble"}:
        add_small_prop(builder, placement, kind, lod)
    else:
        add_structural_prop(builder, placement, kind, lod)


PROP_BOX_COUNTS = {
    "conifer": 2, "broadleaf": 2, "deadtree": 3, "sakura": 2, "bamboo": 3,
    "rock": 1, "towercrane": 3, "portalkrane": 3, "smokestack": 1,
    "gastank": 2, "watertower": 2, "transformer": 3, "antenna": 1,
    "truck": 2, "derelictcar": 1, "forklift": 2, "barricadecar": 2,
    "concretebarrier": 1, "fence": 1, "watchpost": 2, "tankhull": 2,
    "scaffold": 3, "streetlight": 2, "signboard": 2, "bench": 1,
    "vendingmachine": 1, "drumgroup": 3, "pallet": 1, "torii": 3,
    "stonelantern": 3, "well": 2, "pier": 3, "utilitypole": 2,
    "rubble": 2, "gasbottlegroup": 3, "supplycrate": 2,
}


def blender_prop_placements(stage):
    """Mirror planPropVisualsV2's breakable-instance exclusion exactly.

    A breakable runtime prop must retain its individually removable Three.js
    mesh.  Exporting a permanent Blender copy would leave a ghost visual after
    destruction, so only complete, non-breakable placement groups are baked.
    """
    prop_boxes = [box for box in stage["boxes"] if box.get("prop")]
    cursor = 0
    replacements = []
    for placement in stage.get("propPlacements", []):
        count = PROP_BOX_COUNTS[placement["kind"]]
        group = prop_boxes[cursor:cursor + count]
        cursor += count
        if len(group) == count and not any(box.get("breakable") for box in group):
            replacements.append(placement)
    if cursor != len(prop_boxes):
        raise RuntimeError(
            f"{stage['id']}: prop placement/box contract drift ({cursor} != {len(prop_boxes)})"
        )
    return replacements


def add_blender_props(builder, stage, lod):
    """Replace all authored runtime prop visuals while preserving collision."""
    for placement in blender_prop_placements(stage):
        # LOD2 keeps silhouettes and cover-sized props only.
        if lod == 2 and placement["kind"] in {
            "bench", "vendingmachine", "drumgroup", "pallet", "stonelantern",
            "gasbottlegroup", "supplycrate", "rubble",
        }:
            continue
        add_blender_prop(builder, placement, lod)


def add_playable_district_rooflines(builder, stage, lod):
    """Seat roof/facade identity onto authoritative playable buildings."""
    if lod == 2:
        return
    family = IDENTITIES[stage["id"]][0]
    profile = PROFILES[stage["id"]]
    candidates = [
        box for box in stage["boxes"]
        if box.get("district")
        and not box.get("ghost")
        and not box.get("decor")
        and not box.get("legacyHorizon")
        and box["h"] >= 4.8
        and box["w"] >= 5.5
        and box["d"] >= 5.5
    ]
    candidates = sorted(candidates, key=lambda box: box["w"] * box["d"] * box["h"], reverse=True)
    for index, box in enumerate(candidates[:18 if lod == 0 else 10]):
        top = box["y"] + box["h"] / 2
        width, depth = box["w"], box["d"]
        if family in {"heritage", "wilderness"} and profile["dressing"] not in {"armored-outpost", "cliff-fortress"}:
            builder.add_gable_roof(box["x"], top - 0.06, box["z"], width + 0.34, max(0.85, min(2.3, width * 0.12)), depth + 0.44, "accent", "x")
        elif family in {"industrial", "airport", "military", "geothermal", "arctic"}:
            # Saw-tooth / service roof with seated parapet and vents.
            builder.add_box(box["x"], top + 0.08, box["z"], width + 0.18, 0.22, depth + 0.18, "trim")
            if lod == 0 and index % 2 == 0:
                vent_count = max(1, min(4, int(width // 7)))
                for vent in range(vent_count):
                    vx = box["x"] + (vent - (vent_count - 1) / 2) * width * 0.68 / max(1, vent_count - 1)
                    builder.add_cylinder(vx, top + 0.62, box["z"], 0.32, 1.12, "wall_alt", 8, 0.24)
        else:
            builder.add_box(box["x"], top + 0.22, box["z"], width + 0.20, 0.44, depth + 0.20, "wall_alt")
            if lod == 0:
                builder.add_box(box["x"], top + 0.72, box["z"], min(4.5, width * 0.38), 1.0, min(3.2, depth * 0.38), "trim")


def add_playable_district_facades(builder, stage, lod):
    """Give large collision buildings four-sided, human-scale articulation."""
    if lod == 2:
        return
    family = IDENTITIES[stage["id"]][0]
    mood = stage["palette"].get("mood")
    candidates = [
        box for box in stage["boxes"]
        if box.get("district")
        and not box.get("ghost")
        and not box.get("decor")
        and not box.get("legacyHorizon")
        and box["h"] >= 4.2
        and box["w"] * box["d"] >= 30
    ]
    candidates = sorted(candidates, key=lambda box: box["w"] * box["d"] * box["h"], reverse=True)
    for index, box in enumerate(candidates[:14 if lod == 0 else 8]):
        base = box["y"] - box["h"] / 2
        levels = max(1, min(3 if lod == 0 else 2, int(box["h"] // 3.2)))
        for level in range(levels):
            y = base + (level + 0.56) * box["h"] / levels
            pane_h = max(0.58, min(1.26, box["h"] / levels * 0.34))
            if family in {"heritage", "wilderness"}:
                pane_key = "glass" if (level + index) % 3 else "accent"
            elif mood == "night" and (level + index) % 4 == 0:
                pane_key = "emissive"
            else:
                pane_key = "glass"
            pane_w = max(1.1, box["w"] * 0.68)
            pane_d = max(1.1, box["d"] * 0.68)
            # 4.5cm facade depth stays visually attached to the collider shell.
            builder.add_box(box["x"], y, box["z"] - box["d"] / 2 - 0.045, pane_w, pane_h, 0.09, pane_key)
            builder.add_box(box["x"], y, box["z"] + box["d"] / 2 + 0.045, pane_w, pane_h, 0.09, pane_key)
            builder.add_box(box["x"] - box["w"] / 2 - 0.045, y, box["z"], 0.09, pane_h, pane_d, pane_key)
            builder.add_box(box["x"] + box["w"] / 2 + 0.045, y, box["z"], 0.09, pane_h, pane_d, pane_key)
            if lod == 0:
                # Horizontal lintels and corner posts supply construction logic.
                for face_z in (box["z"] - box["d"] / 2 - 0.052, box["z"] + box["d"] / 2 + 0.052):
                    builder.add_box(box["x"], y + pane_h / 2 + 0.08, face_z, pane_w + 0.34, 0.12, 0.11, "trim")
                for face_x in (box["x"] - box["w"] / 2 - 0.052, box["x"] + box["w"] / 2 + 0.052):
                    builder.add_box(face_x, y + pane_h / 2 + 0.08, box["z"], 0.11, 0.12, pane_d + 0.34, "trim")
        if lod == 0:
            for sx in (-1, 1):
                for sz in (-1, 1):
                    builder.add_box(
                        box["x"] + sx * box["w"] / 2,
                        box["y"],
                        box["z"] + sz * box["d"] / 2,
                        0.16,
                        box["h"] * 0.92,
                        0.16,
                        "trim",
                    )


def add_authoritative_wall_facades(builder, stage, lod):
    """Articulate the thin collider walls used by enterable buildings.

    StageLayout models interiors as separate wall, roof and floor boxes.  This
    pass decorates only wall segments that already block traversal, so doors
    and route openings remain open and no collider-free facade crosses them.
    """
    if lod == 2:
        return
    family = IDENTITIES[stage["id"]][0]
    mood = stage["palette"].get("mood")
    segments = []
    for box in stage["boxes"]:
        if not box.get("district") or box.get("ghost") or box.get("decor") or box.get("legacyHorizon"):
            continue
        if box["h"] < 3.2:
            continue
        along_x = box["d"] <= 1.6 and box["w"] >= 4.0
        along_z = box["w"] <= 1.6 and box["d"] >= 4.0
        if along_x or along_z:
            segments.append((box, along_x))
    segments.sort(key=lambda item: max(item[0]["w"], item[0]["d"]) * item[0]["h"], reverse=True)
    for index, (box, along_x) in enumerate(segments[:64 if lod == 0 else 36]):
        length = box["w"] if along_x else box["d"]
        bays = max(1, min(6 if lod == 0 else 3, int(length // 3.2)))
        levels = max(1, min(3 if lod == 0 else 2, int(box["h"] // 3.3)))
        base_y = box["y"] - box["h"] / 2
        pane_key = (
            "emissive"
            if mood == "night" and index % 5 == 0
            else "accent"
            if family == "heritage" and index % 4 == 0
            else "glass"
        )
        for level in range(levels):
            y = base_y + (level + 0.56) * box["h"] / levels
            pane_h = max(0.54, min(1.20, box["h"] / levels * 0.35))
            for bay in range(bays):
                offset = (bay - (bays - 1) / 2) * length * 0.78 / max(1, bays - 1)
                pane_span = min(1.42, length / (bays + 0.5) * 0.58)
                if along_x:
                    for side in (-1, 1):
                        face_z = box["z"] + side * (box["d"] / 2 + 0.045)
                        builder.add_box(box["x"] + offset, y, face_z, pane_span, pane_h, 0.09, pane_key)
                        if lod == 0:
                            builder.add_box(box["x"] + offset, y, face_z + side * 0.014, 0.07, pane_h + 0.16, 0.11, "trim")
                else:
                    for side in (-1, 1):
                        face_x = box["x"] + side * (box["w"] / 2 + 0.045)
                        builder.add_box(face_x, y, box["z"] + offset, 0.09, pane_h, pane_span, pane_key)
                        if lod == 0:
                            builder.add_box(face_x + side * 0.014, y, box["z"] + offset, 0.11, pane_h + 0.16, 0.07, "trim")
        # A seated top/bottom belt exposes construction scale even when the
        # wall is seen at a glancing angle from the interior.
        if along_x:
            for y in (base_y + 0.20, base_y + box["h"] - 0.18):
                builder.add_box(box["x"], y, box["z"], length + 0.12, 0.16, box["d"] + 0.14, "trim")
        else:
            for y in (base_y + 0.20, base_y + box["h"] - 0.18):
                builder.add_box(box["x"], y, box["z"], box["w"] + 0.14, 0.16, length + 0.12, "trim")


def add_exterior_architecture(builder, stage, lod):
    """Build a four-sided, stage-specific 3D district beyond the play wall."""
    if IDENTITIES[stage["id"]][1] in {"grand-abbey", "ruined-abbey"}:
        return
    profile = PROFILES[stage["id"]]
    family = IDENTITIES[stage["id"]][0]
    half = stage["size"] / 2
    count = 28 if lod == 0 else 14 if lod == 1 else 8
    if stage["id"] == "chikurin":
        count = 24 if lod == 0 else 13 if lod == 1 else 8
    if family == "heritage":
        style = "heritage"
    elif profile["dressing"] in {"irrigation-village", "piers-and-cabins"}:
        style = "timber"
    elif family in {"urban", "airport", "arctic"}:
        style = "modern"
    else:
        style = "industrial"
    ruined = family in {"undead", "geothermal"}
    for index in range(count):
        side = index % 4
        lane = index // 4
        jitter = (stable_unit(stage["seed"], index, 0xD17) - 0.5) * 9.0
        yaw = (stable_unit(stage["seed"], index, 0xD18) - 0.5) * 0.18
        spacing = half * 0.20
        if side == 0:
            x = -half * 0.58 + lane * spacing + jitter
            z = -half - 5.5 - (lane % 3) * 3.2
        elif side == 1:
            x = -half - 5.5 - (lane % 3) * 3.2
            z = -half * 0.58 + lane * spacing + jitter
            yaw += math.pi / 2
        elif side == 2:
            x = half + 5.5 + (lane % 3) * 3.2
            z = -half * 0.58 + lane * spacing - jitter
            yaw -= math.pi / 2
        else:
            x = -half * 0.58 + lane * spacing - jitter
            z = half + 5.5 + (lane % 3) * 3.2
            yaw += math.pi
        width = 9.0 + (index % 4) * 2.0
        depth = 7.0 + (index % 3) * 1.4
        storeys = 3 if index % 7 == 0 else 2 if index % 3 == 0 else 1
        add_gabled_house(builder, x, z, width, depth, storeys, style, lod, ruined and index % 3 == 0, yaw)




def add_abbey_visual(builder, stage, lod):
    """Model the visible Gothic shell over the playable abbey collision plan."""
    if not any(box.get("district") == "abbey" for box in stage["boxes"]):
        return
    damaged = stage["id"] == "z04"
    rot = stage["seed"] & 3
    plan_scale = 1.28

    def point(lx, lz):
        lx *= plan_scale
        lz *= plan_scale
        if rot == 1:
            return lz, -lx
        if rot == 2:
            return -lx, -lz
        if rot == 3:
            return -lz, lx
        return lx, lz

    def gable(lx, lz, base_y, local_w, roof_h, local_d, key="accent"):
        x, z = point(lx, lz)
        if rot & 1:
            builder.add_gable_roof(x, base_y, z, local_d * plan_scale, roof_h, local_w * plan_scale, key, "z")
        else:
            builder.add_gable_roof(x, base_y, z, local_w * plan_scale, roof_h, local_d * plan_scale, key, "x")

    def gable_cross(lx, lz, base_y, local_w, roof_h, local_d, key="accent"):
        """Perpendicular roof used by the cathedral transept."""
        x, z = point(lx, lz)
        if rot & 1:
            builder.add_gable_roof(x, base_y, z, local_w * plan_scale, roof_h, local_d * plan_scale, key, "x")
        else:
            builder.add_gable_roof(x, base_y, z, local_d * plan_scale, roof_h, local_w * plan_scale, key, "z")

    def facade_panel(lx, lz, y, width, height, local_plane="x", key="glass"):
        """Seat a framed Gothic lancet directly on an existing solid wall."""
        x, z = point(lx, lz)
        plane_x = (local_plane == "x") != bool(rot & 1)
        scaled_width = width * plan_scale
        if plane_x:
            builder.add_box(x, y, z, 0.10, height, scaled_width, key)
        else:
            builder.add_box(x, y, z, scaled_width, height, 0.10, key)
        if lod != 0:
            return
        # Two jambs and a pointed head.  These are sub-20cm facade strips,
        # never separate cover or invisible collision.
        if local_plane == "x":
            low_a = point(lx, lz - width * 0.52)
            low_b = point(lx, lz + width * 0.52)
        else:
            low_a = point(lx - width * 0.52, lz)
            low_b = point(lx + width * 0.52, lz)
        for px, pz in (low_a, low_b):
            builder.add_beam((px, y - height * 0.48, pz), (px, y + height * 0.20, pz), 0.09, 0.08, "trim")
        apex = point(lx, lz)
        builder.add_beam((low_a[0], y + height * 0.20, low_a[1]), (apex[0], y + height * 0.50, apex[1]), 0.10, 0.08, "trim")
        builder.add_beam((low_b[0], y + height * 0.20, low_b[1]), (apex[0], y + height * 0.50, apex[1]), 0.10, 0.08, "trim")

    # Nave and east-hall roof masses.  The ruined variant exposes rafters and
    # leaves a large broken section instead of merely recolouring the castle.
    if not damaged or lod > 0:
        gable(-28, 0, 16.05, 36.5, 11.5, 25.5, "accent")
    else:
        gable(-35.5, 0, 16.05, 17.5, 10.8, 25.5, "accent")
        for index in range(7):
            lx = -25 + index * 2.4
            a = point(lx, -11.8)
            b = point(lx + (2.8 if index % 2 else -1.4), 4.8)
            builder.add_beam((a[0], 16.2, a[1]), (b[0], 21.2 - index * 0.32, b[1]), 0.16, 0.14, "trim")
    gable_cross(-28, 0, 16.08, 18.0, 9.2, 30.0, "trim" if damaged else "accent")
    gable(31, 0, 12.1, 24.0, 7.6, 28.0, "trim" if damaged else "accent")

    # Four corner spires and the dominant central bell tower.
    segments = 12 if lod == 0 else 8
    for tower_index, (lx, lz) in enumerate(((-41, -31), (-41, 31), (41, -31), (41, 31))):
        x, z = point(lx, lz)
        spire_h = 16.5 if not damaged else (7.5 if tower_index == 1 else 13.0)
        if damaged and tower_index == 2 and lod == 0:
            builder.add_beam((x - 2.5, 18.2, z - 2), (x + 3.4, 23.0, z + 2.4), 0.28, 0.24, "trim")
        else:
            builder.add_cylinder(x, 18 + spire_h / 2, z, 7.2, spire_h, "accent", segments, 0.16)
        builder.add_box(x, 17.7, z, 11.2 * plan_scale, 0.38, 11.2 * plan_scale, "trim")
        if lod == 0:
            for face in (-1, 1):
                if rot & 1:
                    builder.add_box(x, 12.5, z + face * 5.62 * plan_scale, 1.35, 5.2, 0.10, "emissive" if damaged else "glass")
                else:
                    builder.add_box(x + face * 5.62 * plan_scale, 12.5, z, 0.10, 5.2, 1.35, "emissive" if damaged else "glass")

    central_x, central_z = point(14, 0)
    # The central belfry is the stage-scale reference: a 54m silhouette in the
    # normal map and a visibly sheared 43m crown in the ruined map.
    builder.add_box(central_x, 22.0, central_z, 17.0, 20.0, 17.0, "wall_alt")
    builder.add_box(central_x, 33.2, central_z, 14.8, 3.0, 14.8, "trim")
    central_spire_h = 20.0 if not damaged else 11.0
    builder.add_cylinder(
        central_x,
        34.5 + central_spire_h / 2,
        central_z,
        10.2,
        central_spire_h,
        "accent",
        12 if lod == 0 else 8,
        0.22 if not damaged else 2.6,
    )
    builder.add_cylinder(central_x, 48.0 if not damaged else 42.0, central_z, 0.30, 9.0 if not damaged else 4.0, "trim", 8, 0.08)

    # Belfry openings, corner pinnacles and cathedral front windows turn the
    # large masses into readable architecture at FPS distance.
    if lod <= 1:
        for local_plane, (lx, lz) in (("x", (14, -6.68)), ("x", (14, 6.68)), ("z", (7.32, 0)), ("z", (20.68, 0))):
            facade_panel(lx, lz, 25.2, 3.0, 7.6, local_plane, "emissive" if damaged else "glass")
        for ox, oz in ((-7.2, -7.2), (-7.2, 7.2), (7.2, -7.2), (7.2, 7.2)):
            px, pz = point(14 + ox / plan_scale, oz / plan_scale)
            builder.add_cylinder(px, 36.8, pz, 1.18, 9.0 if not damaged else 5.6, "accent", 8, 0.10)
        facade_panel(-44.55, 0, 10.4, 9.0, 9.5, "x", "emissive" if damaged else "glass")
        facade_panel(41.55, 0, 8.1, 7.2, 7.0, "x", "emissive" if damaged else "glass")

    if lod == 0:
        # Dormers and chimneys give the roof line a human construction scale.
        for index, lx in enumerate((-39, -33, -27, -21, -15)):
            for lz in (-9.8, 9.8):
                dx, dz = point(lx, lz)
                builder.add_box(dx, 18.6 + (index % 2) * 0.35, dz, 1.55, 2.7, 1.25, "wall_alt")
                builder.add_cylinder(dx, 21.2, dz, 1.20, 2.6, "accent", 8, 0.10)

    if lod == 0:
        # Flying-buttress rhythm seated against the nave walls.
        for lx in (-40, -34, -28, -22, -16):
            for lz in (-12.4, 12.4):
                outer = point(lx, lz + (2.8 if lz > 0 else -2.8))
                inner = point(lx, lz)
                builder.add_beam((outer[0], 1.0, outer[1]), (inner[0], 11.8, inner[1]), 0.22, 0.20, "trim")
                builder.add_box(outer[0], 2.1, outer[1], 0.92, 4.2, 0.92, "wall_alt")
        # Stained window bands are flush with real walls and illuminate the
        # nave without becoming collider-free cover.
        for lx in (-39, -33, -27, -21, -15):
            for lz in (-11.56, 11.56):
                x, z = point(lx, lz)
                if rot & 1:
                    builder.add_box(x, 10.2, z, 0.10, 4.6, 1.2, "emissive" if damaged else "glass")
                else:
                    builder.add_box(x, 10.2, z, 1.2, 4.6, 0.10, "emissive" if damaged else "glass")
        # Low crenellation trim along the outer walks; 22cm height avoids a
        # misleading invisible gameplay obstacle.
        for index in range(-10, 11):
            for lz in (-35.9, 35.9):
                x, z = point(index * 4.0, lz)
                builder.add_box(x, 8.18, z, 2.1 if not (rot & 1) else 0.40, 0.22, 0.40 if not (rot & 1) else 2.1, "trim")
        for index in range(-7, 8):
            for lx in (-45.9, 45.9):
                x, z = point(lx, index * 4.0)
                builder.add_box(x, 8.18, z, 0.40 if not (rot & 1) else 2.1, 0.22, 2.1 if not (rot & 1) else 0.40, "trim")


def add_pipe_rack(builder, x, z, span=22, height=9, pipes=3):
    for sx in (-span / 2, span / 2):
        builder.add_box(x + sx, height / 2, z, 0.65, height, 0.65, "trim")
    builder.add_beam((x - span / 2, height, z), (x + span / 2, height, z), 0.45, 0.45, "trim")
    for pipe in range(pipes):
        offset = (pipe - (pipes - 1) / 2) * 1.2
        builder.add_beam((x - span / 2, height - 1.2, z + offset), (x + span / 2, height - 1.2, z + offset), 0.22, 0.22, "accent" if pipe == 0 else "obstacle")


def add_ground_character(builder, stage, lod):
    if lod == 2:
        return
    surface = PROFILES[stage["id"]]["surface"]
    size = stage["size"]
    seed = stage["seed"]
    half = size / 2

    if surface == "abbey-causeway":
        # Broad dry-set cobble lanes and rain pockets.  They share the runtime
        # collision plane, so the imported layer cannot snag player movement.
        for index in range(-9 if lod == 0 else -5, 10 if lod == 0 else 6):
            offset = index * size * 0.034
            builder.add_box(offset, 0.036, 0, 0.075, 0.012, size * 0.68, "trim")
            builder.add_box(0, 0.037, offset, size * 0.68, 0.012, 0.075, "trim")
        for index in range(13 if lod == 0 else 6):
            x = (stable_unit(seed, index, 0xA11) - 0.5) * size * 0.62
            z = (stable_unit(seed, index, 0xA12) - 0.5) * size * 0.62
            builder.add_box(x, 0.041, z, 2.4 + index % 4, 0.012, 1.1 + index % 3, "water")
    elif surface in {"range-concrete", "compact-range", "airport-apron", "checkpoint-wet-road"}:
        stripe_count = 11 if lod == 0 else 6
        for index in range(stripe_count):
            offset = -half * 0.36 + index * half * 0.072
            builder.add_box(offset, 0.042, half * 0.20, 0.22, 0.018, size * 0.34, "accent")
        if surface == "airport-apron":
            builder.add_cylinder(-half * 0.12, 0.046, -half * 0.05, 14, 0.018, "accent", 32 if lod == 0 else 16)
            builder.add_cylinder(-half * 0.12, 0.049, -half * 0.05, 10, 0.02, "road", 32 if lod == 0 else 16)
    elif surface in {"wet-logistics", "harbor-concrete", "neon-wet-street", "ruined-wet-asphalt", "wrecked-dock"}:
        puddle_count = 18 if lod == 0 else 8
        for index in range(puddle_count):
            x = (stable_unit(seed, index, 0x311) - 0.5) * size * 0.72
            z = (stable_unit(seed, index, 0x312) - 0.5) * size * 0.72
            width = 3.0 + stable_unit(seed, index, 0x313) * 9.0
            depth = 1.6 + stable_unit(seed, index, 0x314) * 5.0
            builder.add_box(x, 0.038, z, width, 0.012, depth, "water")
        if surface in {"harbor-concrete", "wrecked-dock"}:
            # A shallow flooded service dock catches the sky and crane lights
            # in first-person views while retaining the authoritative runtime
            # floor/collision below it.
            basin_z = -half * 0.34
            basin_x = half * (0.22 if stage["seed"] & 1 else -0.22)
            builder.add_box(basin_x, 0.032, basin_z, half * 0.42, 0.016, half * 0.18, "water")
            builder.add_box(basin_x, 0.07, basin_z - half * 0.095, half * 0.46, 0.14, 0.42, "trim")
            builder.add_box(basin_x, 0.07, basin_z + half * 0.095, half * 0.46, 0.14, 0.42, "trim")
    elif surface in {"palace-stone", "desert-stone", "cathedral-stone", "subway-tile", "onsen-stone"}:
        line_count = 13 if lod == 0 else 7
        for index in range(-line_count, line_count + 1):
            offset = index * size / (line_count * 2.7)
            builder.add_box(offset, 0.035, 0, 0.045, 0.012, size * 0.72, "trim")
            builder.add_box(0, 0.036, offset, size * 0.72, 0.012, 0.045, "trim")
        if surface == "palace-stone":
            builder.add_box(half * 0.24, 0.045, -half * 0.18, half * 0.28, 0.025, half * 0.16, "water")
        elif surface == "onsen-stone":
            for x in (-half * 0.22, half * 0.20):
                builder.add_box(x, 0.05, -half * 0.28, half * 0.20, 0.028, half * 0.13, "water")
    elif surface == "rail-ballast":
        for track in (-half * 0.18, 0, half * 0.18):
            builder.add_beam((-half * 0.45, 0.11, track - 0.72), (half * 0.45, 0.11, track - 0.72), 0.07, 0.09, "trim")
            builder.add_beam((-half * 0.45, 0.11, track + 0.72), (half * 0.45, 0.11, track + 0.72), 0.07, 0.09, "trim")
    elif surface in {"rice-terraces", "lakeside-stone"}:
        for band in range(4 if lod == 0 else 2):
            z = -half * 0.34 + band * half * 0.19
            builder.add_box(half * 0.28, -0.025, z, half * 0.34, 0.045, half * 0.12, "water")
    elif surface in {"lava-mine-floor", "volcanic-fortress"}:
        for index in range(5 if lod == 0 else 3):
            x0 = -half * 0.42 + index * half * 0.19
            bend = (stable_unit(seed, index, 0xF1) - 0.5) * half * 0.12
            builder.add_beam((x0, 0.06, -half * 0.46), (x0 + bend, 0.06, half * 0.46), 0.28, 0.05, "emissive")
    else:
        patch_count = 20 if lod == 0 else 10
        for index in range(patch_count):
            x = (stable_unit(seed, index, 0x201) - 0.5) * size * 0.78
            z = (stable_unit(seed, index, 0x202) - 0.5) * size * 0.78
            radius = 1.8 + stable_unit(seed, index, 0x203) * 4.0
            builder.add_cylinder(x, 0.025, z, radius, 0.018, "natural", 8 if lod == 0 else 6)


def add_stage_dressing(builder, stage, lod):
    if lod == 2:
        return
    profile = PROFILES[stage["id"]]
    dressing = profile["dressing"]
    size = stage["size"]
    half = size / 2
    edge = half + 13
    seed = stage["seed"]
    detail = lod == 0

    if dressing in {"range-targets", "close-range-drills"}:
        add_hangar(builder, -half * 0.48, -edge, 30 if detail else 24, 19, 9, "wall_alt")
        add_hangar(builder, half * 0.16, -edge - 2, 34 if detail else 26, 20, 10, "wall")
        add_hangar(builder, half * 0.60, -edge + 1, 25, 16, 8, "wall_alt")
        add_vehicle_silhouette(builder, -half * 0.12, -half * 0.44, 6.4, 3.0, 2.1)
        if detail:
            add_vehicle_silhouette(builder, half * 0.42, -half * 0.42, 7.2, 3.2, 2.4)
        tree_count = 34 if detail else 18
        for index in range(tree_count):
            angle = math.tau * index / tree_count + stable_unit(seed, index, 0x501) * 0.08
            radius = half + 22 + stable_unit(seed, index, 0x502) * 22
            add_tree(builder, math.cos(angle) * radius, math.sin(angle) * radius, 7 + stable_unit(seed, index, 0x503) * 9, seed + index, True, lod)
        if detail:
            add_gabled_house(builder, -half * 0.28, -edge + 8, 12, 8, 1, "industrial", lod)
            add_gabled_house(builder, half * 0.34, -edge + 6, 10, 7, 1, "industrial", lod)
    elif dressing in {"containers", "dock-equipment", "wreckage"}:
        for index in range(5 if detail else 3):
            add_container_stack(builder, -half * 0.54 + index * half * 0.25, -edge, 2 + index % 2, 2 + (index + 1) % 2)
        if dressing in {"dock-equipment", "wreckage"}:
            # Two additional portal cranes make the harbor identity readable
            # from oblique player spawns instead of only from the QA camera.
            crane_count = 2 if detail else 1
            for crane_index in range(crane_count):
                crane_x = (-0.52 + crane_index * 1.04) * half
                crane_z = -half - 5 - crane_index * 4
                crane_height = 24 if detail else 18
                crane_span = 22 if detail else 17
                for sx in (-crane_span / 2, crane_span / 2):
                    builder.add_beam(
                        (crane_x + sx, 0, crane_z - 4),
                        (crane_x + sx * 0.88, crane_height, crane_z),
                        0.62,
                        0.62,
                        "trim",
                    )
                builder.add_beam(
                    (crane_x - crane_span / 2, crane_height, crane_z),
                    (crane_x + crane_span / 2, crane_height, crane_z),
                    0.76,
                    0.76,
                    "accent" if dressing == "dock-equipment" else "wall_alt",
                )
                builder.add_beam(
                    (crane_x, crane_height, crane_z),
                    (crane_x + crane_span * 0.74, crane_height - 2.6, crane_z),
                    0.44,
                    0.44,
                    "trim",
                )
            add_gabled_house(builder, 0, -edge - 5, 28 if detail else 20, 15, 2 if detail else 1, "industrial", lod, dressing == "wreckage")
            add_workboat(builder, -half * 0.30, -half - 25, 20 if detail else 15, lod, dressing == "wreckage")
            if detail:
                add_workboat(builder, half * 0.30, -half - 34, 15, lod, dressing == "wreckage")
    elif dressing in {"courtyard-gardens", "bamboo-shrine", "irrigation-village", "baths-and-lanterns"}:
        tree_count = (12 if detail else 8) if dressing == "bamboo-shrine" else (24 if detail else 12)
        for index in range(tree_count):
            angle = math.tau * index / tree_count + stable_unit(seed, index, 0x601) * 0.12
            radius = half + 7 + stable_unit(seed, index, 0x602) * 18
            height = 6 + stable_unit(seed, index, 0x603) * 10
            if dressing == "bamboo-shrine":
                add_bamboo(builder, math.cos(angle) * radius, math.sin(angle) * radius, height, seed + index, lod)
            else:
                add_tree(builder, math.cos(angle) * radius, math.sin(angle) * radius, height, seed + index, False, lod)
        for offset in (-half * 0.46, 0, half * 0.46):
            add_arch(builder, offset, 0, -edge, 14, 9, 2.5, "wall")
        house_style = "heritage" if dressing in {"courtyard-gardens", "baths-and-lanterns"} else "timber"
        house_count = 7 if detail else 4
        for index in range(house_count):
            hx = (index - (house_count - 1) / 2) * half * 0.20
            hz = -edge - 7 - abs(index - house_count // 2) * 1.8
            add_gabled_house(
                builder,
                hx,
                hz,
                10 + (index % 3) * 2.4,
                7.5 + (index % 2) * 1.8,
                2 if dressing == "baths-and-lanterns" and index % 2 == 0 else 1,
                house_style,
                lod,
            )
        lantern_count = 12 if detail else 6
        for index in range(lantern_count):
            lx = -half * 0.42 + index * half * 0.84 / max(1, lantern_count - 1)
            add_stone_lantern(builder, lx, -half * 0.38, 2.0 + (index % 3) * 0.18, dressing == "baths-and-lanterns")
        if dressing == "bamboo-shrine" and detail:
            for index in range(-4, 5):
                add_bamboo(
                    builder,
                    index * half * 0.085,
                    -half - 4 - abs(index % 3),
                    14 + index % 4,
                    seed + 900 + index,
                    lod,
                )
    elif dressing in {"abbey-town", "ruined-abbey-town"}:
        ruined = dressing == "ruined-abbey-town"
        # Dense but inaccessible outer borough on three shores.  It is placed
        # beyond the authored play boundary, while the 123x100m central abbey
        # itself remains the fully collidable/enterable combat space.
        house_count = 34 if detail else 17
        for index in range(house_count):
            side = index % 3
            lane = index // 3
            drift = (stable_unit(seed, index, 0xC21) - 0.5) * 7.0
            if side == 0:
                hx = -half * 0.76 + lane * half * 0.145 + drift
                hz = -edge - 8 - (lane % 4) * 4.5
            elif side == 1:
                hx = -edge - 8 - (lane % 4) * 4.4
                hz = -half * 0.72 + lane * half * 0.14 + drift
            else:
                hx = edge + 8 + (lane % 4) * 4.4
                hz = -half * 0.72 + lane * half * 0.14 - drift
            width = 8.2 + (index % 5) * 1.55
            depth = 6.8 + (index % 3) * 1.35
            storeys = 3 if index % 7 == 0 else 2 if index % 3 == 0 else 1
            add_gabled_house(builder, hx, hz, width, depth, storeys, "heritage", lod, ruined and index % 3 != 1)
            if detail and index % 5 == 0:
                # Chimney stacks break up repeated roof silhouettes.
                builder.add_box(hx + width * 0.24, storeys * 3.65 + 1.1, hz, 0.72, 2.2, 0.72, "trim")
        # Terraced retaining walls make the borough climb toward the abbey
        # instead of reading as one row of houses on an empty plane.
        for tier in range(4 if detail else 2):
            tier_width = size * (0.82 - tier * 0.08)
            tier_z = -half - 4.5 - tier * 7.2
            builder.add_box(0, 1.0 + tier * 0.35, tier_z, tier_width, 2.0 + tier * 0.7, 1.2, "wall_alt")
        add_arch(builder, 0, 0, -half - 4.5, 20, 15, 4.5, "wall_alt")
        marker_count = 22 if detail else 10
        for index in range(marker_count):
            mx = -half * 0.43 + index * half * 0.86 / max(1, marker_count - 1)
            mz = -half * 0.34 - (index % 3) * 2.0
            if ruined:
                builder.add_box(mx, 0.72, mz, 0.42, 1.44, 0.18, "wall")
                builder.add_box(mx, 1.18, mz, 0.86, 0.18, 0.20, "wall")
            else:
                add_stone_lantern(builder, mx, mz, 1.8 + (index % 2) * 0.25, False)
    elif dressing in {"colonnades", "cliff-fortress", "fortress-emplacements"}:
        for index in range(-4 if detail else -2, 5 if detail else 3):
            add_arch(builder, index * 12, 0, -edge, 10, 13 + abs(index) % 3 * 2, 3, "wall")
    elif dressing in {"armored-outpost", "research-modules", "bunkers", "ground-support"}:
        for index in range(-2, 3):
            add_hangar(builder, index * half * 0.23, -edge, 24 if detail else 19, 16, 8 + abs(index), "wall_alt")
        add_vehicle_silhouette(builder, half * 0.18, -half * 0.44, 8.5 if dressing == "ground-support" else 6.5, 3.2, 2.2)
    elif dressing in {"pipes-and-vats", "conveyors", "processing-lines", "heat-shields", "mine-equipment"}:
        rack_count = 5 if detail else 3
        for index in range(rack_count):
            add_pipe_rack(builder, -half * 0.45 + index * half * 0.23, -edge, 18, 8 + index % 3 * 2, 3)
            builder.add_cylinder(-half * 0.43 + index * half * 0.22, 6, -edge - 7, 3.5, 12, "wall_alt", 10 if detail else 6, 3.0)
    elif dressing in {"market-stalls", "closed-shops"}:
        for index in range(-5 if detail else -3, 6 if detail else 4):
            x = index * 10
            builder.add_box(x, 2.2, -edge, 8.5, 4.4, 5.5, "wall_alt")
            builder.add_box(x, 4.55, -edge + 2.5, 9.2, 0.3, 2.0, "accent" if index % 2 else "emissive")
        if detail:
            # Lightweight overhead market kit: canopies and hanging signs add
            # first-person density without introducing new collision volumes.
            for row, z in enumerate((-half * 0.24, half * 0.18)):
                for index in range(-5, 6):
                    x = index * half * 0.085 + (row * 2 - 1) * 2.5
                    builder.add_box(x, 3.7 + (index % 3) * 0.14, z, half * 0.075, 0.22, half * 0.055, "accent" if (index + row) % 3 == 0 else "wall_alt")
                    if index % 2 == 0:
                        builder.add_box(x, 4.8, z - half * 0.029, half * 0.035, 1.2, 0.10, "emissive")
            for index in range(-4, 5):
                add_gabled_house(
                    builder,
                    index * half * 0.115,
                    -edge - 8 - abs(index % 3),
                    9.0,
                    7.0,
                    2,
                    "heritage" if dressing == "market-stalls" else "industrial",
                    lod,
                    dressing == "closed-shops" and index % 3 == 0,
                )
    elif dressing in {"roof-mechanical", "urban-debris", "collapsed-arena", "vehicle-barricades", "park-wreckage", "graveyard-rubble"}:
        for index in range(9 if detail else 5):
            x = -half * 0.54 + index * half * 0.14
            height = 3 + stable_unit(seed, index, 0x701) * 8
            builder.add_box(x, height / 2, -edge, 7 + index % 3 * 2, height, 6, "wall_alt" if index % 2 else "obstacle")
            if detail and index % 2:
                builder.add_beam((x - 3, height + 0.4, -edge), (x + 4, height + 4, -edge + 2), 0.22, 0.22, "trim")
        if dressing != "roof-mechanical":
            house_count = 6 if detail else 3
            for index in range(house_count):
                add_gabled_house(
                    builder,
                    (index - (house_count - 1) / 2) * half * 0.22,
                    -edge - 9 - index % 2 * 3,
                    10 + index % 2 * 3,
                    8,
                    1 + index % 2,
                    "industrial",
                    lod,
                    True,
                )
    elif dressing in {"rail-yard", "piers-and-cabins"}:
        for index in range(-3, 4):
            x = index * half * 0.17
            add_hangar(builder, x, -edge, 20, 12, 7, "wall_alt")
            builder.add_beam((x - 8, 0.22, -half * 0.44), (x + 8, 0.22, -half * 0.44), 0.09, 0.08, "trim")
        if dressing == "rail-yard":
            add_train_car(builder, -half * 0.24, -half * 0.35, 26, lod, False)
            add_train_car(builder, half * 0.22, -half * 0.29, 22, lod, True)
            add_gabled_house(builder, 0, -edge - 8, 18, 10, 1, "industrial", lod)
        else:
            cabin_count = 6 if detail else 3
            for index in range(cabin_count):
                add_gabled_house(
                    builder,
                    (index - (cabin_count - 1) / 2) * half * 0.25,
                    -edge - 6 - index % 2 * 2,
                    9.5,
                    7.5,
                    1,
                    "timber",
                    lod,
                )
            add_workboat(builder, -half * 0.28, -half - 28, 16, lod, False)


def add_landmark(builder, stage, lod):
    size = stage["size"]
    half = size / 2
    x, z, y = 0, -half - 10, 0
    landmark = IDENTITIES[stage["id"]][1]
    if landmark == "training-tower":
        x = -half * 0.58
        z = -half - 14
    detail = lod == 0
    medium = lod <= 1

    if landmark in {"grand-abbey", "ruined-abbey"}:
        # The playable abbey is centred in the TypeScript layout and receives
        # its exact Blender shell in add_abbey_visual; do not add a second
        # disconnected background castle here.
        return
    if landmark in {"range-radar", "polar-array"}:
        add_tower(builder, x, z, y, 24 if detail else 18, "wall_alt", "accent", 10)
        dish_y = 31 if detail else 24
        builder.add_cylinder(x, dish_y, z, 7 if detail else 5, 1.0, "accent", 14, 3.0)
        for i in range(0, 8 if detail else 4):
            angle = math.tau * i / (8 if detail else 4)
            builder.add_beam((x, dish_y, z), (x + math.cos(angle) * 7, dish_y + 2.4, z + math.sin(angle) * 7), 0.16, 0.16, "trim")
    elif landmark in {"container-crane", "harbor-crane", "quarry-conveyor", "wrecked-port"}:
        span = 34 if detail else 28
        height = 30 if detail else 23
        for sx in (-span / 2, span / 2):
            builder.add_beam((x + sx, y, z - 7), (x + sx, y + height, z - 2), 0.8, 0.8, "trim")
            builder.add_beam((x + sx, y, z + 7), (x + sx, y + height, z + 2), 0.8, 0.8, "trim")
        builder.add_beam((x - span / 2, y + height, z), (x + span / 2, y + height, z), 1.0, 1.0, "accent")
        builder.add_beam((x, y + height, z), (x + span * 0.65, y + height - 2, z), 0.6, 0.6, "trim")
    elif landmark in {"palace-dome", "ruined-cathedral"}:
        add_arch(builder, x, y, z, 24, 18, 8, "wall")
        builder.add_cylinder(x, 20, z, 9, 5, "accent", 16, 2.0)
        if detail:
            for sx in (-9, 9):
                add_tower(builder, x + sx, z, y, 20, "wall_alt", "accent", 8)
    elif landmark in {"desert-gate", "quarantine-gate", "subway-vault"}:
        add_arch(builder, x, y, z, 30, 20, 8, "wall_alt")
        if detail:
            for sx in (-11, -5.5, 0, 5.5, 11):
                builder.add_box(x + sx, 15, z - 4.1, 2.8, 3.5, 0.15, "emissive" if landmark == "quarantine-gate" else "accent")
    elif landmark in {"hill-fortress", "volcano-fortress", "burning-block"}:
        for level in range(3 if medium else 2):
            width = 38 - level * 9
            builder.add_box(x, 4 + level * 7, z, width, 7, 28 - level * 6, "wall_alt" if level % 2 else "wall")
        if detail:
            for sx in (-15, 15):
                add_tower(builder, x + sx, z, y, 25, "wall_alt", "emissive" if landmark != "hill-fortress" else "accent", 8)
    elif landmark in {"desert-rig", "refinery-stack", "lava-mine", "slaughter-stack"}:
        stacks = 4 if detail else 2
        for i in range(stacks):
            sx = x + (i - (stacks - 1) / 2) * 7
            h = 30 + i * 4
            builder.add_cylinder(sx, h / 2, z, 2.1, h, "trim", 10, 1.55)
            builder.add_cylinder(sx, h + 0.8, z, 2.6, 1.6, "emissive" if landmark != "desert-rig" else "accent", 10)
        builder.add_box(x, 4, z, 36, 8, 20, "wall_alt")
    elif landmark in {"neon-spire", "ruined-city"}:
        add_tower(builder, x, z, y, 50 if detail else 38, "wall_alt", "emissive", 12)
        if detail:
            for level in range(5):
                builder.add_box(x, 12 + level * 8, z - 3.0, 8 - level * 0.8, 1.0, 0.18, "emissive")
    elif landmark == "rooftop-helipad":
        builder.add_cylinder(x, 19, z, 19, 2.0, "wall", 20)
        builder.add_cylinder(x, 20.1, z, 13, 0.12, "accent", 20)
        builder.add_box(x, 9, z, 24, 18, 20, "wall_alt")
    elif landmark in {"bamboo-pagoda", "onsen-pagoda", "terrace-village"}:
        levels = 4 if detail else 3
        for level in range(levels):
            width = 26 - level * 4.5
            builder.add_box(x, 2.5 + level * 5, z, width * 0.72, 4.5, width * 0.62, "wall")
            builder.add_box(x, 5.0 + level * 5, z, width, 0.55, width * 0.82, "accent")
        builder.add_cylinder(x, levels * 5 + 4, z, 0.45, 8, "trim", 8, 0.1)
    elif landmark == "coastal-lighthouse":
        add_tower(builder, x, z, y, 38 if detail else 30, "wall", "emissive", 16)
        builder.add_cylinder(x, 42 if detail else 34, z, 6, 3.5, "glass", 16, 5.2)
    elif landmark == "rail-terminal":
        add_arch(builder, x, y, z, 34, 18, 12, "wall_alt")
        for track in (-6, 0, 6):
            builder.add_beam((x - 22, 0.3, z + track), (x + 22, 0.3, z + track), 0.12, 0.09, "trim")
    elif landmark == "canyon-bridge":
        for side in (-1, 1):
            builder.add_box(x + side * 14, 13, z, 5, 26, 8, "wall_alt")
        builder.add_beam((x - 18, 20, z), (x + 18, 20, z), 1.0, 1.0, "accent")
        builder.add_beam((x - 18, 12, z), (x + 18, 12, z), 1.4, 0.5, "wall")
    elif landmark == "lakeside-observatory":
        builder.add_cylinder(x, 9, z, 14, 4, "wall", 16, 12)
        builder.add_cylinder(x, 15, z, 11, 8, "accent", 16, 2)
    elif landmark == "airport-control":
        add_tower(builder, x, z, y, 44 if detail else 34, "wall_alt", "glass", 12)
        builder.add_cylinder(x, 47 if detail else 37, z, 8, 5, "glass", 12, 6)
    elif landmark == "broken-ferris-wheel":
        radius = 22 if detail else 16
        segments = 18 if detail else 10
        center_y = radius + 4
        for i in range(segments):
            a0 = math.tau * i / segments
            a1 = math.tau * (i + 1) / segments
            if detail and i in {3, 4, 11}:
                continue
            p0 = (x + math.cos(a0) * radius, center_y + math.sin(a0) * radius, z)
            p1 = (x + math.cos(a1) * radius, center_y + math.sin(a1) * radius, z)
            builder.add_beam(p0, p1, 0.5, 0.5, "trim")
            if i % 2 == 0:
                builder.add_beam((x, center_y, z), p0, 0.22, 0.22, "accent")
        builder.add_beam((x - 10, 0, z), (x, center_y, z), 0.8, 0.8, "wall_alt")
        builder.add_beam((x + 10, 0, z), (x, center_y, z), 0.8, 0.8, "wall_alt")
    elif landmark == "training-tower":
        height = 38 if detail else 29
        builder.add_box(x, height / 2, z, 9.5, height, 9.5, "wall_alt")
        builder.add_box(x, height - 6.2, z + 4.8, 7.4, 8.5, 0.22, "glass")
        builder.add_box(x, height + 0.65, z, 12.5, 1.3, 12.5, "accent")
        if detail:
            for level in range(1, 6):
                landing_y = level * 5.6
                builder.add_box(x - 5.6, landing_y, z + 5.2, 3.0, 0.32, 2.2, "trim")
                builder.add_beam(
                    (x - 6.8, landing_y - 4.2, z + 5.3),
                    (x - 4.4, landing_y, z + 5.3),
                    0.16,
                    0.16,
                    "trim",
                )
            builder.add_cylinder(x, height + 5.4, z, 0.22, 8.2, "trim", 8, 0.12)
    else:
        add_tower(builder, x, z, y, 32 if detail else 24, "wall_alt", "accent", 10)


def build_lod(stage, lod, collection, materials):
    bevel = 0.06 if lod == 0 else 0.025 if lod == 1 else 0.0
    builder = MeshBuilder(collection, f"HB_{stage['id']}_LOD{lod}", materials, bevel)
    builder.add_box(0, -0.09, 0, stage["size"] + 2, 0.18, stage["size"] + 2, "floor")
    add_routes(builder, stage, lod)
    add_route_set_dressing(builder, stage, lod)
    add_district_public_realm(builder, stage, lod)
    add_ground_character(builder, stage, lod)
    add_layout_shell(builder, stage, lod)
    add_architectural_skin(builder, stage, lod)
    add_playable_district_rooflines(builder, stage, lod)
    add_playable_district_facades(builder, stage, lod)
    add_authoritative_wall_facades(builder, stage, lod)
    add_blender_props(builder, stage, lod)
    add_abbey_visual(builder, stage, lod)
    add_boundary(builder, stage, lod)
    add_stage_dressing(builder, stage, lod)
    add_exterior_architecture(builder, stage, lod)
    add_skyline(builder, stage, lod)
    add_landmark(builder, stage, lod)
    objects = builder.flush()
    for obj in objects:
        obj["hibanaStage"] = stage["id"]
        obj["hibanaLod"] = lod
    return objects


def set_collection_visible(collection, visible):
    collection.hide_viewport = not visible
    collection.hide_render = not visible


def select_collection(collection):
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    def visit(current):
        for obj in current.objects:
            # The full floor is useful for deterministic Blender QA renders,
            # but Hibana already has a richer gameplay floor shader. Exporting
            # this shell would cover that shader and create a flat duplicate.
            if obj.type == "MESH" and obj.get("hibanaMaterial") != "floor":
                obj.hide_set(False)
                obj.select_set(True)
                selected.append(obj)
        for child in current.children:
            visit(child)
    visit(collection)
    if selected:
        bpy.context.view_layer.objects.active = selected[0]
    return selected


def export_lod(stage, lod, collection):
    set_collection_visible(collection, True)
    selected = select_collection(collection)
    filepath = OUTPUT_DIR + f"/{stage['id']}-lod{lod}.glb"
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    bpy.ops.object.select_all(action="DESELECT")
    return {"path": filepath, "objects": len(selected)}


def point_camera(camera, target):
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def configure_presentation(stage, qa_collection):
    scene = bpy.context.scene
    size = stage["size"]
    palette = stage["palette"]
    profile = PROFILES[stage["id"]]
    camera_data = bpy.data.cameras.new(f"HB_{stage['id']}_QA_CAMERA_DATA")
    camera = bpy.data.objects.new(f"HB_{stage['id']}_QA_CAMERA", camera_data)
    qa_collection.objects.link(camera)
    is_abbey = IDENTITIES[stage["id"]][1] in {"grand-abbey", "ruined-abbey"}
    camera_data.lens = 44 if is_abbey else 38
    camera_data.sensor_width = 36
    camera_angle = math.radians(profile["cameraAzimuth"])
    camera_radius = size * min(profile["cameraRadius"], 0.64 if is_abbey else 0.50)
    camera.location = runtime_point(
        math.cos(camera_angle) * camera_radius,
        size * min(profile["cameraHeight"], 0.30 if is_abbey else 0.20),
        math.sin(camera_angle) * camera_radius,
    )
    # All hero landmarks sit beyond the north route.  Aim partway toward that
    # district so the QA render proves the stage identity instead of framing
    # only the center-floor collision shell.
    point_camera(
        camera,
        runtime_point(0, profile["targetHeight"], -size * (0.04 if is_abbey else 0.27)),
    )
    scene.camera = camera

    sun_data = bpy.data.lights.new(f"HB_{stage['id']}_SUN_DATA", "SUN")
    sun_data.energy = max(1.8, stage["palette"].get("lightIntensity", 2.4))
    sun_data.angle = math.radians(8)
    sun = bpy.data.objects.new(f"HB_{stage['id']}_SUN", sun_data)
    qa_collection.objects.link(sun)
    sun_azimuth = math.radians(profile["sunAzimuth"])
    sun_elevation = math.radians(profile["sunElevation"])
    sun.location = runtime_point(
        math.cos(sun_azimuth) * math.cos(sun_elevation) * size,
        math.sin(sun_elevation) * size,
        math.sin(sun_azimuth) * math.cos(sun_elevation) * size,
    )
    point_camera(sun, runtime_point(0, 0, 0))

    fill_data = bpy.data.lights.new(f"HB_{stage['id']}_FILL_DATA", "AREA")
    mood = palette.get("mood")
    fill_data.energy = 2200 if mood == "night" else 1550 if mood == "dusk" else 1050 if stage["id"].startswith("z") else 780
    fill_data.shape = "DISK"
    fill_data.size = size * 0.6
    fill_data.color = hex_rgb(palette["lightColor"])
    fill = bpy.data.objects.new(f"HB_{stage['id']}_FILL", fill_data)
    qa_collection.objects.link(fill)
    fill.location = runtime_point(-size * 0.25, size * 0.3, -size * 0.1)
    point_camera(fill, runtime_point(0, 4, 0))

    if mood in {"night", "dusk"}:
        accent_color = hex_rgb(palette["accent"])
        for index, (x, z) in enumerate(((-0.28, -0.30), (0.24, -0.22), (0.04, 0.18))):
            accent_data = bpy.data.lights.new(f"HB_{stage['id']}_ACCENT_{index}_DATA", "AREA")
            accent_data.energy = 1250 if mood == "night" else 760
            accent_data.shape = "DISK"
            accent_data.size = size * 0.12
            accent_data.color = accent_color
            accent_light = bpy.data.objects.new(f"HB_{stage['id']}_ACCENT_{index}", accent_data)
            qa_collection.objects.link(accent_light)
            accent_light.location = runtime_point(size * x, size * 0.12, size * z)
            point_camera(accent_light, runtime_point(0, 3, -size * 0.12))

    world = scene.world or bpy.data.worlds.new(f"HB_{stage['id']}_WORLD")
    scene.world = world
    world.use_nodes = True
    world.color = hex_rgb(palette["sky"])
    background = next(
        (node for node in world.node_tree.nodes if node.bl_idname == "ShaderNodeBackground"),
        None,
    )
    if background:
        background.inputs[0].default_value = (*hex_rgb(palette["sky"]), 1.0)
        mood_strength = {
            "day": 0.30,
            "overcast": 0.38,
            "dusk": 0.23,
            "night": 0.28,
            "snow": 0.42,
        }.get(palette.get("mood"), 0.26)
        background.inputs[1].default_value = mood_strength
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.filepath = RENDER_DIR + f"/{stage['id']}.png"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 1.48 if mood == "night" else 0.42 if mood == "dusk" else 0.12 if mood == "overcast" else 0.0
    return camera


def focus_visible_viewport():
    for window in bpy.context.window_manager.windows:
        screen = window.screen
        for area in screen.areas:
            if area.type != "VIEW_3D":
                continue
            area.spaces.active.shading.type = "MATERIAL"
            region = next((item for item in area.regions if item.type == "WINDOW"), None)
            if region:
                with bpy.context.temp_override(window=window, screen=screen, area=area, region=region):
                    try:
                        bpy.ops.view3d.view_camera()
                    except RuntimeError:
                        pass


def write_progress(payload):
    with open(PROGRESS_PATH, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def stage_metrics(stage, lod_collections):
    metrics = {"stage": stage["id"], "lods": {}}
    for lod, collection in enumerate(lod_collections):
        vertices = 0
        polygons = 0
        objects = 0
        for obj in collection.objects:
            if obj.type != "MESH":
                continue
            objects += 1
            vertices += len(obj.data.vertices)
            polygons += len(obj.data.polygons)
        metrics["lods"][str(lod)] = {"objects": objects, "vertices": vertices, "polygons": polygons}
    return metrics


def build_stage(stage, index, total):
    clear_generated()
    root = new_collection(f"HB_{stage['id']}_ROOT")
    guides = new_collection(f"HB_{stage['id']}_00_GUIDES", root)
    lod0 = new_collection(f"HB_{stage['id']}_90_EXPORT_LOD0", root)
    lod1 = new_collection(f"HB_{stage['id']}_90_EXPORT_LOD1", root)
    lod2 = new_collection(f"HB_{stage['id']}_90_EXPORT_LOD2", root)
    qa = new_collection(f"HB_{stage['id']}_QA", guides)
    materials = build_materials(stage)
    build_lod(stage, 0, lod0, materials)
    build_lod(stage, 1, lod1, materials)
    build_lod(stage, 2, lod2, materials)
    configure_presentation(stage, qa)

    exports = []
    for lod, collection in enumerate((lod0, lod1, lod2)):
        exports.append(export_lod(stage, lod, collection))
        set_collection_visible(collection, lod == 0)
    focus_visible_viewport()
    bpy.context.scene.render.filepath = RENDER_DIR + f"/{stage['id']}.png"
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=WORK_DIR + f"/{stage['id']}.blend", copy=True)
    metrics = stage_metrics(stage, (lod0, lod1, lod2))
    metrics["exports"] = exports
    write_progress({
        "status": "building",
        "current": index + 1,
        "total": total,
        "stage": stage["id"],
        "name": stage["name"],
        "metrics": metrics,
    })
    return metrics


def write_manifest(stages):
    assets = []
    for stage in stages:
        assets.append({
            "id": "stage-" + stage["id"],
            "url": f"stages/{stage['id']}-lod0.glb",
            "stages": [stage["id"]],
            "instances": [{"position": [0, 0, 0]}],
            "minTier": "medium",
            "castShadow": False,
            "receiveShadow": True,
            # Every stage now owns a layered 360-degree Blender boundary,
            # midground district and skyline.  The old thumbnail cylinder is
            # intentionally removed only after this GLB reports load success.
            "replacesDistantMatte": True,
            # Exact PropPlacement coordinates are represented by the merged
            # Blender 40_PROPS batches.  Runtime keeps the collider/fallback
            # geometry until this asset has loaded and compiled successfully.
            "replacesProceduralProps": True,
            "lods": [
                {"url": f"stages/{stage['id']}-lod1.glb", "distance": 260},
                {"url": f"stages/{stage['id']}-lod2.glb", "distance": 460},
            ],
        })
    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump({"version": 1, "assets": assets}, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


with open(LAYOUT_PATH, "r", encoding="utf-8") as handle:
    ALL_STAGES = json.load(handle)["stages"]

STAGES = list(ALL_STAGES)

with open(PROFILE_PATH, "r", encoding="utf-8") as handle:
    PROFILES = json.load(handle)["profiles"]

stage_ids = {stage["id"] for stage in ALL_STAGES}
profile_ids = set(PROFILES)
if stage_ids != profile_ids:
    missing = sorted(stage_ids - profile_ids)
    extra = sorted(profile_ids - stage_ids)
    raise RuntimeError(f"stage profile mismatch: missing={missing}, extra={extra}")

EXEC_ARGS = globals().get("args", {})
requested_stage_ids = EXEC_ARGS.get("stage_ids") if isinstance(EXEC_ARGS, dict) else None
if requested_stage_ids:
    requested_stage_ids = set(requested_stage_ids)
    STAGES = [stage for stage in STAGES if stage["id"] in requested_stage_ids]

previous_timer = bpy.app.driver_namespace.get("hibana_stage_build_timer")
if previous_timer and bpy.app.timers.is_registered(previous_timer):
    bpy.app.timers.unregister(previous_timer)

STATE = {"index": 0, "metrics": []}


def build_timer():
    index = STATE["index"]
    if index >= len(STAGES):
        # A filtered Blender QA build must never truncate the production
        # manifest.  Paths are deterministic for all 31 stage IDs.
        write_manifest(ALL_STAGES)
        write_progress({
            "status": "complete",
            "current": len(STAGES),
            "total": len(STAGES),
            "stage": STAGES[-1]["id"],
            "metrics": STATE["metrics"],
        })
        bpy.context.scene["hibanaBuildStatus"] = "complete"
        bpy.context.scene["hibanaBuildCount"] = len(STAGES)
        return None
    stage = STAGES[index]
    try:
        bpy.context.scene["hibanaBuildStatus"] = f"{index + 1}/{len(STAGES)} {stage['id']}"
        metrics = build_stage(stage, index, len(STAGES))
        STATE["metrics"].append(metrics)
        STATE["index"] += 1
        return 0.65
    except Exception as exc:
        write_progress({
            "status": "error",
            "current": index + 1,
            "total": len(STAGES),
            "stage": stage["id"],
            "error": repr(exc),
        })
        bpy.context.scene["hibanaBuildStatus"] = "error: " + repr(exc)
        return None


bpy.app.driver_namespace["hibana_stage_build_timer"] = build_timer
bpy.app.driver_namespace["hibana_stage_build_state"] = STATE
write_progress({"status": "queued", "current": 0, "total": len(STAGES)})
bpy.app.timers.register(build_timer, first_interval=0.2, persistent=False)
__result__ = {"queued": len(STAGES), "progress": PROGRESS_PATH}
