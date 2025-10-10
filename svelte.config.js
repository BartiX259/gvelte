export default {
  compilerOptions: {
    // disable all warnings coming from node_modules and all accessibility warnings
    warningFilter: (warning) => !warning.filename?.includes('node_modules') && !warning.code.startsWith('a11y') && !warning.code.startsWith('element_invalid_self_closing_tag'),
  }
}
