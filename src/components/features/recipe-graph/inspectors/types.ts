import { UIState } from "@/types";

export interface InspectorProps {
  state: UIState;
  setState: (s: Partial<UIState>) => void;
}
