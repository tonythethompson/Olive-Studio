# Prompt Engineering: Microsoft Olive Optimization MCP Server

**For**: Developer / Claude Agent Building This MCP
**Status**: Greenfield - No Competing Implementation Exists
**Opportunity**: Fill gap in AI agent tooling for Olive-based model optimization workflows

---

## EXECUTIVE BRIEF

Build a specialized **Model Context Protocol (MCP) server** that enables AI agents to accurately query, configure, and troubleshoot Microsoft Olive model optimization workflows. This MCP will serve as the authoritative knowledge base for agents building GUI applications, CLI tools, or backend services that leverage Olive for CPU/GPU/NPU model compression.

**Key Success Criteria:**

- Agents can confidently implement any Olive optimization without consulting external docs
- Handles vendor-specific quirks (NVIDIA quantization vs. Intel Neural Compressor vs. Qualcomm Vitis AI)
- Provides working configuration templates and code examples
- Maintains version-aware guidance (Olive 0.2.0 → current)
- Acknowledges when fallback to official docs is needed

---

## PROJECT SCOPE

### MCP Tools to Implement (8-12 tools)

1. **`get_olive_passes`** - List all available optimization passes with categories
   - Input: optional filter (e.g., "quantization", "pruning", "conversion")
   - Output: Pass name, class, supported frameworks, parameter definitions, execution provider requirements
   - Example response structure:
     ```json
     {
       "passes": [
         {
           "name": "OnnxQuantization",
           "type": "quantization",
           "formats_supported": ["onnx"],
           "config_schema": {...},
           "hardware_requirements": [...],
           "typical_compression": "70-80%"
         }
       ]
     }
     ```

2. **`get_pass_config_template`** - Generate scaffold configuration for a specific pass
   - Input: pass name, framework (torch/onnx/tf), optimization target (quality/latency/balanced)
   - Output: Full JSON config snippet ready for copy-paste into workflow
   - Includes defaults, parameter explanations, gotchas

3. **`get_quantization_strategy`** - Recommend quantization approach given constraints
   - Input: model type (LLM/CNN/Vision), target hardware, latency budget, accuracy threshold
   - Output: Recommended algorithm (AWQ/GPTQ/QuaRot/HQQ), calibration strategy, expected outcomes, risks
   - Examples:
     - "LLM + NVIDIA GPU + <100ms latency" → AWQ (int4) + KV-cache quantization
     - "CNN + Mobile NPU + 50MB max" → INT8 per-channel with aggressive pruning

4. **`get_hardware_optimization_guide`** - Hardware-specific optimization path
   - Input: target hardware (CPU/GPU/NPU/mobile), model size, latency/throughput goals
   - Output: Recommended pass chain, execution provider, estimated speedup, calibration requirements
   - Handles: NVIDIA GPU (TensorRT), Intel CPU (OpenVINO), Qualcomm (QNN), Apple (CoreML), Android (NNAPI)

5. **`get_pass_chain`** - Validate and explain pass ordering for a workflow
   - Input: list of pass names in intended order
   - Output: Validation result (valid/invalid), explanation, reordering suggestions, data format transformations between passes
   - Catches: trying to quantize before ONNX export, incompatible pass combinations, missing intermediate conversions

6. **`troubleshoot_olive_error`** - Diagnose common implementation issues
   - Input: error message, pass name, configuration context (optional)
   - Output: Root cause, workaround, updated config snippet
   - Covers: ONNX export failures, quantization accuracy collapse, executor provider fallback, OOM issues, calibration data mismatch

7. **`get_model_compatibility`** - Check Olive support for a model/framework combo
   - Input: model name/path, framework (HuggingFace/PyTorch/ONNX/OpenVINO/etc.), Olive version (optional)
   - Output: Compatibility matrix (supported passes, known issues, required preprocessing, expected performance)
   - Examples: "Mistral 7B → ONNX → OnnxQuantization ✓, IncDistillation ⚠ (slow calibration), QLoRA ✗ (ONNX limitations)"

8. **`get_cli_command`** - Generate ready-to-run Olive CLI command
   - Input: optimization goal, model, target, parameters
   - Output: Complete command with all flags, example usage
   - Includes: quantize, finetune, optimize, auto-opt, onnx-graph-capture, generate-adapter

9. **`get_data_config_template`** - Generate data pipeline configuration
   - Input: data source (HuggingFace dataset, local files, image folder), task (calibration/evaluation)
   - Output: Complete DataConfig JSON with preprocessing, sampling, batching
   - Handles: calibration data preparation, train/val/test split, normalization (ImageNet, custom)

10. **`search_olive_documentation`** - Full-text search across Olive docs + GitHub
    - Input: query (e.g., "how to calibrate static quantization", "QNN execution provider")
    - Output: Ranked results with snippet, source URL, relevance score
    - Scope: Official docs, GitHub issues, blog posts, release notes

