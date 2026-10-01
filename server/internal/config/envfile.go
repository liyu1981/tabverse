package config

import (
	"fmt"
	"os"
	"strings"
)

// The env file: a deployment's settings in a file instead of in the unit file,
// the Dockerfile or the shell. A single binary that reads its configuration
// from the process environment is easy to deploy, but a systemd unit or a
// `docker run -e` line is a worse place to keep ten settings, two of which are
// secrets, than a file you can chmod.
//
// The rules, chosen so that every existing way of running the server keeps
// working unchanged:
//
//   - **the real environment wins.** A key that is already set is never
//     overwritten, so systemd's EnvironmentFile, `docker run --env-file` and
//     `TABVERSED_SECRET=x ./tabversed` all still override the file.
//   - `.env` in the working directory is read when it exists, silently. The
//     development flow (`cd server && go run ./cmd/tabversed`) finds it without
//     anyone naming it.
//   - `TABVERSED_ENV_FILE` names the file instead, and a path that cannot be
//     read is a **startup error**. Asking for a file and silently running
//     without it is how a deployment ends up with a generated auth secret and
//     no idea why everybody is signed out.
//   - `KEY=VALUE` lines, `#` comments, blank lines, an optional `export`, and
//     optional single or double quotes around the value. Nothing else: no
//     `${VAR}` interpolation, no command substitution, no inline comments after
//     the value (quote the value if it contains `#`). It is a file of literals -
//     a parser that ran a shell would be the interesting bug in this file.
//
// An empty value is *not* the same as an absent one: `KEY=` sets an empty
// string, and every setting here treats an empty string as "use the default", so
// `TABVERSED_LINK_BY_EMAIL=` is a no-op rather than a way to turn it off. Write
// `TABVERSED_LINK_BY_EMAIL=false` (or `0`).

const (
	// EnvFileVar names the env file to read instead of the default.
	EnvFileVar = "TABVERSED_ENV_FILE"
	// EnvFileName is the file read when EnvFileVar is unset.
	EnvFileName = ".env"
)

type envPair struct {
	key   string
	value string
	line  int
}

// LoadEnvFile reads the env file into the process environment. It is called
// once, at startup, before Load - which then reads the process environment
// exactly as before, so nothing downstream knows this happened.
//
// Returns the path it loaded, or "" when there was no default file to load.
func LoadEnvFile() (string, error) {
	requested := strings.TrimSpace(os.Getenv(EnvFileVar))
	path := requested
	if path == "" {
		path = EnvFileName
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && requested == "" {
			return "", nil
		}
		return "", fmt.Errorf("%s: %w", path, err)
	}
	pairs, err := parseEnvFile(string(data))
	if err != nil {
		return "", fmt.Errorf("%s: %w", path, err)
	}
	loaded := 0
	for _, pair := range pairs {
		if _, ok := os.LookupEnv(pair.key); ok {
			// the real environment already answered this one
			continue
		}
		if err := os.Setenv(pair.key, pair.value); err != nil {
			return "", fmt.Errorf("%s: line %d: %w", path, pair.line, err)
		}
		loaded++
	}
	return path, nil
}

// parseEnvFile turns the file into pairs, and refuses anything it cannot read
// with a line number: a typo in a file holding two secrets should stop the
// server at startup, not leave one setting quietly at its default.
func parseEnvFile(src string) ([]envPair, error) {
	var out []envPair
	for i, raw := range strings.Split(src, "\n") {
		lineNo := i + 1
		line := strings.TrimSpace(strings.TrimRight(raw, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if rest, ok := strings.CutPrefix(line, "export "); ok {
			line = strings.TrimSpace(rest)
		}
		name, value, ok := strings.Cut(line, "=")
		if !ok {
			return nil, fmt.Errorf("line %d: not KEY=VALUE: %q", lineNo, raw)
		}
		key := strings.TrimSpace(name)
		if !validEnvKey(key) {
			return nil, fmt.Errorf("line %d: not a valid key: %q", lineNo, name)
		}
		value = strings.TrimSpace(value)
		if len(value) >= 2 {
			first, last := value[0], value[len(value)-1]
			if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		out = append(out, envPair{key: key, value: value, line: lineNo})
	}
	return out, nil
}

func validEnvKey(key string) bool {
	for i, r := range key {
		switch {
		case r >= 'A' && r <= 'Z', r >= 'a' && r <= 'z', r == '_':
		case i > 0 && r >= '0' && r <= '9':
		default:
			return false
		}
	}
	return key != ""
}
