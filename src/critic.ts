import * as ort from "onnxruntime-web/webgpu";

type Position = { id: string; [key: string]: unknown };
let runtime:
  | Promise<{ python: any; session: ort.InferenceSession; backend: string }>
  | undefined;

export function initializeCritic() {
  return (runtime ??= (async () => {
    const base = new URL("/runtime/", self.location.href).href;
    const { loadPyodide } = await import(
      /* @vite-ignore */ `${base}pyodide.mjs`
    );
    const python = await loadPyodide({ indexURL: base });
    await python.loadPackage(["numpy", "orjson"]);
    const response = await fetch("/model/encoder.zip");
    if (!response.ok)
      throw new Error("Local observation encoder could not be loaded");
    python.unpackArchive(await response.arrayBuffer(), "zip", {
      extractDir: "/encoder",
    });
    await python.runPythonAsync(
      'import sys\nsys.path.insert(0, "/encoder")\nfrom browser_encoder import encode_positions',
    );
    ort.env.wasm.wasmPaths = base;
    ort.env.wasm.numThreads = 1;
    let backend = "CPU · WebAssembly";
    let session: ort.InferenceSession | undefined;
    if ("gpu" in navigator) {
      try {
        session = await ort.InferenceSession.create("/model/critic.onnx", {
          executionProviders: ["webgpu"],
        });
        backend = "GPU · WebGPU";
      } catch (error) {
        console.warn("WebGPU unavailable; using local CPU inference", error);
      }
    }
    session ??= await ort.InferenceSession.create("/model/critic.onnx", {
      executionProviders: ["wasm"],
    });
    return { python, session, backend };
  })());
}

export async function evaluatePositions(positions: Position[]) {
  const { python, session } = await initializeCritic();
  const encode = python.globals.get("encode_positions");
  const observation = encode(JSON.stringify(positions));
  encode.destroy();
  const buffer = observation.getBuffer("f32");
  try {
    const input = new ort.Tensor("float32", buffer.data, [
      positions.length,
      13,
      139,
    ]);
    try {
      const outputs = await session.run({ observation: input });
      const probability = outputs.probability;
      try {
        return positions.map((position, i) => ({
          id: position.id,
          winProbability: Number(probability.data[i]),
        }));
      } finally {
        probability.dispose();
      }
    } finally {
      input.dispose();
    }
  } finally {
    buffer.release();
    observation.destroy();
  }
}