11. **`get_pass_parameters`** - Deep-dive into a single pass's parameter schema
    - Input: pass name, parameter name (optional for single param)
    - Output: Full parameter documentation: type, default, valid range, interaction with other params, performance impact
    - Example: `get_pass_parameters("OnnxQuantization", "quant_format")` → explains "QOperator" vs "QDQ" tradeoffs

12. **`evaluate_optimization_tradeoff`** - Analyze quality vs. performance tradeoff
    - Input: optimization passes (sequence), model, evaluation metrics (accuracy, latency, size)
    - Output: Predicted outcomes for each metric, risk factors, Pareto frontier recommendations
    - Helps: "Should I use INT4 + pruning or INT8 alone?" → compare predictions

---

## KNOWLEDGE BASE CONTENT

### Core Reference Data to Embed/Fetch

#### 1. **Pass Catalog** (40+ passes)

- Quantization: IncQuantization, IncDynamicQuantization, IncStaticQuantization, OnnxQuantization, OnnxDynamicQuantization, OnnxStaticQuantization, NVModelOptQuantization, VitisAIQuantization, QNNQuantization
- Conversion: OnnxConversion, OnnxOpVersionConversion, OpenVINOConversion, SNPEConversion, TensorFlowConversion
- Graph Opt: OnnxModelOptimizer, OrtTransformersOptimization, OnnxFloatToFloat16, OrtMixedPrecision, QNNPreprocess
- Pruning: IncPruning, IncSparsityFineTuning, SparsityFineTuning
- Distillation: IncDistillation, DistillationPass
- LoRA: LoRA, QLoRA, MultiLoRA, ExtractLoRA, GenerateAdapterWeights
- Tuning: OrtPerfTuning, ModelOptOptimizer, BatchSizeOptimization, OnnxGraphCapture
- **For Each**: class name, supported input formats, output formats, required params, optional params, compatibility matrix (frameworks × hardware)

#### 2. **Configuration Schemas** (JSON)

- `input_model` schema (type, path, io_config, framework)
- `passes[*]` schema (type, params, input, output_name, disable_search)
- `systems` schema (AzureMLSystem, DockerSystem, PythonEnvironmentSystem)
- `data_configs` schema (DataContainer types: HuggingFaceContainer, ImageNetContainer, etc.)
- `evaluators` schema (HuggingFaceEvaluator, AccuracyEvaluator, custom metrics)
- `engine` schema (search_algorithm, objectives, checkpoint handling)

#### 3. **Execution Providers Map**

```
CPUExecutionProvider → Olive passes supporting it, expected speedup, calibration style
CUDAExecutionProvider → ops supported, TensorRT compatibility, mixed-precision support
TensorrtExecutionProvider → ops supported, quantization flavor (INT8/FP16), LoRA support
CoreMLExecutionProvider → layer support, mobile quantization (per-channel requirement)
QNNExecutionProvider → mobile NPU, power-of-2 quantization, operator whitelist
NNAPIExecutionProvider → Android ops, quantization limits
TensorflowLiteExecutionProvider → lite-specific ops, calibration requirements
```

#### 4. **Quirks Database** (Critical for Agent Success)

Document per topic:

- **Calibration Quirks**: Static vs dynamic tradeoff, per-channel vs per-tensor sensitivity, symmetric vs asymmetric correctness, weight-only vs activation compression
- **ONNX Export Quirks**: Dynamic shape handling, opset version compatibility, external data format triggers (>2GB), type casting defaults
- **Multi-Pass Ordering**: Pass dependencies (convert before quantize), state preservation, output naming
- **Hardware Quirks**: Execution provider silent fallback, device memory limits, ops not supported on target vendor hardware
- **LoRA Quirks**: Base model frozen state, rank selection guidelines, merging complexity, MultiLoRA experimental status
- **Search Quirks**: Objective conflicts (latency vs accuracy), evaluator cost overhead, reproducibility (seed control), local optima

#### 5. **Integration Recipes** (Common Patterns)

- Quantization-only (QAT-free, fast)
- Aggressive compression (quantize + prune + distill)
- Speed optimization (transform fusing + quantization)
- Mobile deployment (hardware-aware pass selection)
- LoRA fine-tuning (base model lock + adapter training)
- MultiModel serving (multiple LoRA adapters on single base)

#### 6. **Hardware Target Profiles**

```
{
  "target": "NVIDIA RTX 4090",
  "recommended_passes": ["OnnxConversion", "NVModelOptQuantization (AWQ)", "OnnxFloatToFloat16"],
  "execution_provider": "TensorrtExecutionProvider",
  "typical_speedup": "8-15x",
  "calibration_size": 300,
  "ops_supported": [...],
  "known_issues": [...],
  "optimal_batch_size": 32
}
```

