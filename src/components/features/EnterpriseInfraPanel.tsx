import { Card, CardContent, CardHeader, Input, Label, Switch } from "@/components/ui";
import { UIState } from "@/types";
import { KeyRound, Database, Network } from "lucide-react";

export function EnterpriseInfraPanel({ state, setState }: { state: UIState; setState: (s: Partial<UIState>) => void }) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card>
        <CardHeader 
          title="Enterprise Infrastructure & Caching" 
          description="Configure shared caching and remote storage paths to streamline team workflows and minimize redundant processing."
          badge={<div className="flex h-8 w-8 items-center justify-center rounded-full bg-electric-blue/10 text-electric-blue"><Network className="h-4 w-4" /></div>}
        />
        <CardContent className="grid gap-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
             <div className="grid gap-3">
              <Label htmlFor="cacheDir" className="flex items-center gap-2"><Database className="h-4 w-4 text-slate-400" /> Local/Shared Cache Directory</Label>
              <Input 
                id="cacheDir" 
                placeholder="~/.cache/olive" 
                value={state.cacheDir}
                onChange={(e) => setState({ cacheDir: e.target.value })}
              />
              <p className="text-xs text-slate-500">Path to store downloaded weights and intermediate optimization artifacts.</p>
            </div>
            <div className="grid gap-3">
              <Label htmlFor="azureStr" className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" /> Azure Blob Connection String</Label>
              <Input 
                id="azureStr" 
                type="password"
                placeholder="DefaultEndpointsProtocol=https;AccountName=..." 
                className="font-mono text-xs"
                value={state.azureStr}
                onChange={(e) => setState({ azureStr: e.target.value })}
              />
              <p className="text-xs text-slate-500">Secure connection string for remote cache sharing across your enterprise.</p>
            </div>
          </div>
          
          <div className="mt-4 pt-6 border-t border-slate-800">
             <div className="flex items-center justify-between">
                <div>
                   <Label>Enable Distributed Caching</Label>
                   <p className="text-xs text-slate-500">
                     When enabled, the Olive recipe will use Azure Blob storage as cache if a connection string is provided; otherwise falls back to local cache.
                   </p>
                </div>
                <Switch
                  checked={state.distributedCaching}
                  onCheckedChange={(checked) => setState({ distributedCaching: checked })}
                />
             </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
