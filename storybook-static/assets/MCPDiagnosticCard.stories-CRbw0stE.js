import{s as e}from"./iframe-BVOKsb5M.js";import{t}from"./react-DTT2LJid.js";import{t as n}from"./jsx-runtime-nNYDw_rT.js";import{expect as r,fn as i,userEvent as a,within as o}from"./dist-0zRQ044q.js";var s=e=>e.replace(/([a-z0-9])([A-Z])/g,`$1-$2`).toLowerCase(),c=e=>e.replace(/^([A-Z])|[\s-_]+(\w)/g,(e,t,n)=>n?n.toUpperCase():t.toLowerCase()),l=e=>{let t=c(e);return t.charAt(0).toUpperCase()+t.slice(1)},u=(...e)=>e.filter((e,t,n)=>!!e&&e.trim()!==``&&n.indexOf(e)===t).join(` `).trim(),d=e=>{for(let t in e)if(t.startsWith(`aria-`)||t===`role`||t===`title`)return!0},f={xmlns:`http://www.w3.org/2000/svg`,width:24,height:24,viewBox:`0 0 24 24`,fill:`none`,stroke:`currentColor`,strokeWidth:2,strokeLinecap:`round`,strokeLinejoin:`round`},p=e(t()),m=(0,p.forwardRef)(({color:e=`currentColor`,size:t=24,strokeWidth:n=2,absoluteStrokeWidth:r,className:i=``,children:a,iconNode:o,...s},c)=>(0,p.createElement)(`svg`,{ref:c,...f,width:t,height:t,stroke:e,strokeWidth:r?Number(n)*24/Number(t):n,className:u(`lucide`,i),...!a&&!d(s)&&{"aria-hidden":`true`},...s},[...o.map(([e,t])=>(0,p.createElement)(e,t)),...Array.isArray(a)?a:[a]])),h=(e,t)=>{let n=(0,p.forwardRef)(({className:n,...r},i)=>(0,p.createElement)(m,{ref:i,iconNode:t,className:u(`lucide-${s(l(e))}`,`lucide-${e}`,n),...r}));return n.displayName=l(e),n},g=h(`check`,[[`path`,{d:`M20 6 9 17l-5-5`,key:`1gmf2c`}]]),_=h(`wrench`,[[`path`,{d:`M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z`,key:`1ngwbx`}]]),v=n();function y({diagnostic:e,isDiagnosing:t,fixApplied:n,onApplyFix:r,onRunDiagnosis:i}){return(0,v.jsxs)(`div`,{className:`mt-2 p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-slate-200 animate-in fade-in space-y-2`,children:[(0,v.jsxs)(`div`,{className:`flex items-center justify-between gap-2`,children:[(0,v.jsxs)(`div`,{className:`flex items-center gap-2 font-semibold text-rose-300 text-xs`,children:[(0,v.jsx)(_,{className:`h-4 w-4 text-rose-400 shrink-0`}),(0,v.jsx)(`span`,{children:`Olive MCP Error Diagnostic & Fix`})]}),t&&(0,v.jsx)(`span`,{className:`text-[10px] text-slate-400 animate-pulse`,children:`Diagnosing with MCP KB...`})]}),e?(0,v.jsxs)(`div`,{className:`space-y-1.5 text-xs font-sans`,children:[(0,v.jsxs)(`div`,{children:[(0,v.jsx)(`span`,{className:`font-semibold text-rose-300`,children:`Issue: `}),(0,v.jsx)(`span`,{className:`text-slate-200`,children:e.title})]}),(0,v.jsxs)(`div`,{children:[(0,v.jsx)(`span`,{className:`font-semibold text-slate-400`,children:`Root Cause: `}),(0,v.jsx)(`span`,{className:`text-slate-300`,children:e.root_cause})]}),(0,v.jsxs)(`div`,{children:[(0,v.jsx)(`span`,{className:`font-semibold text-emerald-400`,children:`Recommended Fix: `}),(0,v.jsx)(`span`,{className:`text-slate-300`,children:e.workaround})]}),e.updated_config&&(0,v.jsxs)(`div`,{className:`pt-1`,children:[(0,v.jsx)(`span`,{className:`font-semibold text-electric-blue`,children:`Config Changes: `}),(0,v.jsx)(`span`,{className:`text-slate-400 font-mono text-[10px]`,children:Object.entries(e.updated_config).map(([e,t])=>`${e}=${JSON.stringify(t)}`).join(`, `)})]}),e.relevant_quirks&&e.relevant_quirks.length>0&&(0,v.jsxs)(`div`,{className:`pt-1`,children:[(0,v.jsx)(`span`,{className:`font-semibold text-amber-400`,children:`Known Quirks: `}),(0,v.jsx)(`ul`,{className:`mt-0.5 space-y-0.5`,children:e.relevant_quirks.map((e,t)=>(0,v.jsxs)(`li`,{className:`text-[10px] text-slate-400`,children:[`• `,e]},t))})]}),(0,v.jsx)(`div`,{className:`pt-1.5`,children:(0,v.jsx)(`button`,{type:`button`,onClick:r,disabled:n!==``,className:`flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold rounded border transition-all cursor-pointer ${n===``?`border-electric-blue/30 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 hover:border-electric-blue/50`:`border-emerald-500/50 bg-emerald-500/10 text-emerald-400`}`,children:n===``?(0,v.jsxs)(v.Fragment,{children:[(0,v.jsx)(_,{className:`h-3 w-3`}),` Apply Fix`]}):(0,v.jsxs)(v.Fragment,{children:[(0,v.jsx)(g,{className:`h-3 w-3`}),` Fix Applied`]})})})]}):i?(0,v.jsxs)(`button`,{type:`button`,onClick:i,className:`text-[11px] text-slate-400 hover:text-rose-300 transition-colors cursor-pointer flex items-center gap-1.5`,children:[(0,v.jsx)(_,{className:`h-3 w-3`}),` Run MCP Diagnosis`]}):(0,v.jsx)(`p`,{className:`text-[11px] text-slate-400 italic`,children:`Querying Olive MCP Knowledge Base for matching error patterns...`})]})}y.__docgenInfo={description:'Displays an MCP diagnostic result for a failed Olive run.\n\nStates:\n- **Loading**: `diagnostic` is null, `isDiagnosing` is true → pulsing "Diagnosing..." message\n- **Querying**: `diagnostic` is null, `isDiagnosing` is false → italic "Querying..." message\n- **Result**: `diagnostic` is non-null → shows title, root cause, workaround, config changes, quirks\n- **Applied**: `fixApplied` is non-empty → button shows "Fix Applied" with checkmark',methods:[],displayName:`MCPDiagnosticCard`,props:{diagnostic:{required:!0,tsType:{name:`union`,raw:`McpDiagnostic | null`,elements:[{name:`McpDiagnostic`},{name:`null`}]},description:`The diagnostic result from the MCP knowledge base. Null = loading/querying.`},isDiagnosing:{required:!0,tsType:{name:`boolean`},description:`True while the diagnostic fetch is in flight.`},fixApplied:{required:!0,tsType:{name:`string`},description:`Non-empty string means a fix has been applied (auto-clears after timeout).`},onApplyFix:{required:!0,tsType:{name:`signature`,type:`function`,raw:`() => void`,signature:{arguments:[],return:{name:`void`}}},description:`Called when the user clicks "Apply Fix".`},onRunDiagnosis:{required:!1,tsType:{name:`signature`,type:`function`,raw:`() => void`,signature:{arguments:[],return:{name:`void`}}},description:`Called when the user clicks "Run MCP Diagnosis". If omitted, no button is shown.`}}};var b={title:`Features/MCP Diagnostic Card`,component:y,tags:[`autodocs`],parameters:{layout:`centered`,backgrounds:{default:`dark`}},args:{onApplyFix:i()}},x={matched_entry:`onnxruntime-large-model-external-data`,title:`ONNX Export Fails for Models > 2GB`,root_cause:`ONNX format stores all weights in a single protobuf file. Models exceeding ~2GB hit the protobuf size limit and fail to serialize.`,workaround:`Enable external data format in OnnxConversion to split weights into separate files using the ONNX external data format.`,updated_config:{use_external_data_format:!0,max_external_data_size:4294967296},relevant_quirks:[`PyTorch models with >2B parameters almost always need this flag`,`The resulting .onnx file will be accompanied by .onnx.data sidecar files`]},S={matched_entry:`quantization-precision-mismatch`,title:`Quantization Precision Not Supported by Provider`,root_cause:`The selected execution provider does not support the requested quantization precision. INT4 quantization requires CUDA or QNN EP with specific driver versions.`,workaround:`Switch to INT8 precision or change the execution provider to one that supports INT4 (CUDA 11.8+, QNN 2.22+).`},C={name:`Querying MCP Knowledge Base`,args:{diagnostic:null,isDiagnosing:!1,fixApplied:``},parameters:{docs:{description:{story:`The initial state while the component queries the MCP knowledge base. Shows an italic placeholder message.`}}}},w={name:`Diagnosing (Loading)`,args:{diagnostic:null,isDiagnosing:!0,fixApplied:``},parameters:{docs:{description:{story:`Loading state while a fetch is in flight. The pulsing 'Diagnosing with MCP KB...' indicator appears in the header.`}}}},T={name:`Diagnostic Result with Config & Quirks`,args:{diagnostic:x,isDiagnosing:!1,fixApplied:``},parameters:{docs:{description:{story:`Full diagnostic result showing issue title, root cause, recommended fix, config changes (blue), and known quirks (amber). The 'Apply Fix' button is enabled.`}}}},E={name:`Diagnostic Result (Minimal)`,args:{diagnostic:S,isDiagnosing:!1,fixApplied:``},parameters:{docs:{description:{story:`Diagnostic result without updated_config or relevant_quirks — only the three core fields are shown.`}}},play:async({canvasElement:e})=>{let t=o(e);await r(t.getByText(`Quantization Precision Not Supported by Provider`)).toBeInTheDocument(),await r(t.getByText(`Root Cause:`)).toBeInTheDocument(),await r(t.getByText(`Recommended Fix:`)).toBeInTheDocument(),await r(t.queryByText(`Config Changes:`)).not.toBeInTheDocument(),await r(t.queryByText(`Known Quirks:`)).not.toBeInTheDocument()}},D={name:`Fix Applied`,args:{diagnostic:x,isDiagnosing:!1,fixApplied:`applied`},parameters:{docs:{description:{story:`After the user clicks 'Apply Fix', the button transforms to a green 'Fix Applied' state with a checkmark. The button is disabled until the auto-clear timer resets.`}}},play:async({args:e,canvasElement:t})=>{await r(o(t).getByRole(`button`,{name:/Fix Applied/})).toBeDisabled(),await r(e.onApplyFix).not.toHaveBeenCalled()}},O={name:`Apply Fix Click Interaction`,args:{diagnostic:x,isDiagnosing:!1,fixApplied:``},parameters:{docs:{description:{story:`Interactive test: clicks 'Apply Fix' and verifies the onApplyFix callback fires exactly once. Also verifies the button is clickable and the callback receives no arguments.`}}},play:async({args:e,canvasElement:t})=>{let n=o(t).getByRole(`button`,{name:/Apply Fix/});await r(n).toBeInTheDocument(),await r(n).toBeEnabled(),await a.click(n),await r(e.onApplyFix).toHaveBeenCalledTimes(1),await r(e.onApplyFix).toHaveBeenCalledWith()}},k={name:`Run Diagnosis Click Interaction`,args:{diagnostic:null,isDiagnosing:!1,fixApplied:``,onRunDiagnosis:i()},parameters:{docs:{description:{story:`Interactive test: when onRunDiagnosis is provided and no diagnostic exists, clicking 'Run MCP Diagnosis' fires the callback.`}}},play:async({args:e,canvasElement:t})=>{let n=o(t).getByRole(`button`,{name:/Run MCP Diagnosis/});await r(n).toBeInTheDocument(),await a.click(n),await r(e.onRunDiagnosis).toHaveBeenCalledTimes(1)}};C.parameters={...C.parameters,docs:{...C.parameters?.docs,source:{originalSource:`{
  name: "Querying MCP Knowledge Base",
  args: {
    diagnostic: null,
    isDiagnosing: false,
    fixApplied: ""
  },
  parameters: {
    docs: {
      description: {
        story: "The initial state while the component queries the MCP knowledge base. Shows an italic placeholder message."
      }
    }
  }
}`,...C.parameters?.docs?.source},description:{story:`Card is hidden when executionStatus is not "failed" — this story shows the card directly.`,...C.parameters?.docs?.description}}},w.parameters={...w.parameters,docs:{...w.parameters?.docs,source:{originalSource:`{
  name: "Diagnosing (Loading)",
  args: {
    diagnostic: null,
    isDiagnosing: true,
    fixApplied: ""
  },
  parameters: {
    docs: {
      description: {
        story: "Loading state while a fetch is in flight. The pulsing 'Diagnosing with MCP KB...' indicator appears in the header."
      }
    }
  }
}`,...w.parameters?.docs?.source}}},T.parameters={...T.parameters,docs:{...T.parameters?.docs,source:{originalSource:`{
  name: "Diagnostic Result with Config & Quirks",
  args: {
    diagnostic: MOCK_DIAGNOSTIC,
    isDiagnosing: false,
    fixApplied: ""
  },
  parameters: {
    docs: {
      description: {
        story: "Full diagnostic result showing issue title, root cause, recommended fix, config changes (blue), and known quirks (amber). The 'Apply Fix' button is enabled."
      }
    }
  }
}`,...T.parameters?.docs?.source}}},E.parameters={...E.parameters,docs:{...E.parameters?.docs,source:{originalSource:`{
  name: "Diagnostic Result (Minimal)",
  args: {
    diagnostic: MOCK_DIAGNOSTIC_NO_CONFIG,
    isDiagnosing: false,
    fixApplied: ""
  },
  parameters: {
    docs: {
      description: {
        story: "Diagnostic result without updated_config or relevant_quirks — only the three core fields are shown."
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Verify core fields are rendered
    await expect(canvas.getByText("Quantization Precision Not Supported by Provider")).toBeInTheDocument();
    await expect(canvas.getByText("Root Cause:")).toBeInTheDocument();
    await expect(canvas.getByText("Recommended Fix:")).toBeInTheDocument();

    // Verify config/quirks sections are NOT present
    await expect(canvas.queryByText("Config Changes:")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Known Quirks:")).not.toBeInTheDocument();
  }
}`,...E.parameters?.docs?.source}}},D.parameters={...D.parameters,docs:{...D.parameters?.docs,source:{originalSource:`{
  name: "Fix Applied",
  args: {
    diagnostic: MOCK_DIAGNOSTIC,
    isDiagnosing: false,
    fixApplied: "applied"
  },
  parameters: {
    docs: {
      description: {
        story: "After the user clicks 'Apply Fix', the button transforms to a green 'Fix Applied' state with a checkmark. The button is disabled until the auto-clear timer resets."
      }
    }
  },
  play: async ({
    args,
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Verify "Fix Applied" button is shown and disabled
    const fixAppliedButton = canvas.getByRole("button", {
      name: /Fix Applied/
    });
    await expect(fixAppliedButton).toBeDisabled();

    // Verify onApplyFix was NOT called (button is disabled)
    await expect(args.onApplyFix).not.toHaveBeenCalled();
  }
}`,...D.parameters?.docs?.source}}},O.parameters={...O.parameters,docs:{...O.parameters?.docs,source:{originalSource:`{
  name: "Apply Fix Click Interaction",
  args: {
    diagnostic: MOCK_DIAGNOSTIC,
    isDiagnosing: false,
    fixApplied: ""
  },
  parameters: {
    docs: {
      description: {
        story: "Interactive test: clicks 'Apply Fix' and verifies the onApplyFix callback fires exactly once. Also verifies the button is clickable and the callback receives no arguments."
      }
    }
  },
  play: async ({
    args,
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Find the Apply Fix button
    const applyFixButton = canvas.getByRole("button", {
      name: /Apply Fix/
    });
    await expect(applyFixButton).toBeInTheDocument();
    await expect(applyFixButton).toBeEnabled();

    // Click it
    await userEvent.click(applyFixButton);

    // Verify callback fired exactly once
    await expect(args.onApplyFix).toHaveBeenCalledTimes(1);
    await expect(args.onApplyFix).toHaveBeenCalledWith();
  }
}`,...O.parameters?.docs?.source}}},k.parameters={...k.parameters,docs:{...k.parameters?.docs,source:{originalSource:`{
  name: "Run Diagnosis Click Interaction",
  args: {
    diagnostic: null,
    isDiagnosing: false,
    fixApplied: "",
    onRunDiagnosis: fn()
  },
  parameters: {
    docs: {
      description: {
        story: "Interactive test: when onRunDiagnosis is provided and no diagnostic exists, clicking 'Run MCP Diagnosis' fires the callback."
      }
    }
  },
  play: async ({
    args,
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Verify the Run MCP Diagnosis button appears
    const runDiagnosisButton = canvas.getByRole("button", {
      name: /Run MCP Diagnosis/
    });
    await expect(runDiagnosisButton).toBeInTheDocument();

    // Click it
    await userEvent.click(runDiagnosisButton);

    // Verify callback fired exactly once
    await expect(args.onRunDiagnosis).toHaveBeenCalledTimes(1);
  }
}`,...k.parameters?.docs?.source}}};var A=[`Querying`,`Diagnosing`,`WithResult`,`WithoutConfigOrQuirks`,`FixApplied`,`ApplyFixInteraction`,`RunDiagnosisInteraction`];export{O as ApplyFixInteraction,w as Diagnosing,D as FixApplied,C as Querying,k as RunDiagnosisInteraction,T as WithResult,E as WithoutConfigOrQuirks,A as __namedExportsOrder,b as default};