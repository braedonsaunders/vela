"""Verify the complete Expo archive and player digest before signing. Never extracts files."""
import hashlib
import json
import pathlib
import re
import sys
import tarfile

archive = pathlib.Path(sys.argv[1]).resolve()
manifest_path = archive.with_name(archive.name.removesuffix('.tar.gz') + '.manifest.json')
release = json.loads(manifest_path.read_bytes())


def safe_path(name):
    if (not isinstance(name, str) or not name or name.startswith('/') or '\\' in name
            or any(ord(c) < 32 or ord(c) == 127 for c in name)
            or any(p in ('', '.', '..') for p in name.split('/'))):
        raise ValueError('Unsafe release path: ' + repr(name))
    return name


def file_records(records):
    result = {}
    for record in records:
        name = safe_path(record['path'])
        if (name in result or type(record['bytes']) is not int
                or not 0 <= record['bytes'] <= 9007199254740991
                or not re.fullmatch('[a-f0-9]{64}', record['sha256'])):
            raise ValueError('Invalid file record: ' + name)
        result[name] = record
    return result


def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


if (release['schemaVersion'] != 1 or release['sourceDirty'] is not False
        or release['basePath'] != '/vela/' or release['apiOrigin'] != 'same-origin'
        or not re.fullmatch('[a-f0-9]{40}', release['sourceRevision'])
        or not re.fullmatch(r'\d+\.\d+\.\d+', release['version'])
        or release['archive']['file'] != archive.name
        or any(key in release for key in ('engines', 'exactRevision', 'universalAssets'))):
    raise ValueError('Expected a clean single-app Expo release')
if (archive.stat().st_size != release['archive']['bytes']
        or archive.stat().st_size > 2 * 1024 ** 3
        or hash_file(archive) != release['archive']['sha256']):
    raise ValueError('Release archive size/hash mismatch')
renderer = release['skinRenderer']
if (renderer['schema'] != 1 or type(renderer['version']) is not int or renderer['version'] < 1
        or not re.fullmatch('[a-f0-9]{64}', renderer['digest'])):
    raise ValueError('Invalid skin renderer identity')
expected = file_records(release['files'])
if sum(record['bytes'] for record in expected.values()) > 8 * 1024 ** 3:
    raise ValueError('Release exceeds expanded size limit')
digest = release['playerAssetsDigest']
if not re.fullmatch('[a-f0-9]{64}', digest):
    raise ValueError('Invalid player digest')
prefix = 'player/' + digest + '/'
assets = release['playerAssets']
if assets['digest'] != digest or assets['baseURL'] != '/vela/' + prefix:
    raise ValueError('Player served base mismatch')
payload_name = 'PLAYER-ASSETS-MANIFEST.json'
required = {'index.html', 'routes.json', 'manifest.webmanifest', 'pwa.js', 'sw.js',
            'offline.html', 'skins/catalog.json', payload_name}
if not required <= expected.keys():
    raise ValueError('Release lacks required app resources')
if any(name.split('/')[0] in ('engines', 'engines.json', 'universal', 'app', 'runtime.js')
       or name.startswith('player/') and not name.startswith(prefix) for name in expected):
    raise ValueError('Obsolete or extra runtime root')
seen = set()
seen_files = set()
payload_bytes = None
with tarfile.open(archive, 'r:gz') as tar:
    for member in tar:
        name = member.name.removeprefix('./')
        if name in ('', '.') and member.isdir():
            continue
        name = safe_path(name.rstrip('/') if member.isdir() else name)
        if name in seen:
            raise ValueError('Duplicate archive entry: ' + name)
        seen.add(name)
        if member.isdir():
            if not any(path.startswith(name + '/') for path in expected):
                raise ValueError('Unlisted archive directory: ' + name)
            continue
        if not member.isfile() or name not in expected or member.size != expected[name]['bytes']:
            raise ValueError('Unlisted, special or wrong-sized entry: ' + name)
        seen_files.add(name)
        h = hashlib.sha256()
        chunks = [] if name == payload_name else None
        if chunks is not None and member.size > 16 * 1024 ** 2:
            raise ValueError('Player manifest exceeds size limit')
        with tar.extractfile(member) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(chunk)
                if chunks is not None:
                    chunks.append(chunk)
        if h.hexdigest() != expected[name]['sha256']:
            raise ValueError('Archive checksum mismatch: ' + name)
        if chunks is not None:
            payload_bytes = b''.join(chunks)
if expected.keys() != seen_files:
    raise ValueError('Incomplete release archive')
if hashlib.sha256(payload_bytes).hexdigest() != assets['payloadManifestSha256']:
    raise ValueError('Player manifest hash mismatch')
payload = json.loads(payload_bytes)
if (payload['schemaVersion'] != 1 or payload['digest'] != digest
        or payload['sourceRevision'] != release['sourceRevision'] or payload['sourceDirty'] is not False
        or not isinstance(payload['dependencies'], list) or not payload['dependencies']):
    raise ValueError('Invalid player manifest identity')
records = file_records(payload['files'])
actual = {name[len(prefix):]: record for name, record in expected.items()
          if name.startswith(prefix) and name != payload_name}
if records.keys() != actual.keys():
    raise ValueError('Player inventory differs from release')
h = hashlib.sha256()
for name in sorted(records, key=lambda value: value.encode('ascii')):
    record = records[name]
    if record['bytes'] != actual[name]['bytes'] or record['sha256'] != actual[name]['sha256']:
        raise ValueError('Player file differs from release: ' + name)
    h.update((name + '\0' + str(record['bytes']) + '\0' + record['sha256'] + '\n').encode('ascii'))
if h.hexdigest() != digest:
    raise ValueError('Player aggregate digest mismatch')
print(json.dumps({'verified': True, 'files': len(expected), 'playerAssetsDigest': digest}))
