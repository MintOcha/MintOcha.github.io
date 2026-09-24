import * as ort from "onnxruntime-web/webgpu";

type Position = { id: string; oracle?: unknown; [key: string]: unknown };
let runtime:
  | Promise<{ python: { globals: { get: (name: string) => (payload: string) => { getBuffer: (type: string) => { data: Float32Array; release: () => void }; destroy: () => void } } }; sessions: Record<"critic" | "oracle", ort.InferenceSession>; backend: string }>
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
    const sessions = {} as Record<"critic" | "oracle", ort.InferenceSession>;
    for (const model of ["critic", "oracle"] as const) {
      let session: ort.InferenceSession | undefined;
      if ("gpu" in navigator) {
        try {
          session = await ort.InferenceSession.create(`/model/${model}.onnx`, {
            executionProviders: ["webgpu"],
          });
          backend = "GPU · WebGPU";
        } catch (error) {
          console.warn("WebGPU unavailable; using local CPU inference", error);
        }
      }
      session ??= await ort.InferenceSession.create(`/model/${model}.onnx`, {
        executionProviders: ["wasm"],
      });
      sessions[model] = session;
    }
    return { python, sessions, backend };
  })());
}

export async function evaluatePositions(positions: Position[]) {
  const runtime = await initializeCritic();
  const { python, sessions } = runtime;
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
      const model = positions[0].oracle ? "oracle" : "critic";
      if (positions.some((position) => Boolean(position.oracle) !== Boolean(positions[0].oracle)))
        throw new Error("Mixed critic modes in one evaluation batch");
      const outputs = await sessions[model].run({ observation: input });
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
