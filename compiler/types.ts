// compiler/types.ts

export interface Location {
  start: number;
  end: number;
}
export class CompilerError extends Error {
  location?: Location;

  constructor(message: string, location?: Location) {
    super(message);
    this.name = "CompilerError";
    this.location = location;
  }
}

export interface DependencyInfo {
  path: string;
  location: Location;
}

export interface CompilerState {
  // Input
  svelte_ast: any;
  component_name: string;
  mangled_name: string;

  // Analysis Results
  state_variables: Set<string>;
  props: Map<string, string | null>;
  svelte_dependencies: Map<string, DependencyInfo>; // Maps local name ("Child") to path ("./Child.svelte")
  reactive_variables: Set<string>;
  import_map: Map<string, string>; // Maps local name ("Child") to mangled name ("src_Child")

  // Output Buffers
  widget_declarations: string;
  helper_functions: string;
  effects_and_handlers: string;
  root_widget_name: string;

  // Internal State
  counters: { [key: string]: number };
}
