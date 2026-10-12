package config

import "strings"

// UpgradeEnvFile merges a deployment's current .env into a newer settings
// template.
//
// The template is the authority on *which* settings exist and how they are
// documented; the old file is the authority on their *values*. So the result is
// the new template, line for line, with every setting the old file actually set
// uncommented and carrying its old value. A setting the template no longer
// documents is appended under a comment rather than dropped, because an upgrade
// is the wrong moment to lose a value silently.
//
// It is a pure function so the merge can be tested without touching a disk; the
// caller does the backup and the write.
func UpgradeEnvFile(oldContent string, template []byte) (string, error) {
	pairs, err := parseEnvFile(oldContent)
	if err != nil {
		return "", err
	}
	// The file's own semantics are "the last assignment wins" (os.Setenv in
	// order), so the map keeps the last one and `order` keeps first-seen order
	// for the trailing section.
	old := map[string]string{}
	var order []string
	for _, pair := range pairs {
		if _, seen := old[pair.key]; !seen {
			order = append(order, pair.key)
		}
		old[pair.key] = pair.value
	}

	applied := map[string]bool{}
	var out strings.Builder
	// Trim one trailing newline so a template that ends in one does not gain a
	// blank line; every line is written back with its own newline.
	for _, line := range strings.Split(strings.TrimSuffix(string(template), "\n"), "\n") {
		if key, ok := templateKey(line); ok {
			if value, found := old[key]; found {
				out.WriteString(key + "=" + quoteEnvValue(value) + "\n")
				applied[key] = true
				continue
			}
		}
		out.WriteString(line + "\n")
	}

	var kept []string
	for _, key := range order {
		if !applied[key] {
			kept = append(kept, key+"="+quoteEnvValue(old[key]))
		}
	}
	if len(kept) > 0 {
		out.WriteString("\n# Kept from your previous .env: not in the current template.\n")
		for _, line := range kept {
			out.WriteString(line + "\n")
		}
	}
	return out.String(), nil
}

// templateKey is the KEY of a template line, live or commented out: the
// template documents every variable as `#KEY=default`, so the comment marker is
// not part of the key.
func templateKey(line string) (string, bool) {
	trimmed := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "#"))
	trimmed = strings.TrimSpace(strings.TrimPrefix(trimmed, "export "))
	name, _, ok := strings.Cut(trimmed, "=")
	if !ok {
		return "", false
	}
	key := strings.TrimSpace(name)
	if !validEnvKey(key) {
		return "", false
	}
	return key, true
}

// quoteEnvValue preserves a value the parser would otherwise trim. An inline
// `#` is not a comment to this parser - only a line that starts with one is -
// so surrounding whitespace is the only thing worth quoting. The parser strips
// the surrounding quotes without unescaping, so a value containing the quote
// character itself falls back to the other quote.
func quoteEnvValue(value string) string {
	if value == strings.TrimSpace(value) {
		return value
	}
	if !strings.Contains(value, `"`) {
		return `"` + value + `"`
	}
	if !strings.Contains(value, "'") {
		return "'" + value + "'"
	}
	return value
}
