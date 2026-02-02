#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);

// Parse flags
const flags = {
  help: args.includes('--help') || args.includes('-h'),
  json: args.includes('--json') || args.includes('-j'),
  force: args.includes('--force') || args.includes('-f'),
  stdout: args.includes('--stdout') || args.includes('-s'),
  badges: args.includes('--badges') || args.includes('-b'),
};

// Get target directory (first non-flag arg or cwd)
const targetDir = args.find(a => !a.startsWith('-')) || process.cwd();

if (flags.help) {
  console.log(`
📄 claw-readme — Generate README.md from code analysis

Usage: claw-readme [path] [options]

Options:
  -h, --help     Show this help message
  -j, --json     Output analysis as JSON (no file write)
  -f, --force    Overwrite existing README.md
  -s, --stdout   Print README to stdout (no file write)
  -b, --badges   Include GitHub badges

Examples:
  claw-readme                    # Analyze current directory
  claw-readme ./my-project       # Analyze specific directory
  claw-readme --stdout           # Preview without writing
  claw-readme --force            # Overwrite existing README
  claw-readme --badges           # Include GitHub badges

What it analyzes:
  • package.json (name, description, scripts, bin)
  • Entry point (CLI commands, usage patterns)
  • Existing LICENSE file
  • Git remote for badges
`);
  process.exit(0);
}

// Resolve target directory
const absPath = path.resolve(targetDir);

if (!fs.existsSync(absPath)) {
  console.error(`Error: Directory not found: ${absPath}`);
  process.exit(1);
}

// Check for existing README
const readmePath = path.join(absPath, 'README.md');
if (fs.existsSync(readmePath) && !flags.force && !flags.stdout && !flags.json) {
  console.error('Error: README.md already exists. Use --force to overwrite or --stdout to preview.');
  process.exit(1);
}

// Read package.json
const pkgPath = path.join(absPath, 'package.json');
if (!fs.existsSync(pkgPath)) {
  console.error('Error: No package.json found. This tool requires a Node.js project.');
  process.exit(1);
}

let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
} catch (e) {
  console.error('Error: Invalid package.json');
  process.exit(1);
}

// Analyze the project
const analysis = {
  name: pkg.name || path.basename(absPath),
  description: pkg.description || 'A CLI tool',
  version: pkg.version || '1.0.0',
  license: pkg.license || 'MIT',
  author: pkg.author || '',
  scripts: pkg.scripts || {},
  bin: pkg.bin || {},
  keywords: pkg.keywords || [],
  main: pkg.main || 'index.js',
  commands: [],
  usage: [],
  github: null,
};

// Detect GitHub repo from package.json or git remote
if (pkg.repository) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url;
  const match = repo?.match(/github\.com[\/:]([^\/]+)\/([^\/\.]+)/);
  if (match) {
    analysis.github = { user: match[1], repo: match[2] };
  }
}

// Try to detect from git remote
if (!analysis.github) {
  try {
    const gitConfigPath = path.join(absPath, '.git', 'config');
    if (fs.existsSync(gitConfigPath)) {
      const gitConfig = fs.readFileSync(gitConfigPath, 'utf-8');
      const match = gitConfig.match(/github\.com[\/:]([^\/]+)\/([^\/\.\s]+)/);
      if (match) {
        analysis.github = { user: match[1], repo: match[2].replace('.git', '') };
      }
    }
  } catch (e) {}
}

// Determine which files to analyze for commands
const filesToAnalyze = new Set();

// Add main entry point
filesToAnalyze.add(path.join(absPath, analysis.main));

// Add bin entry points
for (const binPath of Object.values(analysis.bin)) {
  filesToAnalyze.add(path.join(absPath, binPath));
}

