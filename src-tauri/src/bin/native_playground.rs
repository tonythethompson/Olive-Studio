use std::collections::HashMap;
use std::io::{self, BufRead, Write};
use std::path::Path;
use std::time::Instant;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

use ort::execution_providers::{
    CPUExecutionProvider, CoreMLExecutionProvider, CUDAExecutionProvider,
    DirectMLExecutionProvider, ExecutionProvider, ExecutionProviderDispatch,
    OneDNNExecutionProvider, OpenVINOExecutionProvider, TensorRTExecutionProvider,
};
use ort::session::Session;
use ort::value::{DynValue, Tensor};

// ---------------------------------------------------------------------------
// JSON protocol
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct Request {
    model_path: String,
    #[serde(default)]
    execution_provider: Option<String>,
    #[serde(default)]
    inputs: HashMap<String, InputTensor>,
    #[serde(default)]
    default_input: Option<InputTensor>,
    #[serde(default = "default_warmup")]
    warmup_iterations: usize,
    #[serde(default = "default_iterations")]
    iterations: usize,
    #[serde(default = "default_batch_size")]
    batch_size: usize,
    #[serde(default = "default_include_outputs")]
    include_outputs: bool,
}

#[derive(Debug, Deserialize)]
struct InputTensor {
    dtype: String,
    dims: Vec<usize>,
    #[serde(default)]
    data: Vec<f64>,
}

#[derive(Debug, Serialize)]
struct Response {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    ep_used: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    session_create_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    latencies_ms: Option<Vec<f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    avg_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    min_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    p50_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    p99_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    throughput_per_sec: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_shapes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output_preview: Option<String>,
}

fn default_warmup() -> usize {
    0
}

fn default_iterations() -> usize {
    1
}

fn default_batch_size() -> usize {
    1
}

fn default_include_outputs() -> bool {
    false
}

fn error_response(msg: String) -> Response {
    Response {
        ok: false,
        error: Some(msg),
        ep_used: None,
        session_create_ms: None,
        latencies_ms: None,
        avg_ms: None,
        min_ms: None,
        max_ms: None,
        p50_ms: None,
        p99_ms: None,
        throughput_per_sec: None,
        output_shapes: None,
        output_preview: None,
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = line.context("failed to read stdin")?;
        if line.trim().is_empty() {
            continue;
        }

        let req: Request = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                write_response(
                    &mut stdout,
                    error_response(format!("Invalid request JSON: {e}")),
                )?;
                continue;
            }
        };

        let resp = match handle_request(req) {
            Ok(r) => r,
            Err(e) => error_response(format!("{e:#}")),
        };
        write_response(&mut stdout, resp)?;
    }

    Ok(())
}

