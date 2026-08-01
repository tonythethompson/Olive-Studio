/**
 * Renders a chat message's lightweight markdown: fenced code blocks, bullets,
 * `##`/`###` headings, `**bold**` and `` `inline code` ``.
 */
export function renderMessageContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith("```") && part.endsWith("```")) {
      const lines = part.split("\n");
      return (
        <pre
          key={i}
          className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-[10px] font-mono text-emerald-400 my-1.5 overflow-x-auto whitespace-pre-wrap"
        >
          {lines.slice(1, -1).join("\n")}
        </pre>
      );
    }
    return part.split("\n").map((line, j) => {
      const isBullet = line.trim().startsWith("- ") || line.trim().startsWith("* ");
      const clean = isBullet ? line.trim().substring(2) : line;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const elems: any[] = [];
      clean.split(/(\*\*.*?\*\*|`.*?`)/g).forEach((bp, k) => {
        if (bp.startsWith("**") && bp.endsWith("**"))
          elems.push(
            <strong key={k} className="font-bold text-slate-100">
              {bp.slice(2, -2)}
            </strong>,
          );
        else if (bp.startsWith("`") && bp.endsWith("`"))
          elems.push(
            <code
              key={k}
              className="bg-slate-950 border border-slate-800 px-1 py-0.5 rounded text-[10px] font-mono text-cyan-400"
            >
              {bp.slice(1, -1)}
            </code>,
          );
        else elems.push(bp);
      });
      if (isBullet)
        return (
          <div key={`${i}-${j}`} className="ml-3.5 text-xs text-slate-300 leading-relaxed my-0.5 flex gap-1">
            <span aria-hidden="true">•</span>
            <span>{elems}</span>
          </div>
        );
      if (line.trim().startsWith("### "))
        return (
          <h5 key={`${i}-${j}`} className="text-xs font-semibold text-electric-blue mt-2.5 mb-1">
            {line.trim().substring(4)}
          </h5>
        );
      if (line.trim().startsWith("## "))
        return (
          <h4
            key={`${i}-${j}`}
            className="text-xs font-bold text-slate-100 mt-3 mb-1.5 pb-0.5 border-b border-slate-800/80"
          >
            {line.trim().substring(3)}
          </h4>
        );
      return (
        <p key={`${i}-${j}`} className="text-xs text-slate-300 leading-relaxed my-0.5">
          {elems}
        </p>
      );
    });
  });
}
