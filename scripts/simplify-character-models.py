"""Blender batch helper: find the least decimation needed for a GLB byte budget.

Run Blender --background --factory-startup --python this_file -- --model NAME.fbx
--work-dir .artifacts/demo-game/blender-simplification
Full-resolution GLBs are backed up outside public/models before replacing outputs.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import time

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def sha256(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def image_bytes(path):
    with path.open('rb') as stream:
        header = stream.read(20)
        document = json.loads(stream.read(struct.unpack_from('<I', header, 12)[0]))
    return sum(document['bufferViews'][image['bufferView']]['byteLength']
               for image in document.get('images', []) if 'bufferView' in image)


def triangles(objects):
    count = 0
    for obj in objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            count += len(obj.data.loop_triangles)
    return count


def world_bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == 'MESH'
              for corner in obj.bound_box]
    values = np.asarray(points)
    return {'min': values.min(axis=0).tolist(), 'max': values.max(axis=0).tolist()}


def texture_signatures():
    images = []
    for image in bpy.data.images:
        if image.type != 'IMAGE' or image.users == 0:
            continue
        pixels = np.empty(len(image.pixels), dtype=np.float32)
        image.pixels.foreach_get(pixels)
        pixels = pixels.reshape(-1, image.channels)
        images.append({'name': image.name, 'size': list(image.size),
                       'channel_sha256': [hashlib.sha256(np.ascontiguousarray(pixels[:, n]).tobytes()).hexdigest()
                                          for n in range(image.channels)]})
    return images


def sample_surface_error(source, target, sample_count=10000):
    # These character assets each contain one static mesh. Measure both directions.
    source_meshes = [obj for obj in source if obj.type == 'MESH']
    target_meshes = [obj for obj in target if obj.type == 'MESH']
    if len(source_meshes) != 1 or len(target_meshes) != 1:
        return {'note': 'Surface error sampling requires a single mesh.'}
    depsgraph = bpy.context.evaluated_depsgraph_get()
    result = {}
    for label, first, second in [('original_to_simplified', source_meshes[0], target_meshes[0]),
                                  ('simplified_to_original', target_meshes[0], source_meshes[0])]:
        tree = BVHTree.FromObject(second, depsgraph)
        target_inverse = second.matrix_world.inverted()
        indices = np.linspace(0, len(first.data.vertices) - 1,
                              min(sample_count, len(first.data.vertices)), dtype=np.int64)
        errors = []
        for index in indices:
            point = first.matrix_world @ first.data.vertices[int(index)].co
            nearest, _, _, _ = tree.find_nearest(target_inverse @ point)
            if nearest is None:
                raise RuntimeError('A sampled surface point could not be located.')
            errors.append((second.matrix_world @ nearest - point).length)
        result[label] = {'samples': len(errors), 'max_blender_units': max(errors),
                         'mean_blender_units': sum(errors) / len(errors),
                         'p99_blender_units': float(np.quantile(errors, 0.99))}
        del tree
        gc.collect()
    return result


def run(args):
    root = args.models_dir.resolve()
    source = (root / args.model).resolve()
    if source.parent != root or source.suffix.lower() != '.fbx':
        raise RuntimeError('Expected a direct FBX filename inside the models directory.')
    output = source.with_suffix('.glb')
    work = args.work_dir.resolve()
    backups = work / 'originals'
    backups.mkdir(parents=True, exist_ok=True)
    scratch = work / 'temporary'
    scratch.mkdir(exist_ok=True)
    tempfile.tempdir = str(scratch)
    backup = backups / output.name
    if backup.exists():
        raise RuntimeError(f'Backup already exists; refusing an ambiguous restart: {backup}')
    source_hash = sha256(source)
    original_hash = sha256(output)
    shutil.copy2(output, backup)
    if sha256(backup) != original_hash:
        raise RuntimeError('Full-resolution backup verification failed.')
    hard_limit = int(args.limit_mib * 1024 * 1024)
    target = hard_limit - 1024
    original_size = backup.stat().st_size
    started = time.monotonic()
    report = {'blender': bpy.app.version_string, 'source': source.name, 'output': output.name,
              'original_fbx_sha256': source_hash, 'full_glb_sha256': original_hash,
              'backup': str(backup), 'full_glb_bytes': original_size,
              'hard_limit_bytes': hard_limit, 'target_bytes': target, 'trials': []}
    if original_size <= target:
        report.update({'status': 'already_under_limit', 'output_bytes': original_size,
                       'ratio': 1.0, 'original_fbx_unchanged': sha256(source) == source_hash})
        (work / (source.stem + '-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
        print('SIMPLIFICATION_RESULT ' + json.dumps(report), flush=True)
        return

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(source), use_custom_normals=True, use_anim=True,
                             use_image_search=False)
    original_objects = list(bpy.context.scene.objects)
    if any(obj.type == 'ARMATURE' for obj in original_objects) or len(bpy.data.actions):
        raise RuntimeError('This helper expects static character models.')
    original_triangles = triangles(original_objects)
    report['original_triangles'] = original_triangles
    report['original_bounds'] = world_bounds(original_objects)
    report['original_textures'] = texture_signatures()
    fixed = image_bytes(backup)
    report['original_embedded_image_bytes'] = fixed
    ratio = max(0.05, min(0.99, (target - fixed) / (original_size - fixed)))
    observations = [(1.0, original_size)]
    best = None
    best_path = work / (source.stem + '-best.glb')
    trial_path = work / (source.stem + '-trial.glb')
    for trial_index in range(args.max_trials):
        print('SIMPLIFICATION_TRIAL_BEGIN ' + json.dumps({'model': source.stem, 'trial': trial_index + 1,
                                                         'ratio': ratio}), flush=True)
        bpy.ops.object.select_all(action='DESELECT')
        copies = []
        for original in original_objects:
            clone = original.copy()
            if original.type == 'MESH':
                clone.data = original.data.copy()
            bpy.context.scene.collection.objects.link(clone)
            clone.select_set(True)
            copies.append(clone)
            bpy.context.view_layer.objects.active = clone
            if clone.type == 'MESH':
                decimate = clone.modifiers.new('Size budget decimation', 'DECIMATE')
                decimate.decimate_type = 'COLLAPSE'
                decimate.ratio = ratio
                decimate.use_collapse_triangulate = True
                bpy.ops.object.modifier_apply(modifier=decimate.name)
        bpy.ops.export_scene.gltf(
            filepath=str(trial_path), export_format='GLB', check_existing=False, use_selection=True,
            export_draco_mesh_compression_enable=False, export_meshopt_compression_enable=False,
            export_use_gltfpack=False, export_apply=False, export_image_format='AUTO',
            export_image_quality=100, export_texcoords=True, export_normals=True,
            export_tangents=True, export_materials='EXPORT', export_animations=False)
        size = trial_path.stat().st_size
        trial = {'trial': trial_index + 1, 'ratio': ratio, 'bytes': size,
                 'triangles': triangles(copies), 'under_limit': size <= target}
        report['trials'].append(trial)
        observations.append((ratio, size))
        print('SIMPLIFICATION_TRIAL_RESULT ' + json.dumps({'model': source.stem, **trial}), flush=True)
        if size <= target and (best is None or size > best['bytes']):
            shutil.copyfile(trial_path, best_path)
            best = trial
        for obj in copies:
            mesh = obj.data if obj.type == 'MESH' else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        gc.collect()
        if best and target - best['bytes'] < args.tolerance_bytes:
            break
        under = sorted((point for point in observations if point[1] <= target), reverse=True)
        over = sorted(point for point in observations if point[1] > target)
        if under:
            lower = under[0]
            upper = next((point for point in over if point[0] > lower[0]), None)
            if upper is None:
                break
            fraction = (target - lower[1]) / (upper[1] - lower[1])
            fraction = max(0.005, min(0.995, fraction))
            proposal = lower[0] + (upper[0] - lower[0]) * fraction
        else:
            last = min(over)
            proposal = last[0] * max(0.1, min(0.995, (target - fixed) / max(1, last[1] - fixed)))
        if abs(proposal - ratio) < 1e-8:
            break
        ratio = proposal
    if best is None:
        raise RuntimeError('No candidate below the byte limit was found; output was not changed.')

    existing_objects = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(best_path))
    result_objects = [obj for obj in bpy.context.scene.objects if obj not in existing_objects]
    actual_triangles = triangles(result_objects)
    if actual_triangles != best['triangles']:
        raise RuntimeError('Reimported GLB triangle count did not match the selected candidate.')
    report['surface_error'] = sample_surface_error(original_objects, result_objects)
    # Original materials remain in the scene; inspect only images used by imported materials.
    imported_images = set()
    for obj in result_objects:
        if obj.type != 'MESH':
            continue
        for material in obj.data.materials:
            if material and material.use_nodes:
                for node in material.node_tree.nodes:
                    if node.type == 'TEX_IMAGE' and node.image:
                        imported_images.add(node.image)
    all_signatures = texture_signatures()
    result_signatures = [image for image in all_signatures if image['name'] in {item.name for item in imported_images}]
    result_channels = {(tuple(image['size']), digest) for image in result_signatures for digest in image['channel_sha256']}
    retained = all((tuple(image['size']), digest) in result_channels
                   for image in report['original_textures'] for digest in image['channel_sha256'])
    if not retained:
        raise RuntimeError('Texture pixel preservation check failed; output was not changed.')
    if sha256(source) != source_hash or sha256(output) != original_hash:
        raise RuntimeError('An original changed during conversion; output was not replaced.')
    if best_path.stat().st_size >= hard_limit:
        raise RuntimeError('Selected candidate exceeds the hard limit.')
    shutil.copyfile(best_path, output)
    report.update({'status': 'simplified', 'ratio': best['ratio'], 'output_bytes': output.stat().st_size,
                   'output_triangles': actual_triangles, 'output_sha256': sha256(output),
                   'output_bounds': world_bounds(result_objects), 'original_fbx_unchanged': sha256(source) == source_hash,
                   'texture_channels_preserved_at_original_resolution': retained,
                   'seconds': round(time.monotonic() - started, 2)})
    (work / (source.stem + '-report.json')).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print('SIMPLIFICATION_RESULT ' + json.dumps({key: report[key] for key in [
        'output', 'status', 'ratio', 'output_bytes', 'original_triangles', 'output_triangles',
        'texture_channels_preserved_at_original_resolution', 'surface_error', 'seconds']}), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', required=True)
    parser.add_argument('--models-dir', type=Path, default=Path('public/models'))
    parser.add_argument('--work-dir', type=Path, required=True)
    parser.add_argument('--limit-mib', type=float, default=100)
    parser.add_argument('--max-trials', type=int, default=12)
    parser.add_argument('--tolerance-bytes', type=int, default=32768)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    run(args)


if __name__ == '__main__':
    main()
