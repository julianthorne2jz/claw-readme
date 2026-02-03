#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
  • CLI --help output (dynamic analysis)
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
if (fs.existsSync(readmePath) && !flags.force && !flags.stdout && !(!flags.human && !flags.H)) {
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
  flags: [],
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

// Helper: Parse help output
function parseHelpOutput(output) {
  const result = { commands: [], flags: [] };
  const lines = output.split('\n');
  let section = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Detect sections
    if (/^(Commands|Usage|Options|Flags):/i.test(trimmed)) {
      section = trimmed.split(':')[0].toLowerCase();
      continue;
    }

    if (!trimmed) continue;

    if (section === 'commands') {
      // Match "  command    Description"
      const match = line.match(/^\s{2,}(\w[\w-]*)\s+(.+)$/);
      if (match) {
        result.commands.push({ name: match[1], desc: match[2] });
      }
    } else if (section === 'options' || section === 'flags') {
      // Match "  --flag     Description" or "  -f, --flag Description"
      const match = line.match(/^\s{2,}(-[a-zA-Z0-9-]+(?:,\s+-[a-zA-Z0-9-]+)*)\s+(.+)$/);
      if (match) {
        // clean up flag names
        const names = match[1].split(',').map(s => s.trim());
        const primary = names.find(n => n.startsWith('--')) || names[0];
        result.flags.push({ name: primary, desc: match[2] });
      }
    }
  }
  return result;
}

// Dynamic Analysis: Try to run --help
let dynamicData = { commands: [], flags: [] };
const mainFile = path.join(absPath, analysis.main);

if (fs.existsSync(mainFile)) {
  try {
    const result = spawnSync('node', [mainFile, '--help'], { 
      encoding: 'utf-8', 
      timeout: 2000, // Don't hang
      cwd: absPath,  // Run in project dir
      env: { ...process.env, FORCE_COLOR: '0' } // Strip ANSI
    });

    if (result.stdout) {
      dynamicData = parseHelpOutput(result.stdout);
    }
  } catch (e) {
    // Ignore execution errors
  }
}

// Static Analysis (fallback/supplement)
const staticCommands = new Set();
const staticFlags = new Set();

const filesToAnalyze = new Set();
filesToAnalyze.add(mainFile);
for (const binPath of Object.values(analysis.bin)) {
  filesToAnalyze.add(path.join(absPath, binPath));
}

for (const entryPath of filesToAnalyze) {
  if (fs.existsSync(entryPath)) {
    try {
      const code = fs.readFileSync(entryPath, 'utf-8');
      
      // Look for command patterns
      const commandPatterns = [
        /case\s+['"`](\w+)['"`]\s*:/g,
        /args\[0\]\s*===?\s*['"`](\w+)['"`]/g,
        /command\s*===?\s*['"`](\w+)['"`]/g,
        /if\s*\(\s*\w+\s*===?\s*['"`](\w+)['"`]\s*\)/g,
      ];
      
      for (const pattern of commandPatterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
          const cmd = match[1];
          if (cmd && !['help', 'version', 'default', 'true', 'false', 'command', 'cmd', 'action', 'error', 'exit'].includes(cmd.toLowerCase())) {
            staticCommands.add(cmd);
          }
        }
      }

      // Look for flag patterns
      const flagPatterns = [
        /(?:===|==|case|includes\(|indexOf\()\s*['"`](-{1,2}[\w-]+)['"`]/g,
        /(?:argv|opts|flags)\.([a-zA-Z0-9_]+)/g,
      ];

      for (const pattern of flagPatterns) {
        let match;
        while ((match = pattern.exec(code)) !== null) {
          let flag = match[1];
          if (!flag.startsWith('-')) {
            if (flag.length === 1) flag = '-' + flag;
            else flag = '--' + flag;
          }
          if (flag && !['--', '-', '-1', '---', '--help', '-h', '--push', '--pop', '--shift', '--unshift', '--slice', '--splice', '--map', '--filter', '--reduce', '--forEach', '--find', '--join', '--includes', '--indexOf', '--toString', '--length', '--concat'].includes(flag)) {
             if (['--flag', '--cmd', '--opt', '--arg', '--args', '--foo', '--bar'].includes(flag)) continue;
             if (/^-{1,2}[a-zA-Z]/.test(flag)) {
                staticFlags.add(flag);
             }
          }
        }
      }
      
      const usageMatch = code.match(/Usage:\s*(.+)/i);
      if (usageMatch) {
        analysis.usage.push(usageMatch[1].trim());
      }
    } catch (e) {}
  }
}

// Merge Dynamic and Static Data
// Commands
const commandMap = new Map();
// Add static commands (no desc)
staticCommands.forEach(cmd => commandMap.set(cmd, ''));
// Add dynamic commands (overwrite with desc)
dynamicData.commands.forEach(cmd => commandMap.set(cmd.name, cmd.desc));

analysis.commands = Array.from(commandMap.entries())
  .map(([name, desc]) => ({ name, desc }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Flags
const flagMap = new Map();
// Add static flags
staticFlags.forEach(flag => flagMap.set(flag, ''));
// Add dynamic flags
dynamicData.flags.forEach(flag => flagMap.set(flag.name, flag.desc));

analysis.flags = Array.from(flagMap.entries())
  .map(([name, desc]) => ({ name, desc }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Build bin commands
const binCommands = Object.keys(analysis.bin);

// Check for LICENSE
const licenseExists = fs.existsSync(path.join(absPath, 'LICENSE'));

// JSON output
if (!flags.human && !flags.H) {
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
    readme += `| \`${cmd.name}\` | ${cmd.desc || ''} |\n`;
  }
  readme += '\n';
}

// Flags
if (analysis.flags.length > 0) {
  readme += `### Options\n\n`;
  readme += '| Option | Description |\n';
  readme += '|--------|-------------|\n';
  for (const flag of analysis.flags) {
    readme += `| \`${flag.name}\` | ${flag.desc || ''} |\n`;
  }
  readme += '\n';
}

// Examples
readme += `## Examples\n\n`;
readme += '```bash\n';
if (binCommands.length > 0) {
  const mainBin = binCommands[0];
  if (analysis.commands.length > 0) {
    readme += `# ${analysis.commands[0].desc || analysis.commands[0].name}\n`;
    readme += `${mainBin} ${analysis.commands[0].name}\n`;
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
    console.log(`   🔧 Commands: ${analysis.commands.map(c => c.name).join(', ')}`);
  }
  if (analysis.github) {
    console.log(`   🔗 GitHub: ${analysis.github.user}/${analysis.github.repo}`);
  }
}
