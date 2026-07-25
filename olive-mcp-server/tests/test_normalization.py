"""Tests for normalization helpers."""

import pytest

from olive_mcp_server.tools.normalization import (
    normalize_framework,
    normalize_hardware,
    normalize_model,
)


@pytest.mark.parametrize(
    ("input", "expected"),
    [
        ("torch", "PyTorch"),
        ("PyTorch", "PyTorch"),
        ("hf", "PyTorch"),
        ("HuggingFace", "PyTorch"),
        ("onnx", "ONNX"),
        ("tf", "TensorFlow"),
        ("TensorFlow", "TensorFlow"),
        ("tflite", "tflite"),
    ],
)
def test_normalize_framework(input: str, expected: str) -> None:
    assert normalize_framework(input) == expected


@pytest.mark.parametrize(
    ("input", "expected"),
    [
        ("mistralai/Mistral-7B-v0.1", "Mistral 7B"),
        ("Mistral-7B-Instruct", "Mistral 7B"),
        ("microsoft/phi-3-mini", "Phi-3-mini"),
        ("phi3-mini", "Phi-3-mini"),
        ("microsoft/Phi-4", "Phi-4"),
        ("phi4-mini", "Phi-4"),
        ("resnet-101", "ResNet-50"),
        ("openai/whisper-base", "Whisper"),
        ("meta-llama/Meta-Llama-3-8B", "Llama 3 8B"),
        ("llama-3-8b-instruct", "Llama 3 8B"),
        ("meta-llama/Llama-2-7b-hf", "Llama 2 7B"),
        ("llama2-7b", "Llama 2 7B"),
        ("codellama/CodeLlama-7b-Instruct-hf", "CodeLlama 7B"),
        ("code-llama-7b", "CodeLlama 7B"),
        ("deepseek-ai/DeepSeek-R1-Distill-Llama-8B", "DeepSeek-R1-Distill-Llama 8B"),
        ("deepseek-r1-8b", "DeepSeek-R1-Distill-Llama 8B"),
        ("compvis/stable-diffusion-v1-4", "Stable Diffusion v1.4"),
        ("stable-diffusion", "Stable Diffusion v1.4"),
        ("google-bert/bert-base-uncased", "BERT-base"),
        ("bert-base", "BERT-base"),
        ("unrelated-model", "unrelated-model"),
    ],
)
def test_normalize_model(input: str, expected: str) -> None:
    assert normalize_model(input) == expected


def test_normalize_model_no_false_substring_match() -> None:
    """A name that merely contains an alias as part of a larger token should not match."""
    assert normalize_model("mymistralmodel") == "mymistralmodel"


@pytest.mark.parametrize(
    ("input", "expected"),
    [
        ("NVIDIA RTX 4090", "NVIDIA RTX 4090"),
        ("nvidia rtx 4090", "NVIDIA RTX 4090"),
        ("RTX 4090", "NVIDIA RTX 4090"),
        ("NVIDIA RTX 4090 Super", "NVIDIA RTX 4090"),
        ("T4", "NVIDIA T4"),
    ],
)
def test_normalize_hardware(input: str, expected: str) -> None:
    assert normalize_hardware(input) == expected


def test_normalize_hardware_unknown() -> None:
    assert normalize_hardware("MadeUpChip 9000") == "MadeUpChip 9000"
