"""Run with Blender --background --factory-startup --python this_file -- --model NAME.fbx.

Creates separate, uncompressed GLBs without simplifying meshes or resizing images.
Reimports each GLB and records geometry/image checks before publishing the new file.
Original FBXs and existing GLBs are never overwritten.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import time

import bpy
import numpy as np


def file_sha256(filename):
    with filename.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def snapshot():
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == 'MESH']
    positions = []
    triangles = 0
    vertices = 0
    uv_meshes = 0
    shape_keys = 0
    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles += len(mesh.loop_triangles)
        vertices += len(mesh.vertices)
        uv_meshes += bool(mesh.uv_layers)
        shape_keys += max(0, len(mesh.shape_keys.key_blocks) - 1) if mesh.shape_keys else 0
        xyz = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get('co', xyz)
        world = np.asarray(obj.matrix_world, dtype=np.float64)
        positions.append(xyz.reshape(-1, 3).astype(np.float64) @ world[:3, :3].T + world[:3, 3])
    points = np.concatenate(positions) if positions else np.zeros((0, 3))
    # glTF may split vertices at UV/normal seams. Compare unique positions instead.
    unique = np.unique(np.rint(points / 0.00001).astype(np.int64), axis=0)
    return {
        'mesh_objects': len(meshes), 'vertices': vertices, 'triangles': triangles,
        'unique_positions_at_1e-5': len(unique),
        'position_signature_at_1e-5': hashlib.sha256(unique.tobytes()).hexdigest(),
        'bounds_min': points.min(axis=0).tolist() if len(points) else [],
        'bounds_max': points.max(axis=0).tolist() if len(points) else [],
        'meshes_with_uvs': uv_meshes, 'shape_keys': shape_keys,
        'bones': sum(len(obj.data.bones) for obj in bpy.context.scene.objects if obj.type == 'ARMATURE'),
        'actions': len(bpy.data.actions),
        'images': sorted([{'size': list(image.size), 'channels': image.channels}
                          for image in bpy.data.images if image.type == 'IMAGE' and image.users > 0],
                         key=lambda image: (image['size'], image['channels'])),
    }


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    gc.collect()


def convert(source, destination, work_dir):
    if destination.exists():
        raise RuntimeError(f'Refusing to overwrite existing file: {destination}')
    started = time.monotonic()
    source_hash = file_sha256(source)
    clear_scene()
    bpy.ops.import_scene.fbx(filepath=str(source), use_custom_normals=True, use_anim=True,
                             use_image_search=False)
    before = snapshot()
    if not before['triangles']:
        raise RuntimeError('The FBX contains no mesh triangles.')
    print('CONVERSION_SOURCE ' + json.dumps({'file': source.name, 'details': before}), flush=True)
    temporary = work_dir / (source.stem + '.glb')
    if temporary.exists():
        raise RuntimeError(f'Refusing to overwrite previous conversion: {temporary}')
    options = {
        'filepath': str(temporary), 'export_format': 'GLB', 'check_existing': False,
        'export_draco_mesh_compression_enable': False,
        'export_meshopt_compression_enable': False, 'export_use_gltfpack': False,
        'export_image_format': 'AUTO', 'export_image_quality': 100,
        'export_keep_originals': False,
        'export_texcoords': True, 'export_normals': True, 'export_tangents': True,
        'export_materials': 'EXPORT', 'export_apply': False,
        'export_animations': True, 'export_force_sampling': False,
        'export_optimize_animation_size': False, 'export_frame_range': False,
        'export_skins': True, 'export_all_influences': True,
        'export_morph': True, 'export_morph_normal': True, 'export_morph_tangent': True,
    }
    supported = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    unknown = set(options) - set(supported)
    if unknown:
        raise RuntimeError(f'Unsupported Blender exporter options: {unknown}')
    bpy.ops.export_scene.gltf(**options)
    clear_scene()
    bpy.ops.import_scene.gltf(filepath=str(temporary))
    after = snapshot()
    bounds_match = bool(np.allclose(before['bounds_min'], after['bounds_min'], atol=0.00001, rtol=0)
                        and np.allclose(before['bounds_max'], after['bounds_max'], atol=0.00001, rtol=0))
    checks = {
        'triangle_count_matches': before['triangles'] == after['triangles'],
        'world_bounds_match_within_1e-5': bounds_match,
        'uv_mesh_count_matches': before['meshes_with_uvs'] == after['meshes_with_uvs'],
        'shape_key_count_matches': before['shape_keys'] == after['shape_keys'],
        # glTF packs material channels into fewer images; compare resolutions, not counts.
        'source_texture_resolutions_present': {tuple(image['size']) for image in before['images']}
            <= {tuple(image['size']) for image in after['images']},
        'original_fbx_unchanged': source_hash == file_sha256(source),
    }
    if not checks['triangle_count_matches'] or not checks['world_bounds_match_within_1e-5']:
        raise RuntimeError('Geometry verification failed: ' + json.dumps(checks))
    if destination.exists():
        raise RuntimeError(f'Destination appeared during conversion: {destination}')
    temporary.rename(destination)
    result = {
        'source': source.name, 'output': destination.name, 'source_sha256': source_hash,
        'source_bytes': source.stat().st_size, 'output_bytes': destination.stat().st_size,
        'under_100_MiB': destination.stat().st_size < 100 * 1024 * 1024,
        'seconds': round(time.monotonic() - started, 2),
        'checks': checks, 'before': before, 'after': after, 'export_options': options,
    }
    print('CONVERSION_RESULT ' + json.dumps(result), flush=True)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--models-dir', type=Path, default=Path('public/models'))
    parser.add_argument('--work-dir', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    directory = args.models_dir.resolve()
    source = (directory / args.model).resolve()
    if source.parent != directory or source.suffix.lower() != '.fbx':
        raise RuntimeError('Expected an FBX filename directly inside the models directory.')
    args.work_dir.mkdir(parents=True, exist_ok=True)
    scratch = args.work_dir.resolve() / 'temporary'
    scratch.mkdir(exist_ok=True)
    tempfile.tempdir = str(scratch)
    result = convert(source, source.with_suffix('.glb'), args.work_dir.resolve())
    (args.work_dir / (source.stem + '-report.json')).write_text(
        json.dumps({'blender': bpy.app.version_string, **result}, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