// Analyze entry points for CLI commands
for (const entryPath of filesToAnalyze) {
  if (fs.existsSync(entryPath)) {
    try {
      const code = fs.readFileSync(entryPath, 'utf-8');
      
      // Look for command patterns
      const commandPatterns = [
        // case 'command': pattern
        /case\s+['"`](\w+)['"`]\s*:/g,
        // args[0] === 'command' pattern
        /args\[0\]\s*===?\s*['"`](\w+)['"`]/g,
        // command === 'command' pattern  
        /command\s*===?\s*['"`](\w+)['"`]/g,
        // if (command === 'command') pattern
        /if\s*\(\s*\w+\s*===?\s*['"`](\w+)['"`]\s*\)/g,
      ];
      
      for (const pattern of commandPatterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
          const cmd = match[1];
          if (cmd && !['help', 'version', 'default', 'true', 'false', 'command', 'cmd', 'action'].includes(cmd.toLowerCase())) {
            analysis.commands.push(cmd);
          }
        }
      }
      
      // Look for usage examples in comments
      const usageMatch = code.match(/Usage:\s*(.+)/i);
      if (usageMatch) {
        analysis.usage.push(usageMatch[1].trim());
      }
    } catch (e) {}
  }
}

// Dedupe commands
analysis.commands = [...new Set(analysis.commands)];

// Build bin commands
const binCommands = Object.keys(analysis.bin);

// Check for LICENSE
const licenseExists = fs.existsSync(path.join(absPath, 'LICENSE'));

// JSON output
if (flags.json) {
  console.log(JSON.stringify(analysis, null, 2));
  process.exit(0);
}

// Generate README content
let readme = '';

// Title
readme += `# ${analysis.name}\n\n`;

// Description
readme += `${analysis.description}\n\n`;

// Badges
if (flags.badges && analysis.github) {
  const { user, repo } = analysis.github;
  readme += `![License](https://img.shields.io/github/license/${user}/${repo})\n`;
  readme += `![Version](https://img.shields.io/github/package-json/v/${user}/${repo})\n`;
  readme += `![Stars](https://img.shields.io/github/stars/${user}/${repo})\n\n`;
}

// Installation
readme += `## Installation\n\n`;
readme += '```bash\n';
if (binCommands.length > 0) {
  readme += `npm install -g ${analysis.name}\n`;
  readme += `# or\n`;
  readme += `npx ${analysis.name}\n`;
} else {
  readme += `npm install ${analysis.name}\n`;
}
readme += '```\n\n';

// Usage
readme += `## Usage\n\n`;

if (binCommands.length > 0) {
  const mainBin = binCommands[0];
  readme += '```bash\n';
  readme += `${mainBin} --help\n`;
  readme += '```\n\n';
}

// Commands
if (analysis.commands.length > 0) {
  readme += `### Commands\n\n`;
  readme += '| Command | Description |\n';
  readme += '|---------|-------------|\n';
  for (const cmd of analysis.commands) {
    readme += `| \`${cmd}\` | |\n`;
  }
  readme += '\n';
}

// Examples
readme += `## Examples\n\n`;
readme += '```bash\n';
if (binCommands.length > 0) {
  const mainBin = binCommands[0];
  if (analysis.commands.length > 0) {
    readme += `# ${analysis.commands[0]}\n`;
    readme += `${mainBin} ${analysis.commands[0]}\n`;
  } else {
    readme += `${mainBin}\n`;
  }
} else {
  readme += `node ${analysis.main}\n`;
}
readme += '```\n\n';

// Scripts
if (Object.keys(analysis.scripts).length > 0) {
  const usefulScripts = Object.keys(analysis.scripts).filter(s => !['test'].includes(s));
  if (usefulScripts.length > 0) {
    readme += `## Development\n\n`;
    readme += '```bash\n';
    for (const script of usefulScripts.slice(0, 3)) {
      readme += `npm run ${script}\n`;
    }
    readme += '```\n\n';
  }
}

// License
readme += `## License\n\n`;
readme += `${analysis.license}${analysis.author ? ` © ${analysis.author}` : ''}\n`;

// Output
if (flags.stdout) {
  console.log(readme);
} else {
  fs.writeFileSync(readmePath, readme);
  console.log(`✅ Generated README.md (${readme.length} bytes)`);
  console.log(`   📦 ${analysis.name} v${analysis.version}`);
  if (analysis.commands.length > 0) {
    console.log(`   🔧 Commands: ${analysis.commands.join(', ')}`);
  }
  if (analysis.github) {
    console.log(`   🔗 GitHub: ${analysis.github.user}/${analysis.github.repo}`);
  }
}
