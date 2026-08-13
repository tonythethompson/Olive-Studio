---
name: calibration-data
description: Configure calibration and evaluation datasets for Olive quantization. Use when setting up data pipelines for PTQ calibration, accuracy evaluation, or when the user asks about dataset preparation for optimization.
---

# Calibration & Evaluation Data Configuration

Quantization accuracy depends heavily on calibration data quality. This skill covers how to configure data pipelines for Olive optimization using the MCP tools.

## When You Need Calibration Data

| Quantization Method | Calibration Required | Notes |
|--------------------|--------------------|-------|
| PTQ (Static) | Yes — always | Activations profiled on real data |
| PTQ (Dynamic) | No | Quantization ranges computed at runtime |
| AWQ | Yes — always | Activation-aware weight quantization |
| GPTQ | Yes — always | Gradient-based weight rounding |
| HQQ | No | Half-Quadratic Quantization is data-free |
| RTN | No | Round-to-nearest is data-free |
| QAT | Yes — training data | Quantization-aware fine-tuning |
| SpinQuant | Yes — always | Rotation calibration |
| QuaRot | Yes — always | Rotation calibration |

## Quick Start: Get a Data Config Template

```
Tool: get_data_config_template
Input: { "data_source": "huggingface", "task": "calibration" }
```

This generates a complete DataConfig JSON with preprocessing, sampling, and batching settings.

### Available data sources:
- `"huggingface"` — Load from HuggingFace Hub datasets
- `"local_files"` — Local JSON/CSV/Parquet files
- `"image_folder"` — Directory of images (for vision models)

### Available tasks:
- `"calibration"` — Subset for quantization calibration (typically 128-512 samples)
- `"evaluation"` — Full evaluation set for accuracy measurement

## HuggingFace Dataset Configuration

For LLMs (most common):

```json
{
  "data_configs": [
    {
      "name": "calibration_data",
      "type": "HuggingFaceContainer",
      "load_dataset_config": {
        "path": "wikitext",
        "subset": "wikitext-2-raw-v1",
        "split": "train"
      },
      "pre_process_data_config": {
        "input_cols": ["text"],
        "label_cols": ["label"],
        "padding": "max_length",
        "max_length": 2048,
        "normalization": "none"
      },
      "dataloader_config": {
        "batch_size": 1,
        "drop_last": false,
        "num_workers": 0
      },
      "sampling": 256
    }
  ]
}
```

For vision models:

```json
{
  "data_configs": [
    {
      "name": "calibration_data",
      "type": "HuggingFaceContainer",
      "load_dataset_config": {
        "path": "imagenet-1k",
        "subset": "default",
        "split": "validation"
      },
      "pre_process_data_config": {
        "input_cols": ["image"],
        "label_cols": ["label"],
        "padding": "max_length",
        "max_length": 512,
        "normalization": "ImageNet"
      },
      "dataloader_config": {
        "batch_size": 8,
        "drop_last": false,
        "num_workers": 0
      },
      "sampling": 512
    }
  ]
}
```

## Local File Configuration

```json
{
  "data_configs": [
    {
      "name": "calibration_data",
      "type": "DataContainer",
      "load_dataset_config": {
        "data_dir": "./calibration_samples/",
        "data_files": ["train.json"]
      },
      "pre_process_data_config": {
        "input_cols": ["input_ids", "attention_mask"],
        "label_cols": ["labels"],
        "normalization": "custom"
      },
      "dataloader_config": {
        "batch_size": 1,
        "drop_last": false,
        "num_workers": 0
      },
      "sampling": 256
    }
  ]
}
```

## Image Folder Configuration

```json
{
  "data_configs": [
    {
      "name": "calibration_data",
      "type": "ImageNetContainer",
      "load_dataset_config": {
        "data_dir": "./calibration_images/"
      },
      "pre_process_data_config": {
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "input_size": [224, 224],
        "interpolation": "bilinear",
        "normalization": "ImageNet"
      },
      "dataloader_config": {
        "batch_size": 8,
        "drop_last": false,
        "num_workers": 0
      },
      "sampling": 512
    }
  ]
}
```

## Calibration Best Practices

### Sample Count Guidelines

| Model Size | Recommended Samples | Rationale |
|-----------|--------------------|-----------| 
| Small (<1B params) | 128-256 | Fast calibration, sufficient coverage |
| Medium (1-7B params) | 256-512 | Balance of accuracy and time |
| Large (7-70B params) | 128-256 | Memory constraints; quality plateaus early |
| Vision (any) | 256-1024 | More diversity needed for spatial features |

### Data Quality Rules

1. **Representative data** — Use data similar to inference workload (not random noise)
2. **Diverse inputs** — Cover the range of expected inputs (short/long, simple/complex)
3. **Clean data** — Remove corrupt entries, empty strings, broken images
4. **Correct tokenization** — Match the model's tokenizer and max sequence length
5. **No training data leakage** — Use validation/test splits for calibration, not training data

### Sequence Length

- **LLMs:** Set `max_length` to the model's context window or your expected max usage
- **Common values:** 2048 (Llama-2), 4096 (Llama-3), 8192 (Mistral)
- **Shorter is faster** but may miss long-range dependency calibration
- **Rule of thumb:** Use at least 512 tokens per sample for LLMs

### Batch Size

- `batch_size: 1` is safest for large models (avoids OOM during calibration)
- Increase to 4-8 for small models or when VRAM is abundant
- Calibration batch size does NOT affect final model quality — only speed

## Evaluation Data Configuration

Evaluation is separate from calibration — used to measure accuracy post-quantization:

```json
{
  "evaluators": {
    "common_evaluator": {
      "metrics": [
        {
          "name": "perplexity",
          "type": "perplexity",
          "data_config": {
            "name": "eval_data",
            "type": "HuggingFaceContainer",
            "load_dataset_config": {
              "path": "wikitext",
              "subset": "wikitext-2-raw-v1",
              "split": "test"
            },
            "dataloader_config": {
              "batch_size": 1,
              "drop_last": false,
              "num_workers": 0
            }
          }
        }
      ]
    }
  }
}
```

### Common evaluation metrics:
- **perplexity** — LLM text quality (lower is better)
- **accuracy** — Classification models
- **latency** — Inference speed (ms/token or ms/image)
- **model_size** — Compressed model size on disk

## Troubleshooting

### "Calibration dataset is empty"
- Check `path` and `subset` are correct for the HuggingFace dataset
- Verify `split` exists (try "train", "validation", "test")
- Ensure `num_samples` is not larger than the dataset

### "Tokenizer mismatch"
- The calibration data must be tokenized with the SAME tokenizer as the model
- Set `tokenizer_id` explicitly if auto-detection fails

### "CUDA OOM during calibration"
- Reduce `batch_size` to 1
- Reduce `max_length` (try 1024 or 512)
- Reduce `num_samples` (128 minimum for reasonable calibration)

### "Calibration takes too long"
- Reduce `num_samples` — 128 is often sufficient for INT8
- For INT4 (AWQ/GPTQ), 256 samples provides good results
- Use a faster split (train is often larger than needed)

## Related Tools

| Tool | Use For |
|------|---------|
| `get_data_config_template` | Generate a complete data config from scratch |
| `get_quantization_strategy` | Includes calibration recommendations for method |
| `get_integration_recipe` | Pre-built recipes include data configs |
| `search_olive_documentation` | Search for dataset-specific guidance |
