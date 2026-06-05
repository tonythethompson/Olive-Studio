import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const PORT = 3000;

// Initialize Gemini Client
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

// API routes FIRST
app.post("/api/gemini/validate", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable validation.",
    });
  }

  const { recipeJson, ihvProvider } = req.body;
  if (!recipeJson) {
    return res.status(400).json({ error: "No recipe JSON provided for validation." });
  }

  try {
    const prompt = `Validate the following Microsoft Olive JSON recipe configuration being run on hardware platform '${ihvProvider || "CPUExecutionProvider"}'.
Detect any potential execution failures, suboptimal settings, accuracy/precision collapses, or compatibility issues.

Recipe JSON:
${recipeJson}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: "You are an expert MS Olive compiler engineer. Output strict valid structural feedback matching the requested schema. Be constructive and specific.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            valid: { type: Type.BOOLEAN, description: "Whether the recipe structure is valid" },
            severity: { type: Type.STRING, description: "'success' if perfect, 'warning' if issues detected but might run, 'error' if it will fail execution" },
            summary: { type: Type.STRING, description: "A one or two sentence high-level assessment of the recipe" },
            issues: {
              type: Type.ARRAY,
              description: "List of issues, conflicts, or suboptimal points detected",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "One of: 'critical', 'warning', 'info'" },
                  title: { type: Type.STRING, description: "Short summary of the issue" },
                  explanation: { type: Type.STRING, description: "Detailed explanation of why it occurs and its impact" },
                  fix: { type: Type.STRING, description: "Concrete instruction or code snippet to resolve this" }
                },
                required: ["type", "title", "explanation"]
              }
            },
            suggestions: {
              type: Type.ARRAY,
              description: "General best-practice recommendations for this optimization pathway",
              items: { type: Type.STRING }
            }
          },
          required: ["valid", "severity", "summary", "issues", "suggestions"]
        }
      }
    });

    const text = response.text || "{}";
    const data = JSON.parse(text.trim());
    return res.json(data);
  } catch (error: any) {
    console.error("Gemini Validation Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini validation.",
    });
  }
});

app.post("/api/gemini/analyze-state", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable optimization analysis.",
    });
  }

  const { state } = req.body;
  if (!state) {
    return res.status(400).json({ error: "No UI state provided for optimization analysis." });
  }

  try {
    const prompt = `Analyze the following Microsoft Olive optimization pipeline configuration state and provide automated suggestions, compatibility warnings, and performance improvement opportunities.

Current Optimization State:
${JSON.stringify(state, null, 2)}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `You are "Olive Optimization Advisor", a compiler hardware hardware co-design expert.
Your goal is to inspect the optimization choices (conversion, quantization, pruning, PEFT fine-tuning, transformer optimizations) and the target Hardware, and provide a set of actionable advice.
Output valid JSON adhering to this schema:
{
  "score": <number from 0 to 100 assessing the optimization efficiency>,
  "level": "Optimized" | "Suboptimal" | "Unoptimized" | "Critical Mismatch",
  "summary": "<short high-level summary of the state>",
  "suggestions": [
    {
      "title": "<short title of recommendation>",
      "description": "<why it helps and detailed instructions>",
      "impact": "High" | "Medium" | "Low",
      "type": "warning" | "success" | "suggestion" | "info",
      "autofix": {
         "pass": "quantization" | "ihvProvider" | "onnxTransforms" | "pruning" | "peft",
         "value": "<recommended value, if boolean then 'true' or 'false', if provider e.g. 'CUDAExecutionProvider' or 'TensorrtExecutionProvider'>"
      }
    }
  ]
}`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.INTEGER },
            level: { type: Type.STRING },
            summary: { type: Type.STRING },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  description: { type: Type.STRING },
                  impact: { type: Type.STRING },
                  type: { type: Type.STRING },
                  autofix: {
                    type: Type.OBJECT,
                    properties: {
                      pass: { type: Type.STRING },
                      value: { type: Type.STRING }
                    },
                    required: ["pass", "value"]
                  }
                },
                required: ["title", "description", "impact", "type"]
              }
            }
          },
          required: ["score", "level", "summary", "suggestions"]
        }
      }
    });

    const text = response.text || "{}";
    const data = JSON.parse(text.trim());
    return res.json(data);
  } catch (error: any) {
    console.error("Gemini State Analysis Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini state analysis.",
    });
  }
});

app.post("/api/gemini/chat", async (req, res) => {
  if (!ai) {
    return res.status(500).json({
      error: "Gemini API key is not configured. Please add GEMINI_API_KEY in Settings > Secrets to enable assistant chat.",
    });
  }

  const { message, recipeJson, chatHistory, ihvProvider } = req.body;
  if (!message) {
    return res.status(400).json({ error: "Missing message parameter in request." });
  }

  try {
    const formattedHistory = (chatHistory || []).map((msg: any) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const systemInstruction = `You are "Olive AI Assistant", an expert AI compiler specialist with deep expertise in Microsoft Olive, model optimizations, quantization (AWQ, GPTQ, SmoothQuant, PTQ, QAT), pruning, PEFT fine-tuning (LoRA, QLoRA), ONNX runtime, and DirectML / hardware execution providers.
Provide professional, accurate, and concise answers.
You can refer to the user's current recipe configuration if needed to provide tailored code blocks or explanations.
Current hardware target platform: ${ihvProvider || "CPUExecutionProvider"}.
Current recipe configuration JSON:
${recipeJson || "No active recipe selected."}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: [
        ...formattedHistory,
        { role: "user", parts: [{ text: message }] }
      ],
      config: {
        systemInstruction,
      }
    });

    const text = response.text || "I was unable to formulate a response.";
    return res.json({ text });
  } catch (error: any) {
    console.error("Gemini Chat Error:", error);
    return res.status(500).json({
      error: error.message || "An error occurred during Gemini processing.",
    });
  }
});

// Serve static assets or vite middleware & start
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Ensure the dev server runs on 0.0.0.0 and port 3000
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
