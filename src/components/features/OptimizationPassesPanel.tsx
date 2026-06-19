import { useEffect } from "react";
import { Card, CardContent, CardHeader, Switch, Label, Input, Slider, Select, Tabs, TabsList, TabsTrigger, TabsContent, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui";
import { UIState } from "@/types";
import { applyIssueAutofix, getPipelineValidation, getRemainingAdvisories, getAllowedConversionFormats, getAllowedPeftMethods, getAllowedPruningTypes, getAllowedQuantMethods, isPeftAllowed } from "@/lib/pipelineValidation";
import { VramEstimateBanner } from "@/components/features/VramEstimateBanner";
import { Layers, Combine, Zap, Minimize2, Workflow, Fingerprint, Info, ArrowRight, ArrowDown, Box, Settings, AlertTriangle } from "lucide-react";

export function getSelectedModelInfo(state: UIState) {
  let identifier = "";
  if (state.modelSource === "huggingface") {
    identifier = state.hfModelId || "meta-llama/Llama-2-7b-hf";
  } else if (state.modelSource === "azure") {
    identifier = state.azureModelPath || "AzureML Asset Container";
  } else if (state.modelSource === "local") {
    if (state.localFiles && state.localFiles.length > 0) {
      identifier = state.localFiles[0].name;
    } else {
      identifier = "";
    }
  }

  const idLower = identifier.toLowerCase();

  if (
    idLower.includes("llama") || 
    idLower.includes("mistral") || 
    idLower.includes("phi") || 
    idLower.includes("gemma") || 
    idLower.includes("qwen") || 
    idLower.includes("instruct") || 
    idLower.includes("minicpm")
  ) {
    return {
      name: identifier,
      family: "LLM (Generative Text)",
      types: [
        { value: "float16", label: "float16 (Optimized for standard GPU)" },
        { value: "bfloat16", label: "bfloat16 (Optimized for Ampere+ GPUs/TPUs)" },
        { value: "float32", label: "float32 (Full precision, CPU standard)" },
      ],
      defaultType: "float16"
    };
  }

  if (idLower.includes("whisper")) {
    return {
      name: identifier,
      family: "Speech-to-Text Transformer",
      types: [
        { value: "float16", label: "float16 (Fast GPU Audio pipeline)" },
        { value: "float32", label: "float32 (Standard full precision)" },
        { value: "int8", label: "int8 (Highly-compressed quantization target)" },
      ],
      defaultType: "float16"
    };
  }

  if (
    idLower.includes("diffusion") || 
    idLower.includes("sd15") || 
    idLower.includes("unet") || 
    idLower.includes("sdxl") || 
    idLower.includes("flux")
  ) {
    return {
      name: identifier,
      family: "Latent Diffusion Model",
      types: [
        { value: "float16", label: "float16 (Low VRAM - Recommended for SD/Flux)" },
        { value: "float32", label: "float32 (High Fidelity Full Precision)" },
      ],
      defaultType: "float16"
    };
  }

  if (idLower.includes("bert") || idLower.includes("roberta") || idLower.includes("t5")) {
    return {
      name: identifier,
      family: "Transformer Encoder (NLP)",
      types: [
        { value: "float32", label: "float32 (Highly stable standard)" },
        { value: "float16", label: "float16 (Optimized for fast GPU execution)" },
        { value: "int32", label: "int32 (For token ID inputs)" },
        { value: "int64", label: "int64 (High-precision token IDs)" },
      ],
      defaultType: "float32"
    };
  }

  return {
    name: identifier || "Generic Model Workspace",
    family: "Generic Neural Network",
    types: [
      { value: "float32", label: "float32 (Standard multi-purpose format)" },
      { value: "float16", label: "float16 (Half precision target)" },
      { value: "int8", label: "int8 (Quantized deployment format)" },
      { value: "int32", label: "int32 (Integer input labels)" },
    ],
    defaultType: "float32"
  };
}

export function OptimizationPassesPanel({ state, setState }: { state: UIState; setState: (s: Partial<UIState>) => void }) {
  const modelInfo = getSelectedModelInfo(state);

  useEffect(() => {
    const isValid = modelInfo.types.some(t => t.value === state.passes.conversionInputTargetTypes);
    if (!isValid && modelInfo.defaultType) {
      setState({
        passes: {
          ...state.passes,
          conversionInputTargetTypes: modelInfo.defaultType
        }
      });
    }
  }, [state.modelSource, state.hfModelId, state.localFiles.length, state.localFiles[0]?.name, state.azureModelPath]);
  
  const validation = getPipelineValidation(state);
  const advisories = getRemainingAdvisories(state);
  const allowedQuantMethods = getAllowedQuantMethods(state.ihvProvider);
  const allowedConversionFormats = getAllowedConversionFormats(state.ihvProvider);
  const allowedPruningTypes = getAllowedPruningTypes(state.ihvProvider);
  const allowedPeftMethods = getAllowedPeftMethods(state.ihvProvider);
  const pipelineConflicts = validation.issues
    .filter((issue) => issue.autofix)
    .map((issue) => ({
      ...issue,
      type: issue.severity,
      onResolve: issue.autofix ? () => setState(applyIssueAutofix(state, issue)) : undefined,
    }));

  const PipelineToggle = ({ active, onToggle, icon, title, desc, disabled, reason }: any) => {
    const Icon = icon;
    return (
      <div className={`flex items-start gap-4 p-4 rounded border transition-colors ${disabled ? "opacity-40 border-slate-900 bg-slate-950/20" : active ? "border-electric-blue/40 bg-electric-blue/5" : "border-slate-800 bg-slate-900/50"}`}>
        <div className={`mt-0.5 rounded p-1.5 ${disabled ? "bg-slate-950 text-slate-600" : active ? "bg-electric-blue/15 text-electric-blue" : "bg-slate-800 text-slate-400"}`}><Icon className="h-5 w-5" /></div>
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <Label className={`text-sm font-medium ${disabled ? "text-slate-500 cursor-not-allowed" : "cursor-pointer text-slate-200"}`} onClick={!disabled ? onToggle : undefined}>{title}</Label>
            {disabled && reason && (
              <span className="text-[10px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
                {reason}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{desc}</p>
        </div>
        <Switch disabled={disabled} checked={disabled ? false : active} onCheckedChange={onToggle} />
      </div>
    );
  };

  const getConflictCategory = (tab: string) => {
    const tabConflicts = pipelineConflicts.filter((c) => c.affectedTabs?.includes(tab));
    if (tabConflicts.some(c => c.type === "critical")) return "critical";
    if (tabConflicts.length > 0) return "warning";
    return null;
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
      <VramEstimateBanner state={state} compact />
      
      {pipelineConflicts.length > 0 && (
        <div className="mb-6 rounded border border-amber-500/30 bg-amber-950/10 p-4 md:p-5 flex flex-col gap-4">
          <div className="flex items-start gap-2.5 border-b border-slate-800 pb-3">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-amber-500/20 text-amber-500 shrink-0 mt-0.5">
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <div>
              <h3 className="text-sm font-medium text-amber-400">
                Pass conflicts ({pipelineConflicts.length})
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">These settings conflict with your hardware target and may fail at run time.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pipelineConflicts.map((conflict) => (
              <div 
                key={conflict.id} 
                className={`p-3.5 rounded border flex flex-col justify-between gap-3 ${
                  conflict.type === "critical" 
                    ? "border-rose-500/20 bg-rose-950/10" 
                    : "border-amber-500/10 bg-amber-950/5"
                }`}
              >
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${conflict.type === "critical" ? "bg-rose-500" : "bg-amber-400"}`} />
                    <h4 className={`text-xs font-medium ${conflict.type === "critical" ? "text-rose-300" : "text-amber-400"}`}>{conflict.title}</h4>
                  </div>
                  <p className="text-[11px] text-slate-500 leading-normal">{conflict.description}</p>
                </div>
                {conflict.actionLabel && conflict.onResolve && (
                  <div className="flex items-center justify-end border-t border-slate-900/50 pt-2.5 mt-1">
                    <button 
                      type="button"
                      onClick={conflict.onResolve}
                      className={`text-xs px-2.5 py-1 rounded border transition-colors cursor-pointer ${
                        conflict.type === "critical" 
                          ? "border-rose-500/30 text-rose-400 hover:text-white hover:bg-rose-500/15" 
                          : "border-amber-500/30 text-amber-400 hover:text-white hover:bg-amber-500/15"
                      }`}
                    >
                      Resolve: {conflict.actionLabel}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {advisories.length > 0 && (
        <div className="mb-6 bg-amber-500/5 border border-amber-500/30 rounded p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-amber-400 font-medium text-sm">
            <AlertTriangle className="h-4 w-4" /> Performance notes
          </div>
          <ul className="list-disc pl-6 text-xs text-slate-500 space-y-1">
            {advisories.map((issue) => (
              <li key={issue.id}>{issue.description}</li>
            ))}
          </ul>
        </div>
      )}

      <Tabs defaultValue="conversion" className="w-full">
        <TabsList className="mb-6 grid grid-cols-2 md:grid-cols-5 h-auto rounded border p-1 gap-1 bg-slate-950 border-slate-800">
          <TabsTrigger value="conversion" className="py-2 data-[state=active]:bg-electric-blue/10 data-[state=active]:text-electric-blue rounded relative">
            <Workflow className="h-4 w-4 mr-2 hidden lg:block" />
            Conversion
            {getConflictCategory("conversion") && (
              <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${getConflictCategory("conversion") === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
            )}
          </TabsTrigger>
          <TabsTrigger value="quantization" className="py-2 data-[state=active]:bg-electric-blue/10 data-[state=active]:text-electric-blue rounded relative">
            <Minimize2 className="h-4 w-4 mr-2 hidden lg:block" />
            Quantization
            {getConflictCategory("quantization") && (
              <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${getConflictCategory("quantization") === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
            )}
          </TabsTrigger>
          <TabsTrigger value="compression" className="py-2 data-[state=active]:bg-electric-blue/10 data-[state=active]:text-electric-blue rounded relative">
            <Combine className="h-4 w-4 mr-2 hidden lg:block" />
            Compression
            {getConflictCategory("compression") && (
              <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${getConflictCategory("compression") === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
            )}
          </TabsTrigger>
          <TabsTrigger value="peft" className="py-2 data-[state=active]:bg-electric-blue/10 data-[state=active]:text-electric-blue rounded relative">
            <Layers className="h-4 w-4 mr-2 hidden lg:block" />
            PEFT / LoRA
            {getConflictCategory("peft") && (
              <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${getConflictCategory("peft") === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
            )}
          </TabsTrigger>
          <TabsTrigger value="transforms" className="py-2 data-[state=active]:bg-electric-blue/10 data-[state=active]:text-electric-blue rounded relative">
            <Zap className="h-4 w-4 mr-2 hidden lg:block" />
            Transforms
            {getConflictCategory("transforms") && (
              <span className={`absolute top-1.5 right-1.5 h-2 w-2 rounded-full ${getConflictCategory("transforms") === "critical" ? "bg-rose-500" : "bg-amber-500"}`} />
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="conversion" className="space-y-4">
          <Card>
            <CardHeader title="Model conversion" description="Convert PyTorch or TensorFlow to ONNX or OpenVINO." />
            <CardContent className="space-y-6">
              <PipelineToggle 
                active={state.passes.conversion} 
                onToggle={(v: boolean) => setState({ passes: { ...state.passes, conversion: !state.passes.conversion} })}
                title="Enable Conversion Pass"
                desc="Converts weights to standard ONNX or OpenVINO IR formats."
                icon={Workflow}
              />
              {state.passes.conversion && (
                <div className="mt-8 border-t border-slate-800/80 pt-6 animate-in fade-in">
                  <div className="flex flex-col xl:flex-row items-center gap-4 w-full">
                    
                    {/* Node 1: Source */}
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded p-5 w-full relative group hover:border-slate-700 transition-colors">
                      <div className="absolute top-0 right-0 p-3"><Box className="w-4 h-4 text-slate-600 group-hover:text-electric-blue transition-colors" /></div>
                      <h4 className="font-semibold text-slate-200 mb-1 text-sm">1. Source Framework</h4>
                      <p className="text-xs text-slate-500 mb-4 h-8 text-balance">The original training framework format.</p>
                      <div className="space-y-2">
                        <Label>Model Format</Label>
                        <Select 
                          value={state.passes.conversionSourceFormat} 
                          onChange={(e) => setState({ passes: {...state.passes, conversionSourceFormat: e.target.value as any}})}>
                          <option value="pytorch">PyTorch (.pt, .pth)</option>
                          <option value="tensorflow">TensorFlow (.pb, SavedModel)</option>
                          <option value="jax">JAX</option>
                        </Select>
                      </div>
                    </div>

                    <ArrowRight className="text-slate-700 hidden xl:block shrink-0" />
                    <ArrowDown className="text-slate-700 xl:hidden shrink-0" />

                    {/* Node 2: Engine */}
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded p-5 w-full relative group hover:border-electric-blue/40 transition-colors">
                      <div className="absolute top-0 right-0 p-3"><Settings className="w-4 h-4 text-slate-600 group-hover:text-electric-blue transition-colors" /></div>
                      <h4 className="font-semibold text-slate-200 mb-1 text-sm">2. Conversion Engine</h4>
                      <p className="text-xs text-slate-500 mb-4 h-8 text-balance">Parameters guiding the Intermediate Representation (IR).</p>
                      
                      <div className="grid grid-cols-2 gap-3">
                         <div className="space-y-2">
                          <Label>Target Opset</Label>
                           <Select 
                            value={state.passes.conversionOpset} 
                            onChange={(e) => setState({ passes: {...state.passes, conversionOpset: parseInt(e.target.value)}})}>
                            <option value="13">Opset 13</option>
                            <option value="14">Opset 14</option>
                            <option value="15">Opset 15</option>
                            <option value="16">Opset 16</option>
                            <option value="17">Opset 17 (Latest)</option>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label>I/O Target Types</Label>
                          <Select 
                            value={state.passes.conversionInputTargetTypes} 
                            onChange={(e) => setState({ passes: {...state.passes, conversionInputTargetTypes: e.target.value}})}
                          >
                            {modelInfo.types.map(t => (
                              <option key={t.value} value={t.value}>{t.label}</option>
                            ))}
                          </Select>
                          <span className="text-[10px] font-mono text-electric-blue block mt-1">
                            Detected: {modelInfo.family}
                          </span>
                        </div>
                      </div>
                    </div>

                    <ArrowRight className="text-slate-700 hidden xl:block shrink-0" />
                    <ArrowDown className="text-slate-700 xl:hidden shrink-0" />

                    {/* Node 3: Target */}
                    <div className="flex-1 bg-slate-900 border border-slate-800 rounded p-5 w-full relative group hover:border-slate-600 transition-colors">
                      <div className="absolute top-0 right-0 p-3"><Workflow className="w-4 h-4 text-slate-600 group-hover:text-slate-400 transition-colors" /></div>
                      <h4 className="font-semibold text-slate-200 mb-1 text-sm">3. Deployment Target</h4>
                      <p className="text-xs text-slate-500 mb-4 h-8 text-balance">The optimized artifact format.</p>
                      <div className="space-y-2">
                        <Label>Target Format</Label>
                        <Select 
                          value={state.passes.conversionFormat} 
                          onChange={(e) => setState({ passes: {...state.passes, conversionFormat: e.target.value as any}})}>
                          <option value="onnx">ONNX (.onnx)</option>
                          {allowedConversionFormats.includes("openvino") && (
                            <option value="openvino">OpenVINO IR (.xml / .bin)</option>
                          )}
                        </Select>
                      </div>
                    </div>

                  </div>

                  <div className="mt-6 pt-4 border-t border-slate-800">
                    <div className="flex items-center space-x-2">
                       <Switch id="splitting" checked={state.passes.splitting} onCheckedChange={(v) => setState({ passes: { ...state.passes, splitting: v }})} />
                       <Label htmlFor="splitting" className="flex items-center gap-2">Enable model splitting <span className="bg-electric-blue/15 text-electric-blue text-[10px] px-1.5 py-0.5 rounded">Beta</span></Label>
                    </div>
                    <p className="text-xs text-slate-500 mt-1 pl-11">Breaks large architectures (e.g. LLMs) into manageable blocks (encoder/decoder/kv-cache) for memory-constrained edge deployment or pipeline parallelism.</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="quantization" className="space-y-4">
          <Card>
            <CardHeader title="Quantization" description="Reduce weight and activation precision (INT8, INT4, AWQ)." />
            <CardContent className="space-y-6">
               <PipelineToggle 
                active={state.passes.quantization} 
                onToggle={(v: boolean) => setState({ passes: { ...state.passes, quantization: !state.passes.quantization} })}
                title="Enable Quantization"
                desc="Reduces precision of weights and/or activations (INT8, INT4, AWQ)."
                icon={Minimize2}
              />
              {state.passes.quantization && (
                <div className="grid grid-cols-2 gap-4 animate-in fade-in">
                  <div className="space-y-2">
                    <Label>Quantization Strategy</Label>
                    <Select value={state.passes.quantMethod} onChange={e => setState({ passes: {...state.passes, quantMethod: e.target.value as any}})}>
                      {allowedQuantMethods.includes("ptq") && (
                        <option value="ptq">Post-Training Quantization (PTQ)</option>
                      )}
                      {allowedQuantMethods.includes("awq") && (
                        <option value="awq">Activation-Aware Weight Quantization (AWQ)</option>
                      )}
                      {allowedQuantMethods.includes("qat") && (
                        <option value="qat">Quantization-Aware Training (QAT)</option>
                      )}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Precision Boundary</Label>
                    <Select value={state.passes.quantPrecision} onChange={e => setState({ passes: {...state.passes, quantPrecision: e.target.value as any}})}>
                      <option value="int4">INT4 (Maximum Compression)</option>
                      <option value="int8">INT8 (Balanced Performance)</option>
                      <option value="fp16">FP16 (Half Precision)</option>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-2 mt-2">
                     <Label>Block Size (for Block-wise Quantization)</Label>
                     <Select defaultValue="128">
                      <option value="32">32</option>
                      <option value="64">64</option>
                      <option value="128">128</option>
                     </Select>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compression" className="space-y-4">
          <Card>
            <CardHeader title="Compression & pruning" description="Remove redundant weights and enforce sparsity." />
            <CardContent className="space-y-6">
                <PipelineToggle 
                  active={state.passes.pruning} 
                  onToggle={() => {
                  const enabling = !state.passes.pruning;
                  setState({
                    passes: {
                      ...state.passes,
                      pruning: enabling,
                      ...(enabling && state.passes.quantMethod === "awq"
                        ? { quantMethod: "ptq" as const }
                        : {}),
                    },
                  });
                }}
                  title="Enable Pruning"
                  desc="Drive weights to zero to eliminate unnecessary connections."
                  icon={Combine}
                />
                {state.passes.pruning && (
                  <div className="space-y-8 animate-in fade-in mt-4 border-t border-slate-800/80 pt-6">
                    
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <Label className="flex items-center gap-2">
                           Sparsity Ratio
                           <TooltipProvider delayDuration={100}>
                            <Tooltip>
                              <TooltipTrigger type="button" className="cursor-help text-slate-500 hover:text-slate-300 transition-colors">
                                <Info className="h-4 w-4" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <p>Fraction of weights to explicitly set to 0. Higher ratios compress more but risk higher accuracy degradation.</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </Label>
                        <span className="text-electric-blue font-mono text-sm font-semibold">{(state.passes.pruningSparsity * 100).toFixed(0)}%</span>
                      </div>
                      <Slider 
                        value={[state.passes.pruningSparsity]} 
                        min={0} max={0.99} step={0.01} 
                        onValueChange={v => setState({ passes: {...state.passes, pruningSparsity: v[0]}})}
                      />
                      <div className="flex justify-between text-xs text-slate-500 font-mono">
                        <span>0% (Dense)</span>
                        <span>99% (Sparse)</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                       <div className="space-y-3">
                          <Label className="flex items-center gap-2">Algorithm Type</Label>
                          <Select 
                            value={state.passes.pruningType} 
                            onChange={e => setState({ passes: {...state.passes, pruningType: e.target.value as any}})}>
                            {allowedPruningTypes.includes("unstructured") && (
                              <option value="unstructured">Unstructured (Weight-level)</option>
                            )}
                            {allowedPruningTypes.includes("structured") && (
                              <option value="structured">Structured (N:M Block-level)</option>
                            )}
                          </Select>
                          <p className="text-xs text-slate-500 mt-1">Structured pruning ensures hardware alignment (e.g. 2:4 sparsity for Tensor Cores) at the cost of slight accuracy reduction compared to unstructured.</p>
                        </div>
                        
                        <div className="space-y-3">
                          <Label className="flex items-center gap-2">
                            Pruning Method
                            <TooltipProvider delayDuration={100}>
                              <Tooltip>
                                <TooltipTrigger type="button" className="cursor-help"><Info className="h-4 w-4 text-slate-500" /></TooltipTrigger>
                                <TooltipContent className="max-w-xs"><p>The formula to determine which weights to prune. SparseGPT and Wanda are One-Shot methods optimal for LLMs.</p></TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </Label>
                          <Select 
                            value={state.passes.pruningMethod} 
                            onChange={e => setState({ passes: {...state.passes, pruningMethod: e.target.value as any}})}>
                            <option value="magnitude">Magnitude (Standard)</option>
                            <option value="sparsegpt">SparseGPT</option>
                            <option value="wanda">Wanda</option>
                          </Select>
                           <p className="text-xs text-slate-500 mt-1">Uses calibration data to assess weight importance intelligently rather than just lowest absolute values.</p>
                        </div>
                    </div>

                    {state.passes.pruningMethod === "magnitude" && (
                      <div className="space-y-3 p-4 rounded bg-slate-900 border border-slate-800">
                           <Label className="flex items-center gap-2">
                              Pruning Criteria
                               <TooltipProvider delayDuration={100}>
                                <Tooltip>
                                  <TooltipTrigger type="button" className="cursor-help"><Info className="h-4 w-4 text-slate-500" /></TooltipTrigger>
                                  <TooltipContent className="max-w-xs"><p>Mathematical norm applied to evaluate magnitude sizes.</p></TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                           </Label>
                           <Select 
                              value={state.passes.pruningCriteria} 
                              onChange={e => setState({ passes: {...state.passes, pruningCriteria: e.target.value as any}})}>
                              <option value="l1_norm">L1 Norm (Absolute Sum)</option>
                              <option value="l2_norm">L2 Norm (Euclidean Distance)</option>
                           </Select>
                      </div>
                    )}

                  </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="peft" className="space-y-4">
          <Card>
            <CardHeader title="PEFT & LoRA" description="Train lightweight adapters on foundation models." />
            <CardContent className="space-y-6">
                <PipelineToggle 
                  active={state.passes.peft} 
                  onToggle={(v: boolean) => setState({ passes: { ...state.passes, peft: !state.passes.peft} })}
                  title="Enable PEFT Adapters"
                  desc="Parameter-Efficient Fine-Tuning using Low Rank Adaptation."
                  icon={Layers}
                  disabled={!isPeftAllowed(state.ihvProvider)}
                  reason={
                    !isPeftAllowed(state.ihvProvider)
                      ? state.ihvProvider === "QNNExecutionProvider"
                        ? "Incompatible with Snapdragon NPU"
                        : "Incompatible with OpenVINO"
                      : ""
                  }
                />
                
                {state.passes.peft && (
                   <div className="grid gap-6 animate-in fade-in">
                      <div className="grid grid-cols-2 gap-4">
                         <div className="space-y-2">
                           <Label>Adapter Type</Label>
                           <Select value={state.passes.peftMethod} onChange={e => setState({ passes: {...state.passes, peftMethod: e.target.value as any}})}>
                             {allowedPeftMethods.includes("lora") && <option value="lora">LoRA</option>}
                             {allowedPeftMethods.includes("qlora") && (
                               <option value="qlora">QLoRA (Quantized LoRA)</option>
                             )}
                           </Select>
                         </div>
                         <div className="space-y-2">
                           <Label>LoRA Rank (r)</Label>
                           <Input type="number" defaultValue="16" />
                         </div>
                      </div>
                      
                      <div className="pt-4 border-t border-slate-800">
                        <div className="flex items-center space-x-2">
                           <Switch id="diffusionLora" checked={state.passes.diffusionLora} onCheckedChange={(v) => setState({ passes: { ...state.passes, diffusionLora: v }})} />
                           <Label htmlFor="diffusionLora" className="flex items-center gap-2">Diffusion LoRA mode <Fingerprint className="w-3.5 h-3.5 text-electric-blue" /></Label>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 pl-11">Enable specialized UNet/Text Encoder extraction for Stable Diffusion, SDXL, and Flux.</p>
                      </div>
                   </div>
                )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="transforms" className="space-y-4">
           <Card>
            <CardHeader title="ONNX transforms" description="Graph fusions, attention rewrites, and dead-node elimination." />
            <CardContent className="space-y-6">
                <PipelineToggle 
                  active={state.passes.onnxTransforms} 
                  onToggle={(v: boolean) => setState({ passes: { ...state.passes, onnxTransforms: !state.passes.onnxTransforms} })}
                  title="Apply ONNX Graph Rewrites"
                  desc="Fuses attention blocks, normalizations, and memory patterns."
                  icon={Zap}
                />
            </CardContent>
           </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
