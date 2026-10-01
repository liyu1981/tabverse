package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The env file is where a deployment keeps two secrets and ten settings, so
// the tests are about the three things that can go wrong quietly: a key that
// should be overridden being overwritten, a line that is not a setting being
// skipped, and a file that was asked for not being there.
const (
	testKeyAddr = "TABVERSED_TEST_ADDR"
	testKeyWord = "TABVERSED_TEST_WORD"
	testKeyBoth = "TABVERSED_TEST_BOTH"
)

// writeEnvFile writes a file and returns its path. The keys are unique to this
// test file so nothing here can disturb a real setting.
func writeEnvFile(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write env file: %v", err)
	}
	return path
}

// forget removes the keys a test set through the loader, which bypasses
// t.Setenv's restore.
func forget(t *testing.T, keys ...string) {
	t.Helper()
	t.Cleanup(func() {
		for _, k := range keys {
			os.Unsetenv(k)
		}
	})
}

func TestEnvFileIsReadAndTheSettingsTakeEffect(t *testing.T) {
	forget(t, testKeyAddr, testKeyWord)
	path := writeEnvFile(t, "custom.env", testKeyAddr+"=127.0.0.1:9999\n"+
		`TABVERSED_TEST_WORD="two words"`+"\n")
	t.Setenv(EnvFileVar, path)

	loaded, err := LoadEnvFile()
	if err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}
	if loaded != path {
		t.Errorf("loaded %q, want %q", loaded, path)
	}
	if got := os.Getenv(testKeyAddr); got != "127.0.0.1:9999" {
		t.Errorf("%s = %q", testKeyAddr, got)
	}
	// quotes are stripped, so a value with a space in it needs none of them
	if got := os.Getenv(testKeyWord); got != "two words" {
		t.Errorf("%s = %q, want %q", testKeyWord, got, "two words")
	}
}

// The reason the file is not the last word: a systemd EnvironmentFile, a docker
// --env-file or a one-off `VAR=x ./tabversed` must still win, or rolling back a
// deployment would mean editing a file it is not running from.
func TestTheRealEnvironmentWinsOverTheFile(t *testing.T) {
	forget(t, testKeyAddr)
	path := writeEnvFile(t, "custom.env", testKeyAddr+"=from-the-file\n")
	t.Setenv(EnvFileVar, path)
	t.Setenv(testKeyAddr, "from-the-environment")

	if _, err := LoadEnvFile(); err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}
	if got := os.Getenv(testKeyAddr); got != "from-the-environment" {
		t.Errorf("%s = %q, want the environment's value", testKeyAddr, got)
	}
}

// A file that was asked for by name and is not there is a mistake worth failing
// on: the alternative is a deployment that starts with a generated auth secret
// and nobody signed in.
func TestAMissingNamedFileIsAnError(t *testing.T) {
	t.Setenv(EnvFileVar, filepath.Join(t.TempDir(), "nope.env"))

	if _, err := LoadEnvFile(); err == nil {
		t.Fatal("a TABVERSED_ENV_FILE that does not exist should be an error")
	}
}

// ...while no file at all is the normal case for every existing deployment, and
// for the tests.
func TestNoFileIsNotAnError(t *testing.T) {
	t.Setenv(EnvFileVar, "")

	// the working directory in a test is the package directory, which has no
	// .env; an empty path means "loaded nothing"
	loaded, err := LoadEnvFile()
	if err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}
	if loaded != "" {
		t.Errorf("loaded %q with no file present", loaded)
	}
}

func TestEnvFileSyntax(t *testing.T) {
	forget(t, testKeyAddr, testKeyWord, testKeyBoth)
	content := "# a comment\n" +
		"\n" +
		"   \n" +
		"export " + testKeyAddr + "=127.0.0.1:9999\r\n" + // CRLF, with export
		testKeyWord + "='single quoted'\n" +
		testKeyBoth + "=plain\n"
	path := writeEnvFile(t, "custom.env", content)
	t.Setenv(EnvFileVar, path)

	if _, err := LoadEnvFile(); err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}
	if got := os.Getenv(testKeyAddr); got != "127.0.0.1:9999" {
		t.Errorf("%s = %q (a CRLF line or the export prefix left something behind)", testKeyAddr, got)
	}
	if got := os.Getenv(testKeyWord); got != "single quoted" {
		t.Errorf("%s = %q, want the quoted value without its quotes", testKeyWord, got)
	}
	if got := os.Getenv(testKeyBoth); got != "plain" {
		t.Errorf("%s = %q", testKeyBoth, got)
	}
}

// A typo in the file must stop the server, not leave one setting at its default
// while everybody believes it was set.
func TestEnvFileRejectsWhatItCannotRead(t *testing.T) {
	for _, content := range []string{
		"TABVERSED_ADDR=0.0.0.0:8223\nnot a setting\n", // no '='
		"=value\n",           // no key
		"TABVERSED-NOPE=1\n", // not an identifier
		"1BAD=1\n",           // identifier starts with a digit
	} {
		t.Run(strings.ReplaceAll(content, "\n", "_"), func(t *testing.T) {
			path := writeEnvFile(t, "bad.env", content)
			t.Setenv(EnvFileVar, path)

			_, err := LoadEnvFile()
			if err == nil {
				t.Fatalf("content %q was accepted", content)
			}
			if !strings.Contains(err.Error(), "line") {
				t.Errorf("the error should name the line: %v", err)
			}
		})
	}
}

// An empty value is not a way to turn something off here: every setting treats
// "" as "use the default". Worth pinning, because a file is exactly where
// somebody would reach for it.
func TestAnEmptyValueIsAnEmptyString(t *testing.T) {
	forget(t, testKeyBoth)
	path := writeEnvFile(t, "custom.env", testKeyBoth+"=\n")
	t.Setenv(EnvFileVar, path)

	if _, err := LoadEnvFile(); err != nil {
		t.Fatalf("LoadEnvFile: %v", err)
	}
	if got, ok := os.LookupEnv(testKeyBoth); !ok || got != "" {
		t.Errorf("%s = %q (present=%v), want set and empty", testKeyBoth, got, ok)
	}
}
