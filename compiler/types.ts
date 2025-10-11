// compiler/types.ts

export enum ContainerType {
  NONE,
  SINGLE,
  MULTIPLE,
}

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

export interface ImportSpecifier {
  localName: string;
  importedName: string; // 'default' for default imports
}

export interface Dependency {
  path: string;
  location: Location;
  isSvelte: boolean;
  specifiers: ImportSpecifier[];
}

// NEW: Metadata gathered during the first compilation pass
export interface ModuleMetadata {
  // A set of variable names that are exported and are reactive
  reactiveExports: Set<string>;
}

export interface CompilerState {
  // Input
  svelte_ast: any;
  component_name: string;
  mangled_name: string;

  // Analysis Results
  state_variables: Set<string>;
  props: Map<string, string | null>;
  dependencies: Map<string, Dependency>;
  reactive_variables: Set<string>;

  // Output Buffers
  widget_declarations: string;
  helper_functions: string;
  effects_and_handlers: string;
  root_widget_name: string;

  // Internal State
  counters: { [key: string]: number };
}
