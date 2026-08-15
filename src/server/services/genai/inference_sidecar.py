"""
ONNX Runtime GenAI inference sidecar for Olive Studio.

Accepts JSON requests on stdin (one per line) and streams NDJSON token responses.
Designed to be spawned by the Node.js Express server as a long-running child process.

Protocol:
  Input (stdin, one JSON line):
    {"id": "<request-id>", "system": "...", "messages": [...], "max_tokens": 2048}

  Output (stdout, NDJSON):
    {"id": "<request-id>", "type": "token", "text": "Hello"}
    {"id": "<request-id>", "type": "token", "text": " world"}
    {"id": "<request-id>", "type": "done", "text": ""}
    {"id": "<request-id>", "type": "error", "error": "..."}

  Special commands:
    {"command": "health"}  → {"status": "ok", "model": "..."}
    {"command": "shutdown"} → exits cleanly

Environment:
  GENAI_MODEL_PATH — path to the ONNX model directory (must contain genai_config.json)
  GENAI_EXECUTION_PROVIDER — "cpu", "cuda", or "dml" (default: "cpu")
  GENAI_MAX_TOKENS — default max tokens (default: 2048)
"""

import json
import os
import sys
import traceback

def main():
    model_path = os.environ.get("GENAI_MODEL_PATH", "")
    if not model_path:
        emit_error("startup", "GENAI_MODEL_PATH environment variable not set")
        sys.exit(1)

    if not os.path.isdir(model_path):
        emit_error("startup", f"Model directory not found: {model_path}")
        sys.exit(1)

    # Import after env validation to give clear errors before heavy import
    try:
        import onnxruntime_genai as og
    except ImportError as e:
        emit_error("startup", f"onnxruntime-genai not installed: {e}")
        sys.exit(1)

    # Determine execution provider
    ep = os.environ.get("GENAI_EXECUTION_PROVIDER", "cpu").lower()
    default_max_tokens = int(os.environ.get("GENAI_MAX_TOKENS", "2048"))

    # Load model
    try:
        emit_status("loading", f"Loading model from {model_path}...")
        config = og.Config(model_path)
        if ep != "follow_config":
            config.clear_providers()
            if ep == "cuda":
                config.append_provider("cuda")
            elif ep == "dml":
                config.append_provider("dml")
            else:
                config.append_provider("cpu")
        model = og.Model(config)
        tokenizer = og.Tokenizer(model)
        emit_status("ready", f"Model loaded ({ep})")
    except Exception as e:
        emit_error("startup", f"Failed to load model: {e}")
        sys.exit(1)

    # Main loop: read JSON lines from stdin
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            request = json.loads(line)
        except json.JSONDecodeError as e:
            emit_error("parse", f"Invalid JSON: {e}")
            continue

        # Handle commands
        if "command" in request:
            handle_command(request, model_path, ep)
            continue

        # Handle inference requests
        request_id = request.get("id", "unknown")
        try:
            process_inference(
                request_id=request_id,
                request=request,
                model=model,
                tokenizer=tokenizer,
                model_path=model_path,
                default_max_tokens=default_max_tokens,
            )
        except Exception as e:
            emit_error(request_id, f"Inference failed: {e}")
            if os.environ.get("GENAI_DEBUG"):
                traceback.print_exc(file=sys.stderr)


def process_inference(request_id, request, model, tokenizer, model_path, default_max_tokens):
    """Process a single inference request with streaming token output."""
    import onnxruntime_genai as og

    # A decode stream carries partial multi-byte/sub-word state, so each
    # request must get a fresh one — reusing it across requests corrupts text.
    token_stream = tokenizer.create_stream()

    system = request.get("system", "You are a helpful assistant.")
    messages = request.get("messages", [])
    max_tokens = request.get("max_tokens", default_max_tokens)
    temperature = request.get("temperature", 0.7)
    top_p = request.get("top_p", 0.9)

    # Build prompt using chat template format
    prompt = build_chat_prompt(model_path, system, messages)

    # Encode prompt first: max_length is the TOTAL sequence length (prompt +
    # completion), so it must include the prompt tokens or replies truncate.
    input_tokens = tokenizer.encode(prompt)

    # Set up generation parameters
    params = og.GeneratorParams(model)
    params.set_search_options(
        max_length=len(input_tokens) + max_tokens,
        temperature=temperature,
        top_p=top_p,
    )

    # Create generator and feed prompt
    generator = og.Generator(model, params)
    generator.append_tokens(input_tokens)

    # Generate tokens one at a time, streaming each
    token_count = 0
    try:
        while not generator.is_done():
            generator.generate_next_token()
            new_token = generator.get_next_tokens()[0]
            token_text = token_stream.decode(new_token)
            emit({"id": request_id, "type": "token", "text": token_text})
            token_count += 1
    except KeyboardInterrupt:
        pass

    emit({"id": request_id, "type": "done", "text": "", "token_count": token_count})


def detect_template_style(model_path: str) -> str:
    """
    Detect the chat template style from the model's genai_config.json.

    Returns "chatml" for Qwen-style models (<|im_start|>role ... <|im_end|>)
    and "phi" for Phi-style models (<|role|> ... <|end|>). Falls back to
    "chatml" when the config is unreadable — the catalog default model
    (qwen2.5-coder) is ChatML.
    """
    try:
        with open(os.path.join(model_path, "genai_config.json"), "r", encoding="utf-8") as f:
            config_text = f.read()
    except OSError:
        return "chatml"
    if "im_start" in config_text or "qwen" in model_path.lower():
        return "chatml"
    return "phi"


def build_chat_prompt(model_path: str, system: str, messages: list) -> str:
    """
    Build a chat prompt string from system + messages.

    Selects the template from the model's genai_config.json: ChatML for the
    catalog default (Qwen2.5) and Phi-style otherwise.
    """
    style = detect_template_style(model_path)
    parts = []

    if style == "chatml":
        if system:
            parts.append(f"<|im_start|>system\n{system}<|im_end|>")
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            parts.append(f"<|im_start|>{role}\n{content}<|im_end|>")
        parts.append("<|im_start|>assistant\n")
        return "\n".join(parts)

    # Phi-style template
    if system:
        parts.append(f"<|system|>\n{system}<|end|>")
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|{role}|>\n{content}<|end|>")
    parts.append("<|assistant|>")

    return "\n".join(parts)


def handle_command(request: dict, model_path: str, ep: str):
    """Handle special commands (health, shutdown)."""
    cmd = request.get("command", "")

    if cmd == "health":
        emit({"status": "ok", "model": model_path, "ep": ep})
    elif cmd == "shutdown":
        emit({"status": "shutting_down"})
        sys.exit(0)
    else:
        emit_error("command", f"Unknown command: {cmd}")


def emit(data: dict):
    """Write a JSON line to stdout (NDJSON protocol)."""
    sys.stdout.write(json.dumps(data) + "\n")
    sys.stdout.flush()


def emit_status(phase: str, message: str):
    """Emit a status message during startup."""
    emit({"type": "status", "phase": phase, "message": message})


def emit_error(request_id: str, error: str):
    """Emit an error response."""
    emit({"id": request_id, "type": "error", "error": error})


if __name__ == "__main__":
    main()