#### 7. **Compatibility Matrix** (Model × Pass × Hardware)

```
Mistral 7B (ONNX):
  - OnnxQuantization: ✓ (tested, 15% accuracy drop with INT8)
  - IncQuantization: ✗ (requires PyTorch)
  - LoRA: ⚠ (ONNX limitation: requires model reexport)
  - NVIDIA GPU: ✓ (best with NVModelOptQuantization + TensorRT)
  - Mobile NPU: ⚠ (size 15GB → needs aggressive pruning)
```

---

## IMPLEMENTATION STRATEGY

### Phase 1: Core Toolkit (Week 1)

- [ ] Build tool 1-3 (passes, templates, strategies) with stub data
- [ ] Integrate official Olive docs URLs for source attribution
- [ ] Create quirks reference document (from research + GitHub issues)
- [ ] Test with 5 example agent queries (e.g., "How do I quantize Phi-3 for NVIDIA T4?")

### Phase 2: Knowledge Enrichment (Week 2)

- [ ] Populate pass catalog (40+ passes with full param schemas)
- [ ] Build hardware profile matrix (10+ popular targets)
- [ ] Create compatibility matrix scraper (queries GitHub repos + docs)
- [ ] Add troubleshooting database (20+ common errors)

### Phase 3: Smart Tools (Week 3)

- [ ] Implement pass chain validator (prevents invalid sequences)
- [ ] Build hardware recommender (given constraints, suggest optimal path)
- [ ] Add tradeoff analyzer (predict quality/latency/size impacts)
- [ ] Integrate Olive GitHub issue scraper (keep quirks current)

### Phase 4: Polish & Deployment (Week 4)

- [ ] Add versioning (Olive 0.2.0 → current support)
- [ ] Create agent integration tests (verify tools work in agent context)
- [ ] Document MCP server setup, authentication, hosting
- [ ] Build changelog tracking (watch Olive releases, auto-update quirks)

---

## TECHNICAL STACK

### Recommended

- **Language**: Python (FastMCP) or TypeScript (MCP SDK)
  - Python preferred: Olive is Python-first; easier to parse imports/schema
- **Data Storage**:
  - Embedded: JSON files + Python dataclasses (simplest, self-contained)
  - External: PostgreSQL + pgvector (for future docs search semantic embeddings)
- **Doc Integration**:
  - Fetch from: https://microsoft.github.io/Olive/, GitHub API (releases, issues), ONNX Runtime blog
  - Update strategy: Weekly cron job to refresh from official sources
- **Testing**: pytest, MCP client test harness

### Deliverable Structure

```
olive-mcp-server/
├── mcp_server.py                 # MCP server entry point (FastMCP)
├── tools/
│   ├── pass_catalog.py           # Tool: get_olive_passes
│   ├── config_generator.py       # Tools: get_pass_config_template, get_data_config_template
│   ├── strategy_advisor.py       # Tools: get_quantization_strategy, get_hardware_optimization_guide
│   ├── troubleshooting.py        # Tool: troubleshoot_olive_error
│   ├── compatibility.py          # Tools: get_model_compatibility, get_pass_chain
│   ├── cli_helper.py             # Tool: get_cli_command
│   └── docs_search.py            # Tool: search_olive_documentation
├── knowledge_base/
│   ├── passes.json               # Catalog: 40+ passes with full schemas
│   ├── hardware_profiles.json    # Execution provider + target hardware configs
│   ├── compatibility_matrix.json # Model × Pass × Hardware compatibility
│   ├── quirks_database.json      # Known gotchas, workarounds, limitations
│   ├── integration_recipes.json  # Common workflow patterns
│   └── troubleshooting.json      # Error diagnosis rules + solutions
├── fetchers/
│   ├── official_docs_fetcher.py  # Scrape microsoft.github.io/Olive
│   ├── github_scraper.py         # Fetch latest issues, releases, code
│   └── onnx_runtime_fetcher.py   # ONNX Runtime Olive integration docs
├── tests/
│   ├── test_tools.py             # Unit tests for each tool
│   ├── test_integration.py       # Agent-like query flows
│   └── fixtures/                 # Sample configs, error messages
└── README.md                      # Setup, usage, examples
```

---

## SPECIFIC REQUIREMENTS

### Accuracy & Authority

1. **Never hallucinate pass parameters** - Use official schema from GitHub or docs only
2. **Version awareness** - Clearly state which Olive version info applies to (major quirks in 0.2 vs 0.5 vs current)
3. **Hardware nuance** - Execution provider support ≠ general ONNX support; ATen ops may silently fail on QPU
4. **Quantization gotchas** - Clearly explain: calibration bias risk, algorithm selection criteria, accuracy regression causes
5. **Source attribution** - Every claim links back to: GitHub source, official docs URL, or acknowledged limitation ("empirical observation from community issues")

