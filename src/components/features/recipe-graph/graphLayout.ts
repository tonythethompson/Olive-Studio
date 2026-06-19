export type GraphPoint = { x: number; y: number };

export function buildSegmentCurve(from: GraphPoint, to: GraphPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (Math.abs(dx) >= Math.abs(dy)) {
    const c1x = from.x + dx * 0.45;
    const c2x = from.x + dx * 0.55;
    return `M ${from.x} ${from.y} C ${c1x} ${from.y}, ${c2x} ${to.y}, ${to.x} ${to.y}`;
  }

  const c1y = from.y + dy * 0.45;
  const c2y = from.y + dy * 0.55;
  return `M ${from.x} ${from.y} C ${from.x} ${c1y}, ${to.x} ${c2y}, ${to.x} ${to.y}`;
}

export function buildPipelineSteps(passes: {
  splitting: boolean;
  peft: boolean;
  conversion: boolean;
  pruning: boolean;
  onnxTransforms: boolean;
  quantization: boolean;
}) {
  return [
    { id: "input", label: "Model Input", active: true },
    { id: "splitting", label: "Split Model", active: passes.splitting },
    { id: "peft", label: "PEFT / LoRA", active: passes.peft },
    { id: "conversion", label: "Conversion", active: passes.conversion },
    { id: "pruning", label: "Pruning", active: passes.pruning },
    { id: "transformer_opt", label: "ORT Transform", active: passes.onnxTransforms },
    { id: "quantization", label: "Quantization", active: passes.quantization },
    { id: "provider", label: "Target IHV", active: true },
    { id: "output", label: "Optimized Output", active: true },
  ];
}
