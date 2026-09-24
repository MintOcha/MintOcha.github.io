"""Export the Oracle outcome critic and its observation encoder for browser inference."""
import argparse
import ast
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path
from importlib.metadata import distribution

parser = argparse.ArgumentParser()
parser.add_argument('--pokemonbot', type=Path, default=Path('/home/nas/Projects/PokemonBot'))
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(args.pokemonbot))
sys.path.insert(0, str(root / 'server'))
import numpy as np
import torch
import onnxruntime as ort
import poke_env
from bot.outcome_critic import OutcomeCritic
from bot.encode import IDX, TEAM, OBSERVATION_CONTRACT
from bot.vocab import DEX
from main import MESSAGES_TO_IGNORE

torch.set_num_threads(2)
model = OutcomeCritic.load(root / 'server/best.ckpt')
class Probability(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model
    def forward(self, observation):
        return (self.model(observation) + 1) / 2

output = root / 'public/model'
output.mkdir(parents=True, exist_ok=True)
wrapped = Probability(model).eval()
example = torch.zeros(2, 13, 139)
torch.onnx.export(wrapped, example, output / 'oracle.onnx', input_names=['observation'],
                  output_names=['probability'], dynamic_axes={'observation': {0: 'batch'}, 'probability': {0: 'batch'}},
                  opset_version=17, dynamo=False)
session = ort.InferenceSession(str(output / 'oracle.onnx'), providers=['CPUExecutionProvider'])
with torch.inference_mode():
    reference = wrapped(example).numpy()
actual = session.run(None, {'observation': example.numpy()})[0]
np.testing.assert_allclose(actual, reference, atol=1e-6, rtol=1e-5)

vocabulary = {name: getattr(DEX, name).stoi for name in ('species', 'items', 'abilities', 'types', 'status', 'roles', 'moves', 'weather')}
sets = {key: [list(s) for s in entries] for key, entries in DEX.sets.items()}
vocab_tree = ast.parse((args.pokemonbot / 'bot/vocab.py').read_text())
# Keep the canonical vocabulary behavior; initialize its tables from the loaded checkpoint vocabulary.
kept = [node for node in vocab_tree.body if isinstance(node, (ast.Import, ast.ImportFrom)) and not (isinstance(node, ast.ImportFrom) and node.module == 'poke_env.data')
        or isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ('norm', 'Set', 'Vocab', 'Dex')
        or isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in ('BOOSTS', 'EFFECTS', 'FIELDS', 'SIDE_CONDITIONS') for t in node.targets)]
