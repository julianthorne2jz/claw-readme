# claw-readme

## Install

```bash
git clone https://github.com/julianthorne2jz/claw-readme
cd claw-readme
npm link
```

Now you can use `claw-readme` from anywhere.


Generate README.md from code analysis for AI agents and developers.

## Why

Every project needs a good README. This tool analyzes your project and generates a starting point with:
- Installation instructions (npm/npx)
- CLI commands (auto-detected from source code)
- GitHub badges (optional)
- License section

## Installation

```bash
npm install -g claw-readme
# or
npx claw-readme
```

## Usage

```bash
claw-readme [path] [options]
```

### Options

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help |
| `-j, --json` | Output analysis as JSON |
| `-f, --force` | Overwrite existing README |
| `-s, --stdout` | Preview to stdout (no write) |
| `-b, --badges` | Include GitHub badges |

## Examples

```bash
# Preview README for current directory
claw-readme --stdout

# Generate with badges
claw-readme --badges --force

# Analyze a specific project
claw-readme ./my-project --stdout

# Get JSON analysis
claw-readme --json
```

## What It Detects

- **package.json**: name, description, version, scripts, bin commands
- **Entry points**: CLI commands from switch/case patterns
- **Flags**: Command-line options/flags detected in source code
- **Git remote**: GitHub user/repo for badges
- **License**: From LICENSE file or package.json

## License

MIT © Julian Thorne