### Quirk Coverage (Non-Negotiable)

Must handle & explain:

- Why "symmetric per-channel quantization" needed for Qualcomm NPU but optional for NVIDIA
- When to use GPTQ vs AWQ vs HQQ (model architecture, calibration cost, accuracy tradeoff)
- Static quantization "requires representative calibration data matched to inference distribution" - what does this mean operationally?
- Multi-pass ordering pitfalls: "convert before quantize" - what fails if reversed and why?
- LoRA + quantization: which combinations work, which don't, why?
- Hidden layer size regression after quantization: symptom, diagnosis, solution

### Configuration Generation Quality

- Generated configs must be syntactically valid JSON (test against schema)
- All required params included; optional params clearly marked with explanations
- Comments (in separate guidance doc) explaining _why_ each param value chosen
- Include fallback recommendations ("if this fails, try X instead")

### CLI Helper Quality

- Generated commands ready to copy-paste (no placeholders, no guessing)
- Include explanation of each flag
- Common variations documented ("for batch inference, add --batch-size 32")

---

## SUCCESS METRICS

1. **Agent Autonomy**: Agent successfully implements end-to-end Olive workflow (model → optimization → evaluation) with MCP as sole reference (no manual doc lookup)
2. **Accuracy**: 95%+ accuracy on technical claims (validate against official source for every quirk)
3. **Comprehensiveness**: 40+ passes documented, 10+ hardware targets covered, 20+ common errors diagnosed
4. **Latency**: Tool responses <1s (facts cached, no live fetching on request)
5. **Maintainability**: Automatic update mechanism detects Olive releases and flags outdated content

---

## EDGE CASES TO HANDLE

1. **Version Mismatch**: Agent using old Olive version config against current server → surface compatibility warnings
2. **Custom Models**: Models not in compatibility matrix → provide method to "test quantization viability" (guide agent through manual eval)
3. **Exotic Hardware**: Target not in profiles → explain how to profile new hardware + contribute back
4. **Conflicting Objectives**: Latency + accuracy goals incompatible → explain Pareto frontier, suggest tradeoff
5. **Partial Olive Setup**: Agent has some passes installed but not others → detect & recommend available alternatives
6. **Model Loading Failures**: Guide agent through debugging ONNX export failures vs PyTorch model format issues

---

## REFERENCE MATERIALS PROVIDED

See separate attachment: **OLIVE_COMPREHENSIVE_API_REFERENCE.md**

- Complete pass catalog (40+) with all parameters
- Configuration schema (top-level + nested structures)
- Execution provider matrix
- Quirks & special behaviors
- Known limitations & workarounds
- Integration patterns
- Official doc links

---

## DEPLOYMENT & OPERATIONS

### Hosting

- Option A: Standalone Python process (simplest, no auth required)
- Option B: Docker container (reproducible environment)
- Option C: Serverless function (Azure Functions / AWS Lambda)

### Update Strategy

1. **Weekly check**: GitHub Releases, official docs changelog
2. **On new Olive release**: Parse release notes, update quirks DB, flag deprecations
3. **Community feedback**: Monitor GitHub issues for new quirks, add to database
4. **Agent feedback loop**: Log agent queries that generated poor answers → manual review → knowledge base fix

### Observability

- Log all agent queries (anon) + response quality feedback
- Track tool latency (ensure <1s)
- Alert on doc fetcher failures (Olive site down, schema change)

---

## OPEN QUESTIONS FOR CLARIFICATION

Before implementation, confirm:

1. **Scope of custom evaluation metrics support?** (Just predict, or guide agents to implement?)
2. **MultiLoRA support level?** (Olive MultiLoRA still experimental; document risks?)
3. **Version support window?** (Current + 1 prior version, or further back?)
4. **Integration with ONNX Runtime separately?** (Or treat as Olive sub-component?)
5. **Community contribution model?** (Accept quirk submissions from agent developers?)

---

## TIMELINE

- **Weeks 1-2**: Phase 1-2, MVP ready for testing
- **Week 3**: Phase 3, advanced features
- **Week 4**: Polish, docs, deployment
- **Ongoing**: Maintenance & updates

---

## ACCEPTANCE CRITERIA

Server is production-ready when:

- ✅ All 12 tools functional & tested
- ✅ 40+ passes documented with complete parameter schemas
- ✅ 10+ hardware profiles with execution provider mapping
- ✅ 20+ troubleshooting entries with working solutions
- ✅ Agent can independently: quantize LLM for GPU, optimize CNN for mobile, set up LoRA fine-tuning
- ✅ Documentation complete (README, tool examples, troubleshooting guide)
- ✅ Automated update system running (watch Olive releases, flag changes)
