import { UIState } from "@/types";

export interface RecipeItem {
  name: string;
  architecture: string;
  device: string;
  repoPath: string;
  description: string;
  state: Partial<UIState>;
  json: any;
}

export const SUGGESTED_RECIPES: RecipeItem[] = [
  {
    name: "Llama-3-8B AWQ GPU Pass",
    architecture: "Llama",
    device: "CUDA",
    repoPath: "examples/llama3",
    description: "Configures 4-bit dynamic AWQ quantization & OnnxConversion optimized for CUDA GPUs.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "meta-llama/Meta-Llama-3-8B",
      ihvProvider: "CUDAExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 17,
        conversionInputTargetTypes: "float16",
        quantization: true,
        quantMethod: "awq" as const,
        quantPrecision: "int4" as const,
        pruning: false,
        pruningSparsity: 0.5,
        pruningType: "unstructured" as const,
        pruningMethod: "sparsegpt" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: true,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "meta-llama/Meta-Llama-3-8B",
            "task": "text-generation"
          }
        }
      },
      "passes": {
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 17, "precision": "float16" }
        },
        "quantization": {
          "type": "OnnxQuantization",
          "config": { "weight_type": "int4", "algorithm": "awq", "optimize_model": true }
        },
        "transformers_optimization": {
          "type": "OrtTransformersOptimization",
          "config": { "model_type": "gpt2", "use_gpu": true }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "joint" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "Phi-3-Mini DirectML NPU",
    architecture: "Phi",
    device: "DirectML",
    repoPath: "examples/phi3",
    description: "Optimizes Microsoft Phi-3-Mini Transformer model using float16 DirectML compilation for Windows Copilot+ PC NPUs.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "microsoft/Phi-3-mini-4k-instruct",
      ihvProvider: "CPUExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 16,
        conversionInputTargetTypes: "float16",
        quantization: true,
        quantMethod: "ptq" as const,
        quantPrecision: "int4" as const,
        pruning: false,
        pruningSparsity: 0.2,
        pruningType: "structured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: true,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "microsoft/Phi-3-mini-4k-instruct",
            "task": "text-generation"
          }
        }
      },
      "passes": {
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 16, "precision": "float16" }
        },
        "quantization": {
          "type": "OnnxQuantization",
          "config": { "weight_type": "int4", "optimize_model": true }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "serial" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "Stable Diffusion UNet TensorRT",
    architecture: "Stable Diffusion",
    device: "TensorRT",
    repoPath: "examples/stable_diffusion",
    description: "Optimized workflow for SD 1.5 UNet engine compiling with TensorRT EP to yield high-speed image generation rates.",
    state: {
      modelSource: "local" as const,
      localFiles: [{ name: "unet_weights.pt", size: 3400000000 }],
      ihvProvider: "TensorrtExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 16,
        conversionInputTargetTypes: "float16",
        quantization: false,
        quantMethod: "ptq" as const,
        quantPrecision: "int8" as const,
        pruning: false,
        pruningSparsity: 0.3,
        pruningType: "unstructured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: false,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "model_path": "./local_models",
          "local_files": ["unet_weights.pt"]
        }
      },
      "passes": {
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 16, "precision": "float16" }
        },
        "tensorrt_opt": {
          "type": "TensorRTOptimization",
          "config": { "fp16": true }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "joint" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "Whisper-Large INT8 CPU Target",
    architecture: "Whisper",
    device: "CPU",
    repoPath: "examples/whisper",
    description: "Fully converts and quantizes Whisper-Large v3 weights into efficient 8-bit model suitable for standard x86 CPU platforms.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "openai/whisper-large-v3",
      ihvProvider: "CPUExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 15,
        conversionInputTargetTypes: "float32",
        quantization: true,
        quantMethod: "ptq" as const,
        quantPrecision: "int8" as const,
        pruning: false,
        pruningSparsity: 0.3,
        pruningType: "unstructured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: true,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "openai/whisper-large-v3",
            "task": "speech-recognition"
          }
        }
      },
      "passes": {
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 15, "precision": "float32" }
        },
        "quantization": {
          "type": "OnnxQuantization",
          "config": { "weight_type": "int8" }
        },
        "transformers_optimization": {
          "type": "OrtTransformersOptimization",
          "config": { "model_type": "whisper", "use_gpu": false }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "serial" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "Qwen-2.5-7B QLoRA Adapter GPU",
    architecture: "Qwen",
    device: "CUDA",
    repoPath: "examples/qwen25_qlora",
    description: "Compiles Qwen 2.5 Causal LLM equipped with PEFT/QLoRA adapters and integrates dynamic quantization for server-grade GPUs.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "Qwen/Qwen2.5-7B-Instruct",
      ihvProvider: "CUDAExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 17,
        conversionInputTargetTypes: "float16",
        quantization: true,
        quantMethod: "qat" as const,
        quantPrecision: "fp16" as const,
        pruning: false,
        pruningSparsity: 0.0,
        pruningType: "unstructured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: true,
        peft: true,
        peftMethod: "qlora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "Qwen/Qwen2.5-7B-Instruct",
            "task": "text-generation"
          }
        }
      },
      "passes": {
        "peft": {
          "type": "QLoRA",
          "config": { "lora_r": 16, "lora_alpha": 32 }
        },
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 17, "precision": "float16" }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "serial" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "MobileNet-V2 QNN Snapdragon NPU",
    architecture: "MobileNet",
    device: "QNN",
    repoPath: "examples/mobilenetv2_qnn",
    description: "Configures structured pruning and static quantization for Snapdragon NPUs utilizing Qualcomm QNN provider optimization.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "google/mobilenet_v2_1.0_224",
      ihvProvider: "QNNExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 14,
        conversionInputTargetTypes: "float32",
        quantization: true,
        quantMethod: "ptq" as const,
        quantPrecision: "int8" as const,
        pruning: true,
        pruningSparsity: 0.3,
        pruningType: "structured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l2_norm" as const,
        splitting: false,
        onnxTransforms: true,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "google/mobilenet_v2_1.0_224",
            "task": "image-classification"
          }
        }
      },
      "passes": {
        "pruning": {
          "type": "Pruning",
          "config": { "amount": 0.30, "method": "l2_norm" }
        },
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 14, "precision": "float32" }
        },
        "quantization": {
          "type": "OnnxQuantization",
          "config": { "weight_type": "int8" }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "serial" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "ResNet-50 OpenVINO Intel Edge CPU",
    architecture: "ResNet",
    device: "OpenVINO",
    repoPath: "examples/resnet50_openvino",
    description: "Applies 8-bit quantization and graphs optimizations for ResNet-50 targeting high throughput on Intel Xeon Edge Core processors.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "microsoft/resnet-50",
      ihvProvider: "OpenVINOExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "openvino" as const,
        conversionOpset: 15,
        conversionInputTargetTypes: "float32",
        quantization: true,
        quantMethod: "ptq" as const,
        quantPrecision: "int8" as const,
        pruning: false,
        pruningSparsity: 0.0,
        pruningType: "unstructured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: false,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "microsoft/resnet-50",
            "task": "image-classification"
          }
        }
      },
      "passes": {
        "openvino_converter": {
          "type": "OpenVINOConversion",
          "config": { "output_precision": "FP32" }
        },
        "openvino_quantization": {
          "type": "OpenVINOQuantization",
          "config": { "preset": "performance" }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "serial" },
        "cache_dir": "~/.cache/olive"
      }
    }
  },
  {
    name: "BERT Transformer NLP Pruning CPU",
    architecture: "BERT",
    device: "CPU",
    repoPath: "examples/bert",
    description: "Provides pre-configured magnitude pruning at 50% sparsity to compress standard BERT encoder architectures.",
    state: {
      modelSource: "huggingface" as const,
      hfModelId: "bert-base-uncased",
      ihvProvider: "CPUExecutionProvider" as const,
      passes: {
        conversion: true,
        conversionSourceFormat: "pytorch" as const,
        conversionFormat: "onnx" as const,
        conversionOpset: 14,
        conversionInputTargetTypes: "float32",
        quantization: false,
        quantMethod: "ptq" as const,
        quantPrecision: "int8" as const,
        pruning: true,
        pruningSparsity: 0.5,
        pruningType: "unstructured" as const,
        pruningMethod: "magnitude" as const,
        pruningCriteria: "l1_norm" as const,
        splitting: false,
        onnxTransforms: false,
        peft: false,
        peftMethod: "lora" as const,
        diffusionLora: false
      }
    },
    json: {
      "input_model": {
        "type": "PyTorchModel",
        "config": {
          "hf_config": {
            "model_name": "bert-base-uncased",
            "task": "fill-mask"
          }
        }
      },
      "passes": {
        "conversion": {
          "type": "OnnxConversion",
          "config": { "target_opset": 14, "precision": "float32" }
        },
        "pruning": {
          "type": "Prune",
          "config": { "sparsity": 0.5, "pruning_criteria": "l1" }
        }
      },
      "engine": {
        "search_strategy": { "execution_order": "joint" },
        "cache_dir": "~/.cache/olive"
      }
    }
  }
];