fn write_response(out: &mut dyn Write, resp: Response) -> Result<()> {
    let json = serde_json::to_string(&resp)?;
    writeln!(out, "{json}")?;
    out.flush()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

fn handle_request(req: Request) -> Result<Response> {
    if !Path::new(&req.model_path).is_file() {
        bail!("model file not found: {}", req.model_path);
    }

    if req.iterations == 0 {
        bail!("iterations must be > 0");
    }

    let (ep_name, eps) = build_eps(req.execution_provider.as_deref())?;

    let session_start = Instant::now();
    let mut session = Session::builder()?
        .with_execution_providers(&eps)?
        .commit_from_file(&req.model_path)?;
    let session_create_ms = session_start.elapsed().as_secs_f64() * 1000.0;

    // Warmup.
    for _ in 0..req.warmup_iterations {
        let inputs = build_input_values(&session, &req.inputs, req.default_input.as_ref())?;
        let _ = session.run(inputs)?;
    }

    // Timed runs.
    let mut latencies = Vec::with_capacity(req.iterations);

    for _ in 0..req.iterations {
        let inputs = build_input_values(&session, &req.inputs, req.default_input.as_ref())?;
        let start = Instant::now();
        let outputs = session.run(inputs)?;
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        latencies.push(elapsed);
        drop(outputs);
    }

    // One final untimed run to capture output shapes and a preview.
    let (output_shapes, output_preview) = {
        let inputs = build_input_values(&session, &req.inputs, req.default_input.as_ref())?;
        let outputs = session.run(inputs)?;
        let description = describe_outputs(&outputs, req.include_outputs)?;
        drop(outputs);
        description
    };

    let stats = compute_stats(&latencies, req.batch_size);

    Ok(Response {
        ok: true,
        error: None,
        ep_used: Some(ep_name),
        session_create_ms: Some(session_create_ms),
        latencies_ms: Some(latencies),
        avg_ms: Some(stats.avg),
        min_ms: Some(stats.min),
        max_ms: Some(stats.max),
        p50_ms: Some(stats.p50),
        p99_ms: Some(stats.p99),
        throughput_per_sec: Some(stats.throughput),
        output_shapes,
        output_preview,
    })
}

// ---------------------------------------------------------------------------
// Input tensors
// ---------------------------------------------------------------------------

fn build_input_values(
    session: &Session,
    inputs: &HashMap<String, InputTensor>,
    default_input: Option<&InputTensor>,
) -> Result<HashMap<String, DynValue>> {
    let mut result = HashMap::with_capacity(session.inputs.len());
    for input in &session.inputs {
        let tensor = inputs.get(&input.name).or(default_input).with_context(|| {
            format!("missing input tensor: {}", input.name)
        })?;
        let value = build_tensor(tensor)?;
        result.insert(input.name.clone(), value);
    }
    Ok(result)
}

fn build_tensor(input: &InputTensor) -> Result<DynValue> {
    let expected = input.dims.iter().product::<usize>();
    if expected != input.data.len() {
        bail!(
            "input data length {} does not match shape {:?}",
            input.data.len(),
            input.dims
        );
    }

    let value: DynValue = match input.dtype.as_str() {
        "float32" | "f32" | "float" => {
            let data: Vec<f32> = input.data.iter().map(|&v| v as f32).collect();
            Tensor::from_array((input.dims.clone(), data))?.into()
        }
        "float64" | "f64" | "double" => {
            let data: Vec<f64> = input.data.clone();
            Tensor::from_array((input.dims.clone(), data))?.into()
        }
        "int64" | "i64" | "long" => {
            let data: Vec<i64> = input.data.iter().map(|&v| v as i64).collect();
            Tensor::from_array((input.dims.clone(), data))?.into()
        }
        "int32" | "i32" | "int" => {
            let data: Vec<i32> = input.data.iter().map(|&v| v as i32).collect();
            Tensor::from_array((input.dims.clone(), data))?.into()
        }
        "uint8" | "u8" | "byte" => {
            let data: Vec<u8> = input.data.iter().map(|&v| v as u8).collect();
            Tensor::from_array((input.dims.clone(), data))?.into()
        }
        other => bail!("unsupported input dtype: {}", other),
    };

    Ok(value)
}

// ---------------------------------------------------------------------------
// Execution providers
// ---------------------------------------------------------------------------

macro_rules! try_push_ep {
    ($names:expr, $eps:expr, $ep:expr) => {
        {
            let ep = $ep;
            if ep.is_available().unwrap_or(false) {
                let name = ep.name().to_string();
                $eps.push(ep.build());
                $names.push(name);
            }
        }
    };
}

fn build_eps(
    requested: Option<&str>,
) -> Result<(String, Vec<ExecutionProviderDispatch>)> {
    let requested = requested.map(|s| s.to_lowercase()).unwrap_or_default();
    let mut names: Vec<String> = Vec::new();
    let mut eps: Vec<ExecutionProviderDispatch> = Vec::new();

    match requested.as_str() {
        "cuda" | "cudaexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, CUDAExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "tensorrt" | "tensorrtexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, TensorRTExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CUDAExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "directml" | "directmlexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, DirectMLExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "openvino" | "openvinoexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, OpenVINOExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "coreml" | "coremlexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, CoreMLExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "onednn" | "onednnexecutionprovider" => {
            try_push_ep!(&mut names, &mut eps, OneDNNExecutionProvider::default());
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        "cpu" | "cpuexecutionprovider" | "" => {
            try_push_ep!(&mut names, &mut eps, CPUExecutionProvider::default());
        }
        other => bail!("unsupported execution provider: {}", other),
    }

    let ep_name = names
        .first()
        .cloned()
        .unwrap_or_else(|| CPUExecutionProvider::default().name().to_string());
    Ok((ep_name, eps))
}

// ---------------------------------------------------------------------------
// Output description
// ---------------------------------------------------------------------------

fn describe_outputs(
    outputs: &ort::session::SessionOutputs,
    _include_outputs: bool,
) -> Result<(Option<Vec<String>>, Option<String>)> {
    let mut shapes = Vec::new();
    let mut preview = None;

    for (name, value) in outputs.iter() {
        let shape = value.shape();
        let dims = shape
            .iter()
            .map(|d| d.to_string())
            .collect::<Vec<_>>()
            .join(", ");
        shapes.push(format!("{}: [{}]", name, dims));

        if preview.is_none() {
            preview = extract_preview(&value);
        }
    }

    Ok((Some(shapes), preview))
}

fn extract_preview(value: &DynValue) -> Option<String> {
    if let Ok((shape, data)) = value.try_extract_tensor::<f32>() {
        Some(format_preview(shape, data, |v| format!("{:.4}", v)))
    } else if let Ok((shape, data)) = value.try_extract_tensor::<f64>() {
        Some(format_preview(shape, data, |v| format!("{:.4}", v)))
    } else if let Ok((shape, data)) = value.try_extract_tensor::<i64>() {
        Some(format_preview(shape, data, |v| v.to_string()))
    } else if let Ok((shape, data)) = value.try_extract_tensor::<i32>() {
        Some(format_preview(shape, data, |v| v.to_string()))
    } else if let Ok((shape, data)) = value.try_extract_tensor::<u8>() {
        Some(format_preview(shape, data, |v| v.to_string()))
    } else {
        None
    }
}

fn format_preview<T: Copy + std::fmt::Display>(
    shape: &ort::tensor::Shape,
    data: &[T],
    fmt: impl Fn(T) -> String,
) -> String {
    let dims = shape
        .iter()
        .map(|d| d.to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let values: Vec<String> = data.iter().take(8).map(|&v| fmt(v)).collect();
    let suffix = if data.len() > 8 { ", ..." } else { "" };
    format!("[{}{}] (shape: [{}])", values.join(", "), suffix, dims)
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

struct Stats {
    avg: f64,
    min: f64,
    max: f64,
    p50: f64,
    p99: f64,
    throughput: f64,
}

fn compute_stats(latencies: &[f64], batch_size: usize) -> Stats {
    if latencies.is_empty() {
        return Stats {
            avg: 0.0,
            min: 0.0,
            max: 0.0,
            p50: 0.0,
            p99: 0.0,
            throughput: 0.0,
        };
    }

    let sum: f64 = latencies.iter().sum();
    let avg = sum / latencies.len() as f64;
    let min = *latencies
        .iter()
        .min_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(&0.0);
    let max = *latencies
        .iter()
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(&0.0);

    let mut sorted = latencies.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

    let p50 = percentile(&sorted, 0.5);
    let p99 = percentile(&sorted, 0.99);
    let throughput = if avg > 0.0 {
        (1000.0 / avg) * batch_size as f64
    } else {
        0.0
    };

    Stats {
        avg,
        min,
        max,
        p50,
        p99,
        throughput,
    }
}

fn percentile(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = (p * (sorted.len() - 1) as f64).floor() as usize;
    sorted[idx.clamp(0, sorted.len() - 1)]
}
