import{s as e}from"./iframe-BVOKsb5M.js";import{t}from"./react-DTT2LJid.js";import{t as n}from"./jsx-runtime-nNYDw_rT.js";import{fn as r}from"./dist-0zRQ044q.js";var i=e(t(),1),a=n();function o({importedPresets:e,collisions:t,mergedPresets:n,presetDetail:r,onImport:o,onCancel:s}){let c=(0,i.useRef)(null);return(0,i.useEffect)(()=>{c.current?.focus()},[]),(0,a.jsxs)(`div`,{className:`rounded-lg border border-slate-700 bg-slate-900/90 p-3 space-y-2`,onKeyDown:e=>{e.key===`Escape`&&s()},children:[(0,a.jsxs)(`p`,{className:`text-[10px] font-mono uppercase tracking-wider text-slate-400`,children:[`Import `,e.length,` preset`,e.length===1?``:`s`]}),(0,a.jsx)(`div`,{className:`space-y-1.5 max-h-40 overflow-y-auto`,children:e.map(e=>{let n=t.includes(e.label);return(0,a.jsxs)(`div`,{className:`rounded px-2 py-1 ${n?`bg-amber-500/5`:`bg-slate-800/50`}`,children:[(0,a.jsxs)(`div`,{className:`flex items-center gap-1.5 text-[11px]`,children:[(0,a.jsx)(`span`,{className:`w-1.5 h-1.5 rounded-full shrink-0 ${n?`bg-amber-400`:`bg-emerald-400`}`}),(0,a.jsx)(`span`,{className:`font-medium ${n?`text-amber-300`:`text-slate-300`}`,children:e.label}),n&&(0,a.jsx)(`span`,{className:`text-[9px] text-amber-500/70`,children:`will overwrite`})]}),(0,a.jsx)(`div`,{className:`ml-3 text-[9px] text-slate-500 font-mono`,children:r(e)})]},e.label)})}),t.length>0&&(0,a.jsxs)(`p`,{className:`text-[10px] text-amber-400/80`,children:[t.length,` preset`,t.length===1?``:`s`,` will overwrite existing custom presets with the same name.`]}),(0,a.jsxs)(`div`,{className:`flex gap-2 pt-1`,children:[(0,a.jsx)(`button`,{type:`button`,onClick:()=>o(n),className:`h-7 px-3 text-[10px] font-medium rounded border border-electric-blue/50 bg-electric-blue/10 text-electric-blue hover:bg-electric-blue/20 transition-colors`,children:`Import`}),(0,a.jsx)(`button`,{ref:c,type:`button`,onClick:s,className:`h-7 px-3 text-[10px] font-medium rounded border border-slate-600 bg-slate-800 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition-colors`,children:`Cancel`})]})]})}o.__docgenInfo={description:`Reusable confirmation dialog shown before applying an import of custom presets.
Handles keyboard shortcuts (Escape to cancel), auto-focuses the Cancel button,
and displays collision indicators with detail lines for each preset.`,methods:[],displayName:`ImportConfirmDialog`,props:{importedPresets:{required:!0,tsType:{name:`Array`,elements:[{name:`T`}],raw:`T[]`},description:``},collisions:{required:!0,tsType:{name:`Array`,elements:[{name:`string`}],raw:`string[]`},description:``},mergedPresets:{required:!0,tsType:{name:`Array`,elements:[{name:`T`}],raw:`T[]`},description:``},presetDetail:{required:!0,tsType:{name:`signature`,type:`function`,raw:`(preset: T) => string`,signature:{arguments:[{type:{name:`T`},name:`preset`}],return:{name:`string`}}},description:`Render a detail line below each preset label (e.g. "AWQ · INT4" or "magnitude · l1_norm · 70%").`},onImport:{required:!0,tsType:{name:`signature`,type:`function`,raw:`(mergedPresets: T[]) => void`,signature:{arguments:[{type:{name:`Array`,elements:[{name:`T`}],raw:`T[]`},name:`mergedPresets`}],return:{name:`void`}}},description:``},onCancel:{required:!0,tsType:{name:`signature`,type:`function`,raw:`() => void`,signature:{arguments:[],return:{name:`void`}}},description:``}}};var s=e=>`${e.method} · ${e.criteria} · ${(e.sparsity*100).toFixed(0)}%`,c=[{label:`Aggressive`,method:`magnitude`,criteria:`l1_norm`,sparsity:.7},{label:`Balanced`,method:`sparsegpt`,criteria:`l2_norm`,sparsity:.5},{label:`Conservative`,method:`wanda`,criteria:`l1_norm`,sparsity:.3}],l=[{label:`Aggressive`,method:`magnitude`,criteria:`l1_norm`,sparsity:.7},{label:`Balanced`,method:`sparsegpt`,criteria:`l2_norm`,sparsity:.5},{label:`New Only`,method:`wanda`,criteria:`l2_norm`,sparsity:.4}],u={title:`Components/ImportConfirmDialog`,component:o,tags:[`autodocs`],parameters:{layout:`centered`,backgrounds:{default:`dark`}},args:{onImport:r(),onCancel:r(),presetDetail:s}},d={name:`No Collisions`,args:{importedPresets:c,collisions:[],mergedPresets:c},parameters:{docs:{description:{story:`All imported presets are new — no existing presets share the same label. Each preset shows a green dot indicating it will be added without overwriting.`}}}},f={name:`With Collisions`,args:{importedPresets:l,collisions:[`Aggressive`,`Balanced`],mergedPresets:l},parameters:{docs:{description:{story:`Two of three imported presets share labels with existing custom presets. Colliding presets show amber dots and 'will overwrite' labels. The warning banner at the bottom summarizes the collision count.`}}}},p={name:`Empty Preset List`,args:{importedPresets:[],collisions:[],mergedPresets:[]},parameters:{docs:{description:{story:`No presets to import — the imported list is empty. The dialog still renders with its header and action buttons, though this state should rarely be reached in practice.`}}}},m={name:`Single Preset`,args:{importedPresets:[c[0]],collisions:[],mergedPresets:[c[0]]},parameters:{docs:{description:{story:`Only one preset is being imported. The header reads 'Import 1 preset' (singular) instead of 'Import 2 presets'.`}}}},h={name:`All Collisions`,args:{importedPresets:c,collisions:c.map(e=>e.label),mergedPresets:c},parameters:{docs:{description:{story:`Every imported preset collides with an existing custom preset. All three show amber dots and 'will overwrite' labels.`}}}};d.parameters={...d.parameters,docs:{...d.parameters?.docs,source:{originalSource:`{
  name: "No Collisions",
  args: {
    importedPresets: SAMPLE_PRESETS,
    collisions: [],
    mergedPresets: SAMPLE_PRESETS
  },
  parameters: {
    docs: {
      description: {
        story: "All imported presets are new — no existing presets share the same label. " + "Each preset shows a green dot indicating it will be added without overwriting."
      }
    }
  }
}`,...d.parameters?.docs?.source}}},f.parameters={...f.parameters,docs:{...f.parameters?.docs,source:{originalSource:`{
  name: "With Collisions",
  args: {
    importedPresets: COLLIDING_PRESETS,
    collisions: ["Aggressive", "Balanced"],
    mergedPresets: COLLIDING_PRESETS
  },
  parameters: {
    docs: {
      description: {
        story: "Two of three imported presets share labels with existing custom presets. " + "Colliding presets show amber dots and 'will overwrite' labels. " + "The warning banner at the bottom summarizes the collision count."
      }
    }
  }
}`,...f.parameters?.docs?.source}}},p.parameters={...p.parameters,docs:{...p.parameters?.docs,source:{originalSource:`{
  name: "Empty Preset List",
  args: {
    importedPresets: [],
    collisions: [],
    mergedPresets: []
  },
  parameters: {
    docs: {
      description: {
        story: "No presets to import — the imported list is empty. " + "The dialog still renders with its header and action buttons, " + "though this state should rarely be reached in practice."
      }
    }
  }
}`,...p.parameters?.docs?.source}}},m.parameters={...m.parameters,docs:{...m.parameters?.docs,source:{originalSource:`{
  name: "Single Preset",
  args: {
    importedPresets: [SAMPLE_PRESETS[0]],
    collisions: [],
    mergedPresets: [SAMPLE_PRESETS[0]]
  },
  parameters: {
    docs: {
      description: {
        story: "Only one preset is being imported. The header reads " + "'Import 1 preset' (singular) instead of 'Import 2 presets'."
      }
    }
  }
}`,...m.parameters?.docs?.source}}},h.parameters={...h.parameters,docs:{...h.parameters?.docs,source:{originalSource:`{
  name: "All Collisions",
  args: {
    importedPresets: SAMPLE_PRESETS,
    collisions: SAMPLE_PRESETS.map(p => p.label),
    mergedPresets: SAMPLE_PRESETS
  },
  parameters: {
    docs: {
      description: {
        story: "Every imported preset collides with an existing custom preset. " + "All three show amber dots and 'will overwrite' labels."
      }
    }
  }
}`,...h.parameters?.docs?.source}}};var g=[`NoCollisions`,`WithCollisions`,`EmptyList`,`SinglePreset`,`AllCollisions`];export{h as AllCollisions,p as EmptyList,d as NoCollisions,m as SinglePreset,f as WithCollisions,g as __namedExportsOrder,u as default};