vocab_source = ast.unparse(ast.Module(body=kept, type_ignores=[]))
vocab_source += '\n_data = json.load(open(os.path.join(os.path.dirname(__file__), "vocabulary.json")))\nDEX = object.__new__(Dex)\n'
vocab_source += 'for _name, _table in _data["vocabulary"].items():\n    _v = object.__new__(Vocab)\n    _v.stoi = _table\n    setattr(DEX, _name, _v)\n'
vocab_source += 'DEX.sets = {k: tuple(Set(*s) for s in v) for k, v in _data["sets"].items()}\n'
# CATEGORICAL requires vocabulary lengths although browser encoding never constructs model embeddings.
vocab_source += 'for _name in _data["vocabulary"]:\n    _v = getattr(DEX, _name)\n    _v.itos = [None] * (max(_v.stoi.values()) + 1)\n'
server_tree = ast.parse((root / 'server/main.py').read_text())
functions = [node for node in server_tree.body if isinstance(node, ast.FunctionDef) and node.name in ('validate_native_request', 'observation', 'observation_prefixes')]
encoder_source = 'import json, logging, pickle\nfrom typing import Any\nimport numpy as np\nfrom poke_env.battle import Battle\nfrom bot.encode import encode_battle, IDX, TEAM\nlogger = logging.getLogger("browser-critic")\nMAX_MESSAGES_PER_POSITION = 50000\n'
encoder_source += 'MESSAGES_TO_IGNORE = set(' + repr(sorted(MESSAGES_TO_IGNORE)) + ')\n'
encoder_source += ast.unparse(ast.Module(body=functions, type_ignores=[]))
encoder_source += '''
def encode_positions(payload):
    positions = json.loads(payload)
    prefixes = observation_prefixes(positions)
    encoded = []
    for pos in positions:
        perspective = pos['perspective']
        oracle = pos.get('oracle')
        if oracle is not None:
            own = 0 if perspective == 'p1' else 1
            full = [observation(p['messages'], p['request'], f'p{s + 1}', pos['id'], prefixes) for s, p in enumerate(oracle)]
            obs = full[own].copy()
            obs[1 + TEAM:] = full[1 - own][1:1 + TEAM]
            obs[1 + TEAM:, IDX['tok_type'][0]] = 2
        else:
            obs = observation(pos['messages'], pos['request'], perspective, pos['id'], prefixes)
        encoded.append(obs)
    return np.stack(encoded).astype(np.float32).ravel()
'''
package = Path(poke_env.__file__).parent
with zipfile.ZipFile(output / 'encoder.zip', 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in ('poke_env', 'poke_env/player', 'poke_env/teambuilder', 'bot'):
        archive.writestr(name + '/__init__.py', '')
    archive.writestr('poke_env/data/__init__.py', 'from .gen_data import GenData\nfrom .normalize import to_id_str\n')
    for folder in ('battle', 'data'):
        for file in (package / folder).rglob('*'):
            if file.is_file() and '__pycache__' not in file.parts and file.name != '__init__.py':
                archive.write(file, 'poke_env/' + str(file.relative_to(package)))
    archive.write(package / 'battle/__init__.py', 'poke_env/battle/__init__.py')
    for name in ('stats.py', 'exceptions.py', 'player/battle_order.py', 'teambuilder/teambuilder_pokemon.py'):
        archive.write(package / name, 'poke_env/' + name)
    archive.write(args.pokemonbot / 'bot/encode.py', 'bot/encode.py')
    archive.writestr('bot/vocab.py', vocab_source)
    archive.writestr('bot/vocabulary.json', json.dumps({'vocabulary': vocabulary, 'sets': sets}))
    archive.writestr('browser_encoder.py', encoder_source)
    archive.writestr('LICENSE.poke-env', distribution('poke-env').read_text('licenses/LICENSE'))

runtime = root / 'public/runtime'
runtime.mkdir(exist_ok=True)
pyodide = root / 'node_modules/pyodide'
for file in pyodide.iterdir():
    if file.suffix in ('.mjs', '.wasm', '.zip', '.json'):
        shutil.copy2(file, runtime / file.name)
lock = json.loads((pyodide / 'pyodide-lock.json').read_text())
version = json.loads((pyodide / 'package.json').read_text())['version']
needed = {'numpy', 'orjson'}
while True:
    expanded = needed | {dependency for name in needed for dependency in lock['packages'][name]['depends']}
    if expanded == needed:
        break
    needed = expanded
for name in needed:
    record = lock['packages'][name]
    target = runtime / record['file_name']
    if not target.exists():
        urllib.request.urlretrieve(f'https://cdn.jsdelivr.net/pyodide/v{version}/full/{target.name}', target)
    if hashlib.sha256(target.read_bytes()).hexdigest() != record['sha256']:
        raise ValueError(f'Runtime package checksum mismatch: {name}')
for file in (root / 'node_modules/onnxruntime-web/dist').glob('ort-wasm-simd-threaded.*'):
    shutil.copy2(file, runtime / file.name)
(output / 'oracle.json').write_text(json.dumps({'name': 'Oracle outcome critic', 'contract': 'oracle-both-private-own-blocks-v1', 'shape': [13, 139], 'checkpoint_sha256': hashlib.sha256((root / 'server/best.ckpt').read_bytes()).hexdigest()}))
print(json.dumps({'onnx_max_error': float(np.max(np.abs(reference-actual))), 'model_bytes': (output / 'oracle.onnx').stat().st_size, 'encoder_bytes': (output / 'encoder.zip').stat().st_size, 'pyodide': version}))
