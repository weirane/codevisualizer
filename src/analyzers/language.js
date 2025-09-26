const EXTENSION_TO_LANGUAGE = new Map([
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.json', 'JSON'],
  ['.py', 'Python'],
  ['.rb', 'Ruby'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.swift', 'Swift'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.php', 'PHP'],
  ['.cs', 'C#'],
  ['.cpp', 'C++'],
  ['.cc', 'C++'],
  ['.c', 'C'],
  ['.h', 'C/C++ Header'],
  ['.hpp', 'C++ Header'],
  ['.sql', 'SQL'],
  ['.yml', 'YAML'],
  ['.yaml', 'YAML'],
  ['.toml', 'TOML'],
  ['.md', 'Markdown'],
  ['.vue', 'Vue'],
  ['.svelte', 'Svelte'],
  ['.scss', 'SCSS'],
  ['.css', 'CSS'],
  ['.html', 'HTML'],
  ['.xml', 'XML'],
  ['.sh', 'Shell'],
  ['.bash', 'Shell'],
  ['.zsh', 'Shell'],
  ['.ps1', 'PowerShell']
]);

function detectLanguage(ext) {
  return EXTENSION_TO_LANGUAGE.get(ext.toLowerCase()) || 'Unknown';
}

module.exports = {
  detectLanguage
};
