import fs from "fs";

let src = fs.readFileSync("server.ts", "utf8");

// ====================================================================
// FUNCTION-LEVEL — entire function body deals with unknown API shapes
// ====================================================================

// 1. callGemini — 3 any uses (body, err cast, data cast)
src = src.replace(
  "async function callGemini(",
  "/* eslint-disable @typescript-eslint/no-explicit-any -- external API response shape unknown */\nasync function callGemini(",
);
src = src.replace(
  "}\n\nasync function callOpenAICompat(",
  "}\n/* eslint-enable @typescript-eslint/no-explicit-any */\n\nasync function callOpenAICompat(",
);

// 2. callOpenAICompat — 3 any uses (body, err cast, data cast)
src = src.replace(
  "async function callOpenAICompat(",
  "/* eslint-disable @typescript-eslint/no-explicit-any -- external API response shape unknown */\nasync function callOpenAICompat(",
);
src = src.replace(
  "}\n\nasync function callAnthropic(",
  "}\n/* eslint-enable @typescript-eslint/no-explicit-any */\n\nasync function callAnthropic(",
);

// 3. callAnthropic — 2 any uses (err cast, data cast)
src = src.replace(
  "async function callAnthropic(",
  "/* eslint-disable @typescript-eslint/no-explicit-any -- external API response shape unknown */\nasync function callAnthropic(",
);
src = src.replace(
  "}\n\nasync function callAI(",
  "}\n/* eslint-enable @typescript-eslint/no-explicit-any */\n\nasync function callAI(",
);

// ====================================================================
// REMAINING — individual line-level suppressions
// ====================================================================

// 4. inferRequiredPackages — whole function uses any for recipe
src = src.replace(
  "function inferRequiredPackages(recipe: any, cudaTag: string): PkgDef[] {",
  "/* eslint-disable @typescript-eslint/no-explicit-any -- recipe object has dynamic shape from user JSON */\nfunction inferRequiredPackages(recipe: any, cudaTag: string): PkgDef[] {",
);
src = src.replace(
  "}\n\nfunction getRecipeIhvProvider(",
  "}\n/* eslint-enable @typescript-eslint/no-explicit-any */\n\nfunction getRecipeIhvProvider(",
);

// 5. getRecipeIhvProvider — single function-level
src = src.replace(
  "function getRecipeIhvProvider(recipe: any): IHVProvider {",
  "/* eslint-disable @typescript-eslint/no-explicit-any -- recipe object has dynamic shape */\nfunction getRecipeIhvProvider(recipe: any): IHVProvider {",
);
src = src.replace(
  "}\n\nfunction oliveSpawnArgs(",
  "}\n/* eslint-enable @typescript-eslint/no-explicit-any */\n\nfunction oliveSpawnArgs(",
);

// 6. GitHub raw proxy catch(error: any) — put disable BEFORE the catch line
src = src.replace(
  '  } catch (error: any) {\n    console.error("GitHub raw proxy error:', '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error shape\n  } catch (error: any) {\n    console.error("GitHub raw proxy error:'
);
// Remove stale comment if it was placed on wrong line
src = src.replace(
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error',
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error'
);
// Clean up duplicate that might have been created
src = src.replace(
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n    console.error("GitHub raw proxy error:', '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n  } catch (error: any) {\n    console.error("GitHub raw proxy error:'
);

// 7. recipeObj: any in POST /api/olive/run
src = src.replace(
  "    let recipeObj: any = {};",
  '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed JSON shape is dynamic\n    let recipeObj: any = {};'
);

// 8. AI route catch(err: any) blocks — put disable BEFORE each catch line
const aiCatchPatterns = [
  '  } catch (err: any) {\n    console.error("AI Validate Error:',
  '  } catch (err: any) {\n    console.error("AI Analyze Error:',
  '  } catch (err: any) {\n    console.error("AI Recommend Quant Error:',
  '  } catch (err: any) {\n    console.error("AI Chat Error:',
];
for (const pattern of aiCatchPatterns) {
  src = src.replace(
    pattern,
    '    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n  ' + pattern
  );
}
// Clean up any stale wrong-line comments from previous attempt
for (const errMsg of ["AI Validate Error", "AI Analyze Error", "AI Recommend Quant Error", "AI Chat Error"]) {
  src = src.replace(
    `    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n  } catch (err: any) {\n    console.error("${errMsg}:`,
    `    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express catch, unknown error\n  } catch (err: any) {\n    console.error("${errMsg}:`
  );
}

// 9. chatHistory.map((m: any) => ...) — put disable before the line
src = src.replace(
  '  const history: AIChatMessage[] = (chatHistory || []).map((m: any) => ({',
  '  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- chat messages from request body\n  const history: AIChatMessage[] = (chatHistory || []).map((m: any) => ({'
);

// 10. console.log for server startup
src = src.replace(
  '    console.log(`Server running on http://0.0.0.0:${PORT}`);',
  '    // eslint-disable-next-line no-console -- intentional server startup message\n    console.log(`Server running on http://0.0.0.0:${PORT}`);'
);

fs.writeFileSync("server.ts", src);
console.log("✅ All eslint suppressions applied");
