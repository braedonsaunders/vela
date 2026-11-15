"""Verify a complete previous release, then reuse only its shipped runtime bytes."""
import hashlib
import json
import pathlib
import re
import sys
import tarfile

archive = pathlib.Path(sys.argv[1]).resolve()
dist = pathlib.Path(sys.argv[2])
if not archive.name.endswith('.tar.gz'):
    raise ValueError('Expected a release .tar.gz archive')
manifest_path = archive.with_name(archive.name[:-7] + '.manifest.json')
manifest_bytes = manifest_path.read_bytes()
manifest_hash = hashlib.sha256(manifest_bytes).hexdigest()
if manifest_path.with_name(manifest_path.name + '.sha256').read_text().split()[0] != manifest_hash:
    raise ValueError('Previous release manifest checksum mismatch')
release = json.loads(manifest_bytes)

def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def safe_path(name):
    if not isinstance(name, str) or not name or '\\' in name or '\0' in name or name.startswith('/') or '..' in name.split('/') or str(pathlib.PurePosixPath(name)) != name:
        raise ValueError('Unsafe release path')
    return name

if release['schemaVersion'] != 1 or release['sourceDirty'] or release['archive']['file'] != archive.name:
    raise ValueError('Expected a clean versioned release')
if archive.stat().st_size != release['archive']['bytes'] or hash_file(archive) != release['archive']['sha256']:
    raise ValueError('Previous release archive checksum mismatch')
expected = {}
for record in release['files']:
    name = safe_path(record['path'])
    if name in expected or type(record['bytes']) is not int or record['bytes'] < 0 or not re.fullmatch('[a-f0-9]{64}', record['sha256']):
        raise ValueError('Invalid release inventory')
    expected[name] = record
assets = release['universalAssets']
key = assets['assetKey']
if not re.fullmatch('[a-f0-9]{16}', key) or assets['baseURL'] != '/vela/universal/' + key + '/' or assets['upstreamRevision'] != 'a7a95ef26bd0a71f5ee12f863b8ffb2cfbc3c9d2':
    raise ValueError('Invalid universal identity')
prefix = 'universal/' + key + '/'
seen = set()
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar:
        name = member.name.removeprefix('./')
        if member.isdir():
            if name not in ('', '.'):
                safe_path(name.rstrip('/'))
            continue
        safe_path(name)
        if not member.isfile() or name not in expected or name in seen:
            raise ValueError('Unlisted, duplicate or non-file archive entry: ' + name)
        seen.add(name)
        record = expected[name]
        h = hashlib.sha256()
        size = 0
        stream = tar.extractfile(member)
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
            size += len(chunk)
        if size != record['bytes'] or h.hexdigest() != record['sha256']:
            raise ValueError('Release file checksum mismatch: ' + name)
if seen != set(expected):
    raise ValueError('Incomplete previous release')
# All release files verified. Copy only shipped universal files, never a diagnostic host.
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar:
        name = member.name.removeprefix('./')
        if not member.isfile() or not name.startswith(prefix):
            continue
        data = tar.extractfile(member).read()
        if hashlib.sha256(data).hexdigest() != expected[name]['sha256']:
            raise ValueError('Release changed during copy')
        target = dist / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
root = dist / prefix
payload_bytes = (root / 'PAYLOAD-MANIFEST.json').read_bytes()
if hashlib.sha256(payload_bytes).hexdigest() != assets['payloadManifestSha256']:
    raise ValueError('Universal manifest checksum mismatch')
payload = json.loads(payload_bytes)
if payload['assetKey'] != key or payload['schemaVersion'] != 1:
    raise ValueError('Universal manifest identity mismatch')
shipped = {p[len(prefix):] for p in expected if p.startswith(prefix)}
payload_files = {}
for record in payload['files']:
    name = safe_path(record['path'])
    if name == 'index.js':
        continue  # Not shipped, not used, and not reconstructed.
    if not name.startswith('universal/') or name in payload_files:
        raise ValueError('Invalid universal inventory')
    payload_files[name] = record
    b = (root / name[len('universal/'):]).read_bytes()
    if len(b) != record['bytes'] or hashlib.sha256(b).hexdigest() != record['sha256']:
        raise ValueError('Universal payload checksum mismatch')
if shipped != {p[len('universal/'):] for p in payload_files} | {'PAYLOAD-MANIFEST.json'}:
    raise ValueError('Unexpected universal files')
identity = json.loads((root / 'assets.json').read_bytes())
if identity['version'] != 1 or identity['assetKey'] != key or identity['upstreamRevision'] != assets['upstreamRevision'] or identity['libraries'] != './libraries/' or identity['sources'] != './sources/':
    raise ValueError('Universal runtime identity mismatch')
h = hashlib.sha256()
for p in sorted((root / 'libraries').rglob('*')):
    if p.is_file():
        h.update(('/libraries/' + p.relative_to(root / 'libraries').as_posix()).encode())
        h.update(p.read_bytes())
h.update((root / 'runtime.js').read_bytes())
if h.hexdigest()[:16] != key:
    raise ValueError('Universal runtime key mismatch')
print(json.dumps(assets))
