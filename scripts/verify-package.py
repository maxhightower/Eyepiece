import pathlib, zipfile, json, tempfile, subprocess, os
root = pathlib.Path(__file__).resolve().parent.parent
with zipfile.ZipFile(root / 'eyepiece-0.0.1.vsix') as package:
    names = set(package.namelist())
    required = {'extension/package.json', 'extension/out/src/extension.js', 'extension/docs/welcome.md', 'extension/fixtures/rust/src/lib.rs'}
    assert required <= names, required - names
    assert not any('/node_modules/' in n or '/test/' in n or '/target/' in n for n in names)
    manifest = json.loads(package.read('extension/package.json'))
    assert 'extension/' + manifest['main'].removeprefix('./') in names
    with tempfile.TemporaryDirectory(prefix='eyepiece-vsix-') as target:
        package.extractall(target)
        env = dict(os.environ, EYE_EXTENSION_PATH=str(pathlib.Path(target) / 'extension'))
        subprocess.run(['node', 'scripts/test-host.cjs'], cwd=root, env=env, check=True)
print('VSIX contents and packaged extension-host checks passed')
